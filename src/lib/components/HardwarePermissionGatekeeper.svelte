<script>
  import { onMount, onDestroy } from 'svelte';
  import { getNativeHardwareStatus, isNativeAndroid, MacroTyndallCameraTorch, AeroAcousticAmbientSensor, startNativeAmbientTelemetry, stopNativeAmbientTelemetry } from '../nativeSensorBridge.js';
  let expanded = false;
  let permission = 'Not requested';
  let permissionTone = 'neutral';
  let persisted = false;
  let native = false;
  let sensors = 'Browser estimate';
  let nativeStatus = null;
  let nativeListening = false;
  let nativeCameraRunning = false;
  let liveEnvironment = null;
  let liveCameraFrame = null;
  let nativeListener;
  let nativeCameraListener;
  let notice = '';

  onMount(() => {
    native = isNativeAndroid();
    try { localStorage.setItem('aero-theme-mode', document.documentElement.dataset.theme === 'daylight' ? 'daylight' : 'dark'); } catch {}
    if ('DeviceOrientationEvent' in window || 'ondeviceorientation' in window) sensors = native ? 'Native bridge available' : 'Motion API detected';
    let mounted = true;
    getNativeHardwareStatus().then((status) => { if (mounted) { nativeStatus = status; if (status.native) sensors = status.sensors; } });
    return () => { mounted = false; };
  });
  onDestroy(() => {
    nativeListener?.remove?.();
    nativeCameraListener?.remove?.();
    if (nativeListening) stopNativeAmbientTelemetry().catch(() => {});
    if (nativeCameraRunning) MacroTyndallCameraTorch.stopManualCapture().catch(() => {});
  });
  async function requestHardware() {
    notice = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      stream.getTracks().forEach((track) => track.stop());
      permission = 'Granted · ready'; permissionTone = 'good';
    } catch (error) {
      permission = error?.name === 'NotAllowedError' ? 'Blocked by user' : 'Unavailable'; permissionTone = 'warning';
      notice = 'Allow camera and microphone in browser settings; this app does not record or upload media.';
    }
  }
  async function toggleNativeSensors() {
    try {
      if (nativeListening) {
        await stopNativeAmbientTelemetry();
        nativeListener?.remove?.(); nativeListener = null; nativeListening = false; liveEnvironment = null;
        notice = 'Native environmental telemetry stopped.';
      } else {
        nativeListener = await AeroAcousticAmbientSensor.addListener('environmentalTelemetry', (data) => liveEnvironment = data);
        await startNativeAmbientTelemetry(); nativeListening = true;
        notice = '48 kHz local audio and available ambient sensors are active.';
      }
    } catch (error) {
      nativeListener?.remove?.(); nativeListener = null; nativeListening = false;
      notice = error?.message || 'Native sensor permission was not granted.';
    }
  }
  async function toggleNativeCamera() {
    try {
      if (nativeCameraRunning) {
        await MacroTyndallCameraTorch.stopManualCapture();
        nativeCameraListener?.remove?.(); nativeCameraListener = null;
        nativeCameraRunning = false; liveCameraFrame = null;
        notice = 'Native Camera2 test stopped; raw frames were discarded.';
      } else {
        nativeCameraListener = await MacroTyndallCameraTorch.addListener('cameraFrame', (data) => liveCameraFrame = data);
        await MacroTyndallCameraTorch.startManualCapture({ focusDiopters: 8, iso: 640, exposureTimeNs: 4000000 });
        nativeCameraRunning = true;
        notice = 'Native Camera2 is streaming local luminance summaries; raw frames are discarded.';
      }
    } catch (error) {
      nativeCameraListener?.remove?.(); nativeCameraListener = null; nativeCameraRunning = false;
      notice = error?.message || 'Native Camera2 permission or hardware is unavailable.';
    }
  }
  async function persistStorage() {
    if (!navigator.storage?.persist) { notice = 'Persistent storage is not available in this browser.'; return; }
    persisted = await navigator.storage.persist();
    notice = persisted ? 'Local audit vault is eligible for persistent storage.' : 'Browser may still evict local data; export reports regularly.';
  }
  function haptic() { if (navigator.vibrate) { navigator.vibrate([120, 80, 120, 80, 300]); notice = 'Temporal accessibility haptic test fired.'; } else notice = 'Haptics are not supported on this device.'; }
</script>

<section class="permission-card glass-subpanel">
  <button class="permission-heading" on:click={() => expanded = !expanded} aria-expanded={expanded}>
    <span class="permission-icon">⌁</span>
    <span class="permission-title"><strong>Hardware & permissions</strong><small>{native ? 'Native Android bridge' : 'Browser sensor bridge'} · {permission}</small></span>
    <span class="permission-pill" class:ok={permissionTone === 'good' || nativeListening} class:warn={permissionTone === 'warning'}><i></i>{native ? 'NATIVE' : 'SIM / WEB'}</span>
    <span class="chevron">{expanded ? '−' : '+'}</span>
  </button>
  {#if expanded}
    <div class="permission-body">
      <div class="permission-grid">
        <div><span class="hardware-glyph">◉</span><span><b>Macro camera + torch</b><small>{liveCameraFrame ? `Native luma ${Number(liveCameraFrame.meanLuma).toFixed(3)} · bright fraction ${(Number(liveCameraFrame.brightPixelFraction) * 100).toFixed(2)}%` : `Rear camera · ${nativeStatus?.camera || 'torch capability checked on start'}`}</small></span><em>{nativeCameraRunning ? 'ACTIVE' : permission === 'Granted · ready' ? 'READY' : native ? 'CAMERA2' : 'REQUEST'}</em></div>
        <div><span class="hardware-glyph">∿</span><span><b>Wideband microphone</b><small>{native ? 'AudioRecord 48 kHz · unprocessed source where supported' : 'Unprocessed request · browser may apply DSP'}</small></span><em>{nativeListening ? 'ACTIVE' : permission === 'Granted · ready' ? 'READY' : 'REQUEST'}</em></div>
        <div><span class="hardware-glyph">⌖</span><span><b>Ambient telemetry</b><small>{liveEnvironment ? `${Number(liveEnvironment.pressureHpa).toFixed(0)} hPa · ${Number(liveEnvironment.ambientC).toFixed(1)} °C · ${Number(liveEnvironment.relativeHumidity).toFixed(0)}% RH · ρ ${Number(liveEnvironment.airDensityKgM3).toFixed(3)}` : `Pressure / temperature / RH: ${sensors}`}</small></span><em>{liveEnvironment ? 'LIVE' : 'OPTIONAL'}</em></div>
        <div><span class="hardware-glyph">ϟ</span><span><b>Haptics + local vault</b><small>Vibration and IndexedDB support varies</small></span><em>OPTIONAL</em></div>
      </div>
      <div class="permission-actions"><button class="tiny-action" on:click={requestHardware}>Request camera + mic</button>{#if native}<button class="tiny-action" on:click={toggleNativeCamera}>{nativeCameraRunning ? 'Stop native Camera2 test' : 'Test native Camera2'}</button><button class="tiny-action" on:click={toggleNativeSensors}>{nativeListening ? 'Stop native sensors' : 'Start native sensors'}</button>{/if}<button class="tiny-action muted" on:click={persistStorage}>Keep audit data locally</button><button class="tiny-action muted" on:click={haptic}>Test haptic</button><span class="persist-status">{persisted ? '● persistent storage granted' : '○ browser-managed storage'}</span></div>
      {#if notice}<p class="notice">{notice}</p>{/if}
      <p class="fineprint">Media stays on-device. Native Camera2 emits sampled luminance metrics only and discards raw frames; camera scatter is not a calibrated particle count. Microphone-derived CFM requires an instrumented acoustic/flow calibration. Sensors are opt-in.</p>
    </div>
  {/if}
</section>

<style>
  .permission-card { padding:0; overflow:hidden; }
  .permission-heading { width:100%; display:flex; align-items:center; gap:11px; border:0; background:transparent; text-align:left; color:inherit; padding:14px 16px; cursor:pointer; }
  .permission-icon { width:28px; height:28px; display:grid; place-items:center; background:#132d40; border-radius:9px; color:#76d8eb; font-size:18px; }
  .permission-title { flex:1; display:grid; gap:4px; }
  .permission-title strong { font-size:11px; font-weight:650; }
  .permission-title small { color:var(--muted); font-size:9px; }
  .permission-pill { display:flex; gap:6px; align-items:center; border:1px solid #435569; border-radius:30px; padding:5px 8px; color:#bac8d6; font:8px ui-monospace,monospace; }
  .permission-pill i { width:5px; height:5px; border-radius:50%; background:#98a9b9; }
  .permission-pill.ok i { background:#36d399; box-shadow:0 0 6px #36d399; }
  .permission-pill.warn i { background:#f6b44b; }
  .chevron { color:#8fa1b1; font-size:17px; }
  .permission-body { border-top:1px solid var(--line); padding:0 16px 14px; }
  .permission-grid { display:grid; grid-template-columns:1fr 1fr; gap:1px 16px; padding-top:9px; }
  .permission-grid>div { display:flex; align-items:center; gap:8px; padding:8px 0; min-width:0; }
  .hardware-glyph { color:#70cfe1; width:20px; text-align:center; font-size:14px; }
  .permission-grid span:nth-child(2) { display:grid; gap:3px; min-width:0; }
  .permission-grid b { font-size:9px; font-weight:600; }
  .permission-grid small { font-size:8px; color:var(--muted); line-height:1.35; }
  .permission-grid em { margin-left:auto; color:#8da4b5; font:7px ui-monospace,monospace; white-space:nowrap; }
  .permission-actions { display:flex; align-items:center; flex-wrap:wrap; gap:7px; padding-top:7px; }
  .tiny-action { border:1px solid #47899b55; background:#10304066; color:#a9e9ed; border-radius:7px; padding:6px 9px; font-size:8px; cursor:pointer; }
  .tiny-action.muted { background:transparent; color:var(--muted); border-color:var(--line); }
  .persist-status { margin-left:auto; color:#8497a8; font-size:8px; }
  .notice { color:#d5c088; font-size:9px; margin:8px 0 0; }
  .fineprint { font-size:8px; color:var(--muted); line-height:1.5; margin:9px 0 0; }
  @media(max-width:600px){.permission-grid{grid-template-columns:1fr}.persist-status{margin-left:0}}
</style>
