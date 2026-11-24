export const MIE_PRESETS = {
  bedroom: { label: 'ISO clean bedroom', pm25: 4.2, pm10: 7.8, aqi: 18, note: 'Low background aerosol; simulator reference only.' },
  cooking: { label: 'Wok / pan-frying plume', pm25: 88.5, pm10: 122, aqi: 168, note: 'Fine cooking aerosol spike.' },
  wildfire: { label: 'Wildfire smoke infiltration', pm25: 215, pm10: 238, aqi: 265, note: 'Severe smoke event; reduce exposure and follow local guidance.' },
  renovation: { label: 'Drywall / pollen burst', pm25: 42, pm10: 190, aqi: 118, note: 'Coarse dust and pollen dominated.' }
};

const PM25_BREAKPOINTS = [
  [0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]
];

export function calculateAqi(pm25) {
  const concentration = Math.max(0, Math.min(500, Number(pm25) || 0));
  const rounded = Math.floor(concentration * 10 + 0.5) / 10;
  const band = PM25_BREAKPOINTS.find(([lo, hi]) => rounded >= lo && rounded <= hi) || PM25_BREAKPOINTS.at(-1);
  const [cLo, cHi, iLo, iHi] = band;
  return Math.max(0, Math.min(500, Math.round(((iHi - iLo) / (cHi - cLo)) * (rounded - cLo) + iLo)));
}

export function aqiBand(aqi) {
  if (aqi <= 50) return { label: 'Good', color: '#36d399', text: 'Air quality is satisfactory for most people.' };
  if (aqi <= 100) return { label: 'Moderate', color: '#f5c451', text: 'Unusually sensitive people may notice effects.' };
  if (aqi <= 150) return { label: 'Sensitive groups', color: '#fb923c', text: 'Sensitive groups should limit prolonged exertion.' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#fb7185', text: 'Consider filtration and reducing exposure.' };
  if (aqi <= 300) return { label: 'Very unhealthy', color: '#c084fc', text: 'Avoid strenuous activity; use clean indoor air.' };
  return { label: 'Hazardous', color: '#ef4444', text: 'Follow emergency public-health guidance.' };
}

export function cunninghamSlipCorrection(diameterUm, meanFreePathUm = 0.066) {
  const d = Math.max(0.03, Number(diameterUm) || 0.03);
  const ratio = meanFreePathUm / d;
  return 1 + ratio * (2.514 + 0.8 * Math.exp(-0.55 / ratio));
}

export function settlingVelocityMmS(diameterUm, densityKgM3 = 1400, viscosity = 1.81e-5) {
  const d = Math.max(0.03, Number(diameterUm) || 0.03) * 1e-6;
  const cc = cunninghamSlipCorrection(d * 1e6);
  return (densityKgM3 * d * d * 9.80665 * cc / (18 * viscosity)) * 1000;
}

export function brownianDiffusivityM2S(diameterUm, tempC = 20, viscosity = 1.81e-5) {
  const diameterM = Math.max(0.03, Number(diameterUm) || 0.03) * 1e-6;
  const boltzmann = 1.380649e-23;
  const kelvin = Number(tempC) + 273.15;
  return boltzmann * kelvin * cunninghamSlipCorrection(diameterUm) / (3 * Math.PI * viscosity * diameterM);
}

/** An educational Mie-size response envelope, not a substitute for a calibrated optical counter. */
export function mieScatteringEnvelope(diameterUm, wavelengthNm = 630, refractiveIndex = 1.45) {
  const x = Math.PI * diameterUm * 1000 / wavelengthNm;
  const m = (refractiveIndex - 1) / (refractiveIndex + 2);
  const rayleigh = (6 * Math.PI * Math.pow(m, 2) * Math.pow(x, 4)) / (1 + Math.pow(x, 4));
  const mieModulation = 0.58 + 0.42 * Math.pow(Math.sin(1.7 * x + 0.4), 2);
  return { sizeParameter: x, relativeIntensity: Math.max(0, rayleigh * mieModulation), regime: x < 0.3 ? 'Rayleigh limit' : x < 20 ? 'Mie regime' : 'Geometric scatter' };
}

export function buildSizeDistribution(pm25, pm10) {
  const edges = [0.3, 0.45, 0.65, 0.9, 1.2, 1.6, 2.1, 2.5, 3.5, 5, 7.5, 10, 25];
  const centers = edges.slice(0, -1).map((v, i) => Math.sqrt(v * edges[i + 1]));
  const fineShare = Math.max(0, pm25);
  const coarseShare = Math.max(0, pm10 - pm25);
  return centers.map((d, i) => {
    const fine = fineShare * Math.exp(-0.5 * Math.pow(Math.log(d / 0.65) / 0.72, 2));
    const coarse = coarseShare * Math.exp(-0.5 * Math.pow(Math.log(d / 5.5) / 0.62, 2));
    return { from: edges[i], to: edges[i + 1], diameter: d, value: Math.max(0.4, fine + coarse), fine, coarse };
  });
}

export function aerosolSummary(pm25, pm10 = pm25 * 1.25) {
  const fine = Math.max(0, Number(pm25) || 0);
  const coarse = Math.max(0, Number(pm10) || fine);
  return {
    pm25: fine,
    pm10: Math.max(fine, coarse),
    aqi: calculateAqi(fine),
    cigaretteEquivalent: fine / 22,
    distribution: buildSizeDistribution(fine, Math.max(fine, coarse)),
    band: aqiBand(calculateAqi(fine))
  };
}
