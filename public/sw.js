/* dor service worker. Deliberately tiny and privacy-preserving.
 * Caches ONLY immutable build assets (/_next/static/*), the icons and the manifest.
 * Everything else (navigation, API, Clerk, SpacetimeDB, journal/reflection data) is
 * network-only and never stored. No push, no notifications, no offline journaling. */
const CACHE = 'dor-static-v1';
const PRECACHE = [
  '/manifest.webmanifest',
  '/pwa-icon/icon-192.png',
  '/pwa-icon/icon-512.png',
  '/pwa-icon/icon-maskable-512.png',
  '/pwa-icon/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Same-origin only; cross-origin (Clerk, SpacetimeDB, providers) is never touched.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/_next/static/')) return; // network-only by default
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
});
