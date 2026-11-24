import { build, files, prerendered, version } from '$service-worker';

const CACHE_NAME = `aero-spectra-${version}`;
const PRECACHE = [...new Set(['/', ...build, ...files, ...prerendered])]
  .filter((asset) => !new URL(asset, self.location.origin).pathname.split('/').some((part) => part.startsWith('.')));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('aero-spectra-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(async (response) => {
      if (!response.ok) throw new Error(`Navigation returned ${response.status}`);
      const cache = await caches.open(CACHE_NAME);
      await cache.put('/', response.clone());
      return response;
    }).catch(async () => (await caches.match(event.request)) || (await caches.match('/')) || Response.error()));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && response.type === 'basic') caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
