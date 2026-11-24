<script>
  export let open = false;
  export let title = '';
  export let subtitle = '';
  export let onClose = () => {};
</script>
{#if open}
<div class="modal-backdrop" role="presentation" on:click={(event) => event.target === event.currentTarget && onClose()}>
  <dialog open class="modal-shell glass-modal" aria-modal="true" aria-label={title}>
    <header><div><small>{subtitle}</small><h2>{title}</h2></div><button on:click={onClose} aria-label="Close dialog">×</button></header>
    <slot />
  </dialog>
</div>
{/if}
<style>
  .modal-backdrop{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:18px;background:#01070eba;backdrop-filter:blur(16px)}.modal-shell{position:relative;inset:auto;margin:0;max-width:100%;color:var(--text);width:min(600px,100%);padding:22px;border-radius:24px;box-shadow:0 30px 100px #0008}.modal-shell header{display:flex;justify-content:space-between;align-items:flex-start}.modal-shell small{font:8px ui-monospace,monospace;letter-spacing:.15em;color:var(--cyan)}.modal-shell h2{margin:5px 0 0;font-size:22px}.modal-shell header button{background:none;color:var(--muted);border:1px solid var(--line);border-radius:50%;width:30px;height:30px;font-size:19px;cursor:pointer}
</style>
