export const AIR_CLEANER_OPTIONS = [
  { name: '4-filter Corsi–Rosenthal box', cadr: 420, cost: 65, watts: 65, db: 48, kind: 'DIY · MERV-13' },
  { name: 'Compact True HEPA', cadr: 150, cost: 180, watts: 38, db: 42, kind: 'Portable · HEPA' },
  { name: 'Large-room True HEPA', cadr: 300, cost: 420, watts: 72, db: 45, kind: 'Portable · HEPA' },
  { name: 'High-output HEPA unit', cadr: 500, cost: 720, watts: 110, db: 52, kind: 'Large space · HEPA' }
];

export function solveCstr({ volumeFt3 = 12000, cadrCfm = 300, filterEfficiency = 0.92, infiltrationAch = 0.35, depositionAch = 0.2, outdoorUg = 12, penetration = 0.7, sourceUgH = 0, initialUg = 100, durationMin = 360 }) {
  const volume = Math.max(100, Number(volumeFt3) || 100);
  const infiltration = Math.max(0, Number(infiltrationAch) || 0);
  const deposition = Math.max(0, Number(depositionAch) || 0);
  const cleanCfm = Math.max(0, Number(cadrCfm) || 0) * Math.max(0, Math.min(1, Number(filterEfficiency)));
  const cadrAch = cleanCfm * 60 / volume;
  const lambda = infiltration + deposition + cadrAch;
  const outdoor = Math.max(0, Number(outdoorUg) || 0);
  const source = Math.max(0, Number(sourceUgH) || 0);
  const sourcePerVolume = source / volume;
  const steady = lambda > 0 ? (Math.max(0, penetration) * infiltration * outdoor + sourcePerVolume) / lambda : 0;
  const start = Math.max(0, Number(initialUg) || 0);
  const duration = Math.max(1, Number(durationMin) || 1);
  const concentrationAt = (min) => steady + (start - steady) * Math.exp(-lambda * Math.max(0, min) / 60);
  const timeForFraction = (fraction) => lambda > 0 ? Math.log(1 / fraction) * 60 / lambda : Infinity;
  const points = Array.from({ length: 49 }, (_, i) => {
    const min = duration * i / 48;
    return { x: min, y: Math.max(0, concentrationAt(min)) };
  });
  return {
    volumeFt3: volume, cleanCfm, cadrAch, lambdaEff: lambda, steadyUg: steady, initialUg: start,
    t90Min: timeForFraction(0.1), t99Min: timeForFraction(0.01), concentrationAt, points,
    each: infiltration + cadrAch,
    requiredCadrCfm: Math.max(0, (5 - infiltration) * volume / 60)
  };
}

export function requiredCleanAirCfm(volumeFt3, targetEACH = 5, baselineAch = 0) {
  return Math.max(0, (targetEACH - baselineAch) * volumeFt3 / 60);
}

export function buildFleetComparison(volumeFt3, targetEach = 5) {
  const needed = requiredCleanAirCfm(volumeFt3, targetEach);
  return AIR_CLEANER_OPTIONS.map((unit) => ({ ...unit, units: Math.max(1, Math.ceil(needed / unit.cadr)), deliveredCfm: Math.max(1, Math.ceil(needed / unit.cadr)) * unit.cadr, wattsPer100: unit.watts / unit.cadr * 100, fiveYearCost: unit.cost * Math.max(1, Math.ceil(needed / unit.cadr)) + unit.watts * 0.18 * 24 * 365 * 5 / 1000 }));
}
