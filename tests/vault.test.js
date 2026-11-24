import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listAudits, readMutationQueue, saveAudit, syncMutationQueue } from '../src/lib/db/aeroVaultDb.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const priorGlobals = new Map();
function setGlobal(name, value) {
  if (!priorGlobals.has(name)) priorGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
function restoreGlobals() {
  for (const [name, descriptor] of priorGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  priorGlobals.clear();
}

afterEach(restoreGlobals);

test('audit save falls back to local storage and reports online sync as not configured without persistence confirmation', async () => {
  const storage = new MemoryStorage();
  setGlobal('indexedDB', undefined);
  setGlobal('localStorage', storage);
  setGlobal('navigator', { onLine: true });
  setGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, error: 'Remote audit sync is not configured.' }), { status: 503 }));

  await saveAudit('hvac_balometer_logs', { cfm: 145, source: 'simulator:supply' });
  const before = await readMutationQueue();
  assert.equal(before.length, 1);
  assert.equal((await listAudits('hvac_balometer_logs'))[0].cfm, 145);

  const result = await syncMutationQueue();
  assert.equal(result.synced, 0);
  assert.equal(result.queued, 1);
  assert.match(result.error, /not configured/);
  assert.equal((await readMutationQueue()).length, 1);
});

test('only persisted remote acknowledgements remove queued audits', async () => {
  const storage = new MemoryStorage();
  setGlobal('indexedDB', undefined);
  setGlobal('localStorage', storage);
  setGlobal('navigator', { onLine: true });
  setGlobal('fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.action, 'audit_sync');
    return new Response(JSON.stringify({ ok: true, accepted: true, persisted: true }), { status: 200 });
  });

  await saveAudit('mie_aerosol_scans', { pm25: 18, source: 'simulator:cooking' });
  await saveAudit('cadr_clearance_plans', { cadrCfm: 300 });
  const result = await syncMutationQueue();

  assert.equal(result.synced, 2);
  assert.equal(result.queued, 0);
  assert.equal((await readMutationQueue()).length, 0);
  assert.equal((await listAudits('mie_aerosol_scans')).length, 1);
});

test('offline queue sync leaves records untouched', async () => {
  const storage = new MemoryStorage();
  setGlobal('indexedDB', undefined);
  setGlobal('localStorage', storage);
  setGlobal('navigator', { onLine: false });
  setGlobal('fetch', async () => { throw new Error('must not call the network while offline'); });

  await saveAudit('cohb_alarm_events', { modeledCoHb: 1.2, source: 'simulator' });
  const result = await syncMutationQueue();
  assert.equal(result.offline, true);
  assert.equal(result.queued, 1);
});
