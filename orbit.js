// orbit.js — "Orbit Surfer". You're a satellite riding a ring of surf ramps
// around the Earth. Gravity always pulls toward the planet's core; the ramps
// are frictionless, so sliding down them trades altitude for speed (just like
// CS / Garry's Mod surf), and the glowing bounce pads fling you back up and
// onward. Keep your momentum and ride a full 360° lap. Lose it and you fall.
//
// The world is polar: everything lives in cartesian coords around the Earth's
// centre at (0,0), and the camera rotates so that "down toward the core" is
// always screen-down — giving a classic side-on surf view of a curving world.

(function () {
  "use strict";

  const VW = 960, VH = 600;                  // logical (letterboxed) viewport
  const canvas = document.getElementById("orbitCanvas");
  const ctx = canvas.getContext("2d");

  // ---- world constants -----------------------------------------------------
  const RE = 1600;                            // Earth radius
  const PR = 11;                              // player radius
  const WAVES = 16;                           // surf moguls around the ring
  const R_MID = RE + 330, R_AMP = 84;         // ring radius + wave amplitude
  const GAP_EVERY = 4;                        // every Nth crest is a jump gap
  const GAP_HALF = 0.062;                     // half-width of a gap (radians)
  const R_CEIL = R_MID + R_AMP + 60;          // soft "atmosphere" ceiling
  const rOf = (th) => R_MID - R_AMP * Math.cos(WAVES * th); // θ=0 is a trough

  // physics (tuned for 60fps; scaled by frame-time)
  const G = 0.24;          // gravity accel toward core
  const TH = 0.5;          // tangential thrust
  const WS = 14.5;         // thrust speed cap (ramps let you exceed it)
  const JUMP = 5;          // hop impulse (outward) — a small adjustment hop
  const BOUNCE_OUT = 4;    // gentle outward hop off a bounce pad
  const BOUNCE_BOOST = 1.6; // small prograde nudge off a pad (not a free ride)
  const START_SPEED = 12;

  // flavour scales for the HUD
  const SPEED_SCALE = 31;  // world u/frame -> "m/s"
  const ALT_SCALE = 6.2;   // world u -> "km"

  // ---- view / scaling ------------------------------------------------------
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1, cw: VW, ch: VH };
  const cam = { ax: VW * 0.36, ay: VH * 0.54, zoom: 0.56 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    view.scale = Math.min(cw / VW, ch / VH);
    view.ox = (cw - VW * view.scale) / 2;
    view.oy = (ch - VH * view.scale) / 2;
    view.dpr = dpr; view.cw = cw; view.ch = ch;
  }
  resize();
  window.addEventListener("resize", resize);

  // ---- track ---------------------------------------------------------------
  function P(ang, r) { return { x: Math.cos(ang) * r, y: Math.sin(ang) * r }; }
  function seg(a, b, bouncy) {
    return {
      ax: a.x, ay: a.y, bx: b.x, by: b.y, bouncy: !!bouncy,
      mid: Math.atan2((a.y + b.y) / 2, (a.x + b.x) / 2),
    };
  }
  let segs = [], gaps = [];
  function crestAngle(m) { return (2 * m + 1) * Math.PI / WAVES; } // local maxima of rOf
  function inGap(th) {
    for (const g of gaps) if (Math.abs(wrapPi(th - g)) < GAP_HALF) return true;
    return false;
  }
  function buildTrack() {
    segs = []; gaps = [];
    for (let m = 0; m < WAVES; m++) if (m % GAP_EVERY === 0) gaps.push(crestAngle(m));

    // continuous wavy surface, broken by the gaps
    const SAMPLES = 480;
    let prev = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const th = (i / SAMPLES) * Math.PI * 2;
      if (inGap(th)) { prev = null; continue; }
      const pt = P(th, rOf(th));
      if (prev) segs.push(seg(prev, pt, false));
      prev = pt;
    }
    // a bounce pad on the lip leading into each gap, kicked outward to launch
    for (const g of gaps) {
      const t1 = g - GAP_HALF - 0.012;
      segs.push(seg(P(t1 - 0.045, rOf(t1 - 0.045)), P(t1, rOf(t1) + 55), true));
    }
  }

  // ---- state ---------------------------------------------------------------
  let phase = "intro";                 // intro | play | fail | win
  const pos = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
  let onSurface = false, lastNx = 0, lastNy = -1;
  let prevAng = 0, totalAng = 0, best = 0;
  let jumpQueued = false;
  let particles = [], trail = [];
  let shake = 0, clock = 0;
  const input = { pro: false, retro: false };

  try { best = Math.max(0, Math.min(100, +localStorage.getItem("orbit.best") || 0)); } catch (e) { /* ignore */ }

  function reset() {
    buildTrack();
    // start nestled in the first trough (θ=0) just above the surface
    const p = P(0, rOf(0) + PR);
    pos.x = p.x; pos.y = p.y;
    const out = norm(pos);
    const pro = { x: -out.y, y: out.x };          // CCW tangential
    vel.x = pro.x * START_SPEED; vel.y = pro.y * START_SPEED;
    onSurface = false;
    prevAng = Math.atan2(pos.y, pos.x); totalAng = 0;
    particles = []; trail = []; shake = 0;
    input.pro = input.retro = false; jumpQueued = false;
  }

  // ---- math helpers --------------------------------------------------------
  function norm(v) { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  // ---- physics -------------------------------------------------------------
  function resolveSeg(s) {
    const ex = s.bx - s.ax, ey = s.by - s.ay;
    const L2 = ex * ex + ey * ey || 1;
    let t = ((pos.x - s.ax) * ex + (pos.y - s.ay) * ey) / L2;
    t = clamp(t, 0, 1);
    const cx = s.ax + ex * t, cy = s.ay + ey * t;
    let dx = pos.x - cx, dy = pos.y - cy;
    let d = Math.hypot(dx, dy);
    if (d >= PR) return;
    if (d < 1e-4) { dx = -ey; dy = ex; d = Math.hypot(dx, dy) || 1; }
    const nx = dx / d, ny = dy / d;
    pos.x = cx + nx * PR; pos.y = cy + ny * PR;
    const vn = vel.x * nx + vel.y * ny;
    if (vn < 0) {
      if (s.bouncy) {
        // Redirect into a controlled forward hop: a modest outward kick plus a
        // guaranteed prograde push, so you arc across the gap — never launched
        // off into deep space.
        const d2 = Math.hypot(pos.x, pos.y) || 1;
        const ox = pos.x / d2, oy = pos.y / d2;       // outward
        const px = -oy, py = ox;                       // CCW prograde
        const vpro = vel.x * px + vel.y * py + BOUNCE_BOOST; // keep your speed (+nudge)
        vel.x = ox * BOUNCE_OUT + px * vpro; vel.y = oy * BOUNCE_OUT + py * vpro;
        burst(cx, cy, 14, "#5ffbf1"); shake = Math.min(14, shake + 7);
      } else {
        vel.x -= vn * nx; vel.y -= vn * ny;     // frictionless → surf
        if (Math.random() < 0.6) spark(cx, cy);
      }
    }
    onSurface = true; lastNx = nx; lastNy = ny;
  }

  function step(f) {
    const d = Math.hypot(pos.x, pos.y) || 1;
    const outx = pos.x / d, outy = pos.y / d;     // outward (away from core)
    // gravity toward core
    vel.x -= outx * G * f; vel.y -= outy * G * f;
    // soft ceiling: thin upper atmosphere reels you back toward the ring, so
    // an over-fast launch arcs back down instead of escaping into the void
    if (d > R_CEIL) {
      const k = Math.min(3, (d - R_CEIL) * 0.06) * f;
      vel.x -= outx * k; vel.y -= outy * k;
    }
    // tangential thrust toward a wish-speed cap (surfing can exceed it)
    const progx = -outy, progy = outx;            // CCW tangential
    let wish = (input.pro ? 1 : 0) - (input.retro ? 1 : 0);
    if (wish !== 0) {
      const tang = vel.x * progx + vel.y * progy;
      const cap = WS * wish;
      if (wish > 0 ? tang < cap : tang > cap) {
        let nt = tang + TH * f * wish;
        nt = wish > 0 ? Math.min(nt, cap) : Math.max(nt, cap);
        const dv = nt - tang;
        vel.x += progx * dv; vel.y += progy * dv;
      }
    }
    pos.x += vel.x * f; pos.y += vel.y * f;
    onSurface = false;
    const lo = wrapPi(Math.atan2(pos.y, pos.x));
    for (const s of segs) {
      if (Math.abs(wrapPi(s.mid - lo)) < 0.45) resolveSeg(s);
    }
    if (jumpQueued && onSurface) {
      const o = norm(pos);
      vel.x += o.x * JUMP; vel.y += o.y * JUMP;
      jumpQueued = false; onSurface = false;
    }
  }

  function physics(dt) {
    const f = Math.min(2.2, dt * 60);
    const speed = Math.hypot(vel.x, vel.y);
    const steps = clamp(Math.ceil(speed * f / 7), 1, 10);
    const sf = f / steps;
    for (let i = 0; i < steps; i++) step(sf);

    // progress (CCW positive)
    const a = Math.atan2(pos.y, pos.x);
    totalAng += wrapPi(a - prevAng); prevAng = a;

    // trail + particle upkeep
    trail.push({ x: pos.x, y: pos.y }); if (trail.length > 26) trail.shift();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * f; p.y += p.vy * f; p.vx *= 0.94; p.vy *= 0.94;
      p.life -= f; if (p.life <= 0) particles.splice(i, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - f);

    // outcomes — crashing into the Earth is the only way to lose
    const r = Math.hypot(pos.x, pos.y);
    if (totalAng / (Math.PI * 2) * 100 >= 100) return win();
    if (r <= RE + PR - 2) return fail("Burned up on re-entry.");
  }

  // ---- particles -----------------------------------------------------------
  function spark(x, y) {
    particles.push({ x, y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
      life: 8 + Math.random() * 8, max: 16, c: "#ffd86b", r: 1.5 + Math.random() * 1.5 });
  }
  function burst(x, y, n, c) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 14 + Math.random() * 14, max: 28, c, r: 1.5 + Math.random() * 2.5 });
    }
  }

  // ---- rendering -----------------------------------------------------------
  const stars = [];
  for (let i = 0; i < 140; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, tw: Math.random() * Math.PI * 2 });

  function draw() {
    const cw = view.cw, ch = view.ch;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // starfield (screen space, gentle parallax drift with progress)
    const drift = totalAng * 40;
    ctx.fillStyle = "#03040c"; ctx.fillRect(0, 0, cw, ch);
    for (const s of stars) {
      const sx = ((s.x * cw - drift) % cw + cw) % cw;
      const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(clock * 2 + s.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(sx, s.y * ch, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // into logical, letterboxed space
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    // camera: rotate so outward = up, player anchored on screen
    const theta = Math.atan2(pos.y, pos.x);
    const sh = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.save();
    ctx.translate(cam.ax + sh, cam.ay + sh);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.rotate(-Math.PI / 2 - theta);
    ctx.translate(-pos.x, -pos.y);

    drawEarth();
    drawTrack(theta);
    drawTrail();
    drawPlayer();
    drawParticles();

    ctx.restore();
  }

  function drawEarth() {
    // atmosphere glow
    const atmo = ctx.createRadialGradient(0, 0, RE * 0.9, 0, 0, RE + 360);
    atmo.addColorStop(0, "rgba(90,170,255,0.0)");
    atmo.addColorStop(0.55, "rgba(90,170,255,0.30)");
    atmo.addColorStop(1, "rgba(90,170,255,0)");
    ctx.fillStyle = atmo;
    ctx.beginPath(); ctx.arc(0, 0, RE + 360, 0, Math.PI * 2); ctx.fill();

    // ocean
    const g = ctx.createRadialGradient(-RE * 0.3, -RE * 0.3, RE * 0.2, 0, 0, RE);
    g.addColorStop(0, "#2b6fd6");
    g.addColorStop(0.7, "#11407f");
    g.addColorStop(1, "#0a2247");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, RE, 0, Math.PI * 2); ctx.fill();

    // continents — small blobs hugging the surface (scroll past as you orbit)
    ctx.fillStyle = "rgba(70,165,95,0.9)";
    for (let i = 0; i < 40; i++) {
      const a = i * 0.61, rr = RE - 36 - (i % 3) * 16;
      const c = P(a, rr);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 46 + (i % 4) * 22, 26 + (i % 3) * 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // shoreline highlight
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(150,210,255,0.5)";
    ctx.beginPath(); ctx.arc(0, 0, RE, 0, Math.PI * 2); ctx.stroke();
  }

  function drawTrack(theta) {
    for (const s of segs) {
      if (Math.abs(wrapPi(s.mid - theta)) > 0.7) continue;
      ctx.lineCap = "round";
      if (s.bouncy) {
        ctx.lineWidth = 13; ctx.strokeStyle = "rgba(95,251,241,0.25)";
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
        ctx.lineWidth = 6; ctx.strokeStyle = "#5ffbf1";
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
        // little chevrons pointing outward
        const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
        const o = norm({ x: mx, y: my });
        ctx.fillStyle = "#5ffbf1";
        ctx.beginPath();
        ctx.moveTo(mx + o.x * 6, my + o.y * 6);
        ctx.lineTo(mx - o.y * 9, my + o.x * 9);
        ctx.lineTo(mx + o.y * 9, my - o.x * 9);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.lineWidth = 11; ctx.strokeStyle = "rgba(160,120,255,0.22)";
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
        ctx.lineWidth = 5; ctx.strokeStyle = "#b69bff";
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      }
    }
  }

  function drawTrail() {
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i], a = i / trail.length;
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = "#9fd0ff";
      ctx.beginPath(); ctx.arc(t.x, t.y, PR * a * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const o = norm(pos);
    const ang = Math.atan2(vel.y, vel.x);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    // glow
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, PR * 3);
    gl.addColorStop(0, "rgba(150,210,255,0.9)");
    gl.addColorStop(1, "rgba(150,210,255,0)");
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(0, 0, PR * 3, 0, Math.PI * 2); ctx.fill();
    // body (little satellite)
    ctx.rotate(ang);
    ctx.fillStyle = "#eaf2ff";
    ctx.beginPath(); ctx.arc(0, 0, PR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a7bff";
    ctx.fillRect(-PR * 1.9, -PR * 0.42, PR * 0.8, PR * 0.84); // solar panel
    ctx.fillRect(PR * 1.1, -PR * 0.42, PR * 0.8, PR * 0.84);
    ctx.strokeStyle = "#3a7bff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-PR, 0); ctx.lineTo(PR, 0); ctx.stroke();
    ctx.restore();
    // a tiny "down" tick to read gravity
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = "#ff9a3c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(pos.x - o.x * 22, pos.y - o.y * 22); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- HUD -----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const elPct = $("orbitPct"), elSpeed = $("orbitSpeed"), elAlt = $("orbitAlt"),
    elBest = $("orbitBest"), elAltWrap = $("orbitAltWrap"), hud = $("orbitHud"),
    hint = $("orbitHint");
  function updateHud() {
    const pct = clamp(totalAng / (Math.PI * 2) * 100, 0, 100);
    const spd = Math.hypot(vel.x, vel.y);
    const alt = Math.hypot(pos.x, pos.y) - RE;
    elPct.textContent = Math.floor(pct);
    elSpeed.textContent = Math.round(spd * SPEED_SCALE);
    elAlt.textContent = Math.max(0, Math.round(alt * ALT_SCALE));
    elBest.textContent = Math.floor(best);
    elAltWrap.classList.toggle("warn", alt < 130);
  }

  // ---- game states ---------------------------------------------------------
  function startPlay() {
    reset();
    phase = "play";
    hud.hidden = false;
    hint.hidden = false;
    $("orbitIntro").hidden = true; $("orbitFail").hidden = true; $("orbitWin").hidden = true;
  }
  function fail(title) {
    if (phase !== "play") return;
    phase = "fail";
    burst(pos.x, pos.y, 26, "#ff7a4d"); shake = 16;
    saveBest();
    $("orbitFailTitle").textContent = title;
    $("orbitFailMsg").innerHTML = "You made it <b>" + Math.floor(clamp(totalAng / (Math.PI * 2) * 100, 0, 100)) + "%</b> of the way around.";
    setTimeout(() => { $("orbitFail").hidden = false; hud.hidden = true; hint.hidden = true; }, 650);
  }
  function win() {
    if (phase !== "play") return;
    phase = "win";
    totalAng = Math.PI * 2; best = 100; saveBest();
    burst(pos.x, pos.y, 40, "#5ffbf1");
    setTimeout(() => { $("orbitWin").hidden = false; hud.hidden = true; hint.hidden = true; }, 500);
  }
  function saveBest() {
    const pct = clamp(totalAng / (Math.PI * 2) * 100, 0, 100);
    if (pct > best) best = pct;
    try { localStorage.setItem("orbit.best", String(best)); } catch (e) { /* ignore */ }
  }

  // ---- input ---------------------------------------------------------------
  const PRO = new Set(["ArrowRight", "d", "D"]);
  const RETRO = new Set(["ArrowLeft", "a", "A"]);
  const JUMPK = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);
  window.addEventListener("keydown", (e) => {
    if (PRO.has(e.key)) { input.pro = true; e.preventDefault(); }
    else if (RETRO.has(e.key)) { input.retro = true; e.preventDefault(); }
    else if (JUMPK.has(e.key)) { if (phase === "play") jumpQueued = true; e.preventDefault(); }
    else if (e.key === "Enter" && phase !== "play") { startPlay(); }
  });
  window.addEventListener("keyup", (e) => {
    if (PRO.has(e.key)) input.pro = false;
    else if (RETRO.has(e.key)) input.retro = false;
  });

  // touch
  if (window.matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");
  function hold(id, on, off) {
    const el = $(id); if (!el) return;
    const down = (e) => { e.preventDefault(); on(); };
    const up = (e) => { e.preventDefault(); off(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  }
  hold("touchThrust", () => input.pro = true, () => input.pro = false);
  hold("touchBrake", () => input.retro = true, () => input.retro = false);
  const tj = $("touchJump");
  if (tj) tj.addEventListener("pointerdown", (e) => { e.preventDefault(); if (phase === "play") jumpQueued = true; });

  $("orbitPlayBtn").addEventListener("click", startPlay);
  $("orbitRetry").addEventListener("click", startPlay);
  $("orbitReplay").addEventListener("click", startPlay);

  // ---- loop ----------------------------------------------------------------
  let last = performance.now();
  reset();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05;
    clock += dt;
    if (phase === "play") { physics(dt); updateHud(); }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // expose a little for tuning/automated checks
  window.OrbitGame = {
    get state() { return { phase, pos: { ...pos }, vel: { ...vel }, pct: totalAng / (Math.PI * 2) * 100, onSurface }; },
    setInput(p, r) { input.pro = p; input.retro = r; },
    queueJump() { jumpQueued = true; },
    get gaps() { return gaps.slice(); },
    get angle() { return Math.atan2(pos.y, pos.x); },
    start: startPlay,
  };
})();
