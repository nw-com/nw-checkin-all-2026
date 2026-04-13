// Version: 2.0 (Offline App Shell + Runtime Cache)
const ICON_URL = './logo.svg';
const BADGE_URL = './badge.svg';

const CACHE_VERSION = 'v2.0.0';
const APP_SHELL_CACHE = `nw-checkin-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `nw-checkin-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './firebase-config.js',
  './logo.svg',
  './badge.svg',
  './check.html',
  './feedback.html',
  './patrol.html',
  './salary.html',
  './schedule.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('nw-checkin-') && !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isDoc = req.mode === 'navigate' || req.destination === 'document';

  if (isDoc) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(APP_SHELL_CACHE);
          cache.put(req, res.clone());
          return res;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const fallback = await caches.match('./index.html');
          return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(isSameOrigin ? APP_SHELL_CACHE : RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) {
        event.waitUntil(
          fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            })
            .catch(() => {})
        );
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});

self.addEventListener('push', (event) => {
  if (Notification.permission !== 'granted') return;

  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: '通知', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '通知';
  const options = {
    body: payload.body || '',
    icon: payload.icon || ICON_URL,
    badge: payload.badge || BADGE_URL,
    data: payload.data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification?.data?.url;
  if (!url) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
