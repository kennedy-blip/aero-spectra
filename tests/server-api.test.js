import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AeroApiError,
  getAeroApiHealth,
  readBoundedJsonRequest,
  sanitizeAuditSync,
  solveAeroPayload
} from '../src/lib/server/aeroApi.js';

const solverPayload = {
  aerosol: { diameter_um: 1.2, pm25_ug_m3: 18 },
  hvac: { peak_hz: 27.6, vane_spacing_mm: 18, width_in: 12, height_in: 6, room_ft3: 1200 },
  cadr: { volume_ft3: 12000, cadr_cfm: 300, filter_efficiency: 0.92, initial_ug: 100 },
  thermal: { air_c: 24, radiant_c: 24, velocity_ms: 0.1, rh: 50, met: 1.1, clo: 0.7, surface_c: 17 },
  cohb: { co_ppm: 35, duration_min: 60, start_percent: 0.8 }
};

function assertFiniteTree(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (Array.isArray(value)) value.forEach(assertFiniteTree);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertFiniteTree);
}

test('deployable server mirror returns finite results for all five domains', async () => {
  const response = await solveAeroPayload(solverPayload, { env: {} });
  assert.equal(response.ok, true);
  assert.equal(response.model, 'aero-spectra-javascript-mirror');
  assert.deepEqual(Object.keys(response.result).sort(), ['aerosol', 'cadr', 'cohb', 'hvac', 'thermal']);
  assert.equal(response.result.aerosol.mie_phase.approximation, 'educational-envelope');
  assert.equal(response.result.cadr.points.length, 49);
  assert.ok(response.result.thermal.wet_bulb_c < 24);
  assert.ok(response.result.cohb.length > 1);
  assertFiniteTree(response);
});

test('health reports server-side sync configuration without exposing credentials', () => {
  assert.equal(getAeroApiHealth({}).syncConfigured, false);
  assert.equal(getAeroApiHealth({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'secret' }).syncConfigured, true);
  assert.equal(JSON.stringify(getAeroApiHealth({ SUPABASE_SERVICE_ROLE_KEY: 'secret' })).includes('secret'), false);
});

test('server solver rejects malformed domains and non-finite numeric inputs', async () => {
  await assert.rejects(() => solveAeroPayload([]), (error) => error instanceof AeroApiError && error.status === 400);
  await assert.rejects(() => solveAeroPayload({ hvac: [] }), (error) => error instanceof AeroApiError && error.status === 400);
  await assert.rejects(() => solveAeroPayload({ aerosol: { diameter_um: Number.POSITIVE_INFINITY } }), (error) => error instanceof AeroApiError && error.status === 400);
  await assert.rejects(() => solveAeroPayload({ cohb: { duration_min: 1441 } }), (error) => error instanceof AeroApiError && error.status === 400);
});

test('bounded request parser accepts object JSON and rejects oversized, malformed, or array bodies', async () => {
  const valid = new Request('https://aero.test/api', { method: 'POST', body: JSON.stringify({ aerosol: {} }) });
  assert.deepEqual(await readBoundedJsonRequest(valid), { aerosol: {} });

  const oversizedByHeader = new Request('https://aero.test/api', {
    method: 'POST',
    headers: { 'content-length': '1000001' },
    body: '{}'
  });
  await assert.rejects(() => readBoundedJsonRequest(oversizedByHeader), (error) => error.status === 413);

  const oversizedBody = new Request('https://aero.test/api', { method: 'POST', body: JSON.stringify({ data: 'x'.repeat(1_000_100) }) });
  await assert.rejects(() => readBoundedJsonRequest(oversizedBody), (error) => error.status === 413);

  const malformed = new Request('https://aero.test/api', { method: 'POST', body: '{' });
  await assert.rejects(() => readBoundedJsonRequest(malformed), (error) => error.status === 400);

  const array = new Request('https://aero.test/api', { method: 'POST', body: '[]' });
  await assert.rejects(() => readBoundedJsonRequest(array), (error) => error.status === 400);
});

test('remote audit sync only persists allowlisted summaries and confirms remote persistence', async () => {
  const audit = {
    action: 'audit_sync',
    payload: {
      storeName: 'mie_aerosol_scans',
      record: {
        id: 'f1b37b50-771b-4d30-a7ab-78f1fe273f62',
        createdAt: '2026-11-24T07:00:00.000Z',
        pm25: 18,
        source: 'simulator',
        audio: [0.1, 0.2],
        rawFrame: 'never-upload-this',
        unknown: 'strip-me'
      }
    }
  };
  assert.deepEqual(sanitizeAuditSync(audit).record, { pm25: 18, source: 'simulator' });
  assert.throws(() => sanitizeAuditSync({ action: 'audit_sync', payload: { storeName: 'toString', record: audit.payload.record } }), (error) => error.status === 400);

  let sentUrl = '';
  let sentOptions;
  const response = await solveAeroPayload(audit, {
    env: { SUPABASE_URL: 'https://project.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'server-only-secret' },
    fetchImpl: async (url, options) => {
      sentUrl = url;
      sentOptions = options;
      return { status: 201 };
    }
  });
  assert.equal(response.accepted, true);
  assert.equal(response.persisted, true);
  assert.match(sentUrl, /\/rest\/v1\/aero_audit_events\?on_conflict=id$/);
  assert.equal(sentOptions.headers.Authorization, 'Bearer server-only-secret');
  const body = JSON.parse(sentOptions.body);
  assert.deepEqual(Object.keys(body).sort(), ['created_at', 'id', 'record', 'store_name']);
  assert.deepEqual(body.record, { pm25: 18, source: 'simulator' });
  assert.equal(sentOptions.body.includes('rawFrame'), false);
  assert.equal(sentOptions.body.includes('audio'), false);
});

test('unconfigured or failed remote audit sync remains an explicit error', async () => {
  const audit = {
    action: 'audit_sync',
    payload: {
      storeName: 'cohb_alarm_events',
      record: {
        id: '7a1d5e1b-ecbd-487d-b85b-934f7c4a9abe',
        createdAt: '2026-11-24T07:00:00.000Z',
        coPpm: 35
      }
    }
  };
  await assert.rejects(() => solveAeroPayload(audit, { env: {} }), (error) => error.status === 503 && /remains in the local vault/.test(error.message));
  await assert.rejects(() => solveAeroPayload(audit, {
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret' },
    fetchImpl: async () => ({ status: 500 })
  }), (error) => error.status === 502);
});
