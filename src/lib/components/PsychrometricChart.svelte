<script>
  import { onMount } from 'svelte';
  import { humidityRatioGPerKg, moistAirEnthalpyKJkg } from '$engines/fangerPmvPsychrometricEngine.js';
  export let tempC = 22.5;
  export let rh = 45;
  let canvas;
  let observer;
  function draw() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const w = rect.width, h = rect.height, left = 37, right = w - 12, top = 12, bottom = h - 28;
    const x = (t) => left + (t - 5) / 35 * (right - left);
    const y = (humidity) => bottom - humidity / 30 * (bottom - top);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '9px ui-monospace, monospace'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(163,185,201,.73)'; ctx.strokeStyle = 'rgba(129,158,178,.16)';
    for (let t = 5; t <= 40; t += 5) {
      ctx.beginPath(); ctx.moveTo(x(t), top); ctx.lineTo(x(t), bottom); ctx.stroke(); ctx.fillText(`${t}°`, x(t) - 8, h - 8);
    }
    for (let g = 0; g <= 30; g += 5) {
      ctx.beginPath(); ctx.moveTo(left, y(g)); ctx.lineTo(right, y(g)); ctx.stroke(); ctx.fillText(`${g}`, 3, y(g) + 3);
    }
    // Dashed wet-bulb / enthalpy guides from saturated wet-bulb reference states.
    ctx.setLineDash([3, 4]); ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(172,150,220,.28)';
    for (const wetBulb of [10, 15, 20, 25, 30]) {
      const enthalpy = moistAirEnthalpyKJkg(wetBulb, 100);
      ctx.beginPath(); let started = false;
      for (let t = 5; t <= 40; t += 0.5) {
        const humidity = (enthalpy - 1.006 * t) / (2501 + 1.86 * t) * 1000;
        if (humidity >= 0 && humidity <= 30) {
          const px = x(t), py = y(humidity);
          started ? ctx.lineTo(px, py) : ctx.moveTo(px, py); started = true;
        }
      }
      if (started) ctx.stroke();
    }
    ctx.setLineDash([]);
    // ASHRAE-55 style comfort envelope (approximate 20–26 °C, 30–60% RH).
    const polygon = [];
    for (let t = 20; t <= 26; t += 0.5) polygon.push([x(t), y(humidityRatioGPerKg(t, 60))]);
    for (let t = 26; t >= 20; t -= 0.5) polygon.push([x(t), y(humidityRatioGPerKg(t, 30))]);
    ctx.beginPath(); polygon.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
    ctx.fillStyle = 'rgba(66,196,163,.11)'; ctx.fill(); ctx.strokeStyle = 'rgba(83,218,179,.45)'; ctx.stroke();
    for (const percent of [20, 40, 60, 80, 100]) {
      ctx.beginPath();
      for (let t = 5; t <= 40; t += 0.5) {
        const px = x(t), py = y(Math.min(30, humidityRatioGPerKg(t, percent)));
        t === 5 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.strokeStyle = percent === 100 ? 'rgba(126,171,193,.55)' : 'rgba(111,153,177,.27)'; ctx.lineWidth = percent === 100 ? 1.4 : 1; ctx.stroke();
      const labelT = 37; const labelY = y(Math.min(29.5, humidityRatioGPerKg(labelT, percent)));
      ctx.fillStyle = 'rgba(158,185,201,.64)'; ctx.fillText(`${percent}%`, right - 27, labelY - 3);
    }
    const px = x(Math.max(5, Math.min(40, tempC))), py = y(Math.min(30, humidityRatioGPerKg(tempC, rh)));
    ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(79,212,226,.18)'; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = '#8df3ee'; ctx.shadowColor = '#5be8de'; ctx.shadowBlur = 11; ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(165,199,204,.72)'; ctx.font = '8px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText('DRY-BULB °C', (left + right) / 2, h - 1); ctx.textAlign = 'left';
  }
  onMount(() => { observer = new ResizeObserver(draw); observer.observe(canvas); draw(); return () => observer?.disconnect(); });
  $: if (canvas) { tempC; rh; draw(); }
</script>
<canvas bind:this={canvas} class="psychro-canvas" aria-label="Interactive psychrometric chart with relative humidity curves and current indoor state"></canvas>
<style>.psychro-canvas{display:block;width:100%;height:100%;--chart-label:rgba(170,190,210,.7)}</style>
