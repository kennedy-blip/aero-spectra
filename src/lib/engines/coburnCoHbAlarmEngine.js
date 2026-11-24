export const ALARM_PRESETS = {
  t3: { label: 'UL 217 · Temporal-3 smoke', pattern: 'T3', frequency: 3100, description: 'Three long pulses, repeating' },
  t4: { label: 'UL 2034 · Temporal-4 CO', pattern: 'T4', frequency: 3100, description: 'Four short pulses, repeating' },
  chirp: { label: 'Low-battery chirp', pattern: 'CHIRP', frequency: 3100, description: 'Single brief pip at long intervals' },
  ambient: { label: 'Household noise', pattern: 'NO ALARM', frequency: 0, description: 'No sustained narrowband alarm tone' }
};

const OXYGEN_HALF_LIFE_MIN = { air: 320, oxygen: 74, hyperbaric: 20 };

/**
 * RK4 integration of a CFK/Haldane-inspired screening model. It uses the Haldane M=218
 * equilibrium relation and a literature-scale room-air washout half-life. A phone cannot
 * measure blood COHb; this is an exposure illustration, never a clinical or emergency tool.
 */
export function coHbDerivative(cohbPercent, coPpm, ventilationLMin = 8, barometricMmHg = 760, halfLifeMin = 320) {
  const ph2o = 47;
  const inspiredCoMmHg = Math.max(0, coPpm) * 1e-6 * Math.max(100, barometricMmHg - ph2o);
  const alveolarO2MmHg = 0.2095 * Math.max(100, barometricMmHg - ph2o);
  const haldaneM = 218;
  const equilibriumPercent = 100 * (haldaneM * inspiredCoMmHg) / (alveolarO2MmHg + haldaneM * inspiredCoMmHg);
  const ventilationFactor = Math.max(0.55, Math.min(3.5, ventilationLMin / 8));
  const uptakeHalfLife = 210 / ventilationFactor;
  const uptakeRate = Math.LN2 / uptakeHalfLife;
  const washoutRate = Math.LN2 / Math.max(8, halfLifeMin);
  return uptakeRate * (equilibriumPercent - cohbPercent) - washoutRate * cohbPercent;
}

export function integrateCoHb({ coPpm = 0, durationMin = 180, startPercent = 0.8, ventilationLMin = 8, barometricMmHg = 760, oxygen = 'air', stepMin = 1 }) {
  const halfLife = OXYGEN_HALF_LIFE_MIN[oxygen] || OXYGEN_HALF_LIFE_MIN.air;
  const step = Math.max(0.1, Math.min(5, stepMin));
  const count = Math.max(1, Math.ceil(durationMin / step));
  let c = Math.max(0, startPercent);
  const points = [{ x: 0, y: c }];
  let max = c;
  for (let i = 0; i < count; i++) {
    const h = Math.min(step, durationMin - i * step);
    const f = (x) => coHbDerivative(x, coPpm, ventilationLMin, barometricMmHg, halfLife);
    const k1 = f(c), k2 = f(c + h * k1 / 2), k3 = f(c + h * k2 / 2), k4 = f(c + h * k3);
    c = Math.max(0, Math.min(70, c + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6));
    max = Math.max(max, c);
    if (i % Math.max(1, Math.round(count / 80)) === 0 || i === count - 1) points.push({ x: Math.min(durationMin, (i + 1) * step), y: c });
  }
  return { points, finalPercent: c, maxPercent: max, halfLifeMin: halfLife, equilibriumPercent: coHbDerivative(0, coPpm, ventilationLMin, barometricMmHg, halfLife) };
}

export function coHbRisk(percent) {
  if (percent < 2) return { label: 'Baseline range', tone: 'good', detail: 'Non-smoker baseline is commonly below 2%. The model is not a blood test.' };
  if (percent < 5) return { label: 'Elevated estimate', tone: 'watch', detail: 'Avoid exposure; clinical interpretation depends on context.' };
  if (percent < 15) return { label: 'Potential symptoms', tone: 'high', detail: 'Headache, dizziness or cardiac effects may occur. Seek medical advice.' };
  if (percent < 40) return { label: 'Severe danger', tone: 'critical', detail: 'Urgent emergency evaluation is warranted.' };
  return { label: 'Critical emergency', tone: 'critical', detail: 'Call emergency services; move to fresh air immediately if safe.' };
}

export function classifyAlarmEnvelope(envelope, sampleIntervalMs = 100) {
  const threshold = Math.max(0.08, (Math.max(...envelope, 0) || 1) * 0.28);
  const events = [];
  let active = false, start = 0;
  envelope.forEach((value, i) => {
    const next = value > threshold;
    if (next && !active) { start = i * sampleIntervalMs; active = true; }
    if (!next && active) { events.push({ onMs: i * sampleIntervalMs - start, offMs: null, atMs: start }); active = false; }
  });
  if (active) events.push({ onMs: envelope.length * sampleIntervalMs - start, offMs: null, atMs: start });
  const pulses = events.filter((event) => event.onMs >= 50 && event.onMs <= 900);
  const grouped = [];
  let group = [];
  for (const pulse of pulses) {
    if (group.length && pulse.atMs - group.at(-1).atMs > 1700) { grouped.push(group); group = []; }
    group.push(pulse);
  }
  if (group.length) grouped.push(group);
  const last = grouped.at(-1) || [];
  if (last.length === 3 && last.filter((p) => p.onMs > 300).length >= 2) return { type: 'T3', confidence: 0.82, pulses: last.length };
  if (last.length === 4 && last.filter((p) => p.onMs < 300).length >= 3) return { type: 'T4', confidence: 0.82, pulses: last.length };
  if (last.length === 1 && last[0].onMs < 180) return { type: 'CHIRP', confidence: 0.7, pulses: 1 };
  return { type: 'LISTENING', confidence: 0, pulses: last.length };
}

export function alarmWaveform(pattern = 'T3', durationSec = 8, sampleRate = 8000) {
  const total = Math.floor(durationSec * sampleRate);
  return Float32Array.from({ length: total }, (_, i) => {
    const t = i / sampleRate;
    let on = false;
    if (pattern === 'T3') { const phase = t % 4; on = phase < 0.5 || (phase >= 1 && phase < 1.5) || (phase >= 2 && phase < 2.5); }
    else if (pattern === 'T4') { const phase = t % 5.8; on = phase < 0.1 || (phase >= 0.2 && phase < 0.3) || (phase >= 0.4 && phase < 0.5) || (phase >= 0.6 && phase < 0.7); }
    else if (pattern === 'CHIRP') on = t % 6 < 0.05;
    return on ? 0.75 * Math.sin(2 * Math.PI * 3100 * t) : 0;
  });
}
