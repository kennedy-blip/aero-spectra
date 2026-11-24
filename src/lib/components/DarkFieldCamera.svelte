<script>
  import { onDestroy } from 'svelte';
  import detectorSource from '../../shaders/tyndallMieParticleDetector.glsl?raw';
  export let active = false;
  let video, canvas, stream, gl, program, animationFrame;
  let error = '';
  let flash = false;
  let frameCount = 0;

  function shader(type, source) {
    const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
    return item;
  }
  function newTexture(width, height) {
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  }
  function setupGL() {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is unavailable on this browser. Simulator remains available.');
    const vert = shader(gl.VERTEX_SHADER, `#version 300 es\nout vec2 v_uv;\nvoid main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); v_uv=p*0.5; gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`);
    const frag = shader(gl.FRAGMENT_SHADER, detectorSource);
    program = gl.createProgram(); gl.attachShader(program, vert); gl.attachShader(program, frag); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_currentFrame'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_previousFrame'), 1);
    gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), 0.035);
    gl.uniform1f(gl.getUniformLocation(program, 'u_gain'), 8.0);
    const w = video.videoWidth || 640, h = video.videoHeight || 360;
    canvas.width = w; canvas.height = h;
    const current = newTexture(w, h); const previous = newTexture(w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, current);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, previous);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.viewport(0, 0, w, h);
    return { current, previous };
  }
  function render(textures) {
    if (!active || !video || video.readyState < 2 || !gl) return;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures.current);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, textures.previous);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), performance.now() / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    frameCount++;
    animationFrame = requestAnimationFrame(() => render(textures));
  }
  async function start() {
    error = '';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS and a supported browser.');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }
      });
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.();
      if (capabilities?.torch) {
        try { await track.applyConstraints({ advanced: [{ torch: true }] }); flash = true; } catch { flash = false; }
      }
      const textures = setupGL();
      active = true;
      animationFrame = requestAnimationFrame(() => render(textures));
    } catch (cause) {
      error = cause?.message || 'Camera permission was not granted.';
      stop();
    }
  }
  function stop() {
    active = false;
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animationFrame);
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    if (video) video.srcObject = null;
    flash = false;
  }
  onDestroy(stop);
</script>

<div class="camera-frame" class:live={active}>
  {#if active}
    <video bind:this={video} playsinline muted aria-label="Live camera preview"></video>
    <canvas bind:this={canvas} aria-label="WebGL2 temporal dark-field particle contrast"></canvas>
    <span class="live-stamp"><i></i> LIVE · GPU DIFFERENCE</span>
  {:else}
    <div class="sim-field" aria-hidden="true">
      <div class="beam"></div>
      {#each Array(18) as _, i}<span class="mote" style={`--size:${2 + (i % 3)}px; --x:${(i * 37 + 7) % 92}%; --y:${(i * 23 + 13) % 80}%;`}></span>{/each}
      <div class="field-readout"><span class="laser-dot"></span><span>TYNDALL DARK-FIELD</span><small>SIMULATOR · 60 FPS VISUALIZATION</small></div>
    </div>
  {/if}
  <div class="camera-controls">
    {#if active}<button class="icon-control stop" on:click={stop} aria-label="Stop camera">■ Stop camera</button>
    {:else}<button class="icon-control" on:click={start}>◎ Start rear camera</button>{/if}
    <span class="torch-state">{flash ? 'Torch on' : active ? 'Torch unavailable' : 'Torch standby'}</span>
  </div>
  {#if error}<div class="camera-error">{error}</div>{/if}
</div>

<style>
  .camera-frame { height:224px; position:relative; overflow:hidden; border:1px solid rgba(119,171,207,.17); border-radius:16px; background:#050d17; }
  video { display:none; }
  canvas { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .sim-field { position:absolute; inset:0; overflow:hidden; background:radial-gradient(ellipse at 52% 50%,rgba(10,40,56,.65),#040a12 70%); }
  .beam { position:absolute; left:-8%; top:51%; width:120%; height:2px; background:linear-gradient(90deg,transparent,#53e2ff 18%,#c0f8ff 50%,#4dbce6 82%,transparent); filter:drop-shadow(0 0 7px #40d5ff); opacity:.86; transform:rotate(-7deg); }
  .mote { position:absolute; left:var(--x); top:var(--y); width:var(--size); height:var(--size); border-radius:50%; background:#9bf3ff; box-shadow:0 0 10px 2px rgba(74,219,255,.62); animation:float 4s ease-in-out infinite alternate; animation-delay:calc(var(--i) * -0.27s); }
  .mote:nth-child(3n) { background:#ffd991; box-shadow:0 0 8px 2px rgba(255,173,74,.55); }
  @keyframes float { to { transform:translate3d(18px,-20px,0); opacity:.36; } }
  .field-readout { position:absolute; left:18px; bottom:18px; display:grid; grid-template-columns:10px 1fr; column-gap:9px; color:#bceef5; letter-spacing:.12em; font-size:9px; font-weight:700; }
  .field-readout small { grid-column:2; margin-top:5px; color:#7392a7; letter-spacing:.09em; font-size:8px; }
  .laser-dot { width:6px; height:6px; border-radius:50%; margin-top:2px; background:#63e4f5; box-shadow:0 0 8px #63e4f5; }
  .camera-controls { position:absolute; right:12px; bottom:12px; z-index:2; display:flex; align-items:center; gap:9px; }
  .icon-control { border:1px solid rgba(120,210,230,.35); border-radius:9px; background:rgba(5,18,28,.84); color:#c5f3f7; padding:8px 11px; font-size:10px; cursor:pointer; backdrop-filter:blur(9px); }
  .stop { color:#ffb4b4; border-color:rgba(255,100,110,.35); }
  .torch-state { font:9px ui-monospace,monospace; color:#849cac; }
  .live-stamp { position:absolute; left:13px; top:12px; display:flex; gap:7px; align-items:center; font:8px ui-monospace,monospace; letter-spacing:.08em; color:#b4eaf4; background:#06131cbb; border:1px solid #4294a555; border-radius:20px; padding:6px 8px; }
  .live-stamp i { width:5px; height:5px; background:#50e2ad; border-radius:50%; box-shadow:0 0 7px #50e2ad; }
  .camera-error { position:absolute; left:12px; right:12px; top:48px; color:#ffb7a7; font-size:10px; background:#260d0ac9; padding:9px; border-radius:8px; }
</style>
