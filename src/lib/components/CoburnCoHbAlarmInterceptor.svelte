<script>
  import { onDestroy } from 'svelte';
  import ModuleHeader from './ModuleHeader.svelte';
  import CurveCanvas from './CurveCanvas.svelte';
  import { ALARM_PRESETS, integrateCoHb, coHbRisk, classifyAlarmEnvelope, alarmWaveform } from '$engines/coburnCoHbAlarmEngine.js';
  import { saveAudit } from '$db/aeroVaultDb.js';
  let coPpm = 35;
  let durationMin = 120;
  let ventilation = 8;
  let altitude = 760;
  let alarmType = 'none';
  let monitorActive = false;
  let micStatus = 'simulator ready';
  let alarmStatus = 'NO PATTERN SELECTED';
  let audioContext, stream, analyser, timer, envelope = [];
  let oscillator, audioTimer;
  let saved = false;
  let selectedOxygen = 'air';
  $: exposure = integrateCoHb({ coPpm: Number(coPpm), durationMin: Number(durationMin), startPercent: 0.8, ventilationLMin: Number(ventilation), barometricMmHg: Number(altitude), oxygen: 'air' });
  $: recovery = integrateCoHb({ coPpm: 0, durationMin: 600, startPercent: exposure.finalPercent, ventilationLMin: 8, barometricMmHg: Number(altitude), oxygen: selectedOxygen });
  $: combinedCurve = [{ label: 'exposure', color: '#ff8b7c', values: exposure.points }, { label: 'oxygen washout', color: selectedOxygen === 'air' ? '#79c8ff' : selectedOxygen === 'oxygen' ? '#7dd9b3' : '#c5a3ff', values: recovery.points.map((p) => ({ x: Number(durationMin) + p.x, y: p.y })) }];
  $: risk = coHbRisk(exposure.finalPercent);
  $: alarmSeries = [{ label: 'piezo envelope', color: alarmType === 'T4' ? '#a98cf5' : alarmType === 'T3' ? '#f39467' : '#70cddd', values: buildOscillogram(alarmType) }];
  function buildOscillogram(type) {
    if (type === 'none') return Array.from({ length: 100 }, (_, i) => ({ x: i * 0.08, y: 0.04 + 0.03 * Math.sin(i * 1.2) }));
    const key = type === 'CHIRP' ? 'CHIRP' : type;
    const samples = alarmWaveform(key, 8, 1000);
    const stride = 10;
    return Array.from({ length: Math.floor(samples.length / stride) }, (_, i) => ({ x: i * stride / 1000, y: Math.abs(samples[i * stride]) }));
  }
  function setAlarm(key) {
    alarmType = key === 'ambient' ? 'none' : ALARM_PRESETS[key].pattern;
    alarmStatus = ALARM_PRESETS[key].pattern === 'NO ALARM' ? 'NO NARROWBAND ALARM' : `${ALARM_PRESETS[key].pattern} PATTERN · SIMULATED`;
    if (navigator.vibrate && alarmType !== 'none') navigator.vibrate(alarmType === 'T3' ? [400, 180, 400, 180, 400] : [90, 80, 90, 80, 90, 80, 90]);
  }
  async function startMonitor() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      audioContext = new AudioContext({ sampleRate: 48000 }); analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.15;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount); envelope = []; monitorActive = true; micStatus = 'listening · 3.0–3.25 kHz';
      timer = setInterval(() => {
        analyser.getByteFrequencyData(bins);
        const hzPerBin = audioContext.sampleRate / analyser.fftSize;
        let sum = 0, n = 0;
        for (let i = 0; i < bins.length; i++) if (i * hzPerBin >= 3000 && i * hzPerBin <= 3250) { sum += bins[i] / 255; n++; }
        envelope.push(n ? sum / n : 0); if (envelope.length > 600) envelope.shift();
        const found = classifyAlarmEnvelope(envelope, 100);
        if (found.type !== 'LISTENING') { alarmType = found.type; alarmStatus = `${found.type} · ${Math.round(found.confidence * 100)}% cadence match`; }
      }, 100);
    } catch (error) { micStatus = error?.name === 'NotAllowedError' ? 'microphone blocked' : 'microphone unavailable'; }
  }
  function stopMonitor() {
    monitorActive = false; clearInterval(timer); timer = null; stream?.getTracks().forEach((track) => track.stop()); stream = null;
    audioContext?.close(); audioContext = null; micStatus = 'simulator ready';
  }
  async function playTone(key) {
    try {
      const context = new AudioContext(); const osc = context.createOscillator(); const gain = context.createGain();
      osc.frequency.value = 3100; gain.gain.value = 0.055; osc.connect(gain); gain.connect(context.destination); osc.start();
      const now = context.currentTime; const pulse = key === 't3' ? 0.5 : 0.1; const gap = pulse; const pulses = key === 't3' ? 3 : 4;
      for (let p = 0; p < pulses; p++) { gain.gain.setValueAtTime(0.055, now + p * (pulse + gap)); gain.gain.setValueAtTime(0.0001, now + p * (pulse + gap) + pulse); }
      gain.gain.setValueAtTime(0.0001, now + 2.3); osc.stop(now + 2.35); audioTimer = setTimeout(() => context.close(), 2600);
    } catch { /* audio is optional */ }
  }
  async function saveEvent() {
    await saveAudit('cohb_alarm_events', { coPpm: Number(coPpm), durationMin: Number(durationMin), modeledCoHb: exposure.finalPercent, alarmType, source: monitorActive ? 'microphone cadence estimate' : 'simulator' }); saved = true;
  }
  onDestroy(() => { stopMonitor(); clearTimeout(audioTimer); try { oscillator?.stop(); } catch {} });
</script>

<section class="module-stack">
  <ModuleHeader number="05" eyebrow="COHb KINETICS · T3 / T4 CADENCE INTERCEPTOR" title="Combustion safety & alarm lab" description="An exposure-kinetics teaching model and acoustic cadence aid. This cannot detect CO concentration or blood COHb—use certified alarms and emergency responders." accent="rose" status={monitorActive ? 'MIC · LOCAL' : 'SIMULATED'} />
  <div class="emergency-banner"><span class="emergency-symbol">!</span><div><b>Suspect carbon monoxide? Leave now.</b><small>Move everyone outdoors, call emergency services / your local fire service, and do not re-enter until cleared. Never wait for this app.</small></div><span class="alarm-escape">EVACUATE</span></div>
  <div class="co-layout">
    <div class="glass-card alarm-card">
      <div class="section-title-row"><div><span class="section-kicker">3,100 HZ PIEZO CADENCE DECODER</span><small>UL T3 smoke vs. T4 carbon monoxide pattern demonstration</small></div><span class="decoder-led" class:active={monitorActive}></span></div>
      <div class="alarm-result" class:fire={alarmType === 'T3'} class:co={alarmType === 'T4'}><div class="result-glyph">{alarmType === 'T3' ? '▲' : alarmType === 'T4' ? '◈' : alarmType === 'CHIRP' ? '·' : '⌁'}</div><div><span>{alarmStatus}</span><b>{alarmType === 'T3' ? 'SMOKE / FIRE' : alarmType === 'T4' ? 'CARBON MONOXIDE' : alarmType === 'CHIRP' ? 'LOW-BATTERY CHIRP' : 'Listening for cadence'}</b></div><small>{alarmType === 'T3' ? 'Leave by the safest route' : alarmType === 'T4' ? 'Move outdoors immediately' : 'Check certified alarm status'}</small></div>
      <div class="alarm-chart"><CurveCanvas series={alarmSeries} maxX={8} maxY={1} ariaLabel="T3 and T4 alarm cadence oscilloscope" xLabel="seconds" yLabel="envelope"/></div>
      <div class="alarm-presets">{#each Object.entries(ALARM_PRESETS) as [key, item]}<button class:active={(key === 'ambient' && alarmType === 'none') || (key !== 'ambient' && alarmType === item.pattern)} on:click={() => setAlarm(key)}><b>{item.pattern}</b><small>{item.label.replace('UL 217 · ','').replace('UL 2034 · ','')}</small></button>{/each}</div>
      <div class="alarm-tools"><button class="outline-action" on:click={() => playTone(alarmType === 'T4' ? 't4' : 't3')}>▶ Play quiet demo tone</button>{#if monitorActive}<button class="outline-action stop-action" on:click={stopMonitor}>■ Stop listener</button>{:else}<button class="outline-action" on:click={startMonitor}>◎ Listen for alarm</button>{/if}</div>
      <div class="small-warning">Cadence decoding is a convenience signal only. Appliance models, room acoustics and other tones can produce false classifications.</div>
    </div>
    <div class="glass-card cohb-card">
      <div class="section-title-row"><div><span class="section-kicker">COHb EXPOSURE MODEL · RK4</span><small>Haldane affinity M = 218 · room-air washout baseline</small></div><span class="model-only">NOT A BLOOD TEST</span></div>
      <div class="cohb-score" class:danger={risk.tone === 'critical'} class:watch={risk.tone === 'high'}><div><b>{exposure.finalPercent.toFixed(2)}<small>%</small></b><span>modeled COHb at {durationMin} min</span></div><div class="risk-pill">{risk.label}</div></div>
      <div class="risk-explainer">{risk.detail}</div>
      <div class="cohb-chart"><CurveCanvas series={combinedCurve} maxX={Number(durationMin)+600} maxY={60} minY={0} ariaLabel="RK4 carbon monoxide hemoglobin exposure and washout curves" xLabel="minutes" yLabel="COHb %"/></div>
      <div class="oxygen-modes"><span>WASHOUT CURVE</span>{#each [['air','Fresh air · t½ 320 min'],['oxygen','100% O₂ · t½ 74 min'],['hyperbaric','HBO 2.5 ATA · t½ 20 min']] as [key,label]}<button class:active={selectedOxygen === key} on:click={() => selectedOxygen=key}>{label}</button>{/each}</div>
    </div>
  </div>
  <div class="glass-card exposure-controls">
    <div class="section-title-row"><div><span class="section-kicker">EXPOSURE SCENARIO</span><small>Model controls only · real CO needs a certified detector</small></div><span class="reference-chip">Altitude pressure {Number(altitude).toFixed(0)} mmHg</span></div>
    <div class="co-controls-grid">
      <label>CO concentration <b>{Number(coPpm).toFixed(0)} ppm</b><input type="range" min="0" max="1000" step="5" bind:value={coPpm}/></label>
      <label>Exposure duration <b>{Number(durationMin).toFixed(0)} min</b><input type="range" min="10" max="480" step="5" bind:value={durationMin}/></label>
      <label>Alveolar ventilation <b>{Number(ventilation).toFixed(0)} L/min</b><input type="range" min="6" max="35" step="1" bind:value={ventilation}/></label>
      <label>Barometric pressure <b>{Number(altitude).toFixed(0)} mmHg</b><input type="range" min="500" max="800" step="5" bind:value={altitude}/></label>
    </div>
    <div class="risk-footnote">This simplified Haldane/CFK-inspired model is sensitive to unknown physiology and inhaled dose. Symptoms or a CO alarm require immediate fresh air and emergency care—do not use modeled percentages to decide whether to seek help.</div>
    <div class="save-row"><span>Store only scenario values and classification; no raw audio.</span><button class="outline-action" on:click={saveEvent}>{saved ? '✓ Saved to vault' : '＋ Save safety event'}</button></div>
  </div>
</section>

<style>
  .module-stack{display:grid;gap:13px}.emergency-banner{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid #ed686366;background:linear-gradient(105deg,#491b238f,#281b24a8);box-shadow:inset 0 1px #ffffff11}.emergency-symbol{width:26px;height:26px;flex:none;display:grid;place-items:center;border-radius:8px;background:#da4e5b;color:#fff;font-weight:800}.emergency-banner>div{display:grid;gap:4px;flex:1}.emergency-banner b{color:#ffd5d0;font-size:10px}.emergency-banner small{color:#d3a6a5;font-size:8px;line-height:1.45}.alarm-escape{font:8px ui-monospace,monospace;color:#ff9a92;letter-spacing:.08em}.co-layout{display:grid;grid-template-columns:1fr 1fr;gap:13px}.alarm-card,.cohb-card,.exposure-controls{padding:15px}.section-title-row{display:flex;justify-content:space-between;align-items:center;gap:8px}.section-title-row>div{display:grid;gap:4px}.section-title-row small{font-size:8px;color:var(--muted)}.decoder-led{width:7px;height:7px;border-radius:50%;background:#a18a5d}.decoder-led.active{background:#50dfa9;box-shadow:0 0 8px #50dfa9}.alarm-result{display:flex;align-items:center;gap:9px;padding:9px 10px;margin-top:12px;border-radius:10px;background:#162532;border:1px solid var(--line)}.result-glyph{width:28px;height:28px;display:grid;place-items:center;border-radius:8px;background:#213747;color:#9fdce7;font-size:13px}.alarm-result>div:nth-child(2){display:grid;gap:4px;flex:1}.alarm-result span{font:7px ui-monospace,monospace;color:#8da4b2}.alarm-result b{font-size:9px}.alarm-result>small{font-size:7px;color:var(--muted);max-width:80px;text-align:right}.alarm-result.fire{border-color:#dc875b66;background:#36231c}.alarm-result.fire .result-glyph{background:#673a26;color:#ffbb78}.alarm-result.co{border-color:#a981e266;background:#2a2042}.alarm-result.co .result-glyph{background:#49346d;color:#d6bbff}.alarm-chart{height:145px;margin:5px 0}.alarm-presets{display:grid;grid-template-columns:1fr 1fr;gap:6px}.alarm-presets button{display:grid;gap:4px;text-align:left;padding:8px 9px;border-radius:8px;background:transparent;border:1px solid var(--line);color:var(--muted);cursor:pointer}.alarm-presets button.active{border-color:#bf806155;background:#382a26;color:#f0c29b}.alarm-presets b{font:8px ui-monospace,monospace}.alarm-presets small{font-size:7px}.alarm-tools{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}.outline-action{border:1px solid #4ca6a666;border-radius:8px;background:#0c2a3466;color:#aee7e7;padding:7px 10px;font-size:8px;cursor:pointer}.stop-action{color:#ffc1b6;border-color:#d77d6b66}.small-warning{margin-top:9px;color:#8e949c;font-size:7px;line-height:1.45}.model-only{border:1px solid #d16b6366;color:#efa49d;border-radius:20px;padding:5px 8px;font:7px ui-monospace,monospace}.cohb-score{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:13px;padding:10px 11px;border:1px solid #568ba344;border-radius:10px;background:#18283188}.cohb-score>div:first-child{display:grid;gap:4px}.cohb-score b{font-size:26px;letter-spacing:-.05em;color:#c7e7df}.cohb-score b small{font-size:12px}.cohb-score span{color:var(--muted);font-size:7px}.risk-pill{font-size:7px;color:#a8d8c6;border:1px solid #59b49544;border-radius:20px;padding:6px 8px}.cohb-score.watch{border-color:#d4915266;background:#392b1c}.cohb-score.watch b{color:#ffcd8b}.cohb-score.danger{border-color:#e05b5b88;background:#441f24}.cohb-score.danger b{color:#ff9c98}.risk-explainer{min-height:25px;margin-top:7px;color:#ad9c9b;font-size:7px;line-height:1.45}.cohb-chart{height:170px}.oxygen-modes{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:5px}.oxygen-modes>span{font:7px ui-monospace,monospace;color:var(--muted);margin-right:3px}.oxygen-modes button{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:6px;padding:5px 6px;font-size:7px;cursor:pointer}.oxygen-modes button.active{color:#bce4df;border-color:#53bba677;background:#16332e}.reference-chip{font:7px ui-monospace,monospace;color:#94a9b1;border:1px solid var(--line);padding:6px 8px;border-radius:20px}.co-controls-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:15px}.co-controls-grid label{display:grid;gap:6px;color:var(--muted);font-size:8px}.co-controls-grid b{font:8px ui-monospace,monospace;color:#e7c5bd}.co-controls-grid input{width:100%;accent-color:#f27e7b}.risk-footnote{margin-top:12px;padding:8px 10px;border-left:2px solid #ed7168;background:#321f2266;color:#c0a4a2;font-size:7px;line-height:1.5}.save-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:11px;color:var(--muted);font-size:8px}
  @media(max-width:780px){.co-layout{grid-template-columns:1fr}.co-controls-grid{grid-template-columns:1fr 1fr}}
  @media(max-width:480px){.emergency-banner{align-items:flex-start}.alarm-escape{display:none}.alarm-presets button{padding:7px}.co-controls-grid{gap:9px}}
</style>
