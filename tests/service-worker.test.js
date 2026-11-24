import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const origin = 'https://aero.test';

function loadWorker(source, onlineFetch) {
  const cacheEntries = new Map();
  const normalize = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const cache = {
    async addAll(urls) {
      for (const url of urls) cacheEntries.set(normalize(url), new Response(`precache:${url}`));
    },
    async put(request, response) { cacheEntries.set(normalize(request), response.clone()); },
    async match(request) { return cacheEntries.get(normalize(request))?.clone(); }
  };
  const caches = {
    async open() { return cache; },
    async match(request) { return cache.match(request); },
    async keys() { return ['aero-spectra-test']; },
    async delete() { return true; }
  };
  const listeners = {};
  const self = {
    location: { origin, pathname: '/service-worker.js' },
    clients: { claim: async () => {} },
    addEventListener(type, callback) { listeners[type] = callback; },
    skipWaiting: async () => {}
  };
  const injected = source.replace(
    "import { build, files, prerendered, version } from '$service-worker';",
    "const build = ['/app.js']; const files = ['/manifest.webmanifest', '/releases/.gitkeep']; const prerendered = []; const version = 'test';"
  );
  assert.notEqual(injected, source, 'test harness replaces SvelteKit service-worker imports');
  vm.runInNewContext(injected, { self, location: self.location, caches, fetch: onlineFetch, URL, Response, console });
  return { listeners, cacheEntries };
}

test('service worker precaches the app shell and serves it after navigation goes offline', async () => {
  const source = await readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8');
  const { listeners, cacheEntries } = loadWorker(source, async () => new Response('<h1>online workstation</h1>', { status: 200 }));

  let installPromise;
  listeners.install({ waitUntil(promise) { installPromise = promise; } });
  await installPromise;
  assert.ok(cacheEntries.has(`${origin}/`), 'root app shell is included in the install precache');
  assert.ok(!cacheEntries.has(`${origin}/releases/.gitkeep`), 'repository placeholder dotfiles are excluded from precache');

  let responsePromise;
  listeners.fetch({
    request: { method: 'GET', url: `${origin}/`, mode: 'navigate' },
    respondWith(promise) { responsePromise = promise; }
  });
  assert.match(await (await responsePromise).text(), /online workstation/);
  assert.match(await (await cacheEntries.get(`${origin}/`).clone()).text(), /online workstation/);

  let offlineResponsePromise;
  const worker = loadWorker(source, async () => { throw new TypeError('offline'); });
  // Seed a separate worker cache through its install path, then verify route fallback.
  let offlineInstall;
  worker.listeners.install({ waitUntil(promise) { offlineInstall = promise; } });
  await offlineInstall;
  const offlineCache = worker.cacheEntries;
  offlineCache.set(`${origin}/`, new Response('<h1>offline shell</h1>'));
  worker.listeners.fetch({
    request: { method: 'GET', url: `${origin}/thermal`, mode: 'navigate' },
    respondWith(promise) { offlineResponsePromise = promise; }
  });
  assert.match(await (await offlineResponsePromise).text(), /offline shell/);
});
