export const cToF = (c) => c * 9 / 5 + 32;
export const fToC = (f) => (f - 32) * 5 / 9;
export const ft3ToM3 = (ft3) => ft3 * 0.0283168;
export const cfmToM3h = (cfm) => cfm * 1.69901;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const formatDuration = (minutes) => Number.isFinite(minutes) ? (minutes < 60 ? `${Math.round(minutes)} min` : `${(minutes / 60).toFixed(1)} h`) : '—';
