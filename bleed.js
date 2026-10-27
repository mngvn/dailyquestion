// bleed.js — the page arriving: it opens in the middle and bleeds outward, like
// ink soaking into paper, while the desk loads behind it.
//
// A veil the colour of the room covers the page from the very first paint
// (home.css draws it, with a pinhole in the middle, before any script runs).
// This takes it over and opens it as far as the loading has got: desk.js says
// how far with Bleed.reach(fraction), and Bleed.finish() once the notes are on
// the desk. In between it keeps creeping outward, slower and slower, so it is
// never standing still. Its edge is ragged and feathered, with a faint tide
// line where the stain is still spreading.
//
// With reduced motion there is no veil; the page simply appears.

(function () {
  "use strict";

  const veil = document.getElementById("bleed");
  const g = veil && veil.getContext && veil.getContext("2d");
  if (!g || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (veil) veil.remove();
    window.Bleed = { reach() {}, finish() {} };
    return;
  }

  const SCALE = 2;            // CSS pixels per canvas pixel; the upscale softens the edge
  const START = 34;           // the pinhole home.css draws, in CSS pixels
  const MAX_SPEED = 0.5;      // of the whole bleed, per second: never faster than this
  const GIVE_UP_MS = 25000;   // if the page never says it's ready, open it anyway
  const TAU = Math.PI * 2;

  // The edge, feathered over the outer eighth of the radius: rings from the
  // rim inward, each clearing an even share more, so it fades in a ramp.
  const RINGS = 12, FEATHER_WIDTH = 0.12;
  const FEATHER = Array.from({ length: RINGS }, (_, i) => [1 - FEATHER_WIDTH * i / (RINGS - 1), 1 / (RINGS - i)]);

  // The ragged edge: slow lobes round the rim with finer ripples on top, and
  // fingers where the ink has run further along the grain. Different on every
  // visit, and drifting a little as it spreads.
  const waves = [2, 3, 4, 6, 9, 13, 19, 27, 38, 53, 71].map((k) => ({
    k, a: (0.05 + Math.random() * 0.04) * Math.pow(k / 2, -0.9),
    phase: Math.random() * TAU, drift: (Math.random() - 0.5) * 0.5
  }));
  const fingers = Array.from({ length: 22 }, () => ({
    at: Math.random() * TAU, width: 0.04 + Math.random() * 0.07, reach: 0.015 + Math.random() * 0.045
  }));
  const POINTS = 240;
  const rim = new Float32Array(POINTS);
  // how much of the radius is clear all the way round, with room for the drift
  shape(0);
  const CLEAR = (Math.min(...rim) - 0.04) * (1 - FEATHER_WIDTH);

  let target = 0, shown = 0, since = performance.now(), last = since, finished = false, closing = false;
  let width = 0, height = 0, colours = null, drawn = false, gone = false;

  function readColours() {
    const style = getComputedStyle(veil);
    colours = {
      veil: style.getPropertyValue("--veil").trim() || "#050302",
      tide: style.getPropertyValue("--tide").trim() || "rgb(255, 170, 90)"
    };
  }

  function resize() {
    width = Math.max(1, Math.ceil(veil.clientWidth / SCALE));
    height = Math.max(1, Math.ceil(veil.clientHeight / SCALE));
    if (veil.width !== width || veil.height !== height) {
      veil.width = width;
      veil.height = height;
    }
  }

  function shape(t) {
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * TAU;
      let r = 1;
      for (const w of waves) r += w.a * Math.sin(w.k * a + w.phase + w.drift * t);
      for (const f of fingers) {
        let d = Math.abs(a - f.at);
        if (d > Math.PI) d = TAU - d;
        r += f.reach * Math.exp(-(d / f.width) * (d / f.width));
      }
      rim[i] = r;
    }
  }

  function trace(cx, cy, radius) {
    g.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * TAU, r = radius * rim[i];
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  }

  function draw(t) {
    const cx = width / 2, cy = height / 2;
    // wide enough at the end that even the deepest notch in the rim is past
    // the corners
    const end = Math.hypot(cx, cy) / CLEAR + 4;
    const start = START / SCALE / CLEAR;
    // slow at first, while there is little behind it to show
    const radius = start + (end - start) * Math.pow(shown, 1.5);
    shape(t);

    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = colours.veil;
    g.fillRect(0, 0, width, height);
    g.globalCompositeOperation = "destination-out";
    for (const [ring, clear] of FEATHER) {
      trace(cx, cy, radius * ring);
      g.globalAlpha = clear;
      g.fill();
    }
    // the tide line, where the stain is still spreading
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = colours.tide;
    trace(cx, cy, radius * 0.99);
    g.globalAlpha = 0.05;
    g.lineWidth = 8;
    g.stroke();
    g.globalAlpha = 0.1;
    g.lineWidth = 1.4;
    g.stroke();
    g.globalAlpha = 1;

    if (!drawn) {
      drawn = true;
      veil.style.background = "none";   // the pinhole home.css drew is now drawn here
    }
  }

  function frame(now) {
    if (gone) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // keep creeping into what's left, slower the longer the wait
    const creep = finished ? 0 : (1 - target) * 0.3 * (1 - Math.exp(-(now - since) / 3000));
    const goal = Math.min(1, target + creep);
    const gap = Math.max(0, goal - shown);
    let step = Math.min(MAX_SPEED * dt, gap * (1 - Math.exp(-2.4 * dt)));
    if (finished) step = Math.min(gap, Math.max(step, 0.15 * dt));
    shown += step;

    draw(now / 1000);
    if (finished && shown > 0.92 && !closing) close();
    requestAnimationFrame(frame);
  }

  // The last of it fades rather than crawling into the corners.
  function close() {
    closing = true;
    veil.dataset.done = "true";
    const remove = () => {
      if (gone) return;
      gone = true;
      veil.remove();
    };
    veil.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 1200);
  }

  function reach(fraction) {
    if (finished || !(fraction > target)) return;
    target = Math.min(1, fraction);
    since = performance.now();
  }

  function finish() {
    if (finished) return;
    reach(1);
    finished = true;
  }

  readColours();
  resize();
  window.addEventListener("resize", resize);
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", readColours);
  setTimeout(finish, GIVE_UP_MS);
  requestAnimationFrame(frame);

  window.Bleed = Object.freeze({ reach, finish });
})();
