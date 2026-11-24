<script>
  import ModuleHeader from './ModuleHeader.svelte';
  import DarkFieldCamera from './DarkFieldCamera.svelte';
  import CurveCanvas from './CurveCanvas.svelte';
  import { MIE_PRESETS, aerosolSummary, mieScatteringEnvelope, settlingVelocityMmS, brownianDiffusivityM2S, cunninghamSlipCorrection } from '$engines/mieAerosolNephelometerEngine.js';
  import { saveAudit } from '$db/aeroVaultDb.js';
  export let pm25 = 4.2;
  export let pm10 = 7.8;
  export let pro = false;
  let presetKey = 'bedroom';
  let diameter = 0.8;
  let cameraActive = false;
  let saved = false;
  $: summary = aerosolSummary(pm25, pm10);
  $: distributionSeries = [{ label: 'relative particle counts', color: summary.aqi > 150 ? '#f7a54b' : '#57cde1', values: summary.distribution.map((bin) => ({ x: bin.diameter, y: bin.value })) }];
  $: optical = mieScatteringEnvelope(Number(diameter));
  $: settling = settlingVelocityMmS(Number(diameter));
  $: brownian = brownianDiffusivityM2S(Number(diameter));
  $: slip = cunninghamSlipCorrection(Number(diameter));
  $: cameraStatus = cameraActive ? 'LIVE · NOT CALIBRATED' : 'SIMULATED';

  function applyPreset(key) {
    presetKey = key;
    pm25 = MIE_PRESETS[key].pm25;
    pm10 = MIE_PRESETS[key].pm10;
    saved = false;
  }
  async function saveScan() {
    await saveAudit('mie_aerosol_scans', { pm25: Number(pm25), pm10: Number(pm10), aqi: summary.aqi, source: cameraActive ? 'camera optical preview' : 'preset simulator', preset: presetKey });
    saved = true;
  }
</script>

<section class="module-stack">
  <ModuleHeader number="01" eyebrow="OPTICAL NEPHELOMETER · TYN DALL DARK-FIELD" title="Aerosol & particulate lab" description="Explore PM₂.₅ / PM₁₀ trends with a simulated Tyndall beam or opt-in rear camera. Phone optics are not a calibrated particle counter." status={cameraStatus} />
  <div class="mie-layout">
    <div class="glass-card optical-card">
      <div class="card-topline"><span class="section-kicker">01 / SCATTER CHAMBER</span><span class="calibration-tag">ESTIMATE · NOT A MONITOR</span></div>
      <DarkFieldCamera bind:active={cameraActive} />
      <div class="preset-row"><span>RUN A PRESET</span>{#each Object.entries(MIE_PRESETS) as [key, preset]}<button class:active={presetKey === key} on:click={() => applyPreset(key)}>{preset.label.replace(' infiltration','').replace('ISO clean ','').replace('Wok / pan-frying plume','Cooking plume').replace('Drywall / pollen burst','Dust burst')}</button>{/each}</div>
      <div class="optical-caveat"><span>ⓘ</span><p>Scattering flashes depend on lens, distance, lighting and particle refractive index. Concentrations shown are <b>simulator reference values</b>; a certified PM instrument is needed for health decisions.</p></div>
    </div>
    <div class="mie-side">
      <div class="metric-card glass-card pm-card">
        <div class="metric-heading"><span>PM₂.₅ MASS CONCENTRATION</span><span class="pulse-mark"></span></div>
        <div class="metric-big">{Number(pm25).toFixed(1)}<small>µg/m³</small></div>
        <div class="aqi-row"><div class="aqi-number" style={`--aqi-color:${summary.band.color}`}>{summary.aqi}</div><div><b>{summary.band.label}</b><small>US EPA PM₂.₅ AQI · {summary.band.text}</small></div></div>
        <div class="metric-divider"></div>
        <div class="mini-metrics"><div><span>PM₁₀</span><b>{Number(pm10).toFixed(1)} <small>µg/m³</small></b></div><div><span>Cigarette equivalent</span><b>{summary.cigaretteEquivalent.toFixed(2)} <small>cig/day*</small></b></div></div>
        <div class="metric-foot">*Berkeley Earth estimate: 22 µg/m³ ≈ one cigarette/day. Not a personal-dose measurement.</div>
      </div>
      <div class="glass-card chart-card">
        <div class="chart-heading"><div><span class="section-kicker">AERODYNAMIC SIZE DISTRIBUTION</span><small>12-bin log-normal reference · 0.3–25 µm</small></div><span class="chart-mark">µm</span></div>
        <div class="histogram"><CurveCanvas series={distributionSeries} maxX={25} maxY={Math.max(10, ...summary.distribution.map((bin) => bin.value)) * 1.15} yLabel="relative" xLabel="diameter µm" ariaLabel="Twelve-bin aerosol size distribution" fill={true} /></div>
        <div class="bin-legend"><span><i class="fine-dot"></i>Fine mode · PM₂.₅</span><span><i class="coarse-dot"></i>Coarse / pollen · PM₁₀</span></div>
      </div>
    </div>
  </div>
  <div class="glass-card science-strip">
    <div class="science-title"><span class="section-kicker">PARTICLE PHYSICS</span><small>Illustrative optical model · standard air at 20 °C</small></div>
    <label class="diameter-control">Test diameter <input type="range" min="0.1" max="20" step="0.1" bind:value={diameter} /><b>{Number(diameter).toFixed(1)} µm</b></label>
    <div class="physics-metrics"><div><span>MIE SIZE PARAMETER x</span><b>{optical.sizeParameter.toFixed(2)}</b><small>{optical.regime}</small></div><div><span>CUNNINGHAM C<sub>c</sub></span><b>{slip.toFixed(3)}</b><small>slip correction</small></div><div><span>STOKES SETTLING</span><b>{settling.toFixed(3)} <small>mm/s</small></b><small>unit-density assumption</small></div><div><span>BROWNIAN DIFFUSION</span><b>{brownian.toExponential(2)} <small>m²/s</small></b><small>thermal drift coefficient</small></div></div>
    {#if pro}<div class="pro-insight">Mie envelope relative intensity <b>{optical.relativeIntensity.toExponential(2)}</b> · assumed λ = 630 nm, refractive index = 1.45</div>{/if}
    <div class="save-row"><span>Local audit stores runs on this device.</span><button class="outline-action" on:click={saveScan}>{saved ? '✓ Saved to vault' : '＋ Save aerosol scan'}</button></div>
  </div>
</section>

<style>
  .module-stack{display:grid;gap:13px}.mie-layout{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(270px,.82fr);gap:13px}.glass-card{min-width:0}.optical-card{padding:15px}.card-topline{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.section-kicker{font:8px ui-monospace,SFMono-Regular,monospace;letter-spacing:.12em;color:var(--muted)}.calibration-tag{border:1px solid #a35d4370;color:#e8a57d;font:7px ui-monospace,monospace;border-radius:20px;padding:5px 8px}.preset-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:12px}.preset-row>span{font:7px ui-monospace,monospace;color:var(--muted);margin-right:4px}.preset-row button{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:7px;padding:6px 8px;font-size:8px;cursor:pointer;transition:.2s}.preset-row button.active{border-color:#55cadd88;background:#0d3542;color:#b8f2f4}.optical-caveat{display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:8px 10px;background:#19202a66;border-radius:9px;color:#8b9aa8;font-size:8px;line-height:1.45}.optical-caveat>span{color:#f0c47c}.optical-caveat p{margin:0}.optical-caveat b{color:#cad4dc;font-weight:600}.mie-side{display:grid;gap:13px}.pm-card{padding:15px}.metric-heading{display:flex;align-items:center;gap:7px;color:var(--muted);font:8px ui-monospace,monospace;letter-spacing:.08em}.pulse-mark{width:6px;height:6px;border-radius:50%;background:#45d3a8;box-shadow:0 0 9px #45d3a8}.metric-big{font-size:36px;letter-spacing:-.06em;font-weight:650;margin:11px 0 7px}.metric-big small{font-size:10px;letter-spacing:0;color:var(--muted);font-weight:400;margin-left:5px}.aqi-row{display:flex;align-items:center;gap:11px}.aqi-number{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;border:1px solid color-mix(in srgb,var(--aqi-color) 50%,transparent);background:color-mix(in srgb,var(--aqi-color) 12%,transparent);font-size:16px;font-weight:700;color:var(--aqi-color)}.aqi-row div:nth-child(2){display:grid;gap:4px}.aqi-row b{font-size:10px}.aqi-row small{font-size:8px;color:var(--muted);line-height:1.35}.metric-divider{border-top:1px solid var(--line);margin:12px 0 10px}.mini-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mini-metrics div{display:grid;gap:5px}.mini-metrics span{font-size:8px;color:var(--muted)}.mini-metrics b{font-size:12px;font-weight:650}.mini-metrics b small{color:var(--muted);font-size:8px;font-weight:400}.metric-foot{color:#8595a4;font-size:7px;line-height:1.45;margin-top:10px}.chart-card{padding:13px 14px 10px}.chart-heading{display:flex;justify-content:space-between;align-items:center}.chart-heading>div{display:grid;gap:4px}.chart-heading small{font-size:8px;color:var(--muted)}.chart-mark{font:8px ui-monospace,monospace;color:#86cad7}.histogram{height:128px;margin-top:7px}.bin-legend{display:flex;justify-content:space-between;color:var(--muted);font-size:7px}.bin-legend span{display:flex;gap:5px;align-items:center}.bin-legend i{width:5px;height:5px;border-radius:50%}.fine-dot{background:#54cee0}.coarse-dot{background:#f1ad62}.science-strip{padding:13px 15px}.science-title{display:flex;align-items:center;gap:9px}.science-title small{color:var(--muted);font-size:8px}.diameter-control{display:flex;align-items:center;gap:10px;margin:10px 0;color:var(--muted);font-size:8px}.diameter-control input{flex:1;accent-color:#50c9dc}.diameter-control b{color:#dce8ec;min-width:47px;text-align:right;font:9px ui-monospace,monospace}.physics-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.physics-metrics>div{display:grid;gap:5px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:var(--panel-soft)}.physics-metrics span{font:7px ui-monospace,monospace;color:var(--muted)}.physics-metrics b{font-size:12px;font-weight:650}.physics-metrics b small{font-size:8px;color:var(--muted);font-weight:400}.physics-metrics>div>small{font-size:7px;color:var(--muted)}.pro-insight{margin-top:8px;color:#b6a0e8;font-size:8px}.save-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:11px;color:var(--muted);font-size:8px}.outline-action{border:1px solid #4ca6a666;border-radius:8px;background:#0c2a3466;color:#aee7e7;padding:7px 10px;font-size:8px;cursor:pointer}
  @media(max-width:800px){.mie-layout{grid-template-columns:1fr}.mie-side{grid-template-columns:1fr 1fr}.pm-card,.chart-card{min-height:220px}}
  @media(max-width:560px){.mie-side{grid-template-columns:1fr}.preset-row button{font-size:7px}.science-title{align-items:flex-start;flex-direction:column;gap:4px}.physics-metrics{grid-template-columns:1fr 1fr}.physics-metrics>div:last-child{grid-column:1/-1}}
</style>
