let currentUser = null;
let socket = null;
let selectedUser = null;

// DOM Elements
const authSection = document.getElementById('authSection');
const chatSection = document.getElementById('chatSection');
const authTitle = document.getElementById('authTitle');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const usernameInput = document.getElementById('username');
const authBtn = document.getElementById('authBtn');
const toggleAuth = document.getElementById('toggleAuth');
const switchForm = document.getElementById('switchForm');
const usersList = document.getElementById('usersList');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

let isLogin = true;

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const installBtn = document.createElement('button');
  installBtn.textContent = 'Install Chat App';
  document.body.appendChild(installBtn);

  installBtn.addEventListener('click', () => {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') console.log('App installed');
      deferredPrompt = null;
      installBtn.remove();
    });
  });
});


// Toggle Login/Register Form
function toggleForm(e) {
  if (e) e.preventDefault();
  isLogin = !isLogin;
  authTitle.textContent = isLogin ? 'Login' : 'Register';
  authBtn.textContent = isLogin ? 'Login' : 'Register';
  usernameInput.style.display = isLogin ? 'none' : 'block';
  toggleAuth.innerHTML = isLogin
    ? 'Don\'t have an account? <a href="#" id="switchForm">Register</a>'
    : 'Already have an account? <a href="#" id="switchForm">Login</a>';
  
  const newSwitch = document.getElementById('switchForm');
  if (newSwitch) newSwitch.addEventListener('click', toggleForm);
}

// Initialize toggle listener
if (switchForm) switchForm.addEventListener('click', toggleForm);

// Auth Submit
authBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const username = usernameInput.value.trim();

  if (!email || !password || (!isLogin && !username)) {
    alert('Please fill all fields');
    return;
  }

  try {
    const url = isLogin ? '/api/login' : '/api/register';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isLogin ? { email, password } : { username, email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (isLogin) {
      localStorage.setItem('token', data.token);
      currentUser = data.user;

      // Service Worker & Push
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => navigator.serviceWorker.ready)
          .then(reg => reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
          }))
          .then(sub => fetch('/api/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.token}`
            },
            body: JSON.stringify({ subscription: sub })
          }))
          .then(() => console.log('✅ Push subscription saved'))
          .catch(err => console.error('❌ Push setup failed:', err));
      }

      // Socket.io
      socket = io({ auth: { token: data.token } });
      socket.on('message', addMessage);
      socket.on('error', err => alert(err.message));

      authSection.style.display = 'none';
      chatSection.classList.add('active');
      loadUsers();
    } else {
      alert('Registration successful! Please login.');
      isLogin = true;
      toggleForm();
    }

  } catch (err) {
    alert(err.message || 'Operation failed');
  }
});

// Load Users
async function loadUsers() {
  const res = await fetch('/api/users', {
    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
  });
  const users = await res.json();

  usersList.innerHTML = users.map(u => `
    <div class="user-item" data-id="${u.id}">
      <span class="online-indicator"></span>
      ${u.username}
    </div>
  `).join('');

  document.querySelectorAll('.user-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.user-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      selectedUser = users.find(u => u.id == item.dataset.id);
      loadMessages(selectedUser.id);
      messageInput.disabled = false;
      sendBtn.disabled = false;
    });
  });
}

// Load Messages
async function loadMessages(userId) {
  const res = await fetch(`/api/messages/${userId}`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
  });
  const messages = await res.json();
  messagesDiv.innerHTML = '';
  messages.forEach(msg => addMessage(msg, true));
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Add message
function addMessage(msg, isInitial=false) {
  const isOwn = isInitial ? msg.sender_id === currentUser.id : msg.isOwn;
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : 'other'}`;
  div.innerHTML = `
    <div>${msg.content}</div>
    <small>${new Date(msg.created_at).toLocaleTimeString()}</small>
  `;
  messagesDiv.appendChild(div);
  if (!isInitial) messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message
sendBtn.addEventListener('click', () => {
  const content = messageInput.value.trim();
  if (!content || !selectedUser) return;

  socket.emit('send_message', {
    receiverId: selectedUser.id,
    content
  });

  messageInput.value = '';
});

messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') sendBtn.click();
});

// Utility: VAPID
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Request notification permission on load
if ('Notification' in window) Notification.requestPermission();
