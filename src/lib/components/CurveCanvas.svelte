<script>
  import { onMount } from 'svelte';
  export let series = [];
  export let maxX = null;
  export let maxY = null;
  export let minY = 0;
  export let yLabel = '';
  export let xLabel = '';
  export let ariaLabel = 'Scientific data chart';
  export let fill = false;
  let canvas;
  let observer;

  function draw() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const width = rect.width, height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const left = 42, right = width - 14, top = 14, bottom = height - 30;
    const all = series.flatMap((s) => s.values || []);
    const xMax = maxX ?? Math.max(1, ...all.map((p) => Number(p.x) || 0));
    const yMax = maxY ?? Math.max(1, ...all.map((p) => Number(p.y) || 0));
    const yMin = minY ?? Math.min(0, ...all.map((p) => Number(p.y) || 0));
    ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--chart-label') || 'rgba(170,190,210,.65)';
    ctx.strokeStyle = 'rgba(151,177,204,.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = top + (bottom - top) * i / 4;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      const value = yMax - (yMax - yMin) * i / 4;
      ctx.fillText(value >= 100 ? value.toFixed(0) : value.toFixed(1), 3, y + 3);
    }
    for (let i = 0; i <= 4; i++) {
      const x = left + (right - left) * i / 4;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillText((xMax * i / 4).toFixed(xMax > 20 ? 0 : 1), x - 9, height - 9);
    }
    for (const line of series) {
      const values = line.values || [];
      if (!values.length) continue;
      ctx.beginPath();
      values.forEach((point, index) => {
        const x = left + (right - left) * (Number(point.x) || 0) / xMax;
        const y = bottom - (bottom - top) * ((Number(point.y) || 0) - yMin) / Math.max(0.0001, yMax - yMin);
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      if (fill) {
        const last = values.at(-1), first = values[0];
        ctx.lineTo(left + (right - left) * (Number(last.x) || 0) / xMax, bottom);
        ctx.lineTo(left + (right - left) * (Number(first.x) || 0) / xMax, bottom);
        ctx.closePath(); ctx.globalAlpha = 0.1; ctx.fillStyle = line.color || '#38bdf8'; ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath();
        values.forEach((point, index) => {
          const x = left + (right - left) * (Number(point.x) || 0) / xMax;
          const y = bottom - (bottom - top) * ((Number(point.y) || 0) - yMin) / Math.max(0.0001, yMax - yMin);
          index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
      }
      ctx.strokeStyle = line.color || '#38bdf8';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = line.color || '#38bdf8'; ctx.shadowBlur = 8;
      ctx.stroke(); ctx.shadowBlur = 0;
    }
    if (xLabel) { ctx.textAlign = 'right'; ctx.fillText(xLabel, right, height - 9); ctx.textAlign = 'left'; }
    if (yLabel) { ctx.save(); ctx.translate(11, top + 8); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore(); }
  }

  onMount(() => {
    observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer?.disconnect();
  });
  $: if (series && canvas) { series; maxX; maxY; minY; draw(); }
</script>

<canvas bind:this={canvas} class="chart-canvas" aria-label={ariaLabel}></canvas>

<style>
  .chart-canvas { width:100%; height:100%; display:block; --chart-label:rgba(173,191,212,.72); }
</style>
