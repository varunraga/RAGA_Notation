/* Kriti Notation Studio — service worker
   Strategy:
   - App shell (index.html, manifest, icons): cache-first, falls back to
     network, and refreshes the cache in the background on every fetch
     (stale-while-revalidate) so edits you deploy show up without forcing
     a full reinstall.
   - Third-party library scripts/fonts (docx, pdf.js, jszip, Google Fonts):
     cache-first with a network fallback, so the editor keeps working
     offline once they've been fetched once.
   - Google Identity Services (accounts.google.com) is NEVER intercepted —
     sign-in requires a live network round-trip and caching it would just
     break Drive sync.
   Bump CACHE_VERSION whenever index.html (or anything precached) changes,
   so returning users get the update instead of a stale cached copy. */

const CACHE_VERSION = 'kriti-studio-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192x192.png',
  './icon-512x512.png',
];

const NEVER_CACHE_HOSTS = ['accounts.google.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return; // let the browser handle it directly

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          // Only cache successful, basic/CORS-ok responses.
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to whatever's cached, if anything

      // Stale-while-revalidate: return cached instantly if we have it,
      // otherwise wait on the network.
      return cached || networkFetch;
    })
  );
});
