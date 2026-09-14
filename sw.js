// CA Study — service worker. Caches the app shell so it works offline.
// All actual data lives in IndexedDB, which this worker never touches —
// updating/replacing these files never affects your saved notes/data.
//
// Strategy: network-first for the app shell. When you're online, you
// always get the latest index.html/app.js straight away; the cache is
// only a fallback for when you're offline. Bump CACHE_NAME whenever you
// deploy a new version so old caches get cleared out automatically.
const CACHE_NAME = 'castudy-cache-v10';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './sidebar-logo.png',
  './favicon-32.png',
  './favicon-16.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting(); // activate this new version immediately, don't wait for old tabs to close
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control of any already-open windows (including the installed PWA) right away
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)) // offline fallback only
  );
});
