<script>
  import { onMount } from 'svelte';
  import fragmentSource from '../../shaders/navierStokesAirflowBackground.glsl?raw';
  let canvas;
  let frame = 0;
  let gl;
  let program;
  let uniforms = {};
  let resizeObserver;
  let cfm = 145;
  let aqi = 24;
  let mode = 0;
  let ecoMode = false;
  let startTime = 0;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  function resize() {
    if (!canvas || !gl) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.35);
    const w = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const h = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  function render(now) {
    if (!gl || !program || ecoMode) { frame = 0; return; }
    resize();
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, (now - startTime) / 1000);
    gl.uniform1f(uniforms.cfm, cfm);
    gl.uniform1f(uniforms.aqi, aqi);
    gl.uniform1i(uniforms.lightMode, mode);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frame = requestAnimationFrame(render);
  }
  onMount(() => {
    mode = document.documentElement.dataset.theme === 'daylight' ? 1 : 0;
    ecoMode = document.documentElement.dataset.theme === 'eco';
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
      if (!gl) return;
      const vertex = compile(gl.VERTEX_SHADER, `#version 300 es\nvoid main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      uniforms = {
        resolution: gl.getUniformLocation(program, 'u_resolution'), time: gl.getUniformLocation(program, 'u_time'),
        cfm: gl.getUniformLocation(program, 'u_cfm'), aqi: gl.getUniformLocation(program, 'u_aqi'),
        lightMode: gl.getUniformLocation(program, 'u_lightMode')
      };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
      startTime = performance.now(); frame = requestAnimationFrame(render);
    } catch (error) { console.warn('Airflow WebGL background unavailable:', error); }
    const applyTheme = (name) => {
      const wasEco = ecoMode;
      mode = name === 'daylight' ? 1 : 0;
      ecoMode = name === 'eco';
      if (ecoMode) { if (frame) cancelAnimationFrame(frame); frame = 0; }
      else if (wasEco && gl && program && !frame) frame = requestAnimationFrame(render);
    };
    const update = (event) => {
      if (event.key === 'aero-telemetry') { try { const value = JSON.parse(event.newValue || '{}'); cfm = value.cfm || cfm; aqi = value.aqi || aqi; } catch {} }
      if (event.key === 'aero-theme-mode') mode = event.newValue === 'daylight' ? 1 : 0;
      if (event.key === 'aero-theme') applyTheme(event.newValue || 'obsidian');
    };
    const updateTheme = (event) => applyTheme(event.detail || 'obsidian');
    const updateTelemetry = (event) => { cfm = event.detail?.cfm ?? cfm; aqi = event.detail?.aqi ?? aqi; };
    window.addEventListener('storage', update);
    window.addEventListener('aero-theme-change', updateTheme);
    window.addEventListener('aero-telemetry-change', updateTelemetry);
    return () => { cancelAnimationFrame(frame); resizeObserver?.disconnect(); window.removeEventListener('storage', update); window.removeEventListener('aero-theme-change', updateTheme); window.removeEventListener('aero-telemetry-change', updateTelemetry); };
  });
</script>

<canvas class="flow-underlay" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .flow-underlay { position:fixed; inset:0; z-index:0; width:100%; height:100%; pointer-events:none; opacity:.74; }
  @media (prefers-reduced-motion: reduce) { .flow-underlay { opacity:.42; } }
</style>
