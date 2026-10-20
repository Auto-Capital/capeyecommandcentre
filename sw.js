// CapEye Auto Capital | CapEye Final V1.1
// Build: v20261020  (bump this on each release so old caches are purged)
const CACHE_NAME = 'capeye-v20261020b';

// Install — activate immediately, don't wait
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activate — delete ALL old caches, take control immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => caches.delete(k))  // Delete every old cache
    )).then(() => self.clients.claim())
  );
});

// Fetch — NETWORK FIRST. Always try to get fresh version.
// Only fall back to cache if completely offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // For HTML and JS files — always go to network first
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Got fresh version from network — use it
        return res;
      })
      .catch(() => {
        // Only if offline — try cache
        return caches.match(e.request);
      })
  );
});

// Push notifications
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {title:'CapEye', body:'New notification'};
  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: '/auto-capital-logo.png',
      data: d.url || '/'
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data || '/'));
});
