import { calculateAqi, brownianDiffusivityM2S, cunninghamSlipCorrection, mieScatteringEnvelope, settlingVelocityMmS } from '../engines/mieAerosolNephelometerEngine.js';
import { solveCstr } from '../engines/cstrCadrClearanceEngine.js';
import { integrateCoHb } from '../engines/coburnCoHbAlarmEngine.js';
import { fangerPmv } from '../engines/fangerPmvPsychrometricEngine.js';

export const MAX_REQUEST_BYTES = 1_000_000;
const MAX_AUDIT_BYTES = 64_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUDIT_FIELDS = Object.freeze({
  mie_aerosol_scans: ['pm25', 'pm10', 'aqi', 'source', 'preset'],
  hvac_balometer_logs: ['cfm', 'ach', 'peakHz', 'roomType', 'roomFt3', 'roomDimensionsFt', 'blowerRpm', 'bladeCount', 'shaftHz', 'bpfHz', 'restriction', 'source'],
  cadr_clearance_plans: ['volumeFt3', 'cadrCfm', 'eACH', 'initialUg', 't90Min', 't99Min', 'requiredCfm'],
  fanger_psychrometric_audits: ['airC', 'radiantC', 'rh', 'velocityMs', 'met', 'clo', 'pmv', 'ppd', 'dewPointC', 'surfaceAw'],
  cohb_alarm_events: ['coPpm', 'durationMin', 'modeledCoHb', 'alarmType', 'source']
});
const AUDIT_TEXT_FIELDS = new Set(['source', 'preset', 'roomType', 'alarmType']);
const AUDIT_ARRAY_FIELDS = new Set(['roomDimensionsFt']);

export class AeroApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AeroApiError';
    this.status = status;
  }
}

function objectField(payload, key) {
  const value = payload[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AeroApiError(400, `'${key}' must be a JSON object`);
  }
  return value;
}

function finiteField(data, key, fallback) {
  const raw = data[key] === undefined ? fallback : data[key];
  if (raw === null || raw === '' || typeof raw === 'object') {
    throw new AeroApiError(400, `'${key}' must be a finite number`);
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) throw new AeroApiError(400, `'${key}' must be a finite number`);
  return value;
}

function assertFiniteResult(value, path = 'result') {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new AeroApiError(400, `Calculation produced a non-finite value at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteResult(item, `${path}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertFiniteResult(item, `${path}.${key}`);
  }
}

function solveAerosol(data) {
  const diameter = Math.max(0, finiteField(data, 'diameter_um', 1));
  const wavelength = finiteField(data, 'wavelength_nm', 630);
  const refractiveIndex = finiteField(data, 'refractive_index', 1.45);
  const theta = finiteField(data, 'theta_degrees', 90);
  const pm25 = finiteField(data, 'pm25_ug_m3', 0);
  if (wavelength <= 0) throw new AeroApiError(400, "'wavelength_nm' must be greater than zero");

  // This serverless mirror uses the same educational optical envelope as the client UI.
  // The standalone Python module retains the full Mie-series reference implementation.
  const sizeResponse = mieScatteringEnvelope(diameter);
  const phaseResponse = mieScatteringEnvelope(diameter, wavelength, refractiveIndex);
  return {
    size_parameter: sizeResponse.sizeParameter,
    mie_phase: {
      size_parameter: phaseResponse.sizeParameter,
      relative_intensity: phaseResponse.relativeIntensity,
      regime: phaseResponse.regime,
      theta_degrees: theta,
      approximation: 'educational-envelope'
    },
    slip_correction: cunninghamSlipCorrection(diameter),
    settling_velocity_mm_s: settlingVelocityMmS(diameter),
    brownian_diffusivity_m2_s: brownianDiffusivityM2S(diameter),
    aqi: calculateAqi(pm25)
  };
}

function solveHvac(data) {
  const frequency = Math.max(0, finiteField(data, 'peak_hz', 0));
  const vaneM = Math.max(0.0005, finiteField(data, 'vane_spacing_mm', 18) / 1000);
  const strouhal = Math.max(0.05, finiteField(data, 'strouhal', 0.21));
  const velocityMs = frequency * vaneM / strouhal;
  const velocityFpm = velocityMs * 196.8504;
  const widthIn = Math.max(0, finiteField(data, 'width_in', 12));
  const heightIn = Math.max(0, finiteField(data, 'height_in', 6));
  const freeArea = Math.max(0.35, Math.min(0.95, finiteField(data, 'free_area', 0.76)));
  const discharge = Math.max(0, finiteField(data, 'discharge_coefficient', 0.82));
  const freeAreaFt2 = widthIn * heightIn / 144 * freeArea;
  const cfm = discharge * freeAreaFt2 * velocityFpm;
  const roomFt3 = Math.max(50, finiteField(data, 'room_ft3', 1200));
  return { velocity_ms: velocityMs, velocity_fpm: velocityFpm, free_area_ft2: freeAreaFt2, cfm, ach: cfm * 60 / roomFt3 };
}

function solveCadr(data) {
  const result = solveCstr({
    volumeFt3: finiteField(data, 'volume_ft3', 12000),
    cadrCfm: finiteField(data, 'cadr_cfm', 300),
    filterEfficiency: finiteField(data, 'filter_efficiency', 0.92),
    infiltrationAch: finiteField(data, 'infiltration_ach', 0.35),
    depositionAch: finiteField(data, 'deposition_ach', 0.2),
    outdoorUg: finiteField(data, 'outdoor_ug', 12),
    penetration: finiteField(data, 'penetration', 0.7),
    sourceUgH: finiteField(data, 'source_ug_h', 0),
    initialUg: finiteField(data, 'initial_ug', 100),
    durationMin: finiteField(data, 'duration_min', 360)
  });
  return {
    clean_cfm: result.cleanCfm,
    cadr_ach: result.cadrAch,
    effective_decay_h: result.lambdaEff,
    steady_ug_m3: result.steadyUg,
    each: result.each,
    t90_min: Number.isFinite(result.t90Min) ? result.t90Min : null,
    t99_min: Number.isFinite(result.t99Min) ? result.t99Min : null,
    points: result.points.map(({ x, y }) => ({ minute: x, ug_m3: y }))
  };
}

function solveThermal(data) {
  const airC = finiteField(data, 'air_c', 22.5);
  const radiantC = finiteField(data, 'radiant_c', 22.5);
  const result = fangerPmv({
    airC,
    radiantC,
    velocityMs: finiteField(data, 'velocity_ms', 0.1),
    rh: finiteField(data, 'rh', 45),
    met: finiteField(data, 'met', 1.1),
    clo: finiteField(data, 'clo', 0.7),
    externalWork: finiteField(data, 'external_work', 0),
    surfaceC: finiteField(data, 'surface_c', Math.min(airC, radiantC - 3)),
    pressureKPa: finiteField(data, 'pressure_kpa', 101.325)
  });
  return {
    pmv: result.pmv,
    ppd: result.ppd,
    clothing_surface_c: result.clothingSurfaceC,
    dew_point_c: result.dewPointC,
    wet_bulb_c: result.wetBulbC,
    humidity_ratio_g_kg: result.humidityRatio,
    enthalpy_kj_kg: result.enthalpyKJkg,
    surface_water_activity: result.surfaceWaterActivity,
    iterations: result.iterations
  };
}

function solveCohb(data) {
  const duration = finiteField(data, 'duration_min', 180);
  if (duration < 0 || duration > 1440) throw new AeroApiError(400, "'duration_min' must be between 0 and 1440");
  const result = integrateCoHb({
    coPpm: finiteField(data, 'co_ppm', 0),
    durationMin: duration,
    startPercent: finiteField(data, 'start_percent', 0.8),
    ventilationLMin: finiteField(data, 'ventilation_l_min', 8),
    barometricMmHg: finiteField(data, 'barometric_mmhg', 760),
    oxygen: typeof data.oxygen === 'string' ? data.oxygen : 'air',
    stepMin: finiteField(data, 'step_min', 1)
  });
  return result.points.map(({ x, y }) => ({ minute: x, cohb_percent: y }));
}

export function isSyncConfigured(env = process.env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getAeroApiHealth(env = process.env) {
  return {
    ok: true,
    service: 'Aero-Spectra environmental solver',
    model: 'aero-spectra-javascript-mirror',
    methods: ['POST'],
    syncConfigured: isSyncConfigured(env)
  };
}

export function sanitizeAuditSync(payload) {
  const config = payload?.payload;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new AeroApiError(400, 'Audit sync payload must be a JSON object');
  }
  const { storeName, record } = config;
  const fields = typeof storeName === 'string' && Object.hasOwn(AUDIT_FIELDS, storeName) ? AUDIT_FIELDS[storeName] : null;
  if (!fields || !record || typeof record !== 'object' || Array.isArray(record)) {
    throw new AeroApiError(400, 'Audit sync requires a supported store name and record object');
  }
  if (typeof record.id !== 'string' || !UUID_PATTERN.test(record.id)) {
    throw new AeroApiError(400, 'Audit record must contain a valid UUID');
  }
  if (typeof record.createdAt !== 'string' || record.createdAt.length > 64 || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new AeroApiError(400, 'Audit record must contain a valid creation timestamp');
  }
  let serialized;
  try {
    serialized = JSON.stringify(record);
  } catch {
    throw new AeroApiError(400, 'Audit record must be valid JSON');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_AUDIT_BYTES) {
    throw new AeroApiError(400, 'Audit record must not exceed 64 KB');
  }

  const safeRecord = {};
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) continue;
    const value = record[field];
    if (AUDIT_TEXT_FIELDS.has(field)) {
      if (typeof value !== 'string' || value.length > 120) {
        throw new AeroApiError(400, `Audit field '${field}' must be a short text value`);
      }
    } else if (AUDIT_ARRAY_FIELDS.has(field)) {
      if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
        throw new AeroApiError(400, `Audit field '${field}' must contain three finite dimensions`);
      }
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AeroApiError(400, `Audit field '${field}' must be a finite number`);
    }
    safeRecord[field] = value;
  }
  if (!Object.keys(safeRecord).length) throw new AeroApiError(400, 'Audit record has no supported summary fields');
  return { id: record.id.toLowerCase(), storeName, createdAt: record.createdAt, record: safeRecord };
}

async function persistAudit(payload, { env, fetchImpl }) {
  const safeAudit = sanitizeAuditSync(payload);
  const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey) {
    throw new AeroApiError(503, 'Remote audit sync is not configured; this record remains in the local vault.');
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new AeroApiError(500, 'Remote audit sync configuration is invalid.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new AeroApiError(500, 'Remote audit sync configuration is invalid.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/aero_audit_events?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        id: safeAudit.id,
        store_name: safeAudit.storeName,
        created_at: safeAudit.createdAt,
        record: safeAudit.record
      }),
      signal: controller.signal
    });
  } catch {
    throw new AeroApiError(502, 'Remote audit database is unreachable.');
  } finally {
    clearTimeout(timeoutId);
  }
  if (![200, 201, 204].includes(response.status)) {
    throw new AeroApiError(502, `Remote audit database returned HTTP ${response.status}.`);
  }
  return { ok: true, accepted: true, persisted: true, id: safeAudit.id };
}

export async function solveAeroPayload(payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AeroApiError(400, 'Request body must be a JSON object');
  }
  if ((payload.action || 'solve') === 'audit_sync') return persistAudit(payload, { env, fetchImpl });

  const result = {};
  if (Object.hasOwn(payload, 'aerosol')) result.aerosol = solveAerosol(objectField(payload, 'aerosol'));
  if (Object.hasOwn(payload, 'hvac')) result.hvac = solveHvac(objectField(payload, 'hvac'));
  if (Object.hasOwn(payload, 'cadr')) result.cadr = solveCadr(objectField(payload, 'cadr'));
  if (Object.hasOwn(payload, 'thermal')) result.thermal = solveThermal(objectField(payload, 'thermal'));
  if (Object.hasOwn(payload, 'cohb')) result.cohb = solveCohb(objectField(payload, 'cohb'));
  assertFiniteResult(result);
  return { ok: true, model: 'aero-spectra-javascript-mirror', result };
}

export async function readBoundedJsonRequest(request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new AeroApiError(413, 'Request body must not exceed 1 MB');
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new AeroApiError(413, 'Request body must not exceed 1 MB');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AeroApiError) throw error;
    throw new AeroApiError(400, 'Unable to read request body');
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AeroApiError(400, 'Malformed JSON request body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AeroApiError(400, 'Request body must be a JSON object');
  }
  return body;
}
