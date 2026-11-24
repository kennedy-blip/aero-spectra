import { Capacitor, registerPlugin } from '@capacitor/core';

const registryKey = '__AERO_SPECTRA_CAPACITOR_PLUGINS__';
const pluginRegistry = globalThis[registryKey] || (globalThis[registryKey] = new Map());

function pluginProxy(name) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === 'toJSON') return () => ({});
      if (!pluginRegistry.has(name)) pluginRegistry.set(name, registerPlugin(name));
      const plugin = pluginRegistry.get(name);
      const value = Reflect.get(plugin, property, plugin);
      return typeof value === 'function' ? value.bind(plugin) : value;
    }
  });
}

// Defer plugin registration until the user enters a native hardware path. This keeps
// SSR and the simulator-only browser preview free from native bridge side effects.
export const MacroTyndallCameraTorch = pluginProxy('MacroTyndallCameraTorch');
export const AeroAcousticAmbientSensor = pluginProxy('AeroAcousticAmbientSensor');
export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function getNativeHardwareStatus() {
  if (!isNativeAndroid()) return { native: false, camera: 'browser API', audio: 'browser API', sensors: 'browser estimate' };
  try {
    const camera = await MacroTyndallCameraTorch.getCapabilities();
    return { native: true, camera: camera?.available ? 'Camera2 ready' : 'Camera2 unavailable', manualFocus: camera?.manualFocus === true, torch: camera?.torch === true, audio: 'AudioRecord bridge available', sensors: 'Android environment bridge available' };
  } catch { return { native: true, camera: 'Camera2 bridge loaded', audio: 'AudioRecord bridge available', sensors: 'Android environment bridge available' }; }
}

export async function startNativeAmbientTelemetry() {
  if (!isNativeAndroid()) throw new Error('Native sensor bridge is available only in the Android app.');
  return AeroAcousticAmbientSensor.startTelemetry();
}
export async function stopNativeAmbientTelemetry() {
  if (!isNativeAndroid()) return { stopped: true };
  return AeroAcousticAmbientSensor.stopTelemetry();
}
