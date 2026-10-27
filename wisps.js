// wisps.js — smoke from the candle, curling up through the whole page.
//
// Each wisp is a ribbon: a head carried along a curl-noise flow field (which
// is what makes real smoke roll and fold rather than just drift), dragging a
// trail of the places it has been. The trail keeps moving after the head has
// passed, rising and spreading, so the ribbon thins and widens as it ages.
// Wisps lean away from the pointer and get stirred by how fast it moves.
//
// They live in page coordinates on one fixed canvas laid over everything, so
// a wisp that leaves the desk can wander up past the heading and the nav.
// candle.js decides when to puff; this just carries the smoke.
//
// Exposes Wisps.puff(pageX, pageY, { count, power, long, alpha }).

const Wisps = (function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TRAIL = 46;            // points per ribbon
  const BUOYANCY = 46;         // px/s the smoke rises on its own
  const FIELD = 0.0042;        // flow-field scale: smaller → broader curls
  const SWIRL = 70;            // px/s of curl at full strength
  const POINTER_REACH = 170;   // px within which the pointer moves smoke
  const MAX_WISPS = 18;

  // ----- Gradient noise (2D Perlin) -----
  const perm = new Uint8Array(512);
  (function seed() {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  function grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  }
  function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
  }
  // The curl of the noise: a flow with no sources or sinks, so smoke never
  // bunches up or tears apart, it only swirls.
  const curlOut = { x: 0, y: 0 };
  function curl(x, y, t) {
    const e = 0.01;
    const ox = t * 0.05, oy = t * 0.11;
    const dy = noise(x + ox, y + e + oy) - noise(x + ox, y - e + oy);
    const dx = noise(x + e + ox, y + oy) - noise(x - e + ox, y + oy);
    curlOut.x = dy / (2 * e);
    curlOut.y = -dx / (2 * e);
    return curlOut;
  }

  // ----- The canvas -----
  const canvas = document.createElement("canvas");
  canvas.className = "wisps";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  let width = 0, height = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  // ----- The pointer -----
  const pointer = { x: -1e5, y: -1e5, vx: 0, vy: 0, t: 0 };
  function onPointer(e) {
    const now = performance.now();
    const x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
    const dt = Math.max(0.008, (now - pointer.t) / 1000);
    if (pointer.t) {
      pointer.vx = pointer.vx * 0.6 + ((x - pointer.x) / dt) * 0.4;
      pointer.vy = pointer.vy * 0.6 + ((y - pointer.y) / dt) * 0.4;
    }
    pointer.x = x; pointer.y = y; pointer.t = now;
  }

  // ----- Wisps -----
  const wisps = [];
  let frame = 0, last = 0, clock = Math.random() * 100;

  function spawn(x, y, power, long, fade) {
    const life = long ? 11 + Math.random() * 4 : 5.5 + Math.random() * 3.5;
    const side = Math.random() < 0.5 ? -1 : 1;
    const pts = [];
    for (let i = 0; i < TRAIL; i++) pts.push({ x, y });
    wisps.push({
      x, y,
      vx: (Math.random() - 0.5) * 30,
      vy: -60 - Math.random() * 40 * power,
      drift: side * (long ? 26 + Math.random() * 30 : Math.random() * 18),
      age: 0, life,
      width: 1.2 + Math.random() * 1.6,
      alpha: (0.5 + Math.random() * 0.4) * fade,
      power,
      pts
    });
    if (wisps.length > MAX_WISPS) wisps.shift();
  }

  // Pushes a point away from the pointer and drags it along with the pointer's
  // motion, strongest right under it.
  function stir(p, dt, strength) {
    const dx = p.x - pointer.x, dy = p.y - pointer.y;
    const d = Math.hypot(dx, dy);
    if (d > POINTER_REACH || d < 0.001) return;
    const k = 1 - d / POINTER_REACH;
    const push = k * k * 520 * strength * dt;
    p.x += (dx / d) * push + pointer.vx * k * 0.35 * strength * dt;
    p.y += (dy / d) * push + pointer.vy * k * 0.35 * strength * dt;
  }

  function step(dt) {
    clock += dt;
    pointer.vx *= Math.pow(0.02, dt);
    pointer.vy *= Math.pow(0.02, dt);
    for (let w = wisps.length - 1; w >= 0; w--) {
      const s = wisps[w];
      s.age += dt;
      if (s.age > s.life) { wisps.splice(w, 1); continue; }
      const f = curl(s.x * FIELD, s.y * FIELD, clock);
      const ease = Math.min(1, dt * 2.2);
      s.vx += (f.x * SWIRL * s.power + s.drift - s.vx) * ease;
      s.vy += (f.y * SWIRL * s.power - BUOYANCY - s.vy) * ease;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      stir(s, dt, 1.4);

      // the trail shuffles back one place and keeps rising and curling
      for (let i = s.pts.length - 1; i > 0; i--) {
        const p = s.pts[i], q = s.pts[i - 1];
        p.x = q.x; p.y = q.y;
      }
      s.pts[0].x = s.x; s.pts[0].y = s.y;
      for (let i = 1; i < s.pts.length; i++) {
        const p = s.pts[i];
        const g = curl(p.x * FIELD * 1.6, p.y * FIELD * 1.6, clock + 7);
        const age = i / s.pts.length;
        p.x += g.x * 22 * age * dt;
        p.y += (g.y * 22 * age - 10 * age) * dt;
        stir(p, dt, 1);
      }
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const light = document.body.classList.contains("light");
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    const rgb = light ? "26, 18, 14" : "255, 206, 150";
    const sx = window.scrollX, sy = window.scrollY;
    ctx.lineCap = "round";
    for (const s of wisps) {
      const life = Math.min(1, s.age / 0.5) * Math.min(1, (s.life - s.age) / (s.life * 0.45));
      const base = s.alpha * life * (light ? 0.5 : 0.42);
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1], b = s.pts[i];
        const t = i / s.pts.length;
        const alpha = base * Math.pow(1 - t, 1.2);
        if (alpha < 0.004) continue;
        const w = s.width * (0.6 + t * 5);
        ctx.strokeStyle = `rgba(${rgb}, ${(alpha * 0.22).toFixed(3)})`;
        ctx.lineWidth = w * 3.2;
        ctx.beginPath(); ctx.moveTo(a.x - sx, a.y - sy); ctx.lineTo(b.x - sx, b.y - sy); ctx.stroke();
        ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(a.x - sx, a.y - sy); ctx.lineTo(b.x - sx, b.y - sy); ctx.stroke();
      }
    }
  }

  function loop(now) {
    frame = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    step(dt);
    draw();
    if (wisps.length) frame = requestAnimationFrame(loop);
    else { last = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  let ready = false;
  function init() {
    if (ready) return;
    ready = true;
    document.body.append(canvas);
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
  }

  function puff(x, y, opts) {
    if (reduce || document.hidden) return;
    init();
    const o = opts || {};
    const count = o.count || 2;
    for (let i = 0; i < count; i++) {
      spawn(x + (Math.random() - 0.5) * 6, y - Math.random() * 4, o.power || 1, o.long && i === 0, o.alpha || 1);
    }
    if (!frame) frame = requestAnimationFrame(loop);
  }

  return { puff };
})();
