// === FULL BACKEND CODE ===
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const webpush = require('web-push');
const { Pool } = require('pg');
const path = require('path');

// CONFIG
const VAPID_PUBLIC_KEY = 'BOaLqXqBZn2kkuNwgB5HRVaaf_PpgDhMyXtfnc-7l7Px20sluLtmQxZ1IoE5gZC1g7xLaWTrSTv2-UwxF8dJtAM';
const VAPID_PRIVATE_KEY = 'fs_8HvYz9PfJQVVDcT3TUhQh2-ZwD1jhGjHZ9LVNy40';
const JWT_SECRET = 'supersecret123!@#';
const PORT = process.env.PORT || 5000;

// Initialize VAPID
webpush.setVapidDetails(
  'mailto:admin@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// PostgreSQL Pool
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_ZS1hyJvEkRL9@ep-holy-pond-adhxy251-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: { rejectUnauthorized: false }
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", "http:", "https:"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(morgan('combined'));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve service worker
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// AUTH ROUTES
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users(username, email, password_hash) VALUES($1, $2, $3) RETURNING id, username, email',
      [username, email, hashed]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.code === '23505' ? 'User exists' : 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email },
      vapidPublicKey: VAPID_PUBLIC_KEY
    });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// SUBSCRIBE PUSH NOTIFICATIONS
app.post('/api/subscribe', authenticateToken, async (req, res) => {
  try {
    const subscription = req.body.subscription;

    // Ensure user_push_subscriptions table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        subscription JSONB NOT NULL
      )
    `);

    // Check for duplicate
    const existing = await pool.query(
      'SELECT * FROM user_push_subscriptions WHERE user_id = $1 AND subscription = $2',
      [req.user.id, subscription]
    );

    if (!existing.rows.length) {
      await pool.query(
        'INSERT INTO user_push_subscriptions(user_id, subscription) VALUES($1, $2)',
        [req.user.id, subscription]
      );
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Subscription failed' });
  }
});

// GET USERS
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE id != $1',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET MESSAGES
app.get('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.username as sender_name 
       FROM messages m 
       JOIN users u ON m.sender_id = u.id 
       WHERE (m.sender_id = $1 AND m.receiver_id = $2) 
          OR (m.sender_id = $2 AND m.receiver_id = $1)
       ORDER BY m.created_at`,
      [req.user.id, req.params.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// SOCKET.IO
const userSockets = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  userSockets.set(socket.user.id, socket.id);

  socket.on('send_message', async (data) => {
    try {
      const result = await pool.query(
        'INSERT INTO messages(sender_id, receiver_id, content) VALUES($1, $2, $3) RETURNING *',
        [socket.user.id, data.receiverId, data.content]
      );
      const message = result.rows[0];

      // Send to sender
      socket.emit('message', { ...message, sender_name: socket.user.username, isOwn: true });

      // Send to receiver via socket if online
      const receiverSocket = userSockets.get(data.receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit('message', { ...message, sender_name: socket.user.username, isOwn: false });
      }

      // Send push notification to all subscriptions of receiver
      const subs = await pool.query(
        'SELECT subscription FROM user_push_subscriptions WHERE user_id = $1',
        [data.receiverId]
      );

      subs.rows.forEach(s => {
        webpush.sendNotification(
          s.subscription,
          JSON.stringify({
            title: 'New Message',
            body: `${socket.user.username}: ${data.content.substring(0, 30)}...`,
            icon: '/icon-192x192.png'
          })
        ).catch(err => console.error('Push error:', err));
      });

    } catch (e) {
      console.error('Message send error:', e);
      socket.emit('error', { message: 'Send failed' });
    }
  });

  socket.on('disconnect', () => {
    userSockets.delete(socket.user.id);
  });
});

// Serve frontend
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// START SERVER
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`VAPID Public Key: ${VAPID_PUBLIC_KEY}`);
});
