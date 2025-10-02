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

// Toggle between login/register
let isLogin = true;
switchForm.addEventListener('click', (e) => {
  e.preventDefault();
  isLogin = !isLogin;
  authTitle.textContent = isLogin ? 'Login' : 'Register';
  authBtn.textContent = isLogin ? 'Login' : 'Register';
  usernameInput.style.display = isLogin ? 'none' : 'block';
  toggleAuth.innerHTML = isLogin 
    ? 'Don\'t have an account? <a href="#" id="switchForm">Register</a>' 
    : 'Already have an account? <a href="#" id="switchForm">Login</a>';
  document.getElementById('switchForm').addEventListener('click', toggleForm);
});

function toggleForm(e) {
  e.preventDefault();
  isLogin = !isLogin;
  authTitle.textContent = isLogin ? 'Login' : 'Register';
  authBtn.textContent = isLogin ? 'Login' : 'Register';
  usernameInput.style.display = isLogin ? 'none' : 'block';
  toggleAuth.innerHTML = isLogin 
    ? 'Don\'t have an account? <a href="#" id="switchForm">Register</a>' 
    : 'Already have an account? <a href="#" id="switchForm">Login</a>';
  document.getElementById('switchForm').addEventListener('click', toggleForm);
}

// Auth form submission
authBtn.addEventListener('click', async () => {
  const email = emailInput.value;
  const password = passwordInput.value;
  const username = usernameInput.value;
  
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
      
      // Initialize service worker
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(reg => {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
          });
        }).then(sub => {
          return fetch('/api/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.token}`
            },
            body: JSON.stringify({ subscription: sub })
          });
        }).catch(console.error);
      }
      
      // ✅ FIXED: Connect to same origin (no URL needed)
      socket = io({  // ←←← REMOVED 'http://localhost:5000'
        auth: { token: data.token }
      });
      
      socket.on('message', addMessage);
      socket.on('error', (err) => alert(err.message));
      
      // Show chat
      authSection.style.display = 'none';
      chatSection.classList.add('active');
      loadUsers();
    } else {
      alert('Registration successful! Please login.');
      isLogin = true;
      toggleForm({ preventDefault: () => {} });
    }
  } catch (err) {
    alert(err.message || 'Operation failed');
  }
});

// Load users
async function loadUsers() {
  const res = await fetch('/api/users', {
    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
  });
  const users = await res.json();
  
  usersList.innerHTML = users.map(user => 
    `<div class="user-item" data-id="${user.id}">
      <span class="online-indicator"></span>
      ${user.username}
    </div>`
  ).join('');
  
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

// Load messages
async function loadMessages(userId) {
  const res = await fetch(`/api/messages/${userId}`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
  });
  const messages = await res.json();
  messagesDiv.innerHTML = '';
  messages.forEach(msg => addMessage(msg, true));
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Add message to UI
function addMessage(message, isInitial = false) {
  const isOwn = isInitial ? message.sender_id == currentUser.id : message.isOwn;
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : 'other'}`;
  div.innerHTML = `
    <div>${message.content}</div>
    <small>${new Date(message.created_at).toLocaleTimeString()}</small>
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

// Press Enter to send
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendBtn.click();
});

// Utility: Convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Request notification permission
if ('Notification' in window) {
  Notification.requestPermission();
}

// Initialize switch form listener
document.getElementById('switchForm').addEventListener('click', toggleForm);
