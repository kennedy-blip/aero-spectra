<script>
  import { onMount } from 'svelte';
  import { apiEndpoint } from '$lib/apiEndpoint.js';
  export let open = false;
  export let onClose = () => {};
  let apiStatus = 'Checking same-origin solver…';
  const runtimes = [
    { name: 'Svelte 5 workstation', tag: 'UI', detail: 'Interactive module state, accessible overlays and offline-first viewport.', tone: 'cyan' },
    { name: 'Pure ES2024 engines', tag: 'CLIENT', detail: 'Mie sizing, Strouhal flow, CSTR, Fanger PMV/PPD and RK4 COHb.', tone: 'green' },
    { name: 'Vercel SvelteKit API', tag: 'API', detail: 'Deployable server route with five-domain JavaScript mirror and optional private audit sync.', tone: 'amber' },
    { name: 'Python 3.12 solver', tag: 'PYTHON', detail: 'Standalone reference endpoint, proxied by the local Vite development server.', tone: 'amber' },
    { name: 'Android / Capacitor 6', tag: 'NATIVE', detail: 'Camera2 macro/torch and AudioRecord + environmental sensor bridge sources.', tone: 'violet' },
    { name: 'WebGL2 GLSL', tag: 'GPU', detail: 'Airflow underlay and temporal dark-field frame-difference detector shader.', tone: 'blue' },
    { name: 'IndexedDB vault', tag: 'LOCAL', detail: 'Five audit stores with a visible offline mutation queue.', tone: 'pink' }
  ];
  onMount(async () => {
    try {
      const response = await fetch(apiEndpoint('/api/aero_environmental_solver'));
      const data = await response.json();
      const solverName = data.model === 'aero-spectra-python' ? 'Python reference solver' : data.model === 'aero-spectra-javascript-mirror' ? 'JavaScript server route' : 'Solver endpoint';
      apiStatus = data.ok ? (data.syncConfigured ? `Reachable · ${solverName} + remote audit sync` : `Reachable · ${solverName} · device-only vault`) : 'Responding · check solver';
    } catch { apiStatus = 'Offline / preview · client mirrors active'; }
  });
  async function benchmarkSolver() {
    apiStatus = 'Running server API smoke test…';
    try {
      const response = await fetch(apiEndpoint('/api/aero_environmental_solver'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        aerosol: { diameter_um: 1.2, pm25_ug_m3: 18 },
        hvac: { peak_hz: 27.6, vane_spacing_mm: 18, width_in: 12, height_in: 6, room_ft3: 1200 },
        cadr: { volume_ft3: 12000, cadr_cfm: 300, filter_efficiency: 0.92, initial_ug: 100 },
        thermal: { air_c: 24, radiant_c: 24, velocity_ms: 0.1, rh: 50, met: 1.1, clo: 0.7 },
        cohb: { co_ppm: 35, duration_min: 60, start_percent: 0.8 }
      }) });
      const data = await response.json();
      const domains = Object.keys(data.result || {});
      apiStatus = response.ok && data.ok && domains.length === 5 ? 'Server API smoke test · all five domains ready' : 'API responded · inspect payload';
    } catch { apiStatus = 'Server API unavailable · local JS mirrors remain active'; }
  }
</script>

{#if open}
  <div class="modal-backdrop" role="presentation" on:click={(event) => event.target === event.currentTarget && onClose()}>
    <dialog open class="runtime-modal glass-modal" aria-modal="true" aria-labelledby="runtime-title">
      <header class="modal-head"><div><span class="eyebrow">ENVIRONMENTAL SYSTEMS ARCHITECT</span><h2 id="runtime-title">Runtime inspector</h2></div><button class="close-button" on:click={onClose} aria-label="Close inspector">×</button></header>
      <div class="runtime-status"><span class="status-led"></span><span class="api-status-text">{apiStatus}</span><button class="api-test" on:click={benchmarkSolver}>Test API</button><span class="runtime-build">JS MIRROR · READY</span></div>
      <div class="runtime-grid">
        {#each runtimes as runtime}
          <article class="runtime-item"><span class={`runtime-tag ${runtime.tone}`}>{runtime.tag}</span><div><b>{runtime.name}</b><p>{runtime.detail}</p></div><span class="check">✓</span></article>
        {/each}
      </div>
      <div class="inspector-note"><strong>Offline queue</strong><span>Inspect queued audits and export JSON from the vault controls. Raw camera and audio buffers are never sent.</span></div>
      <footer class="modal-foot"><span>JS · GLSL · Python · Kotlin</span><button class="primary-button" on:click={onClose}>Return to workstation</button></footer>
    </dialog>
  </div>
{/if}

<style>
  .modal-backdrop{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:18px;background:rgba(1,7,14,.72);backdrop-filter:blur(18px)}
  .runtime-modal{position:relative;inset:auto;margin:0;max-width:100%;color:var(--text);width:min(690px,100%);padding:24px;border-radius:26px;box-shadow:0 28px 100px #0009;animation:rise .24s ease-out}
  @keyframes rise{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
  .modal-head{display:flex;justify-content:space-between;align-items:flex-start}.eyebrow{color:var(--cyan);font:8px ui-monospace,monospace;letter-spacing:.16em}
  h2{font-size:24px;letter-spacing:-.04em;margin:7px 0 0}.close-button{background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:50%;width:31px;height:31px;font-size:20px;cursor:pointer}
  .runtime-status{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:18px 0;color:#c5d8e6;font-size:10px}
  .status-led{width:7px;height:7px;border-radius:50%;background:#42d9aa;box-shadow:0 0 8px #42d9aa}.api-status-text{flex:1}.api-test{border:1px solid var(--line);border-radius:6px;background:transparent;color:#a9dfe4;padding:5px 7px;font-size:7px;cursor:pointer}.runtime-build{color:#8aa0b1;font:8px ui-monospace,monospace}
  .runtime-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.runtime-item{display:flex;align-items:flex-start;gap:9px;padding:12px;background:var(--panel-soft);border:1px solid var(--line);border-radius:13px;min-height:83px}
  .runtime-tag{font:7px ui-monospace,monospace;border-radius:5px;padding:5px 6px;background:#18364b;color:#9adff0}.runtime-tag.green{color:#91e7bb;background:#123b34}.runtime-tag.amber{color:#f3d38c;background:#3b3218}.runtime-tag.violet{color:#d4b7ff;background:#302145}.runtime-tag.blue{color:#a9c9ff;background:#1b2e4c}.runtime-tag.pink{color:#f2b4d7;background:#44263a}
  .runtime-item b{font-size:10px}.runtime-item p{font-size:8px;line-height:1.5;color:var(--muted);margin:5px 0 0}.check{margin-left:auto;color:#54d4a0;font-size:12px}
  .inspector-note{margin-top:13px;padding:11px 12px;border-left:2px solid #a78bfa;background:#15162488;display:grid;gap:4px}.inspector-note strong{font-size:9px}.inspector-note span{font-size:8px;color:var(--muted);line-height:1.5}
  .modal-foot{display:flex;justify-content:space-between;align-items:center;margin-top:18px;color:var(--muted);font:8px ui-monospace,monospace}.primary-button{border:0;border-radius:9px;background:#72d9e4;color:#07131b;padding:9px 13px;font-size:9px;font-weight:700;cursor:pointer}
  @media(max-width:560px){.runtime-grid{grid-template-columns:1fr}.runtime-modal{padding:18px}.runtime-build{font-size:7px}}
</style>
