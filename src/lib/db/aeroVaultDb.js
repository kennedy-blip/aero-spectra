import { apiEndpoint } from '../apiEndpoint.js';

const DB_NAME = 'aero-spectra-vault';
const DB_VERSION = 1;
export const AUDIT_STORES = ['mie_aerosol_scans', 'hvac_balometer_logs', 'cadr_clearance_plans', 'fanger_psychrometric_audits', 'cohb_alarm_events'];

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this context.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [...AUDIT_STORES, 'mutation_sync_queue']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact(storeName, mode, operation) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let request;
    try { request = operation(store); } catch (error) { reject(error); db.close(); return; }
    tx.oncomplete = () => { resolve(request?.result); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
    tx.onabort = () => { reject(tx.error); db.close(); };
  }));
}

export async function saveAudit(storeName, data) {
  if (!AUDIT_STORES.includes(storeName)) throw new Error(`Unknown audit store: ${storeName}`);
  const record = { ...data, id: data.id || crypto.randomUUID(), createdAt: data.createdAt || new Date().toISOString(), synced: false };
  try { await transact(storeName, 'readwrite', (store) => store.put(record)); }
  catch (error) {
    const key = `aero-vault:${storeName}`;
    const items = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify([record, ...items].slice(0, 100)));
  }
  await enqueueMutation({ storeName, record });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('aero-vault-updated'));
  return record;
}

export async function listAudits(storeName) {
  if (!AUDIT_STORES.includes(storeName)) throw new Error(`Unknown audit store: ${storeName}`);
  try { return (await transact(storeName, 'readonly', (store) => store.getAll())) || []; }
  catch { return JSON.parse(localStorage.getItem(`aero-vault:${storeName}`) || '[]'); }
}

export async function enqueueMutation(payload) {
  const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...payload };
  try { await transact('mutation_sync_queue', 'readwrite', (store) => store.put(item)); }
  catch {
    const queue = JSON.parse(localStorage.getItem('aero-vault:queue') || '[]');
    localStorage.setItem('aero-vault:queue', JSON.stringify([...queue, item]));
  }
  return item;
}

export async function readMutationQueue() {
  try { return (await transact('mutation_sync_queue', 'readonly', (store) => store.getAll())) || []; }
  catch { return JSON.parse(localStorage.getItem('aero-vault:queue') || '[]'); }
}

export async function syncMutationQueue(endpoint = '/api/aero_environmental_solver') {
  const queue = await readMutationQueue();
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { synced: 0, queued: queue.length, offline: true };
  let synced = 0;
  let remaining = queue.slice();
  let error = '';
  for (const item of queue) {
    try {
      const target = /^https?:\/\//i.test(endpoint) ? endpoint : apiEndpoint(endpoint);
      const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'audit_sync', payload: item }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.accepted !== true || result.persisted !== true) {
        error = result.error || 'Remote audit storage did not confirm persistence.';
        break;
      }
      remaining = remaining.filter((entry) => entry.id !== item.id);
      try { await transact('mutation_sync_queue', 'readwrite', (store) => store.delete(item.id)); }
      catch { localStorage.setItem('aero-vault:queue', JSON.stringify(remaining)); }
      synced++;
    } catch {
      error = 'Could not reach remote audit storage; unsynced records remain on this device.';
      break;
    }
  }
  if (typeof window !== 'undefined' && synced) window.dispatchEvent(new CustomEvent('aero-vault-updated'));
  return { synced, queued: remaining.length, offline: false, error };
}

export async function exportEnvironmentalReport() {
  const records = {};
  for (const store of AUDIT_STORES) records[store] = await listAudits(store);
  return { product: 'AERO-SPECTRA', schemaVersion: 1, exportedAt: new Date().toISOString(), notice: 'Screening and educational estimates only; not a substitute for calibrated instruments, certified inspection, or medical advice.', records };
}
