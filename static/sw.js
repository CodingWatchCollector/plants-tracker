const _SW_VERSION = '1.0.1'; // bump this on every change

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title ?? '🌿 Plant Tracker', {
      body: data.body ?? 'Time to check your plants.',
      icon: '/favicon.svg',
      badge: '/apple-touch-icon.png',
      tag: 'watering-reminder',
      renotify: true,
      data: { url: data.url ?? '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const existing = clientList.find(c => c.url === url && 'focus' in c);
        if (existing) return existing.focus();
        return clients.openWindow(url);
      })
  );
});