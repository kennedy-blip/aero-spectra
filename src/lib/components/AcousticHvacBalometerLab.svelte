<script>
  import { onDestroy } from 'svelte';
  import { spring } from 'svelte/motion';
  import ModuleHeader from './ModuleHeader.svelte';
  import CurveCanvas from './CurveCanvas.svelte';
  import { HVAC_PRESETS, calculateDuctFlow, buildSpectrum, analyzeSpectrum, classifyVentilation } from '$engines/acousticHvacBalometerEngine.js';
  import { saveAudit } from '$db/aeroVaultDb.js';
  export let cfm = 145;
  export let pro = false;
  let presetKey = 'supply';
  let peakHz = 27.6;
  let widthIn = 12;
  let heightIn = 6;
  let spacingMm = 18;
  let freeArea = 0.76;
  let roomLengthFt = 12;
  let roomWidthFt = 10;
  let roomHeightFt = 10;
  let roomFt3 = 1200;
  let roomType = 'bathroom';
  let blowerRpm = 900;
  let bladeCount = 48;
  let micActive = false;
  let micStatus = 'preset spectrum';
  let liveFrequencies = [];
  let liveSpectrum = [];
  let audioContext, stream, analyser, interval;
  let spectrumCanvas;
  let saved = false;
  let restriction = HVAC_PRESETS.supply.restriction;
  const flowDial = spring(145, { stiffness: 0.17, damping: 0.66 });
  const boundedInput = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  $: roomFt3 = boundedInput(roomLengthFt, 3, 100, 12) * boundedInput(roomWidthFt, 3, 100, 10) * boundedInput(roomHeightFt, 3, 30, 10);
  $: flow = calculateDuctFlow({ peakHz, vaneSpacingMm: spacingMm, widthIn, heightIn, freeArea, roomFt3 });
  $: shaftHz = boundedInput(blowerRpm, 100, 5000, 900) / 60;
  $: bpfHz = boundedInput(bladeCount, 1, 100, 48) * shaftHz;
  $: flowDial.set(flow.cfm);
  $: cfm = flow.cfm;
  $: activePreset = HVAC_PRESETS[presetKey] || HVAC_PRESETS.supply;
  $: spectrum = liveSpectrum.length ? liveSpectrum : buildSpectrum(presetKey, Number(peakHz));
  $: requirement = classifyVentilation(flow.cfm, roomType);
  $: chartSeries = [{ label: 'normalized spectral energy', color: requirement.status === 'below target' ? '#ff946e' : '#5fd5c2', values: spectrum.map((item) => ({ x: item.hz, y: item.value * 100 })) }];
  $: badgeText = micActive ? 'MIC · ESTIMATE' : 'SIMULATED';

  function frequencyFor(cfmValue, w, h, spacing) {
    const effectiveArea = w * h / 144 * freeArea * 0.82;
    const fpm = cfmValue / Math.max(0.01, effectiveArea);
    const velocityMs = fpm / 196.8504;
    return velocityMs * 0.21 / (spacing / 1000);
  }
  function applyPreset(key) {
    presetKey = key; liveSpectrum = []; liveFrequencies = []; micStatus = 'preset spectrum';
    const item = HVAC_PRESETS[key];
    if (key === 'bathroom') { widthIn = 6; heightIn = 4; spacingMm = 12; }
    else if (key === 'clogged') { widthIn = 6; heightIn = 4; spacingMm = 18; }
    else { widthIn = 12; heightIn = 6; spacingMm = 18; }
    peakHz = frequencyFor(item.cfm, Number(widthIn), Number(heightIn), Number(spacingMm));
    restriction = item.restriction; saved = false;
  }
  async function startMic() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      audioContext = new AudioContext({ sampleRate: 48000 });
      analyser = audioContext.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.65;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micActive = true; micStatus = `live audio · ${audioContext.sampleRate.toLocaleString()} Hz`;
      interval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const result = analyzeSpectrum(data, audioContext.sampleRate, analyser.fftSize);
        liveFrequencies = [...data];
        peakHz = Math.max(20, result.peakHz || 20);
        restriction = result.restriction ?? restriction;
        const hzPerBin = audioContext.sampleRate / analyser.fftSize;
        liveSpectrum = Array.from({ length: 72 }, (_, i) => {
          const hz = 40 + i * 32; const index = Math.round(hz / hzPerBin);
          return { hz, value: (data[index] || 0) / 255 };
        });
      }, 180);
    } catch (error) { micStatus = error?.name === 'NotAllowedError' ? 'microphone blocked' : 'microphone unavailable'; }
  }
  function stopMic() {
    micActive = false; clearInterval(interval); interval = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    audioContext?.close(); audioContext = null; liveSpectrum = []; micStatus = 'preset spectrum';
  }
  async function saveReading() {
    await saveAudit('hvac_balometer_logs', { cfm: Number(flow.cfm.toFixed(1)), ach: Number(flow.ach.toFixed(2)), peakHz: Number(Number(peakHz).toFixed(1)), roomType, roomFt3: Math.round(roomFt3), roomDimensionsFt: [boundedInput(roomLengthFt, 3, 100, 12), boundedInput(roomWidthFt, 3, 100, 10), boundedInput(roomHeightFt, 3, 30, 10)], blowerRpm: Math.round(shaftHz * 60), bladeCount: Math.round(bpfHz / shaftHz), shaftHz: Number(shaftHz.toFixed(1)), bpfHz: Number(bpfHz.toFixed(1)), restriction, source: micActive ? 'microphone spectrum estimate' : `simulator:${presetKey}` });
    saved = true;
  }
  onDestroy(stopMic);
</script>

<section class="module-stack">
  <ModuleHeader number="02" eyebrow="AERO-ACOUSTIC BALOMETER · 20–4,000 HZ" title="HVAC airflow & balancing lab" description="Translate vane vortex frequency into a geometry-based airflow estimate. Use an anemometer or balometer for code compliance and balancing." accent="amber" status={badgeText} />
  <div class="hvac-layout">
    <div class="glass-card hvac-left">
      <div class="preset-bar"><span class="section-kicker">AERO-ACOUSTIC SIGNATURES</span><div>{#each Object.entries(HVAC_PRESETS) as [key, preset]}<button class:active={presetKey === key} on:click={() => applyPreset(key)}>{preset.label}</button>{/each}</div></div>
      <div class="spectrum-heading"><span><i class="mic-dot" class:live={micActive}></i> VANE-VORTEX SPECTRUM</span><span>{micStatus}</span></div>
      <div class="spectrum-canvas"><CurveCanvas series={chartSeries} maxX={2400} maxY={100} yLabel="level %" xLabel="Hz" ariaLabel="HVAC microphone spectrum and vortex peak" /></div>
      <div class="spectrum-legend"><span><i></i>Broadband flow energy</span><b>Vortex peak&nbsp; {Number(peakHz).toFixed(1)} Hz</b></div>
      <div class="mic-actions">{#if micActive}<button class="outline-action stop-action" on:click={stopMic}>■ Stop microphone</button>{:else}<button class="outline-action" on:click={startMic}>◎ Listen to register</button>{/if}<small>Audio is processed on-device · no recording saved</small></div>
      <div class="acoustic-note">Acoustic frequency is influenced by grille geometry, room noise and fan harmonics. The simulator uses a reference discharge coefficient C<sub>d</sub> = 0.82.</div>
    </div>
    <div class="glass-card flow-card">
      <div class="flow-card-head"><span class="section-kicker">CALCULATED FLOW · SIM / ESTIMATE</span><span class="air-arrow">↗</span></div>
      <div class="flow-number">{Math.round($flowDial)}<small>CFM</small></div>
      <div class="flow-conversions"><span>{flow.velocityMs.toFixed(2)} m/s face velocity</span><span>{Math.round(flow.velocityFpm).toLocaleString()} FPM</span></div>
      <div class="gauge-wrap"><div class="semi-gauge" style={`--gauge:${Math.min(100,flow.cfm/4)}%; --gauge-color:${requirement.status === 'below target' ? '#f39b65' : '#50d2be'}`}><div class="gauge-center"><b>{flow.ach.toFixed(1)}</b><small>ACH</small></div></div><div class="gauge-scale"><span>0</span><span>25</span><span>50+ ACH</span></div></div>
      <div class="target-status" class:fail={requirement.status === 'below target'}><span>{requirement.status === 'below target' ? '!' : '✓'}</span><div><b>{roomType === 'bathroom' ? '50 CFM bathroom reference' : roomType === 'kitchen' ? '100 CFM kitchen reference' : 'Room ACH reference'}</b><small>{requirement.status === 'below target' ? `${requirement.delta.toFixed(0)} CFM below selected reference` : 'Meets selected comparison value'}</small></div></div>
      <label class="select-label">Compare as<select bind:value={roomType}><option value="bathroom">Bathroom exhaust</option><option value="kitchen">Kitchen hood</option><option value="bedroom">Bedroom air changes</option></select></label>
    </div>
  </div>
  <div class="glass-card setup-card">
    <div class="setup-heading"><div><span class="section-kicker">DUCT & ROOM GEOMETRY</span><small>Continuity equation · free-area correction · C<sub>d</sub> = 0.82</small></div><span class="restriction-pill" class:high={restriction > 45}>FILTER RESTRICTION&nbsp; <b>{restriction}%</b></span></div>
    <div class="input-grid">
      <label>Grille width <span><input type="number" min="2" max="48" step="0.5" bind:value={widthIn} /> <small>in</small></span></label>
      <label>Grille height <span><input type="number" min="2" max="48" step="0.5" bind:value={heightIn} /> <small>in</small></span></label>
      <label>Vane spacing <span><input type="number" min="2" max="60" step="0.5" bind:value={spacingMm} /> <small>mm</small></span></label>
      <label class="room-dimension">Room L × W × H <span><input aria-label="Room length in feet" type="number" min="3" max="100" step="1" bind:value={roomLengthFt}/><i>×</i><input aria-label="Room width in feet" type="number" min="3" max="100" step="1" bind:value={roomWidthFt}/><i>×</i><input aria-label="Room height in feet" type="number" min="3" max="30" step="1" bind:value={roomHeightFt}/></span><small>{Math.round(roomFt3).toLocaleString()} ft³ room volume</small></label>
      <label class="range-input">Free-area ratio <span>{Math.round(freeArea * 100)}%</span><input type="range" min="0.55" max="0.92" step="0.01" bind:value={freeArea} /></label>
      <div class="frequency-control"><label for="vortex-freq">Vortex peak</label><div><input id="vortex-freq" type="range" min="20" max="600" step="1" bind:value={peakHz} /><b>{Number(peakHz).toFixed(0)} <small>Hz</small></b></div></div>
    </div>
    {#if pro}<div class="pro-flow-note"><div class="bpf-controls"><label>Blower blades <input type="number" min="1" max="100" bind:value={bladeCount}/></label><label>Blower RPM <input type="number" min="100" max="5000" step="50" bind:value={blowerRpm}/></label></div><span>BPF <b>{bpfHz.toFixed(1)} Hz</b> · shaft <b>{shaftHz.toFixed(1)} Hz</b> · sidebands <b>{(bpfHz-shaftHz).toFixed(1)} / {(bpfHz+shaftHz).toFixed(1)} Hz</b>.</span><small>Heuristic fault bands require known fan geometry and tachometer RPM.</small></div>{/if}
    <div class="save-row"><span>Acoustic outputs are estimates—not an airflow certification.</span><button class="outline-action" on:click={saveReading}>{saved ? '✓ Saved to vault' : '＋ Save balometer log'}</button></div>
  </div>
</section>

<style>
  .module-stack{display:grid;gap:13px}.hvac-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr);gap:13px}.hvac-left,.flow-card,.setup-card{padding:15px}.preset-bar>div{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.preset-bar button{border:1px solid var(--line);background:transparent;color:var(--muted);padding:6px 8px;border-radius:7px;font-size:8px;cursor:pointer}.preset-bar button.active{color:#ffe0a2;border-color:#c6974d77;background:#392b18aa}.spectrum-heading{display:flex;justify-content:space-between;align-items:center;margin-top:17px;color:#a9c0cb;font:8px ui-monospace,monospace;letter-spacing:.09em}.spectrum-heading>span:last-child{color:var(--muted);letter-spacing:0}.mic-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#f2bb61;margin-right:5px}.mic-dot.live{background:#46dba6;box-shadow:0 0 7px #46dba6}.spectrum-canvas{height:180px;margin-top:5px}.spectrum-legend{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:8px}.spectrum-legend span{display:flex;align-items:center;gap:6px}.spectrum-legend i{width:6px;height:6px;border-radius:50%;background:#56ccbd}.spectrum-legend b{color:#ddd9c7;font:8px ui-monospace,monospace}.mic-actions{display:flex;align-items:center;gap:9px;margin-top:11px}.outline-action{border:1px solid #4ca6a666;border-radius:8px;background:#0c2a3466;color:#aee7e7;padding:7px 10px;font-size:8px;cursor:pointer}.stop-action{border-color:#d77d6b66;color:#f3b1a5}.mic-actions small{font-size:7px;color:var(--muted)}.acoustic-note{margin-top:10px;color:#8795a1;font-size:8px;line-height:1.5}.flow-card{display:flex;flex-direction:column}.flow-card-head{display:flex;justify-content:space-between;color:var(--muted)}.air-arrow{color:#7cdbca;font-size:19px}.flow-number{font-size:45px;letter-spacing:-.06em;font-weight:650;margin-top:7px}.flow-number small{font-size:10px;color:var(--muted);letter-spacing:0;margin-left:7px;font-weight:450}.flow-conversions{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font:8px ui-monospace,monospace}.gauge-wrap{margin:17px auto 5px;width:180px}.semi-gauge{width:180px;height:93px;position:relative;overflow:hidden}.semi-gauge:before{content:'';position:absolute;inset:0;border-radius:100px 100px 0 0;border:12px solid rgba(132,167,182,.11);border-bottom:0}.semi-gauge:after{content:'';position:absolute;inset:0;border-radius:100px 100px 0 0;border:12px solid transparent;border-top-color:var(--gauge-color);border-left-color:var(--gauge-color);border-right-color:transparent;border-bottom:0;transform:rotate(calc(-45deg + var(--gauge) * 1.1));transform-origin:50% 100%;transition:transform .6s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 7px color-mix(in srgb,var(--gauge-color) 60%,transparent))}.gauge-center{position:absolute;bottom:2px;left:0;right:0;text-align:center;display:grid;gap:2px}.gauge-center b{font-size:20px}.gauge-center small{color:var(--muted);font:8px ui-monospace,monospace}.gauge-scale{display:flex;justify-content:space-between;color:var(--muted);font:7px ui-monospace,monospace}.target-status{display:flex;align-items:center;gap:8px;padding:9px;margin:11px 0 10px;border-radius:9px;border:1px solid #4dbf9a33;background:#16342d50}.target-status>span{color:#67dfb1;font-size:12px}.target-status div{display:grid;gap:3px}.target-status b{font-size:8px}.target-status small{font-size:7px;color:var(--muted)}.target-status.fail{border-color:#dc8b5844;background:#3a291d66}.target-status.fail>span{color:#ffb16c}.select-label{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:8px}.select-label select{background:#14202b;border:1px solid var(--line);border-radius:7px;color:#dce6ea;padding:6px 9px;font-size:8px}.setup-heading{display:flex;justify-content:space-between;align-items:center}.setup-heading>div{display:grid;gap:4px}.setup-heading small{font-size:8px;color:var(--muted)}.restriction-pill{border:1px solid #6a5c3266;border-radius:30px;padding:6px 9px;color:#cfbc8a;font:7px ui-monospace,monospace}.restriction-pill b{font-size:9px;color:#f3ca6f}.restriction-pill.high{border-color:#b36b4877;color:#f0a181}.restriction-pill.high b{color:#ff9b70}.input-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.input-grid>label{display:grid;gap:6px;color:var(--muted);font-size:8px}.input-grid>label>span{display:flex;align-items:center;gap:5px}.input-grid input[type=number]{width:78px;border:1px solid var(--line);background:#101e2a;border-radius:6px;padding:6px;color:#e4edf0;font-size:9px}.input-grid small{color:var(--muted)}.room-dimension>span{gap:3px}.room-dimension input[type=number]{width:45px;padding:6px 3px;text-align:center}.room-dimension>span i{font-style:normal;color:var(--muted);font-size:8px}.room-dimension>small{font-size:7px;color:var(--muted)}.range-input{grid-column:span 2}.range-input>span{margin-left:auto;color:#cbd7da;font:8px ui-monospace,monospace}.range-input input{width:100%;accent-color:#e2b454}.frequency-control{grid-column:span 2;display:grid;gap:6px;color:var(--muted);font-size:8px}.frequency-control>div{display:flex;align-items:center;gap:8px}.frequency-control input{flex:1;accent-color:#e2b454}.frequency-control b{color:#e9d59b;font:8px ui-monospace,monospace}.pro-flow-note{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:10px;padding:9px 10px;border:1px solid #92734033;border-radius:8px;background:#2c251866;color:#c6b58c;font-size:8px}.pro-flow-note>span{color:#d9ca9e}.pro-flow-note>small{color:var(--muted);font-size:7px}.bpf-controls{display:flex;gap:8px}.bpf-controls label{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:7px}.bpf-controls input{width:54px;border:1px solid var(--line);background:#101e2a;border-radius:5px;padding:5px;color:#eee;font-size:8px}.save-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:11px;color:var(--muted);font-size:8px}
  @media(max-width:780px){.hvac-layout{grid-template-columns:1fr}.flow-card{min-height:350px}.input-grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:500px){.preset-bar button{font-size:7px}.setup-heading{align-items:flex-start;gap:8px;flex-direction:column}.input-grid{grid-template-columns:1fr 1fr}.input-grid input[type=number]{width:68px}.room-dimension input[type=number]{width:38px}.range-input,.frequency-control{grid-column:span 2}}
</style>
