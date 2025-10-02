self.addEventListener('push', function(event) {
  const data = event.data.json();
  const options = {
    body: data.body || 'You have a new message',
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
     data
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Chat App', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
