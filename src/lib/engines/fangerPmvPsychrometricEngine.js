export function saturationVaporPressureKPa(tempC) {
  return 0.61094 * Math.exp((17.625 * tempC) / (tempC + 243.04));
}

export function dewPointC(tempC, relativeHumidity) {
  const rh = Math.max(0.01, Math.min(100, relativeHumidity)) / 100;
  const gamma = Math.log(rh) + 17.625 * tempC / (243.04 + tempC);
  return 243.04 * gamma / (17.625 - gamma);
}

export function wetBulbC(tempC, relativeHumidity, pressureKPa = 101.325) {
  const ta = Number(tempC);
  const actualVapor = saturationVaporPressureKPa(ta) * Math.max(0.01, Math.min(100, relativeHumidity)) / 100;
  let low = Math.max(-25, ta - 35), high = ta;
  for (let i = 0; i < 48; i++) {
    const tw = (low + high) / 2;
    const psychrometricCoefficient = 0.00066 * (1 + 0.00115 * tw) * pressureKPa;
    const predictedVapor = saturationVaporPressureKPa(tw) - psychrometricCoefficient * (ta - tw);
    if (predictedVapor > actualVapor) high = tw; else low = tw;
  }
  return (low + high) / 2;
}

export function humidityRatioGPerKg(tempC, relativeHumidity, pressureKPa = 101.325) {
  const pv = saturationVaporPressureKPa(tempC) * Math.max(0, Math.min(100, relativeHumidity)) / 100;
  return 1000 * 0.62198 * pv / Math.max(0.1, pressureKPa - pv);
}

export function moistAirEnthalpyKJkg(tempC, relativeHumidity, pressureKPa = 101.325) {
  const w = humidityRatioGPerKg(tempC, relativeHumidity, pressureKPa) / 1000;
  return 1.006 * tempC + w * (2501 + 1.86 * tempC);
}

export function fangerPmv({ airC = 22.5, radiantC = 22.5, velocityMs = 0.1, rh = 45, met = 1.1, clo = 0.7, externalWork = 0, surfaceC = Math.min(airC, radiantC - 3), pressureKPa = 101.325 } = {}) {
  const ta = Number(airC), tr = Number(radiantC), vel = Math.max(0.01, Number(velocityMs));
  const metabolic = Math.max(0.8, Number(met)) * 58.15;
  const work = Math.max(0, Number(externalWork)) * 58.15;
  const icl = Math.max(0.01, Number(clo)) * 0.155;
  const fcl = icl <= 0.078 ? 1 + 1.29 * icl : 1.05 + 0.645 * icl;
  const vaporPressurePa = saturationVaporPressureKPa(ta) * Math.max(0, Math.min(100, rh)) * 10;
  const hcf = 12.1 * Math.sqrt(vel);
  let tcl = ta + (35.5 - ta) / (3.5 * icl + 0.1);
  let hc = hcf, iterations = 0;
  for (let i = 0; i < 150; i++) {
    hc = Math.max(hcf, 2.38 * Math.pow(Math.abs(tcl - ta), 0.25));
    const radiation = 3.96e-8 * fcl * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4));
    const convection = fcl * hc * (tcl - ta);
    const next = 35.7 - 0.028 * (metabolic - work) - icl * (radiation + convection);
    iterations = i + 1;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - tcl) < 0.0001) { tcl = next; break; }
    tcl = 0.5 * tcl + 0.5 * next;
  }
  const term1 = 3.05e-3 * (5733 - 6.99 * (metabolic - work) - vaporPressurePa);
  const term2 = metabolic - work > 58.15 ? 0.42 * (metabolic - work - 58.15) : 0;
  const term3 = 1.7e-5 * metabolic * (5867 - vaporPressurePa);
  const term4 = 0.0014 * metabolic * (34 - ta);
  const term5 = 3.96e-8 * fcl * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4));
  const term6 = fcl * hc * (tcl - ta);
  const load = (metabolic - work) - term1 - term2 - term3 - term4 - term5 - term6;
  const pmv = (0.303 * Math.exp(-0.036 * metabolic) + 0.028) * load;
  const ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
  const dp = dewPointC(ta, rh);
  const waterActivity = saturationVaporPressureKPa(dp) / saturationVaporPressureKPa(Number(surfaceC));
  return { pmv: Math.max(-3, Math.min(3, pmv)), ppd: Math.max(5, Math.min(100, ppd)), clothingSurfaceC: tcl, dewPointC: dp, wetBulbC: wetBulbC(ta, rh, pressureKPa), humidityRatio: humidityRatioGPerKg(ta, rh, pressureKPa), enthalpyKJkg: moistAirEnthalpyKJkg(ta, rh, pressureKPa), iterations, surfaceWaterActivity: Math.max(0, Math.min(1.5, waterActivity)) };
}

export function psychrometricCurve(relativeHumidity, fromC = 5, toC = 40, points = 36) {
  return Array.from({ length: points + 1 }, (_, i) => {
    const tempC = fromC + (toC - fromC) * i / points;
    return { tempC, humidityRatio: humidityRatioGPerKg(tempC, relativeHumidity) };
  });
}
