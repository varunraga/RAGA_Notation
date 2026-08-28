# Kriti Notation Studio

A single-page app for building tala-aware Carnatic music kriti notation (swara +
sahitya grids), with in-browser Word/PDF export and Google Drive sync. Packaged
as an installable Progressive Web App (PWA). All files sit at the repo root —
no subfolders.

## Files in this repo

```
index.html                       the entire app (markup, styles, logic — one file)
manifest.webmanifest             PWA manifest (name, icons, colors, display mode)
sw.js                            service worker — enables install + offline use
favicon.ico                      classic browser-tab favicon (16/32/48 multi-res)
icon-16x16.png … icon-512x512.png  app icons at every size (see table below)
apple-touch-icon.png             iOS home-screen icon
maskable-icon-192x192.png,
maskable-icon-512x512.png        Android adaptive-icon variants
kriti-docx-generator.js          standalone Node CLI companion (NOT part of the web app)
package.json                     dependencies for the Node CLI above
.nojekyll, .gitignore
README.md
```

## Deploying to GitHub Pages

1. Upload every file above to the repo (root of `main`, or a `/docs` folder —
   either works, just match what you pick in step 2).
2. In the repo: **Settings → Pages → Build and deployment → Source**, pick
   "Deploy from a branch," then select the branch/folder you used.
3. GitHub gives you a URL like `https://<username>.github.io/<repo>/`. Open it —
   `index.html` is served automatically as the root document.
4. On desktop Chrome/Edge, an install icon appears in the address bar. On
   Android Chrome, a "Install app" / "Add to Home screen" prompt appears. On
   iOS Safari, use Share → **Add to Home Screen** (iOS doesn't support the
   automatic install prompt, but the manifest + icons still make the home
   screen icon and splash look correct).

All paths in `index.html`, `manifest.webmanifest`, and `sw.js` are **relative**
(`./`), so this works whether you host it at the domain root or under a repo
subpath like `/kriti-notation-studio/` — no path edits needed either way.

## How the offline/install behavior works

- `manifest.webmanifest` declares the app's name, theme colors, display mode
  (`standalone`, so it opens without browser chrome once installed), and the
  full icon set.
- `sw.js` is a service worker that:
  - Precaches the app shell (`index.html`, manifest, core icons) on install.
  - Caches third-party library scripts (docx.js, pdf.js, JSZip, Google Fonts)
    the first time they're fetched, so the editor keeps working offline after
    that.
  - Deliberately **never** intercepts `accounts.google.com` requests — Google
    sign-in for Drive sync needs a live network round-trip, and caching it
    would just break the sync flow.
  - Uses stale-while-revalidate: cached content is served instantly, while a
    background fetch refreshes the cache for next time.
- Bump `CACHE_VERSION` in `sw.js` any time you change `index.html` (or add/
  remove precached files) so returning visitors pick up the new version
  instead of a stale cached copy.

## Icons

Generated from the submitted logo art at every size current platforms ask for:

| File | Size | Purpose |
|---|---|---|
| `favicon.ico` | 16/32/48 (multi-res) | classic browser tab favicon |
| `icon-16x16.png` / `icon-32x32.png` | 16, 32 | browser tab (PNG fallback) |
| `icon-72x72.png` … `icon-384x384.png` | 72–384 | Android home-screen / splash at various densities |
| `icon-192x192.png`, `icon-512x512.png` | 192, 512 | required manifest sizes (Android install, Chrome install prompt) |
| `apple-touch-icon.png` | 180 | iOS home-screen icon (flattened onto the art's dark background — iOS ignores transparency) |
| `maskable-icon-192x192.png`, `maskable-icon-512x512.png` | 192, 512 | Android adaptive icons — extra padding so the badge survives circular/squircle cropping |

## The Node.js docx generator

`kriti-docx-generator.js` (with its own `package.json`) is a **separate,
standalone command-line tool** — it's not loaded by the browser app and doesn't
need GitHub Pages to serve it at all; it just rides along in the same repo.
It exists so you can regenerate a `.docx` from a song's exported `song.json`
outside the browser (e.g. batch-processing many songs, or as a build step). It
intentionally mirrors the in-app export rendering logic exactly, per the app's
own consistency rule.

To use it locally:

```bash
npm install
node kriti-docx-generator.js song.json output.docx
```

`node_modules/` is already excluded via `.gitignore`, so it won't get pushed.
