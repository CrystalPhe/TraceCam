// TraceCam service worker: caches the app shell only (our own HTML/CSS/JS/icons).
// It never touches camera streams, blob: image URLs, or anything cross-origin.
//
// Strategy: NETWORK-FIRST for same-origin GET requests, falling back to the
// cache when offline. That means when you are online you always get the newest
// files (no stale-version trap); offline you get the last cached copy.
//
// To ship an update: change VERSION below (and commit). Old caches are deleted
// on activate. The page shows an "Update" button when a new worker is waiting.

const VERSION = 'v1.0.0';
const CACHE = `tracecam-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/camera.js',
  'js/gestures.js',
  'js/image-loader.js',
  'js/prefs.js',
  'js/transform.js',
  'js/wakelock.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' bypasses the HTTP cache so we store fresh copies.
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))),
  );
  // No skipWaiting() here: the page asks for it (SKIP_WAITING) when the user taps Update.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('tracecam-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never handle other origins

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        return new Response('TraceCam is offline and this file is not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })(),
  );
});
