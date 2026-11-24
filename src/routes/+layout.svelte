<script>
  import '../app.css';
  import AirflowBackdrop from '$lib/components/AirflowBackdrop.svelte';
</script>

<svelte:head>
  <title>AERO-SPECTRA · Environmental Workstation</title>
  <meta name="color-scheme" content="dark light" />
</svelte:head>

<div class="app-shell">
  <AirflowBackdrop />
  <slot />
</div>
