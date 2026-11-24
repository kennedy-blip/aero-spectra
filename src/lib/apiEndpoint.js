import { Capacitor } from '@capacitor/core';

const configuredOrigin = import.meta.env?.VITE_AERO_API_BASE_URL?.trim() || '';
const androidReleaseOrigin = 'https://aero-spectra.vercel.app';

/** Same-origin on the web; deployed API origin inside the packaged Capacitor shell. */
export function apiEndpoint(path, nativePlatform = Capacitor.isNativePlatform()) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let origin = configuredOrigin;
  if (!origin && nativePlatform) origin = androidReleaseOrigin;
  return origin ? new URL(normalizedPath, origin).toString() : normalizedPath;
}
