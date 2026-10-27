// candle.js — the candle on the desk, and everything its light touches.
//
// The flame flickers on layered noise and leans when the pointer sweeps past
// it. Its light is a pair of CSS variables on the desk (where the wick is, and
// how hard the flame is burning right now) that desk.css turns into a pool of
// light in the dark, or a pool of darkness in the light. The pointer carries a
// faint light of its own, like a struck match, so the far corners of the desk
// can be found. Click the candle to blow it out; it catches again by itself.
//
// Every so often the flame sends a wisp of smoke up through the page
// (wisps.js), and a puff goes up whenever a note is unfolded. The compass on
// the desk turns to point at the pointer.
//
// Exposes Candle.puff(strength).

const Candle = (function () {
  "use strict";

  const desk = document.getElementById("desk");
  const candle = document.getElementById("candle");
  const flame = candle ? candle.querySelector(".flame") : null;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const RELIGHT_MS = 2800;     // how long the candle stays out
  const PUFF_EVERY = [5000, 9000];
  const LEAN_REACH = 260;      // px around the flame where a passing pointer bends it
  const MAX_LEAN = 28;         // degrees

  if (!desk || !candle || !flame) return { puff() {} };

  let lit = true;
  let inView = true;
  let lean = 0, leanVel = 0;
  const pointer = { x: -1e5, y: -1e5, vx: 0, t: 0 };
  const needle = { el: null, angle: 0, vel: 0, cx: 0, cy: 0 };
  let frame = 0, lastPaint = 0, lastLight = 0;
  const LIGHT_MS = 50;

  // ----- Where the flame is -----
  // The light is centred on the wick, in the desk's own coordinates.
  function placeLight() {
    const d = desk.getBoundingClientRect();
    const f = flame.getBoundingClientRect();
    desk.style.setProperty("--cx", `${(f.left + f.width / 2 - d.left).toFixed(0)}px`);
    desk.style.setProperty("--cy", `${(f.bottom - d.top - 6).toFixed(0)}px`);
    const n = desk.querySelector(".compass-needle");
    if (n) {
      const box = n.closest("svg").getBoundingClientRect();
      needle.el = n;
      needle.cx = box.left + box.width / 2 + window.scrollX;
      needle.cy = box.top + box.height / 2 + window.scrollY;
    }
  }

  // The top of the flame, in page coordinates, where smoke leaves it.
  function tip() {
    const f = flame.getBoundingClientRect();
    return { x: f.left + f.width / 2 + window.scrollX, y: f.top + f.height * 0.15 + window.scrollY };
  }

  function puff(strength) {
    if (!lit || typeof Wisps === "undefined") return;
    const t = tip();
    const s = strength || 1;
    Wisps.puff(t.x, t.y, { count: Math.round(1 + s * 2), power: 0.8 + s * 0.4, long: s >= 1 });
  }

  // ----- Pointer -----
  function onPointer(e) {
    const now = performance.now();
    const x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
    const dt = Math.max(0.008, (now - pointer.t) / 1000);
    pointer.vx = pointer.t ? (x - pointer.x) / dt : 0;
    pointer.x = x; pointer.y = y; pointer.t = now;

    const d = desk.getBoundingClientRect();
    const inside = e.clientX >= d.left && e.clientX <= d.right && e.clientY >= d.top && e.clientY <= d.bottom;
    desk.style.setProperty("--px", inside ? `${(e.clientX - d.left).toFixed(0)}px` : "-999px");
    desk.style.setProperty("--py", inside ? `${(e.clientY - d.top).toFixed(0)}px` : "-999px");

    // a fast pass near the flame shoves it over
    const t = tip();
    const near = Math.hypot(x - t.x, y - t.y);
    if (near < LEAN_REACH) {
      const k = 1 - near / LEAN_REACH;
      leanVel += Math.max(-1, Math.min(1, pointer.vx / 1600)) * k * 60;
    }
    wake();
  }

  // ----- The loop -----
  // Layered sines at unrelated rates read as a living flame; an occasional
  // gutter dips it for a moment.
  const phase = [Math.random() * 10, Math.random() * 10, Math.random() * 10];
  let gutter = 0;
  function flicker(t) {
    if (Math.random() < 0.004) gutter = 1;
    gutter *= 0.94;
    return 1 + 0.035 * Math.sin(t * 7.1 + phase[0]) + 0.025 * Math.sin(t * 12.7 + phase[1]) +
      0.018 * Math.sin(t * 23.3 + phase[2]) - gutter * 0.08;
  }

  function turnNeedle(t, dt) {
    if (!needle.el) return;
    const want = pointer.t
      ? Math.atan2(pointer.x - needle.cx, -(pointer.y - needle.cy)) * 180 / Math.PI
      : Math.sin(t * 0.4) * 12;
    const diff = ((want - needle.angle + 540) % 360) - 180;
    needle.vel += diff * 30 * dt;
    needle.vel *= Math.pow(0.08, dt);
    needle.angle += needle.vel * dt;
    needle.el.setAttribute("transform", `rotate(${needle.angle.toFixed(2)} 70 70)`);
  }

  function step(now) {
    frame = 0;
    if (!inView || document.hidden) return;
    const t = now / 1000;
    const dt = lastPaint ? Math.min(0.05, (now - lastPaint) / 1000) : 1 / 60;
    lastPaint = now;

    // the flame springs back upright, with a slow idle sway
    const idle = Math.sin(t * 1.3) * 3 + Math.sin(t * 2.9) * 1.5;
    leanVel += (idle - lean) * 40 * dt;
    leanVel *= Math.pow(0.02, dt);
    lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, lean + leanVel * dt));

    // The light on the desk is a large repaint, so it moves at about 20fps;
    // the flame itself is small and moves every frame.
    candle.style.setProperty("--lean", `${lean.toFixed(2)}deg`);
    if (now - lastLight > LIGHT_MS) {
      lastLight = now;
      desk.style.setProperty("--flick", (lit ? flicker(t) : 0).toFixed(3));
    }
    turnNeedle(t, dt);
    wake();
  }

  function wake() {
    if (!frame && !reduce && inView && !document.hidden) frame = requestAnimationFrame(step);
  }

  // ----- Blowing it out -----
  function blowOut() {
    if (!lit) return;
    puff(2.2);
    lit = false;
    desk.dataset.lit = "false";
    candle.setAttribute("aria-pressed", "true");
    setTimeout(() => {
      lit = true;
      desk.dataset.lit = "true";
      candle.setAttribute("aria-pressed", "false");
      candle.classList.add("relight");
      setTimeout(() => candle.classList.remove("relight"), 700);
    }, RELIGHT_MS);
  }

  // ----- Every so often, a wisp -----
  function schedule() {
    const [lo, hi] = PUFF_EVERY;
    setTimeout(() => {
      if (inView && !document.hidden) puff(Math.random() < 0.35 ? 1 : 0.5);
      schedule();
    }, lo + Math.random() * (hi - lo));
  }

  let lastHoverPuff = 0;
  candle.addEventListener("pointerenter", () => {
    const now = performance.now();
    if (now - lastHoverPuff > 1500) { lastHoverPuff = now; puff(0.5); }
  });
  candle.addEventListener("click", blowOut);
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("resize", placeLight);
  new ResizeObserver(placeLight).observe(desk);
  new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    if (inView) { placeLight(); wake(); }
  }).observe(desk);
  document.addEventListener("visibilitychange", wake);

  placeLight();
  wake();
  schedule();
  setTimeout(() => puff(1), 1600);

  return { puff };
})();
