export const HVAC_PRESETS = {
  supply: { label: 'Healthy supply register', cfm: 145, restriction: 8, peakHz: 305, lowEnergy: 0.78, highEnergy: 0.18, fault: 'Balanced airflow' },
  clogged: { label: 'Choked MERV-13 filter', cfm: 62, restriction: 58, peakHz: 132, lowEnergy: 0.34, highEnergy: 0.72, fault: 'High static / bypass whistle' },
  bathroom: { label: 'Weak bathroom exhaust', cfm: 24, restriction: 22, peakHz: 205, lowEnergy: 0.5, highEnergy: 0.25, fault: 'Bearing rumble · below 50 CFM' },
  hood: { label: 'Kitchen range hood', cfm: 280, restriction: 6, peakHz: 590, lowEnergy: 0.9, highEnergy: 0.44, fault: 'High-volume exhaust' }
};

export function airflowFromVortex(peakHz, vaneSpacingMm = 18, strouhal = 0.21) {
  const velocityMs = Math.max(0, Number(peakHz) || 0) * (Math.max(0.5, vaneSpacingMm) / 1000) / Math.max(0.05, strouhal);
  return { velocityMs, velocityFpm: velocityMs * 196.8504 };
}

export function calculateDuctFlow({ peakHz = 300, vaneSpacingMm = 18, widthIn = 12, heightIn = 6, freeArea = 0.76, discharge = 0.82, roomFt3 = 1200 }) {
  const { velocityMs, velocityFpm } = airflowFromVortex(peakHz, vaneSpacingMm);
  const grossSqFt = Math.max(0.01, widthIn * heightIn / 144);
  const freeSqFt = grossSqFt * Math.max(0.35, Math.min(0.95, freeArea));
  const cfm = Math.max(0, discharge) * freeSqFt * velocityFpm;
  const ach = cfm * 60 / Math.max(50, roomFt3);
  return { velocityMs, velocityFpm, grossSqFt, freeSqFt, cfm, ach };
}

export function restrictionIndex(lowBandEnergy, highBandEnergy) {
  const ratio = Math.max(0, highBandEnergy) / Math.max(0.035, lowBandEnergy);
  return Math.max(0, Math.min(100, Math.round((ratio - 0.12) * 43)));
}

export function analyzeSpectrum(frequencies, sampleRate, fftSize, options = {}) {
  if (!frequencies?.length) return { peakHz: 0, lowEnergy: 0, highEnergy: 0, bpfHz: null };
  const hzPerBin = sampleRate / fftSize;
  const rangeMean = (lo, hi) => {
    let sum = 0, n = 0;
    for (let i = 1; i < frequencies.length; i++) {
      const hz = i * hzPerBin;
      if (hz >= lo && hz <= hi) { sum += frequencies[i] / 255; n++; }
    }
    return n ? sum / n : 0;
  };
  const low = rangeMean(80, 400);
  const high = rangeMean(1200, 4000);
  let peak = 0, peakBin = 0;
  for (let i = 1; i < frequencies.length; i++) {
    const hz = i * hzPerBin;
    if (hz >= 60 && hz <= 1600 && frequencies[i] > peak) { peak = frequencies[i]; peakBin = i; }
  }
  const rpm = Number(options.rpm) || 900;
  const bladeCount = Number(options.bladeCount) || 48;
  return { peakHz: peakBin * hzPerBin, lowEnergy: low, highEnergy: high, restriction: restrictionIndex(low, high), bpfHz: bladeCount * rpm / 60 };
}

export function buildSpectrum(presetKey = 'supply', peakHz) {
  const preset = HVAC_PRESETS[presetKey] || HVAC_PRESETS.supply;
  const centerHz = Number.isFinite(Number(peakHz)) && Number(peakHz) > 0 ? Number(peakHz) : preset.peakHz;
  return Array.from({ length: 72 }, (_, index) => {
    const hz = 40 + index * 32;
    const peak = Math.exp(-0.5 * Math.pow((hz - centerHz) / 60, 2));
    const whistle = preset.highEnergy * Math.exp(-0.5 * Math.pow((hz - 1900) / 420, 2));
    const low = preset.lowEnergy * Math.exp(-0.5 * Math.pow((hz - 180) / 140, 2));
    const ripple = 0.045 + 0.035 * (Math.sin(index * 2.9) + 1);
    return { hz, value: Math.min(1, peak * 0.85 + whistle + low * 0.27 + ripple) };
  });
}

export function classifyVentilation(cfm, roomType = 'bathroom') {
  const minimum = roomType === 'kitchen' ? 100 : roomType === 'bathroom' ? 50 : 0;
  if (minimum && cfm < minimum) return { status: 'below target', minimum, delta: minimum - cfm };
  return { status: 'meets selected target', minimum, delta: 0 };
}
