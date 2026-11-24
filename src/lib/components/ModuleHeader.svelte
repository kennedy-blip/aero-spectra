<script>
  export let number = '01';
  export let eyebrow = '';
  export let title = '';
  export let description = '';
  export let accent = 'cyan';
  export let status = 'SIMULATED';
</script>

<div class={`module-heading accent-${accent}`}>
  <div class="module-index">{number}</div>
  <div class="heading-copy"><div class="heading-meta"><span>{eyebrow}</span><span class="module-status"><i></i>{status}</span></div><h2>{title}</h2><p>{description}</p></div>
</div>
<style>
  .module-heading{display:flex;gap:15px;align-items:flex-start;margin-bottom:18px}.module-index{width:38px;height:38px;flex:none;border-radius:12px;display:grid;place-items:center;font:10px ui-monospace,monospace;background:#133343;color:#8de9f1;border:1px solid #3bb9c333}.accent-amber .module-index{background:#372b18;color:#f6cb75;border-color:#c68b3433}.accent-violet .module-index{background:#2b2142;color:#d1b4ff;border-color:#9d75eb33}.accent-green .module-index{background:#15342f;color:#94e6c1;border-color:#4ec89933}.accent-rose .module-index{background:#3a2028;color:#ffa8b8;border-color:#ff5a7733}.heading-copy{min-width:0}.heading-meta{display:flex;align-items:center;gap:10px;color:var(--muted);font:8px ui-monospace,monospace;letter-spacing:.13em}.module-status{display:flex;align-items:center;gap:5px;color:#9bb2bf;letter-spacing:.06em}.module-status i{width:5px;height:5px;border-radius:50%;background:#37d5aa;box-shadow:0 0 7px #37d5aa}.heading-copy h2{font-size:19px;line-height:1.16;letter-spacing:-.035em;margin:6px 0 4px;font-weight:650}.heading-copy p{margin:0;color:var(--muted);font-size:9px;line-height:1.45;max-width:650px}
</style>
