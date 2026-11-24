<script>
  import { onMount } from 'svelte';
  import OpticalMieAerosolNephelometer from './OpticalMieAerosolNephelometer.svelte';
  import AcousticHvacBalometerLab from './AcousticHvacBalometerLab.svelte';
  import HepaCadrClearanceArchitect from './HepaCadrClearanceArchitect.svelte';
  import FangerPmvThermalPsychrometrics from './FangerPmvThermalPsychrometrics.svelte';
  import CoburnCoHbAlarmInterceptor from './CoburnCoHbAlarmInterceptor.svelte';
  import HardwarePermissionGatekeeper from './HardwarePermissionGatekeeper.svelte';
  import PolyglotRuntimeInspectorModal from './PolyglotRuntimeInspectorModal.svelte';
  import ApkReleaseDownloadModal from './ApkReleaseDownloadModal.svelte';
  import Modal from './Modal.svelte';
  import { aerosolSummary } from '$engines/mieAerosolNephelometerEngine.js';
  import { exportEnvironmentalReport, readMutationQueue, syncMutationQueue } from '$db/aeroVaultDb.js';
  import { apiEndpoint } from '$lib/apiEndpoint.js';

  const modules = [
    { id: 'mie', n: '01', icon: '◉', title: 'Aerosol lab', sub: 'Optical nephelometry', tone: 'cyan' },
    { id: 'hvac', n: '02', icon: '⌁', title: 'HVAC flow', sub: 'CFM · ACH · filter', tone: 'amber' },
    { id: 'cadr', n: '03', icon: '✳', title: 'Clean air', sub: 'HEPA · CADR', tone: 'green' },
    { id: 'thermal', n: '04', icon: '◒', title: 'Thermal comfort', sub: 'PMV · psychrometrics', tone: 'violet' },
    { id: 'safety', n: '05', icon: '⌑', title: 'CO safety', sub: 'COHb · alarms', tone: 'rose' }
  ];
  const themes = [
    { id: 'obsidian', name: 'Obsidian', hint: 'ISO class-1 dark', dot: '#38bdf8' },
    { id: 'daylight', name: 'Daylight', hint: 'ASHRAE field', dot: '#e9f3f5' },
    { id: 'hazmat', name: 'Hazmat', hint: 'AQI alert', dot: '#f59e0b' },
    { id: 'eco', name: 'Eco-glass', hint: 'Low GPU', dot: '#10b981' }
  ];
  let activeModule = 'mie';
  let theme = 'obsidian';
  let role = 'occupant';
  let viewport = 'desktop';
  let livePm = 4.2;
  let livePm10 = 7.8;
  let liveCfm = 145;
  let online = true;
  let syncReady = false;
  let queue = [];
  let queueOpen = false;
  let inspectorOpen = false;
  let apkOpen = false;
  let mobileNav = false;
  let notice = '';
  $: activeIndex = Math.max(0, modules.findIndex((item) => item.id === activeModule));
  $: air = aerosolSummary(Number(livePm), Number(livePm10));
  $: roleLabel = role === 'occupant' ? 'Occupant' : role === 'pro' ? 'Hygienist · Pro' : 'Systems architect';
  $: roleIsPro = role === 'pro' || role === 'admin';
  $: if (typeof window !== 'undefined') {
    const telemetry = { cfm: Number(liveCfm), aqi: air.aqi };
    try { localStorage.setItem('aero-telemetry', JSON.stringify(telemetry)); } catch {}
    window.dispatchEvent(new CustomEvent('aero-telemetry-change', { detail: telemetry }));
  }

  function setTheme(next) {
    theme = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem('aero-theme', next);
    localStorage.setItem('aero-theme-mode', next === 'daylight' ? 'daylight' : 'dark');
    window.dispatchEvent(new CustomEvent('aero-theme-change', { detail: next }));
  }
  function setRole(event) { role = event.currentTarget.value; }
  function selectModule(id) { activeModule = id; mobileNav = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  async function openQueue() { queue = await readMutationQueue(); queueOpen = true; }
  async function syncQueue() {
    const result = await syncMutationQueue();
    queue = await readMutationQueue();
    notice = result.offline ? 'Offline: audits remain safely queued on this device.' : result.error ? `${result.error} ${result.queued} audit${result.queued === 1 ? '' : 's'} still queued.` : `${result.synced} audit${result.synced === 1 ? '' : 's'} synced to the private vault · ${result.queued} remain.`;
  }
  async function exportReport() {
    const report = await exportEnvironmentalReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `aero-spectra-audit-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice = 'Environmental hygiene report exported as JSON.';
  }
  function printReport() {
    const text = `AERO-SPECTRA · Indoor Environmental Hygiene Report\nGenerated ${new Date().toLocaleString()}\nPM2.5 ${Number(livePm).toFixed(1)} µg/m³ · AQI ${air.aqi}\nHVAC estimated airflow ${Math.round(liveCfm)} CFM\n\nScreening estimates only. Verify with calibrated instruments.`;
    const win = window.open('', '_blank');
    if (win) { win.document.write(`<title>AERO-SPECTRA Audit</title><pre style="font:14px ui-monospace;white-space:pre-wrap;padding:30px">${text}</pre>`); win.document.close(); win.print(); }
  }
  onMount(() => {
    theme = localStorage.getItem('aero-theme') || 'obsidian';
    document.documentElement.dataset.theme = theme;
    window.dispatchEvent(new CustomEvent('aero-theme-change', { detail: theme }));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    online = navigator.onLine;
    const checkSyncConfig = async () => {
      try {
        const response = await fetch(apiEndpoint('/api/aero_environmental_solver'), { cache: 'no-store' });
        const health = await response.json();
        syncReady = response.ok && health.syncConfigured === true;
      } catch { syncReady = false; }
    };
    const updateOnline = () => { online = navigator.onLine; if (online) checkSyncConfig(); };
    const refreshQueue = async () => queue = await readMutationQueue();
    checkSyncConfig();
    window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
    window.addEventListener('aero-vault-updated', refreshQueue);
    refreshQueue();
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); window.removeEventListener('aero-vault-updated', refreshQueue); };
  });
</script>

<svelte:head>
  <meta name="application-name" content="AERO-SPECTRA" />
  <link rel="manifest" href="/manifest.webmanifest" />
</svelte:head>

<div class="workspace-root" class:mobile-preview={viewport === 'mobile'}>
  <header class="topbar">
    <a class="brand-lockup" href="#top" aria-label="Aero-Spectra home" on:click|preventDefault={() => selectModule('mie')}>
      <span class="brand-mark"><svg viewBox="0 0 36 36" aria-hidden="true"><path d="M18 3 33 31H3L18 3Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 25c4-8 14-8 18 0M13 25c3-4 7-4 10 0" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="18" cy="20" r="2" fill="currentColor"/></svg></span>
      <span class="brand-word"><strong>AERO<span>·</span>SPECTRA</strong><small>ENVIRONMENTAL WORKSTATION <i>v1.21</i></small></span>
    </a>
    <div class="topbar-center">
      <div class="viewport-switcher" aria-label="Viewport mode"><button class:active={viewport === 'desktop'} on:click={() => viewport='desktop'}><span>▣</span> Workstation</button><button class:active={viewport === 'mobile'} on:click={() => viewport='mobile'}><span>▯</span> APK frame</button></div>
    </div>
    <div class="topbar-actions">
      <div class="role-control"><span>ROLE</span><select bind:value={role} aria-label="Privilege tier"><option value="occupant">Occupant</option><option value="pro">Hygienist · Pro</option><option value="admin">Architect · Admin</option></select><i>⌄</i></div>
      <button class="header-action vault-action" on:click={openQueue}><span>▤</span><span class="vault-label">Vault</span>{#if queue.length}<b>{queue.length}</b>{/if}</button>
      <button class="header-action report-action" on:click={exportReport}><span>↧</span><span>Export</span></button>
      {#if role === 'admin'}<button class="header-action inspector-action" on:click={() => inspectorOpen=true}><span>⌘</span><span>Runtime</span></button>{/if}
      <button class="apk-trigger" on:click={() => apkOpen=true}><span>⬇</span><span>Get Android APK</span></button>
    </div>
  </header>

  <div class="viewport-stage" id="top">
    <div class="workspace-frame">
      {#if viewport === 'mobile'}<div class="phone-chrome"><span></span><b>AERO-SPECTRA · ANDROID PREVIEW</b><i>···</i></div>{/if}
      <div class="workspace-content">
        <section class="overview-row">
          <div class="overview-title"><div class="live-kicker"><span class="online-dot" class:offline={!online}></span>{!online ? 'OFFLINE MODE · DATA STAYS ON DEVICE' : syncReady ? 'LOCAL-FIRST · REMOTE AUDIT SYNC READY' : 'LOCAL-FIRST · DEVICE VAULT · REMOTE SYNC NOT CONFIGURED'}</div><h1>Indoor air, <span>engineered.</span></h1><p>Five connected labs for particle, airflow, clean-air, comfort and combustion safety screening.</p></div>
          <div class="overview-readouts">
            <div class="readout"><span>PM₂.₅ · SIM</span><b>{Number(livePm).toFixed(1)} <small>µg/m³</small></b><i class="spark cyan"></i></div>
            <div class="readout"><span>EPA AQI</span><b style={`color:${air.band.color}`}>{air.aqi} <small>{air.band.label}</small></b><i class="spark amber"></i></div>
            <div class="readout"><span>HVAC FLOW</span><b>{Math.round(liveCfm)} <small>CFM</small></b><i class="spark green"></i></div>
          </div>
        </section>
        <div class="theme-and-role-row">
          <div class="theme-switcher"><span>VISUAL MODE</span>{#each themes as item}<button class:chosen={theme === item.id} on:click={() => setTheme(item.id)} aria-label={`Set ${item.name} theme`} title={`${item.name} · ${item.hint}`}><i style={`--theme-dot:${item.dot}`}></i><span>{item.name}</span></button>{/each}</div>
          <div class="role-badge"><span class="role-shield">◇</span><span><b>{roleLabel}</b><small>{role === 'occupant' ? 'All 5 labs · local audits' : role === 'pro' ? 'Advanced physics · report exports' : 'Inspector · sync queue diagnostics'}</small></span></div>
        </div>
        {#if notice}<div class="notice-toast" role="status">{notice}<button on:click={() => notice=''}>×</button></div>{/if}
        <div class="workspace-grid">
          <aside class="side-rail">
            <div class="rail-label">ENVIRONMENTAL LABS <span>05</span></div>
            <nav aria-label="Environmental modules">
              {#each modules as item}
                <button class={`rail-link ${item.tone}`} class:selected={activeModule === item.id} on:click={() => selectModule(item.id)} aria-current={activeModule === item.id ? 'page' : undefined}>
                  <span class="rail-icon">{item.icon}</span><span class="rail-copy"><b>{item.title}</b><small>{item.sub}</small></span><span class="rail-number">{item.n}</span>
                </button>
              {/each}
            </nav>
            <div class="rail-spacer"></div>
            <HardwarePermissionGatekeeper />
            <div class="offline-card"><div><span class="storage-icon">◫</span><b>LOCAL VAULT</b><i class:connected={online}></i></div><small>{queue.length} pending sync · IndexedDB</small><button on:click={openQueue}>Inspect audit queue <span>↗</span></button></div>
            <div class="rail-footer"><span>ENGINE MODE</span><b><i></i>{role === 'occupant' ? 'CLIENT · OFFLINE READY' : 'POLYGLOT · HYBRID'}</b></div>
          </aside>
          <main class="module-stage" aria-live="polite">
            {#if activeModule === 'mie'}<OpticalMieAerosolNephelometer bind:pm25={livePm} bind:pm10={livePm10} pro={roleIsPro}/>
            {:else if activeModule === 'hvac'}<AcousticHvacBalometerLab bind:cfm={liveCfm} pro={roleIsPro}/>
            {:else if activeModule === 'cadr'}<HepaCadrClearanceArchitect importedPm25={livePm} importedCfm={liveCfm} pro={roleIsPro}/>
            {:else if activeModule === 'thermal'}<FangerPmvThermalPsychrometrics supplyVelocity={liveCfm} pro={roleIsPro}/>
            {:else}<CoburnCoHbAlarmInterceptor />{/if}
          </main>
        </div>
        <div class="mobile-hardware"><HardwarePermissionGatekeeper /></div>
        <footer class="workspace-footer"><span>◈ PHYSICS-INFORMED SCREENING · NOT A CERTIFIED INSTRUMENT</span><span>LOCAL DATA · MEDIA NOT UPLOADED · {queue.length} QUEUED</span></footer>
      </div>
      {#if viewport === 'mobile'}<div class="phone-home"></div>{/if}
    </div>
  </div>

  <nav class="mobile-dock" aria-label="Module dock">
    <svg class="dock-filter" aria-hidden="true"><defs><filter id="aero-gooey-dock"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo"/><feComposite in="SourceGraphic" in2="goo" operator="atop"/></filter></defs></svg>
    <span class="dock-blob" style={`--active-index:${activeIndex}`}></span>
    {#each modules as item, index}<button class:active={activeModule === item.id} on:click={() => selectModule(item.id)} aria-label={item.title}><span>{item.icon}</span><small>{item.n}</small></button>{/each}
  </nav>

  <Modal open={queueOpen} title="Offline audit vault" subtitle="INDEXEDDB · LOCAL-FIRST" onClose={() => queueOpen=false}>
    <div class="queue-modal-body"><div class="queue-summary"><span class="queue-number">{queue.length}</span><span><b>pending mutation{queue.length === 1 ? '' : 's'}</b><small>{!online ? 'Offline · queued locally' : syncReady ? 'Online · private sync is user initiated' : 'Online · remote sync is not configured'}</small></span><i class:connected={online}></i></div>
      {#if queue.length}<div class="queue-list">{#each queue.slice().reverse() as item}<div class="queue-item"><span class="queue-kind">{item.storeName?.replaceAll('_',' ') || 'audit'}</span><b>{item.record?.preset || item.record?.alarmType || item.record?.source || 'Environmental audit'}</b><small>{new Date(item.createdAt).toLocaleString()}</small><code>{item.id?.slice(0,8)}</code></div>{/each}</div>{:else}<div class="empty-queue"><span>✓</span><b>Queue is clear</b><small>Saved module audits appear here for optional sync.</small></div>{/if}
      <div class="queue-actions">{#if roleIsPro}<button class="secondary-modal-button" on:click={printReport}>Print summary</button>{/if}<button class="secondary-modal-button" on:click={exportReport}>Export JSON</button><button class="primary-modal-button" on:click={syncQueue} disabled={!online || queue.length === 0}>↻ Sync queue</button></div>
      <p class="queue-privacy">Only calculated audit summaries are eligible for sync. Raw camera and microphone media are never stored or uploaded by the app.</p>
    </div>
  </Modal>
  <PolyglotRuntimeInspectorModal open={inspectorOpen} onClose={() => inspectorOpen=false}/>
  <ApkReleaseDownloadModal open={apkOpen} onClose={() => apkOpen=false}/>
</div>

<style>
  .workspace-root{position:relative;z-index:1;min-height:100vh;padding-bottom:30px;color:var(--text)}.topbar{height:62px;position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:17px;padding:0 clamp(14px,3vw,38px);border-bottom:1px solid var(--line);background:var(--topbar);backdrop-filter:blur(22px) saturate(160%);box-shadow:0 4px 24px #00000010}.brand-lockup{display:flex;gap:9px;align-items:center;min-width:203px;color:var(--text);text-decoration:none}.brand-mark{width:30px;height:30px;color:#69d9e8}.brand-mark svg{width:100%;height:100%}.brand-word{display:grid;gap:3px}.brand-word strong{font-size:11px;letter-spacing:.1em;font-weight:750}.brand-word strong span{color:#54d5e3}.brand-word small{font:6px ui-monospace,monospace;letter-spacing:.13em;color:var(--muted)}.brand-word small i{font-style:normal;color:#77cdbf;margin-left:4px}.topbar-center{flex:1;display:flex;justify-content:center}.viewport-switcher{display:flex;padding:3px;background:var(--panel-soft);border:1px solid var(--line);border-radius:10px}.viewport-switcher button{border:0;border-radius:7px;background:transparent;color:var(--muted);padding:6px 10px;font-size:8px;cursor:pointer;transition:.2s}.viewport-switcher button span{margin-right:5px;font-size:10px}.viewport-switcher button.active{background:var(--active-surface);color:var(--text);box-shadow:0 1px 5px #0002}.topbar-actions{display:flex;align-items:center;gap:6px}.role-control{position:relative;display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel-soft);border-radius:8px;padding:0 8px;height:29px}.role-control>span{color:var(--muted);font:7px ui-monospace,monospace;letter-spacing:.08em}.role-control select{appearance:none;border:0;background:transparent;color:var(--text);font-size:8px;padding:5px 12px 5px 0;outline:0;cursor:pointer}.role-control select option{background:#101a25;color:#e6edf4}.role-control i{position:absolute;right:7px;pointer-events:none;font-style:normal;color:var(--muted);font-size:11px}.header-action{height:29px;display:flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft);color:var(--muted);padding:0 8px;font-size:8px;cursor:pointer}.header-action>span:first-child{font-size:11px;color:#a7cbd0}.vault-action{position:relative}.vault-action b{position:absolute;top:-5px;right:-5px;min-width:14px;height:14px;border-radius:10px;display:grid;place-items:center;background:#45ba9c;color:#06221d;font:7px ui-monospace,monospace}.apk-trigger{height:30px;display:flex;align-items:center;gap:6px;border:0;border-radius:8px;background:linear-gradient(105deg,#6ad9e6,#75d6b3);color:#07141c;padding:0 10px;font-size:8px;font-weight:750;cursor:pointer;box-shadow:0 4px 16px #41c2bf22}.apk-trigger span{font-size:10px}.viewport-stage{padding:20px clamp(12px,3vw,40px) 12px}.workspace-frame{max-width:1440px;margin:0 auto;transition:max-width .35s ease}.mobile-preview .workspace-frame{max-width:430px;border:1px solid #86a6b45e;border-radius:30px;overflow:hidden;background:var(--bg);box-shadow:0 30px 100px #0005;padding:0 8px}.phone-chrome{height:29px;padding:0 12px;display:flex;align-items:center;justify-content:space-between;color:var(--muted);font:7px ui-monospace,monospace;letter-spacing:.1em}.phone-chrome>span{width:43px;height:4px;background:#6d7c86;border-radius:10px}.phone-chrome i{font-style:normal}.phone-home{width:85px;height:4px;border-radius:10px;background:var(--muted);opacity:.5;margin:10px auto 8px}.workspace-content{padding:0 14px}.overview-row{display:flex;justify-content:space-between;align-items:flex-end;gap:22px;padding:15px 0 13px}.overview-title{min-width:0}.live-kicker{display:flex;align-items:center;gap:6px;color:var(--muted);font:7px ui-monospace,monospace;letter-spacing:.12em}.online-dot{width:6px;height:6px;border-radius:50%;background:#45d5a2;box-shadow:0 0 8px #45d5a2}.online-dot.offline{background:#e8aa5d;box-shadow:0 0 8px #e8aa5d}.overview-title h1{font-size:24px;letter-spacing:-.06em;margin:6px 0 3px;font-weight:650}.overview-title h1 span{color:#7ed5dc}.overview-title p{font-size:9px;color:var(--muted);margin:0}.overview-readouts{display:flex;gap:7px;flex:none}.readout{min-width:116px;padding:8px 11px;border:1px solid var(--line);border-radius:11px;background:var(--panel-soft);position:relative;overflow:hidden}.readout>span{display:block;color:var(--muted);font:7px ui-monospace,monospace;letter-spacing:.09em}.readout>b{display:block;margin-top:4px;font-size:15px;letter-spacing:-.04em}.readout>b small{font-size:7px;color:var(--muted);font-weight:450;letter-spacing:0}.spark{position:absolute;right:10px;top:11px;width:25px;height:16px;opacity:.55;clip-path:polygon(0 60%,18% 52%,30% 72%,45% 25%,58% 48%,76% 10%,100% 28%,100% 38%,76% 20%,58% 58%,45% 35%,30% 82%,18% 62%,0 70%)}.spark.cyan{background:#5bd8e4}.spark.amber{background:#f5bd63}.spark.green{background:#66dfb2}.theme-and-role-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;padding:7px 10px;border:1px solid var(--line);border-radius:11px;background:var(--panel-soft)}.theme-switcher{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.theme-switcher>span{font:7px ui-monospace,monospace;letter-spacing:.1em;color:var(--muted);margin:0 5px 0 1px}.theme-switcher button{display:flex;align-items:center;gap:5px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted);padding:5px 7px;font-size:7px;cursor:pointer;transition:.2s}.theme-switcher button i{width:6px;height:6px;border-radius:50%;background:var(--theme-dot);box-shadow:0 0 6px var(--theme-dot)}.theme-switcher button.chosen{border-color:var(--line);background:var(--active-surface);color:var(--text)}.role-badge{display:flex;align-items:center;gap:7px;border-left:1px solid var(--line);padding-left:12px}.role-shield{width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:#19263a;color:#b6a2ef}.role-badge>span:last-child{display:grid;gap:3px}.role-badge b{font-size:8px}.role-badge small{font-size:7px;color:var(--muted)}.notice-toast{display:flex;justify-content:space-between;align-items:center;margin:-3px 0 11px;padding:8px 11px;border:1px solid #54c4ad55;border-radius:9px;background:#11372fa6;color:#b6e9d5;font-size:8px}.notice-toast button{border:0;background:none;color:inherit;font-size:14px;cursor:pointer}.workspace-grid{display:grid;grid-template-columns:205px minmax(0,1fr);gap:13px;align-items:start}.side-rail{position:sticky;top:75px;min-width:0;display:flex;flex-direction:column;gap:10px}.rail-label{display:flex;justify-content:space-between;color:var(--muted);font:7px ui-monospace,monospace;letter-spacing:.13em;padding:3px 4px}.rail-label span{color:#8fb4bc}.side-rail nav{display:grid;gap:4px}.rail-link{display:flex;align-items:center;gap:9px;width:100%;border:1px solid transparent;background:transparent;border-radius:10px;padding:8px;text-align:left;color:var(--muted);cursor:pointer;transition:transform .2s,background .2s,border-color .2s}.rail-link:hover{transform:translateX(2px);background:var(--panel-soft)}.rail-link.selected{border-color:var(--line);background:var(--active-surface);color:var(--text);box-shadow:inset 0 1px #ffffff11}.rail-icon{display:grid;place-items:center;width:27px;height:27px;border-radius:9px;background:#102a36;color:#71d8e3;font-size:14px;flex:none}.rail-link.amber .rail-icon{background:#342918;color:#efc377}.rail-link.green .rail-icon{background:#15352b;color:#82dcb5}.rail-link.violet .rail-icon{background:#2a2140;color:#c2a6f0}.rail-link.rose .rail-icon{background:#3b2228;color:#f2999c}.rail-copy{display:grid;gap:4px;min-width:0;flex:1}.rail-copy b{font-size:8px;font-weight:620}.rail-copy small{font-size:7px;color:var(--muted);white-space:nowrap}.rail-number{align-self:flex-start;margin-top:3px;color:#738797;font:6px ui-monospace,monospace}.rail-spacer{height:1px}.offline-card{padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel-soft)}.offline-card>div{display:flex;align-items:center;gap:6px}.storage-icon{color:#86b8c0;font-size:12px}.offline-card b{font:7px ui-monospace,monospace;letter-spacing:.08em}.offline-card i{margin-left:auto;width:5px;height:5px;border-radius:50%;background:#daa05b}.offline-card i.connected{background:#55d2a0;box-shadow:0 0 5px #55d2a0}.offline-card>small{display:block;margin:7px 0;color:var(--muted);font-size:7px}.offline-card button{display:flex;justify-content:space-between;width:100%;border:0;background:none;color:#9ed9dc;padding:0;font-size:7px;text-align:left;cursor:pointer}.rail-footer{display:grid;gap:6px;padding:3px 4px}.rail-footer>span{font:6px ui-monospace,monospace;letter-spacing:.12em;color:var(--muted)}.rail-footer b{display:flex;align-items:center;gap:5px;color:#9cb7ba;font:6px ui-monospace,monospace;letter-spacing:.07em}.rail-footer i{width:5px;height:5px;border-radius:50%;background:#5cd5ac}.module-stage{min-width:0;animation:fadein .22s ease-out}@keyframes fadein{from{opacity:.4;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}.workspace-footer{display:flex;justify-content:space-between;gap:10px;padding:12px 3px 2px;color:#8093a0;font:6px ui-monospace,monospace;letter-spacing:.08em}.mobile-dock{display:none}.mobile-hardware{display:none}.dock-filter{position:absolute;width:0;height:0}.queue-modal-body{margin-top:16px}.queue-summary{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:11px;background:var(--panel-soft)}.queue-number{width:32px;height:32px;display:grid;place-items:center;border-radius:10px;background:#183b39;color:#86e3c3;font-size:15px}.queue-summary>span:nth-child(2){display:grid;gap:4px;flex:1}.queue-summary b{font-size:9px}.queue-summary small{font-size:8px;color:var(--muted)}.queue-summary>i{width:7px;height:7px;border-radius:50%;background:#daa05b}.queue-summary>i.connected{background:#52d39e}.queue-list{max-height:260px;overflow:auto;display:grid;gap:6px;margin:10px 0}.queue-item{display:grid;grid-template-columns:1fr auto;gap:4px 10px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:var(--panel-soft)}.queue-kind{font:7px ui-monospace,monospace;text-transform:uppercase;color:#97c9c5}.queue-item b{font-size:9px}.queue-item small{font-size:7px;color:var(--muted)}.queue-item code{grid-column:2;grid-row:1/3;align-self:center;color:var(--muted);font-size:7px}.empty-queue{display:grid;place-items:center;gap:5px;padding:24px;color:var(--muted)}.empty-queue span{color:#64d6a8;font-size:22px}.empty-queue b{font-size:10px;color:var(--text)}.empty-queue small{font-size:8px}.queue-actions{display:flex;gap:7px;margin-top:14px}.queue-actions button{flex:1;border-radius:8px;padding:8px 9px;font-size:8px;cursor:pointer}.secondary-modal-button{border:1px solid var(--line);background:transparent;color:var(--muted)}.primary-modal-button{border:0;background:#6bd9cb;color:#071a1b;font-weight:700}.primary-modal-button:disabled{opacity:.42;cursor:not-allowed}.queue-privacy{margin:11px 0 0;color:var(--muted);font-size:7px;line-height:1.5}
  .mobile-preview .workspace-grid{grid-template-columns:1fr}.mobile-preview .side-rail{display:none}.mobile-preview .overview-row{align-items:flex-start;flex-direction:column;gap:12px}.mobile-preview .overview-readouts{width:100%}.mobile-preview .theme-and-role-row{align-items:flex-start;flex-direction:column}.mobile-preview .mobile-hardware{display:block;margin:12px 0}.mobile-preview .mobile-dock{position:sticky;left:auto;bottom:10px;transform:none;margin:12px auto 0;width:min(400px,calc(100% - 20px))}
  @media(max-width:1120px){.topbar{gap:10px}.brand-lockup{min-width:175px}.topbar-actions{gap:4px}.header-action span:nth-child(2){display:none}.report-action span:first-child,.vault-action span:first-child{display:inline!important}.inspector-action span:nth-child(2){display:none}.overview-readouts .readout{min-width:100px}.workspace-grid{grid-template-columns:185px minmax(0,1fr)}}
  @media(max-width:860px){.topbar{height:56px;padding:0 12px}.brand-lockup{min-width:145px}.brand-word small{display:none}.topbar-center{justify-content:flex-end}.topbar-actions .role-control>span{display:none}.topbar-actions .role-control select{max-width:90px}.apk-trigger{padding:0 8px}.apk-trigger span:last-child{display:none}.overview-row{align-items:flex-start;flex-direction:column;gap:12px}.overview-readouts{width:100%}.readout{flex:1}.workspace-grid{grid-template-columns:1fr}.side-rail{display:none}.mobile-hardware{display:block;margin:12px 0}.workspace-content{padding:0 10px}.mobile-dock{position:fixed;display:flex;z-index:25;left:50%;bottom:calc(10px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(440px,calc(100% - 28px));height:57px;align-items:center;justify-content:space-around;padding:0 5px;border-radius:20px;background:var(--dock-surface);border:1px solid var(--line);box-shadow:0 14px 40px #0006;backdrop-filter:blur(25px) saturate(190%)}.mobile-dock button{position:relative;z-index:2;width:20%;height:100%;border:0;background:transparent;color:var(--muted);display:grid;align-content:center;justify-items:center;gap:3px;cursor:pointer}.mobile-dock button>span{font-size:15px}.mobile-dock button small{font:6px ui-monospace,monospace;opacity:.7}.mobile-dock button.active{color:#b8f6ed}.dock-blob{filter:url(#aero-gooey-dock);position:absolute;left:calc(5px + var(--active-index) * ((100% - 10px) / 5));top:6px;width:calc((100% - 10px) / 5);height:44px;border-radius:16px;background:linear-gradient(140deg,#235a60aa,#31477a88);transition:left .38s cubic-bezier(.2,.8,.2,1)}.workspace-root{padding-bottom:84px}.workspace-footer{padding-bottom:12px}}
  @media(max-width:600px){.topbar{gap:6px}.brand-lockup{min-width:0;flex:1}.brand-mark{width:26px;height:26px}.brand-word strong{font-size:9px}.topbar-center{display:none}.topbar-actions{gap:4px}.role-control{height:27px;padding:0 5px}.role-control select{max-width:72px;font-size:7px}.header-action{height:27px;padding:0 6px}.report-action{display:none}.apk-trigger{height:27px;padding:0 7px}.overview-title h1{font-size:21px}.overview-title p{font-size:8px}.overview-readouts{gap:5px}.readout{min-width:0;padding:7px 8px}.readout>b{font-size:13px}.readout>b small{display:block;margin-top:2px}.theme-and-role-row{align-items:flex-start;flex-direction:column;gap:7px;padding:8px}.theme-switcher{gap:2px}.theme-switcher>span{width:100%;margin-bottom:3px}.theme-switcher button{padding:4px 6px}.role-badge{border-left:0;border-top:1px solid var(--line);width:100%;padding:7px 0 0}.workspace-content{padding:0 6px}.workspace-footer{font-size:5px;flex-direction:column}.queue-actions{flex-wrap:wrap}.queue-actions button{min-width:30%}}
  @media(max-width:430px){.vault-label{display:none}.inspector-action{display:none}.role-control select{max-width:64px}.apk-trigger{font-size:7px}.readout>span{font-size:6px}.overview-title h1{font-size:19px}}
</style>
