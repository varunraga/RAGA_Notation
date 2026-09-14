/* Kriti Notation Studio — service worker
   Strategy:
   - The app shell itself (the HTML document — index.html / navigations to
     './') is NETWORK-FIRST, not cache-first: always try a live fetch when
     online, and only fall back to whatever's cached if that fails (i.e.
     genuinely offline). This is the fix for a real, confirmed problem —
     see the long comment below — where every deploy needed a second full
     close-and-reopen before it actually showed up.
   - Third-party library scripts/fonts (docx, pdf.js, jszip, Google Fonts)
     and other static assets stay cache-first with a network fallback
     (stale-while-revalidate), so the editor keeps working offline once
     they've been fetched once, and repeat loads don't re-download files
     that essentially never change.
   - Google Identity Services (accounts.google.com) and the Google Drive
     API (www.googleapis.com) are NEVER intercepted — sign-in requires a
     live network round-trip, and so does every single Drive read. Drive's
     checksum-check and file-download calls hit the exact same URL every
     time (same file ID), which is precisely the shape of request a
     stale-while-revalidate strategy handles WORST: it returns whatever
     was cached from the very first call, instantly, without waiting for
     the network — silently, with a normal-looking 200, no error anywhere.
     That meant every "has Drive changed?" check could have been answered
     from a frozen-in-time snapshot instead of Drive's actual current
     state, on any device, indefinitely — which looks exactly like "sync
     succeeds but nothing ever actually updates." Confirmed directly:
     DevTools' Network tab showed sw.js as the initiator on the
     checksum-check requests.

   WHY THE APP SHELL NEEDED ITS OWN FIX, SEPARATELY FROM THE ABOVE: the
   exact same "return cached instantly, refetch in the background for next
   time" logic used to apply to index.html itself too, since only the two
   Google hosts were ever excluded from it — the page you're looking at was
   never actually exempt from being served stale. That meant: deploy a fix,
   reload the page — the service worker hands back the OLD cached HTML
   immediately, and only quietly fetches the new one in the background for
   NEXT time. The very reload that was supposed to pick up the fix couldn't;
   it always took a second full reload afterward before the update was ever
   visible, no matter how correctly the deploy itself went. A live network
   fetch for the page itself is cheap and fast — there's no good reason to
   ever be a version behind just to save that one request.

   Bump CACHE_VERSION whenever anything precached changes, so returning
   users get the update instead of a stale cached copy. Bumped here too,
   specifically so any device that already has the old, buggy worker
   installed is forced onto this fixed one rather than continuing to run
   its own already-cached version of this very file. */

const CACHE_VERSION = 'kriti-studio-v4';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192x192.png',
  './icon-512x512.png',
];

const NEVER_CACHE_HOSTS = ['accounts.google.com', 'www.googleapis.com'];

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

  // The app shell document: network-first, cache only as an offline fallback. Covers an
  // actual page navigation (opening/reloading the app or the installed PWA) as well as a
  // direct request for index.html or the site root, in case something requests those without
  // it registering as a "navigate".
  const isAppShellDoc = req.mode === 'navigate'
    || url.pathname.endsWith('/index.html')
    || url.pathname === new URL('./', self.registration.scope).pathname;

  if (isAppShellDoc) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)) // offline: fall back to whatever's cached, if anything
    );
    return;
  }

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
