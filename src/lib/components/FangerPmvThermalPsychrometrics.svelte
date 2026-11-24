<script>
  import { spring } from 'svelte/motion';
  import ModuleHeader from './ModuleHeader.svelte';
  import CurveCanvas from './CurveCanvas.svelte';
  import PsychrometricChart from './PsychrometricChart.svelte';
  import { fangerPmv, saturationVaporPressureKPa } from '$engines/fangerPmvPsychrometricEngine.js';
  import { saveAudit } from '$db/aeroVaultDb.js';
  export let supplyVelocity = 0.12;
  export let pro = false;
  let airC = 22.5;
  let radiantC = 22;
  let rh = 45;
  let velocityMs = 0.12;
  let met = 1.1;
  let clo = 0.7;
  let surfaceC = 17;
  let saved = false;
  const pmvDial = spring(0, { stiffness: 0.17, damping: 0.66 });
  $: linkedVelocity = Math.max(0.05, Math.min(1.2, Number(supplyVelocity) / 196.8504));
  $: result = fangerPmv({ airC: Number(airC), radiantC: Number(radiantC), velocityMs: Number(velocityMs), rh: Number(rh), met: Number(met), clo: Number(clo) });
  $: pmvDial.set(result.pmv);
  $: surfaceVapor = saturationVaporPressureKPa(result.dewPointC) / Math.max(0.0001, saturationVaporPressureKPa(Number(surfaceC)));
  $: surfaceAw = Math.min(1.5, surfaceVapor);
  $: pmvCurve = [{ label: 'PMV vs air temperature', color: '#b99aff', values: Array.from({ length: 33 }, (_, i) => { const temp = 16 + i * 0.5; return { x: temp, y: fangerPmv({ airC: temp, radiantC, velocityMs, rh, met, clo }).pmv }; }) }];
  $: pmvComfort = Math.abs(result.pmv) <= 0.5;
  async function saveAuditRecord() {
    await saveAudit('fanger_psychrometric_audits', { airC: Number(airC), radiantC: Number(radiantC), rh: Number(rh), velocityMs: Number(velocityMs), met: Number(met), clo: Number(clo), pmv: result.pmv, ppd: result.ppd, dewPointC: result.dewPointC, surfaceAw });
    saved = true;
  }
</script>

<section class="module-stack">
  <ModuleHeader number="04" eyebrow="ISO 7730 / ASHRAE 55 · PSYCHROMETRIC LAB" title="Thermal comfort & mold risk" description="Fanger PMV/PPD combines air, radiant, velocity, humidity, metabolic rate and clothing. The comfort polygon is an illustrative reference—not a compliance determination." accent="violet" status="ITERATIVE SOLVER" />
  <div class="thermal-layout">
    <div class="glass-card thermal-controls">
      <div class="thermal-state"><div class="pmv-score" class:comfortable={pmvComfort}><b>{$pmvDial > 0 ? '+' : ''}{$pmvDial.toFixed(2)}</b><small>PMV</small></div><div class="state-copy"><span class="section-kicker">PREDICTED MEAN VOTE</span><b>{pmvComfort ? 'Comfort zone' : result.pmv < -0.5 ? 'Cool sensation' : 'Warm sensation'}</b><small>PPD {result.ppd.toFixed(0)}% dissatisfied · ISO 7730 model</small></div></div>
      <div class="thermal-inputs">
        <label>Air temperature <b>{Number(airC).toFixed(1)} °C</b><input type="range" min="16" max="32" step="0.1" bind:value={airC}/></label>
        <label>Mean radiant temp. <b>{Number(radiantC).toFixed(1)} °C</b><input type="range" min="10" max="36" step="0.1" bind:value={radiantC}/></label>
        <label>Relative humidity <b>{Number(rh).toFixed(0)}%</b><input type="range" min="10" max="90" step="1" bind:value={rh}/></label>
        <label>Air velocity <b>{Number(velocityMs).toFixed(2)} m/s</b><input type="range" min="0.05" max="1.2" step="0.01" bind:value={velocityMs}/></label>
        <label>Metabolic activity <b>{Number(met).toFixed(1)} met</b><input type="range" min="0.8" max="2" step="0.1" bind:value={met}/></label>
        <label>Clothing insulation <b>{Number(clo).toFixed(1)} clo</b><input type="range" min="0.3" max="1.5" step="0.1" bind:value={clo}/></label>
      </div>
      <div class="thermal-formula">Inputs include <b>T<sub>a</sub></b> · <b>T<sub>mrt</sub></b> · <b>v<sub>air</sub></b> · RH · met · clo <button on:click={() => velocityMs = linkedVelocity}>Link HVAC flow · {linkedVelocity.toFixed(2)} m/s</button></div>
    </div>
    <div class="glass-card psychro-card">
      <div class="psychro-head"><div><span class="section-kicker">INDOOR AIR STATE</span><small>Humidity ratio · g water / kg dry air</small></div><span class="point-legend"><i></i>current point</span></div>
      <div class="psychro-chart"><PsychrometricChart tempC={Number(airC)} rh={Number(rh)} /></div>
      <div class="psychro-footer"><span>Dry-bulb {Number(airC).toFixed(1)} °C</span><span>Wet-bulb {result.wetBulbC.toFixed(1)} °C</span><span>ω {result.humidityRatio.toFixed(1)} g/kg</span><span>h {result.enthalpyKJkg.toFixed(1)} kJ/kg</span></div>
    </div>
  </div>
  <div class="glass-card thermal-lower">
    <div class="comfort-curve-card"><div class="lower-heading"><div><span class="section-kicker">COMFORT RESPONSE</span><small>PMV vs. dry-bulb temperature · fixed personal/room conditions</small></div><span class="comfort-label" class:ok={pmvComfort}>{pmvComfort ? '−0.5 to +0.5' : 'outside reference band'}</span></div><div class="pmv-chart"><CurveCanvas series={pmvCurve} maxX={32} minY={-3} maxY={3} xLabel="°C" yLabel="PMV" ariaLabel="Fanger predicted mean vote response by air temperature"/></div></div>
    <div class="mold-card"><div class="lower-heading"><div><span class="section-kicker">COLD-SURFACE MOLD SCREEN</span><small>Dew point & thermal bridge surface humidity</small></div><span class="mold-mark">⌁</span></div><div class="mold-readings"><div><span>DEW POINT</span><b>{result.dewPointC.toFixed(1)}<small>°C</small></b></div><div><span>SURFACE WATER ACTIVITY</span><b>{surfaceAw.toFixed(2)}<small> a<sub>w</sub></small></b></div></div><label class="surface-control">Cold wall / frame <b>{Number(surfaceC).toFixed(1)} °C</b><input type="range" min="5" max="24" step="0.5" bind:value={surfaceC}/></label><div class="mold-alert" class:high={surfaceAw >= 0.8}><i></i>{surfaceAw >= 0.8 ? 'Elevated mold-growth conditions · reduce surface moisture' : 'Below 0.80 screening threshold'}</div></div>
    {#if pro}<div class="pro-thermal">Solver converged in {result.iterations} clothing-surface iterations · T<sub>cl</sub> {result.clothingSurfaceC.toFixed(2)} °C</div>{/if}
    <div class="save-row"><span>Surface water activity is a screening estimate; hidden cavities need inspection.</span><button class="outline-action" on:click={saveAuditRecord}>{saved ? '✓ Saved to vault' : '＋ Save comfort audit'}</button></div>
  </div>
</section>

<style>
  .module-stack{display:grid;gap:13px}.thermal-layout{display:grid;grid-template-columns:minmax(300px,.9fr) minmax(0,1.1fr);gap:13px}.thermal-controls,.psychro-card,.thermal-lower{padding:15px}.thermal-state{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}.pmv-score{width:57px;height:57px;border-radius:17px;display:grid;align-content:center;text-align:center;background:#2b2142;border:1px solid #b18bf344;color:#d8c5ff}.pmv-score.comfortable{background:#15392f;border-color:#56c79844;color:#9ce4c2}.pmv-score b{font-size:18px;letter-spacing:-.04em}.pmv-score small{font:7px ui-monospace,monospace;opacity:.75}.state-copy{display:grid;gap:5px}.state-copy b{font-size:11px}.state-copy small{font-size:8px;color:var(--muted)}.thermal-inputs{display:grid;grid-template-columns:1fr 1fr;column-gap:14px;row-gap:11px;margin-top:14px}.thermal-inputs label{display:grid;gap:5px;color:var(--muted);font-size:8px}.thermal-inputs b{color:#e2d8fa;font:8px ui-monospace,monospace}.thermal-inputs input,.surface-control input{width:100%;accent-color:#b694f6;height:11px}.thermal-formula{margin-top:12px;padding:8px;border-radius:8px;background:#1d1a2c77;color:#9488ac;font:8px ui-monospace,monospace;display:flex;align-items:center;gap:4px;flex-wrap:wrap}.thermal-formula b{color:#c7b4f3}.thermal-formula button{margin-left:auto;border:1px solid #806db055;border-radius:6px;background:#29213a;color:#d1baf9;padding:5px 7px;font-size:7px;cursor:pointer}.psychro-head{display:flex;align-items:center;justify-content:space-between}.psychro-head>div{display:grid;gap:4px}.psychro-head small{font-size:8px;color:var(--muted)}.point-legend{font-size:7px;color:var(--muted);display:flex;gap:5px;align-items:center}.point-legend i{width:6px;height:6px;border-radius:50%;background:#8df3ee;box-shadow:0 0 5px #8df3ee}.psychro-chart{height:260px;margin-top:7px}.psychro-footer{display:flex;justify-content:space-between;gap:5px;color:#91a4ad;font:7px ui-monospace,monospace}.thermal-lower{display:grid;grid-template-columns:1fr 1fr;gap:14px}.comfort-curve-card,.mold-card{min-width:0}.lower-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.lower-heading>div{display:grid;gap:4px}.lower-heading small{font-size:8px;color:var(--muted)}.comfort-label{color:#bba8df;font:7px ui-monospace,monospace;border:1px solid #8c70bf55;padding:5px 7px;border-radius:15px;white-space:nowrap}.comfort-label.ok{color:#9ce2bf;border-color:#58bd8b55}.pmv-chart{height:142px;margin-top:5px}.mold-mark{color:#d7a7ec;font-size:17px}.mold-readings{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.mold-readings>div{display:grid;gap:5px;padding:9px;border:1px solid var(--line);border-radius:8px}.mold-readings span{font:7px ui-monospace,monospace;color:var(--muted)}.mold-readings b{font-size:16px}.mold-readings small{font-size:8px;color:var(--muted);font-weight:400}.surface-control{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:12px;color:var(--muted);font-size:8px}.surface-control b{font:8px ui-monospace,monospace;color:#e3c3ed}.surface-control input{grid-column:1/-1}.mold-alert{display:flex;align-items:center;gap:7px;margin-top:11px;padding:8px;border-radius:8px;background:#17312866;color:#a2d7bd;font-size:8px}.mold-alert i{width:6px;height:6px;border-radius:50%;background:#5bd4a1}.mold-alert.high{background:#40241f88;color:#ffc08f}.mold-alert.high i{background:#ff995d;box-shadow:0 0 6px #ff995d}.pro-thermal{grid-column:1/-1;color:#d0bce9;font-size:8px}.save-row{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:2px;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:8px}.outline-action{border:1px solid #4ca6a666;border-radius:8px;background:#0c2a3466;color:#aee7e7;padding:7px 10px;font-size:8px;cursor:pointer}
  @media(max-width:780px){.thermal-layout{grid-template-columns:1fr}.psychro-chart{height:230px}}
  @media(max-width:560px){.thermal-lower{grid-template-columns:1fr}.pro-thermal,.save-row{grid-column:1}.thermal-inputs{gap:9px}.psychro-footer{flex-wrap:wrap}}
</style>
