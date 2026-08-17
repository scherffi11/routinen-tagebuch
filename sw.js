/*
 * Service Worker: cacht die App-Hülle, damit die App auch ohne Netz startet.
 * Tagebuchdaten liegen in localStorage und werden hier NICHT angefasst.
 *
 * Bei jeder Änderung an den Dateien CACHE hochzählen — sonst bekommt das Handy
 * die alte Version serviert.
 */

const CACHE = 'routinen-tagebuch-v12';

const SHELL = [
  '.',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/views.js',
  'js/drive.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll bricht komplett ab, wenn eine Datei fehlt - einzeln ist robuster.
      .then((c) => Promise.allSettled(SHELL.map((url) => c.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/*
 * Netz zuerst, Cache als Rückfall. Andersherum säße man nach einem Update
 * tagelang auf einer alten Version fest.
 */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
