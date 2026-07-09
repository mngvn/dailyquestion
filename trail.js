// trail.js — neon streaks that only appear while the cursor is moving and
// emit from the mouse trail. Every streak renders at one constant opacity for
// its whole life (it shrinks away rather than fading out). Draws onto a
// full-viewport <canvas id="fxCanvas"> sitting behind the content. Idle =
// pure black. Disabled under prefers-reduced-motion.

(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fx = document.getElementById("fxCanvas");
  if (!fx || reduce) return;

  const ctx = fx.getContext("2d");
  // Two palettes: neon that glows additively on black, and deeper, saturated
  // tones that read on a light background.
  const COLORS_DARK = ["#a64dff", "#19e3ff", "#ff2e97", "#b6ff5a"];
  const COLORS_LIGHT = ["#7b2ff7", "#0094c6", "#e0218a", "#3a9e1b"];
  const isLight = () => document.body.classList.contains("light");
  const palette = () => (isLight() ? COLORS_LIGHT : COLORS_DARK);

  let w = 0, h = 0, dpr = 1;
  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  size();
  window.addEventListener("resize", size);

  const streaks = [];
  const MAX = 240;
  // One constant opacity for every streak, in both themes: a soft outer glow
  // pass and a bright core pass. Life only controls length, never alpha.
  const GLOW_ALPHA = 0.18;
  const CORE_ALPHA = 0.9;
  let lastX = null, lastY = null, lastT = 0;

  function onMove(e) {
    const now = performance.now();
    if (lastX !== null) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1.5) {
        const dt = Math.max(8, now - lastT);
        const speed = dist / dt;                 // px per ms
        const ux = dx / dist, uy = dy / dist;
        // emit a few streaks spread along the path just travelled
        const n = Math.min(5, Math.max(1, Math.round(dist / 12)));
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const sp = Math.min(2.6, 0.5 + speed * 7);
          streaks.push({
            x: lastX + dx * t, y: lastY + dy * t,
            vx: ux * sp + (Math.random() - 0.5) * 0.5,
            vy: uy * sp + (Math.random() - 0.5) * 0.5,
            life: 1, decay: 1 / (28 + Math.random() * 26),   // ~0.5–0.9s
            c: palette()[(Math.random() * 4) | 0],
            r: 1 + Math.random() * 1.7,
            len: 12 + speed * 70
          });
        }
        while (streaks.length > MAX) streaks.shift();
      }
    }
    lastX = e.clientX; lastY = e.clientY; lastT = now;
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerout", () => { lastX = lastY = null; });

  function tick() {
    ctx.clearRect(0, 0, w, h);
    // Additive glow on dark; normal blending on light so the colors stay visible.
    const light = isLight();
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    ctx.lineCap = "round";

    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.x += s.vx; s.y += s.vy;
      s.vx *= 0.95; s.vy *= 0.95;
      s.life -= s.decay;
      if (s.life <= 0) { streaks.splice(i, 1); continue; }

      const sp = Math.hypot(s.vx, s.vy) || 0.001;
      const ux = s.vx / sp, uy = s.vy / sp;
      const len = s.len * s.life;
      const tx = s.x - ux * len, ty = s.y - uy * len;

      ctx.strokeStyle = s.c;
      ctx.globalAlpha = GLOW_ALPHA; ctx.lineWidth = s.r * 3.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.globalAlpha = CORE_ALPHA; ctx.lineWidth = Math.max(1, s.r);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
