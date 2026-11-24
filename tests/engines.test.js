import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAqi, cunninghamSlipCorrection, settlingVelocityMmS, brownianDiffusivityM2S } from '../src/lib/engines/mieAerosolNephelometerEngine.js';
import { calculateDuctFlow, buildSpectrum } from '../src/lib/engines/acousticHvacBalometerEngine.js';
import { solveCstr } from '../src/lib/engines/cstrCadrClearanceEngine.js';
import { fangerPmv } from '../src/lib/engines/fangerPmvPsychrometricEngine.js';
import { integrateCoHb } from '../src/lib/engines/coburnCoHbAlarmEngine.js';
import { Capacitor } from '@capacitor/core';
import { getNativeHardwareStatus } from '../src/lib/nativeSensorBridge.js';
import { apiEndpoint } from '../src/lib/apiEndpoint.js';

test('Mie helper and current EPA PM2.5 AQI produce bounded, monotonic values', () => {
  assert.ok(cunninghamSlipCorrection(0.3) > cunninghamSlipCorrection(10));
  assert.ok(settlingVelocityMmS(10) > settlingVelocityMmS(1));
  assert.ok(Number.isFinite(brownianDiffusivityM2S(1)) && brownianDiffusivityM2S(1) > 0);
  assert.equal(calculateAqi(0), 0);
  assert.ok(calculateAqi(88.5) > calculateAqi(10));
  assert.ok(calculateAqi(500) <= 500);
});

test('Strouhal and continuity calculation recovers the healthy-register preset', () => {
  const flow = calculateDuctFlow({ peakHz: 27.6, vaneSpacingMm: 18, widthIn: 12, heightIn: 6, freeArea: 0.76, discharge: 0.82, roomFt3: 1200 });
  assert.ok(Math.abs(flow.cfm - 145) < 2);
  assert.ok(flow.velocityMs > 0);
  assert.ok(flow.ach > 0);
  const spectrum = buildSpectrum('supply', 27.6);
  assert.ok(spectrum.reduce((best, item) => item.value > best.value ? item : best).hz < 100);
});

test('CSTR clearance follows the exact exponential decay solution', () => {
  const model = solveCstr({ volumeFt3: 12000, cadrCfm: 300, filterEfficiency: 0.92, infiltrationAch: 0.35, depositionAch: 0.2, outdoorUg: 0, sourceUgH: 0, initialUg: 100, durationMin: 240 });
  assert.ok(Math.abs(model.concentrationAt(model.t90Min) - 10) < 0.01);
  assert.ok(model.t99Min > model.t90Min);
  assert.ok(model.points.every((point) => Number.isFinite(point.y)));
});

test('Fanger PMV/PPD and dew point remain finite in a normal occupied room', () => {
  const result = fangerPmv({ airC: 24, radiantC: 24, velocityMs: 0.1, rh: 50, met: 1.1, clo: 0.7 });
  assert.ok(Number.isFinite(result.pmv));
  assert.ok(result.pmv > -3 && result.pmv < 3);
  assert.ok(result.ppd >= 5 && result.ppd <= 100);
  assert.ok(result.dewPointC < 24);
});

test('native hardware bridge stays lazy in SSR and simulator-only contexts', async () => {
  const status = await getNativeHardwareStatus();
  assert.equal(apiEndpoint('/api/aero_environmental_solver'), '/api/aero_environmental_solver');
  assert.equal(apiEndpoint('/api/aero_environmental_solver', true), 'https://aero-spectra.vercel.app/api/aero_environmental_solver');
  assert.equal(status.native, false);
  assert.equal(Capacitor.Plugins.MacroTyndallCameraTorch, undefined);
  assert.equal(Capacitor.Plugins.AeroAcousticAmbientSensor, undefined);
});

test('RK4 COHb uptake rises with exposure and oxygen washout lowers the estimate', () => {
  const exposure = integrateCoHb({ coPpm: 100, durationMin: 60, startPercent: 0.8 });
  const washout = integrateCoHb({ coPpm: 0, durationMin: 60, startPercent: exposure.finalPercent, oxygen: 'oxygen' });
  assert.ok(exposure.finalPercent > 0.8);
  assert.ok(washout.finalPercent < exposure.finalPercent);
  assert.ok(exposure.points.every((point) => Number.isFinite(point.y)));
});
