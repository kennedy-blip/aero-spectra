<script>
  import ModuleHeader from './ModuleHeader.svelte';
  import CurveCanvas from './CurveCanvas.svelte';
  import { solveCstr, requiredCleanAirCfm, buildFleetComparison } from '$engines/cstrCadrClearanceEngine.js';
  import { saveAudit } from '$db/aeroVaultDb.js';
  import { cfmToM3h, formatDuration } from '$engines/units.js';
  export let importedPm25 = 88.5;
  export let importedCfm = 145;
  export let pro = false;
  let volumeFt3 = 12000;
  let cadrCfm = 300;
  let efficiency = 0.92;
  let infiltrationAch = 0.35;
  let depositionAch = 0.2;
  let outdoorUg = 12;
  let penetration = 0.7;
  let sourceUgH = 20;
  let initialUg = 100;
  let targetEach = 5;
  let saved = false;
  let appliedLink = false;
  $: model = solveCstr({ volumeFt3, cadrCfm, filterEfficiency: efficiency, infiltrationAch, depositionAch, outdoorUg, penetration, sourceUgH, initialUg, durationMin: 480 });
  $: requiredCfm = requiredCleanAirCfm(Number(volumeFt3), Number(targetEach), Number(infiltrationAch));
  $: fleet = buildFleetComparison(Number(volumeFt3), Number(targetEach));
  $: curve = [{ label: 'Indoor concentration', color: '#72d7c2', values: model.points }];
  function importReadings() { initialUg = Number(importedPm25); cadrCfm = Math.max(0, Number(importedCfm)); efficiency = 0.82; appliedLink = true; saved = false; }
  async function savePlan() {
    await saveAudit('cadr_clearance_plans', { volumeFt3: Number(volumeFt3), cadrCfm: Number(cadrCfm), eACH: model.each, initialUg: Number(initialUg), t90Min: model.t90Min, t99Min: model.t99Min, requiredCfm });
    saved = true;
  }
</script>

<section class="module-stack">
  <ModuleHeader number="03" eyebrow="CSTR CLEAN-AIR ARCHITECT · CADR / eACH" title="HEPA & Corsi–Rosenthal planner" description="Model room concentration decay, steady-state loading and equivalent clean-air rate. Manufacturer floor-area claims are not a substitute for room volume and ACH." accent="green" status="MASS-BALANCE MODEL" />
  <div class="import-strip"><span class="import-icon">↳</span><span><b>Connect live workstation values</b><small>Seed a PM spike and airflow estimate from the other labs.</small></span><button on:click={importReadings}>{appliedLink ? '✓ Live inputs applied' : `Import ${Number(importedPm25).toFixed(1)} µg/m³ + ${Math.round(importedCfm)} CFM`}</button></div>
  <div class="cadr-layout">
    <div class="glass-card cadr-controls">
      <div class="section-title-row"><div><span class="section-kicker">ROOM & CONTAMINANT CONDITIONS</span><small>Single-zone, well-mixed assumption</small></div><span class="volume-chip">{(Number(volumeFt3)*0.0283168).toFixed(0)} m³</span></div>
      <div class="cadr-input-grid">
        <label>Room volume <div class="number-unit"><input type="number" min="500" max="100000" step="500" bind:value={volumeFt3}/><span>ft³</span></div></label>
        <label>Initial PM₂.₅ <div class="number-unit"><input type="number" min="0" max="1000" step="1" bind:value={initialUg}/><span>µg/m³</span></div></label>
        <label>Cleaner CADR <div class="number-unit"><input type="number" min="0" max="2000" step="10" bind:value={cadrCfm}/><span>CFM</span></div></label>
        <label>Outdoor PM₂.₅ <div class="number-unit"><input type="number" min="0" max="500" step="1" bind:value={outdoorUg}/><span>µg/m³</span></div></label>
      </div>
      <div class="slider-row"><div>Filter efficiency <b>{Math.round(efficiency*100)}%</b></div><input aria-label="Filter efficiency" type="range" min="0.4" max="1" step="0.01" bind:value={efficiency}/></div>
      <div class="slider-row"><div>Infiltration <b>{Number(infiltrationAch).toFixed(2)} ACH</b></div><input aria-label="Infiltration rate" type="range" min="0" max="2" step="0.05" bind:value={infiltrationAch}/></div>
      <div class="slider-row"><div>Envelope penetration <b>{Math.round(penetration*100)}%</b></div><input aria-label="Envelope particle penetration" type="range" min="0.1" max="1" step="0.01" bind:value={penetration}/></div>
      <div class="slider-row"><div>Deposition loss <b>{Number(depositionAch).toFixed(2)} h⁻¹</b></div><input aria-label="Deposition loss" type="range" min="0" max="1" step="0.05" bind:value={depositionAch}/></div>
      <div class="slider-row"><div>Indoor source rate <b>{Number(sourceUgH).toFixed(0)} µg/h</b></div><input aria-label="Indoor source rate" type="range" min="0" max="300" step="5" bind:value={sourceUgH}/></div>
      <div class="target-control"><span>Clean-air target</span><div class="target-chips">{#each [3,5,6] as each}<button class:active={Number(targetEach) === each} on:click={() => targetEach=each}>{each} eACH</button>{/each}</div></div>
      <div class="input-disclaimer">Illustrative, well-mixed model. Outdoor penetration and source emissions are uncertain; CADR assumes the selected efficiency at the operating fan speed.</div>
    </div>
    <div class="glass-card cadr-results">
      <div class="section-title-row"><div><span class="section-kicker">CLEAN-AIR RESPONSE</span><small>Analytical CSTR solution</small></div><span class="eq-pill">λ<sub>eff</sub> {model.lambdaEff.toFixed(2)} h⁻¹</span></div>
      <div class="cadr-main-metrics"><div><span>FILTERED FLOW</span><b>{Math.round(model.cleanCfm)}<small>CFM</small></b><em>{cfmToM3h(model.cleanCfm).toFixed(0)} m³/h</em></div><div><span>EQUIVALENT CLEAN AIR</span><b>{model.each.toFixed(1)}<small>eACH</small></b><em>{model.cadrAch.toFixed(1)} ACH from cleaner</em></div></div>
      <div class="clearance-chart"><CurveCanvas series={curve} maxX={480} maxY={Math.max(120, Number(initialUg)*1.05)} ariaLabel="CSTR indoor pollutant concentration decay curve" xLabel="minutes" yLabel="µg/m³" fill={true}/></div>
      <div class="clearance-metrics"><div><span>t₉₀ · 90% reduction</span><b>{formatDuration(model.t90Min)}</b></div><div><span>t₉₉ · 99% reduction</span><b>{formatDuration(model.t99Min)}</b></div><div><span>steady state</span><b>{model.steadyUg.toFixed(1)} <small>µg/m³</small></b></div></div>
      <div class="required-row"><span>Additional clean-air flow for {targetEach} eACH</span><b>{Math.ceil(requiredCfm)} CFM</b></div>
    </div>
  </div>
  <div class="glass-card fleet-card">
    <div class="fleet-heading"><div><span class="section-kicker">FLEET BUILDER · REFERENCE HARDWARE</span><small>Approximate list prices / rated CADR; verify actual speed and acoustic output.</small></div><span>5-year energy @ $0.18/kWh</span></div>
    <div class="fleet-table"><div class="fleet-head"><span>CONFIGURATION</span><span>QTY</span><span>CADR</span><span>W / 100 CFM</span><span>5-YR EST.</span></div>{#each fleet as unit}<div class="fleet-line"><span><b>{unit.name}</b><small>{unit.kind} · {unit.db} dBA reference</small></span><strong>×{unit.units}</strong><span>{unit.deliveredCfm} CFM</span><span>{unit.wattsPer100.toFixed(1)} W</span><b>${Math.round(unit.fiveYearCost).toLocaleString()}</b></div>{/each}</div>
    {#if pro}<div class="pro-equation">λ<sub>eff</sub> = λ<sub>inf</sub> + k<sub>dep</sub> + η·CADR/V &nbsp; · &nbsp; C<sub>ss</sub> = (PλC<sub>out</sub> + Ṡ/V) / λ<sub>eff</sub></div>{/if}
    <div class="save-row"><span>Store this plan in the on-device audit vault.</span><button class="outline-action" on:click={savePlan}>{saved ? '✓ Plan saved' : '＋ Save clearance plan'}</button></div>
  </div>
</section>

<style>
  .module-stack{display:grid;gap:13px}.import-strip{display:flex;align-items:center;gap:10px;border:1px solid #4bbba233;background:linear-gradient(100deg,#15352eaa,#13202aaa);border-radius:13px;padding:10px 13px}.import-icon{width:25px;height:25px;border-radius:8px;display:grid;place-items:center;background:#1e5143;color:#8de0bd;font-size:17px}.import-strip>span:nth-child(2){display:grid;gap:3px;flex:1}.import-strip b{font-size:9px}.import-strip small{font-size:8px;color:var(--muted)}.import-strip button{border:1px solid #4dba9970;border-radius:8px;padding:7px 10px;background:#12413788;color:#bcead9;font-size:8px;cursor:pointer}.cadr-layout{display:grid;grid-template-columns:minmax(290px,.85fr) minmax(0,1.15fr);gap:13px}.cadr-controls,.cadr-results,.fleet-card{padding:15px}.section-title-row{display:flex;justify-content:space-between;align-items:center;gap:9px}.section-title-row>div{display:grid;gap:4px}.section-title-row small{font-size:8px;color:var(--muted)}.volume-chip,.eq-pill{border:1px solid var(--line);border-radius:20px;padding:6px 9px;color:#b0d4d6;font:8px ui-monospace,monospace}.cadr-input-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.cadr-input-grid label{display:grid;gap:5px;color:var(--muted);font-size:8px}.number-unit{display:flex;align-items:center;background:#101d28;border:1px solid var(--line);border-radius:7px;padding:0 7px}.number-unit input{min-width:0;width:100%;border:0;outline:0;background:transparent;color:#e4edf0;padding:7px 0;font-size:9px}.number-unit span{white-space:nowrap;color:#8497a7;font-size:7px}.slider-row{margin-top:12px}.slider-row>div{display:flex;justify-content:space-between;font-size:8px;color:var(--muted)}.slider-row b{font:8px ui-monospace,monospace;color:#cfebd9}.slider-row input{width:100%;height:12px;accent-color:#5bd0af;margin:7px 0 0}.target-control{display:flex;justify-content:space-between;align-items:center;margin-top:11px;color:var(--muted);font-size:8px}.target-chips{display:flex;gap:5px}.target-chips button{border:1px solid var(--line);background:transparent;color:var(--muted);padding:6px 8px;border-radius:7px;font-size:8px;cursor:pointer}.target-chips button.active{color:#a8edce;border-color:#54c8a277;background:#15362e}.input-disclaimer{margin-top:12px;border-left:2px solid #6a9b7c;padding:7px 9px;background:#15221d55;color:#839487;font-size:7px;line-height:1.5}.cadr-main-metrics{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin:15px 0 5px}.cadr-main-metrics>div{display:grid;gap:5px;padding:10px;border:1px solid var(--line);background:var(--panel-soft);border-radius:10px}.cadr-main-metrics span{font:7px ui-monospace,monospace;color:var(--muted)}.cadr-main-metrics b{font-size:21px;letter-spacing:-.04em}.cadr-main-metrics b small{font-size:8px;color:var(--muted);margin-left:4px;letter-spacing:0}.cadr-main-metrics em{font-size:7px;color:#9ab1b6;font-style:normal}.clearance-chart{height:165px;margin-top:4px}.clearance-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.clearance-metrics>div{display:grid;gap:5px;padding:8px 9px;border:1px solid var(--line);border-radius:8px}.clearance-metrics span{font-size:7px;color:var(--muted)}.clearance-metrics b{font-size:10px}.clearance-metrics small{font-size:7px;color:var(--muted);font-weight:400}.required-row{display:flex;justify-content:space-between;align-items:center;padding:9px 1px 0;margin-top:9px;border-top:1px solid var(--line);font-size:8px;color:var(--muted)}.required-row b{color:#a8ebcd;font:11px ui-monospace,monospace}.fleet-heading{display:flex;justify-content:space-between;gap:8px;align-items:flex-end}.fleet-heading>div{display:grid;gap:4px}.fleet-heading small{font-size:8px;color:var(--muted)}.fleet-heading>span{font-size:7px;color:var(--muted)}.fleet-table{margin-top:12px}.fleet-head,.fleet-line{display:grid;grid-template-columns:minmax(150px,2fr) .45fr .7fr .8fr .7fr;align-items:center;gap:8px}.fleet-head{padding:7px 8px;color:#8192a0;font:7px ui-monospace,monospace;border-bottom:1px solid var(--line)}.fleet-line{padding:9px 8px;border-bottom:1px solid #67798721;font-size:8px}.fleet-line>span:first-child{display:grid;gap:4px}.fleet-line b{font-weight:600}.fleet-line small{font-size:7px;color:var(--muted)}.fleet-line strong,.fleet-line>span:not(:first-child){font:8px ui-monospace,monospace;color:#c2d0d1}.fleet-line>span:last-child{color:#a6e3c2}.pro-equation{margin-top:9px;color:#9dd8bf;font:8px ui-monospace,monospace}.save-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:11px;color:var(--muted);font-size:8px}.outline-action{border:1px solid #4ca6a666;border-radius:8px;background:#0c2a3466;color:#aee7e7;padding:7px 10px;font-size:8px;cursor:pointer}
  @media(max-width:760px){.cadr-layout{grid-template-columns:1fr}.fleet-table{overflow:auto}.fleet-head,.fleet-line{min-width:520px}}
  @media(max-width:480px){.import-strip{align-items:flex-start;flex-wrap:wrap}.import-strip button{margin-left:35px}.fleet-heading{align-items:flex-start;flex-direction:column}.cadr-input-grid{gap:8px}}
</style>
