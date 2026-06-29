// orbit.js — "Orbit Surfer". A third-person surf runner set in orbit. The
// camera floats BEHIND and ABOVE your satellite, looking forward down a
// channel of opposing surf ramps suspended in space above the Earth.
//
// Two angled walls face each other across a central void. Each wall is
// frictionless and tilts in toward the gap, so gravity slides you down it,
// trading height for speed (classic CS / Garry's Mod surf). Ride a wall to
// build momentum, then HOP across the gap and land on the opposite wall —
// over and over — STRAFING to control how high you ride and when you leave.
// Miss a wall, or fly off the outer edge, and you fall into the void.

(function () {
  "use strict";

  const VW = 960, VH = 600;                  // logical (letterboxed) viewport
  const canvas = document.getElementById("orbitCanvas");
  const ctx = canvas.getContext("2d");

  // ---- world constants -----------------------------------------------------
  const PR = 0.7;            // player radius (world units)
  const XI = 8;              // inner edge: the central void spans [-XI, XI]
  const XO = 30;             // outer edge: each wall runs from ±XI to ±XO
  const LAP = 900;           // forward distance for a full 360° lap
  const VOID = 22;           // how far you can fall below the walls before you're lost

  // physics (tuned for 60fps; scaled by frame-time factor f) — deliberately
  // gentle, so the rhythm of riding a wall and hopping to the next is readable.
  const G = 0.028;           // gravity accel (−y) — snappy enough to keep leaps controllable
  const STRAFE = 0.04;       // lateral steer accel per frame
  const VX_CAP = 1.1;        // lateral speed cap
  const THRUST_Z = 0.006;    // gentle forward engine so you never fully stall
  const VZ_CAP = 0.95;       // forward speed soft cap
  const HOP_Y = 0.5;         // upward part of a wall-to-wall leap
  const HOP_X = 0.35;        // lateral part — flings you across the void to the other wall
  const DRAG = 0.9996;       // very mild space drag

  // flavour scales for the HUD
  const SPEED_SCALE = 120;   // world u/frame -> "m/s"
  const ALT_SCALE = 9;       // world u -> "km"

  // ---- view / scaling ------------------------------------------------------
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1, cw: VW, ch: VH };
  // camera rig: behind + above the player, pitched down to look along the channel
  const CAM_BACK = 16, CAM_UP = 10, PITCH = 0.36;
  const FOC = VH * 1.12;                      // focal length (perspective)
  const HORIZON = VH * 0.40;
  const cosP = Math.cos(PITCH), sinP = Math.sin(PITCH);
  const cam = { x: 0, y: 0 };                 // smoothed follow target

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

  // ---- the surf channel ----------------------------------------------------
  // Two opposing walls. Each tilts down toward the central void, so a satellite
  // resting on it slides inward + down. Walls also descend gently forward, so
  // surfing one builds forward speed. The tilt steepens with distance for a
  // gradual difficulty ramp.
  function tiltAt(z) { return clamp(0.5 + z * 0.00009, 0.5, 0.85); }
  function yBase(z) { return -z * 0.05 + 4 * Math.sin(z * 0.009); }   // inner-edge height
  function dYBase(z) { const e = 1.0; return (yBase(z + e) - yBase(z - e)) / (2 * e); }

  // Surface query: is there a wall at (x,z)? If so, its height + (un-normalised) normal.
  function surfaceAt(x, z) {
    const t = tiltAt(z), yb = yBase(z), dz = dYBase(z);
    if (x <= -XI && x >= -XO) return { onWall: true, y: yb + t * (-XI - x), nx: t, ny: 1, nz: -dz };
    if (x >= XI && x <= XO) return { onWall: true, y: yb + t * (x - XI), nx: -t, ny: 1, nz: -dz };
    return { onWall: false, y: yb, nx: 0, ny: 1, nz: -dz };
  }

  // ---- state ---------------------------------------------------------------
  let phase = "intro";                 // intro | play | fail | win
  const pos = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
  let onSurface = false, offRamp = false;
  let best = 0, clock = 0, shake = 0, camYsmooth = 0;
  let jumpQueued = false;
  let particles = [], trail = [];
  const input = { left: false, right: false };

  try { best = Math.max(0, Math.min(100, +localStorage.getItem("orbit.best") || 0)); } catch (e) { /* ignore */ }

  function reset() {
    pos.z = 0; pos.x = -(XI + XO) / 2;                 // partway up the left wall
    pos.y = surfaceAt(pos.x, 0).y + PR;
    vel.x = 0.18; vel.y = 0; vel.z = 0.5;              // drift gently inward to get going
    onSurface = true; offRamp = false;
    cam.x = pos.x; cam.y = pos.y; camYsmooth = pos.y;
    particles = []; trail = []; shake = 0;
    input.left = input.right = false; jumpQueued = false;
  }

  // ---- math helpers --------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function norm3(x, y, z) { const d = Math.hypot(x, y, z) || 1; return { x: x / d, y: y / d, z: z / d }; }

  // ---- physics -------------------------------------------------------------
  function step(f) {
    // gravity
    vel.y -= G * f;
    // gentle forward engine toward the soft cap (so you never fully stall)
    if (vel.z < VZ_CAP) vel.z = Math.min(VZ_CAP, vel.z + THRUST_Z * f);
    // strafe input → lateral accel (momentum is preserved; that's what carries you across)
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) vel.x = clamp(vel.x + dir * STRAFE * f, -VX_CAP, VX_CAP);

    // integrate
    pos.x += vel.x * f; pos.y += vel.y * f; pos.z += vel.z * f;
    vel.x *= Math.pow(DRAG, f); vel.z *= Math.pow(DRAG, f);

    // wall contact
    const s = surfaceAt(pos.x, pos.z);
    offRamp = !s.onWall;
    onSurface = false;
    if (s.onWall && pos.y <= s.y + PR) {
      pos.y = s.y + PR;
      const n = norm3(s.nx, s.ny, s.nz);
      const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
      if (vn < 0) {                          // frictionless: cancel into-surface velocity → surf
        vel.x -= vn * n.x; vel.y -= vn * n.y; vel.z -= vn * n.z;
        if (Math.random() < 0.5) spark(pos.x, s.y, pos.z);
      }
      onSurface = true;
      if (jumpQueued) {
        // a deliberate leap across the void toward the opposite wall
        vel.y += HOP_Y;
        vel.x += (pos.x < 0 ? 1 : -1) * HOP_X;
        burst(pos.x, s.y, pos.z, 8, "#5ffbf1");
        jumpQueued = false; onSurface = false;
      }
    }
  }

  function physics(dt) {
    const f = Math.min(2.2, dt * 60);
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const steps = clamp(Math.ceil(speed * f / 1.0), 1, 8);
    const sf = f / steps;
    for (let i = 0; i < steps; i++) step(sf);

    // camera follow (lag the lateral + vertical so strafing/hopping reads nicely)
    cam.x += (pos.x - cam.x) * Math.min(1, 0.1 * f);
    camYsmooth += (pos.y - camYsmooth) * Math.min(1, 0.07 * f);

    // trail + particle upkeep
    trail.push({ x: pos.x, y: pos.y, z: pos.z }); if (trail.length > 30) trail.shift();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * f; p.y += p.vy * f; p.z += p.vz * f;
      p.vx *= 0.93; p.vy *= 0.93; p.vz *= 0.93;
      p.life -= f; if (p.life <= 0) particles.splice(i, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - f);

    // outcomes
    if (pos.z / LAP * 100 >= 100) return win();
    if (pos.y < yBase(pos.z) - VOID) {
      return fail(Math.abs(pos.x) > XO ? "Flew off the outer wall." : "Missed the jump — into the void.");
    }
  }

  // ---- particles -----------------------------------------------------------
  function spark(x, y, z) {
    particles.push({ x, y, z, vx: (Math.random() - 0.5) * 0.3, vy: Math.random() * 0.25,
      vz: -0.2 - Math.random() * 0.2, life: 8 + Math.random() * 8, max: 16, c: "#ffd86b", r: 1.6 });
  }
  function burst(x, y, z, n, c) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 1.5, sp = 0.2 + Math.random() * 0.5;
      particles.push({ x, y, z, vx: Math.cos(a) * sp, vy: Math.abs(e) * sp + 0.2, vz: Math.sin(a) * sp,
        life: 14 + Math.random() * 16, max: 30, c, r: 2 + Math.random() * 2.5 });
    }
  }

  // ---- projection (behind + above, looking forward) ------------------------
  // Returns logical-space screen coords + depth, or null if behind the camera.
  function project(X, Y, Z) {
    const rx = X - cam.x;
    const ry = Y - (camYsmooth + CAM_UP);
    const rz = Z - (pos.z - CAM_BACK);
    const ru = ry * cosP + rz * sinP;          // along camera "up"
    const rf = -ry * sinP + rz * cosP;         // along camera "forward" (depth)
    if (rf < 0.6) return null;
    const inv = FOC / rf;
    return { sx: VW / 2 + rx * inv, sy: HORIZON - ru * inv, depth: rf };
  }

  // ---- rendering -----------------------------------------------------------
  const stars = [];
  for (let i = 0; i < 150; i++) stars.push({ x: Math.random(), y: Math.random() * 0.55, r: Math.random() * 1.4 + 0.3, tw: Math.random() * Math.PI * 2 });
  const LIGHT = norm3(-0.3, 0.9, -0.25);

  function draw() {
    const cw = view.cw, ch = view.ch;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = "#03040c"; ctx.fillRect(0, 0, cw, ch);

    // starfield (screen space, drifts sideways as you weave between walls)
    const drift = cam.x * 6;
    for (const s of stars) {
      const sx = ((s.x * cw - drift) % cw + cw) % cw;
      const a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(clock * 2 + s.tw));
      ctx.globalAlpha = a; ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(sx, s.y * ch, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // into logical, letterboxed space
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    const sh = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.translate(sh, sh);

    drawEarthHorizon();
    drawWalls();
    drawTrail();
    drawPlayer();
    drawParticles();
  }

  // The Earth fills the sky far ahead/below for the orbital backdrop + glow.
  function drawEarthHorizon() {
    const grad = ctx.createLinearGradient(0, HORIZON - 70, 0, HORIZON + 60);
    grad.addColorStop(0, "rgba(90,170,255,0)");
    grad.addColorStop(0.55, "rgba(90,170,255,0.28)");
    grad.addColorStop(1, "rgba(20,60,130,0.05)");
    ctx.fillStyle = grad;
    ctx.fillRect(-200, HORIZON - 70, VW + 400, 130);

    ctx.save();
    const cxp = VW / 2 - cam.x * 2;
    const g = ctx.createRadialGradient(cxp, HORIZON + 1400, 900, cxp, HORIZON + 1400, 1500);
    g.addColorStop(0, "#2b6fd6"); g.addColorStop(0.7, "#11407f"); g.addColorStop(1, "#0a2247");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cxp, HORIZON + 1400, 1480, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(150,210,255,0.45)";
    ctx.beginPath(); ctx.arc(cxp, HORIZON + 1400, 1480, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.restore();
  }

  // Draw both walls as tessellated strips, far → near (painter's algorithm).
  function drawWalls() {
    const STEP = 4, FAR = 200, NX = 5;
    const z0 = Math.floor(pos.z / STEP) * STEP - 12;
    ctx.lineJoin = "round";
    for (let z = z0 + FAR; z >= z0; z -= STEP) {
      drawWallBand(z, z + STEP, -1, NX, z0, FAR);   // left wall:  x in [-XO, -XI]
      drawWallBand(z, z + STEP, 1, NX, z0, FAR);    // right wall: x in [ XI,  XO]
      // glowing inner rails (the edge of the void — your jump line) + outer rails
      drawEdge(z, z + STEP, -XI, z0, FAR, "#5ffbf1", true);
      drawEdge(z, z + STEP, XI, z0, FAR, "#5ffbf1", true);
      drawEdge(z, z + STEP, -XO, z0, FAR, "#b69bff", false);
      drawEdge(z, z + STEP, XO, z0, FAR, "#b69bff", false);
    }
    ctx.globalAlpha = 1;
  }

  function wallX(side, u) { return side < 0 ? -XO + u * (XO - XI) : XI + u * (XO - XI); }

  function drawWallBand(za, zb, side, NX, z0, FAR) {
    const n = surfaceAt(side < 0 ? -XO + 0.5 : XI + 0.5, za);
    const nn = norm3(n.nx, n.ny, n.nz);
    const lit = clamp(0.45 + (nn.x * LIGHT.x + nn.y * LIGHT.y + nn.z * LIGHT.z) * 0.7, 0.2, 1);
    for (let j = 0; j < NX; j++) {
      const ua = j / NX, ub = (j + 1) / NX;
      const xa = wallX(side, ua), xb = wallX(side, ub);
      const p1 = project(xa, surfaceAt(xa, za).y, za);
      const p2 = project(xb, surfaceAt(xb, za).y, za);
      const p3 = project(xb, surfaceAt(xb, zb).y, zb);
      const p4 = project(xa, surfaceAt(xa, zb).y, zb);
      if (!p1 || !p2 || !p3 || !p4) continue;
      const fog = clamp(1 - (za - z0) / FAR, 0.12, 1);
      const checker = (j + Math.floor(za / 4)) % 2 === 0 ? 1 : 0.82;
      const r = Math.round(120 * lit * checker), gg = Math.round(96 * lit * checker), b = Math.round(210 * lit);
      ctx.globalAlpha = fog;
      ctx.fillStyle = `rgb(${r},${gg},${b})`;
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy);
      ctx.lineTo(p3.sx, p3.sy); ctx.lineTo(p4.sx, p4.sy); ctx.closePath(); ctx.fill();
    }
  }

  function drawEdge(za, zb, x, z0, FAR, color, bright) {
    const pa = project(x, surfaceAt(x, za).y, za);
    const pb = project(x, surfaceAt(x, zb).y, zb);
    if (!pa || !pb) return;
    const fog = clamp(1 - (za - z0) / FAR, 0.12, 1);
    ctx.globalAlpha = fog;
    if (bright) {
      ctx.lineWidth = clamp(60 / pa.depth, 1, 6);
      ctx.strokeStyle = "rgba(95,251,241,0.35)";
      ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
    }
    ctx.lineWidth = clamp((bright ? 28 : 18) / pa.depth, 0.6, bright ? 3 : 2);
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
  }

  function drawTrail() {
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i], a = i / trail.length;
      const p = project(t.x, t.y, t.z);
      if (!p) continue;
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = "#9fd0ff";
      const rr = clamp((PR * 70) / p.depth, 0.5, 7) * a;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    // shadow on the wall directly beneath
    if (!offRamp) {
      const sp = project(pos.x, surfaceAt(pos.x, pos.z).y + 0.05, pos.z);
      if (sp) {
        ctx.globalAlpha = 0.35; ctx.fillStyle = "#000";
        const sr = clamp((PR * 110) / sp.depth, 1, 18);
        ctx.beginPath(); ctx.ellipse(sp.sx, sp.sy, sr, sr * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    const p = project(pos.x, pos.y, pos.z);
    if (!p) return;
    const sc = clamp((PR * 150) / p.depth, 6, 60);
    const roll = clamp(-vel.x * 0.5, -0.6, 0.6);   // bank into the strafe
    ctx.save();
    ctx.translate(p.sx, p.sy);
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * 2.4);
    gl.addColorStop(0, "rgba(150,210,255,0.85)"); gl.addColorStop(1, "rgba(150,210,255,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, sc * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(roll);
    ctx.fillStyle = "#3a7bff";
    ctx.fillRect(-sc * 2.0, -sc * 0.32, sc * 1.0, sc * 0.64);
    ctx.fillRect(sc * 1.0, -sc * 0.32, sc * 1.0, sc * 0.64);
    ctx.strokeStyle = "#2a5fd0"; ctx.lineWidth = sc * 0.08;
    ctx.beginPath(); ctx.moveTo(-sc * 1.0, 0); ctx.lineTo(sc * 1.0, 0); ctx.stroke();
    ctx.fillStyle = "#eaf2ff";
    ctx.beginPath(); ctx.arc(0, 0, sc * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#9ec6ff";
    ctx.beginPath(); ctx.arc(0, -sc * 0.12, sc * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    const list = particles.map((p) => ({ p, pr: project(p.x, p.y, p.z) })).filter((o) => o.pr);
    list.sort((a, b) => b.pr.depth - a.pr.depth);
    for (const { p, pr } of list) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.c;
      const rr = clamp((p.r * 60) / pr.depth, 0.6, 9);
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- HUD -----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const elPct = $("orbitPct"), elSpeed = $("orbitSpeed"), elAlt = $("orbitAlt"),
    elBest = $("orbitBest"), elAltWrap = $("orbitAltWrap"), hud = $("orbitHud"),
    hint = $("orbitHint");
  function updateHud() {
    const pct = clamp(pos.z / LAP * 100, 0, 100);
    const spd = Math.hypot(vel.x, vel.y, vel.z);
    const height = pos.y - yBase(pos.z);        // height above the inner-edge plane
    elPct.textContent = Math.floor(pct);
    elSpeed.textContent = Math.round(spd * SPEED_SCALE);
    elAlt.textContent = Math.max(0, Math.round((height + VOID) * ALT_SCALE));
    elBest.textContent = Math.floor(best);
    elAltWrap.classList.toggle("warn", offRamp || height < -VOID * 0.5);
  }

  // ---- game states ---------------------------------------------------------
  function startPlay() {
    reset();
    phase = "play";
    hud.hidden = false; hint.hidden = false;
    $("orbitIntro").hidden = true; $("orbitFail").hidden = true; $("orbitWin").hidden = true;
  }
  function fail(title) {
    if (phase !== "play") return;
    phase = "fail";
    burst(pos.x, pos.y, pos.z, 26, "#ff7a4d"); shake = 16;
    saveBest();
    $("orbitFailTitle").textContent = title;
    $("orbitFailMsg").innerHTML = "You made it <b>" + Math.floor(clamp(pos.z / LAP * 100, 0, 100)) + "%</b> of the way around.";
    setTimeout(() => { $("orbitFail").hidden = false; hud.hidden = true; hint.hidden = true; }, 650);
  }
  function win() {
    if (phase !== "play") return;
    phase = "win";
    pos.z = LAP; best = 100; saveBest();
    burst(pos.x, pos.y, pos.z, 40, "#5ffbf1");
    setTimeout(() => { $("orbitWin").hidden = false; hud.hidden = true; hint.hidden = true; }, 500);
  }
  function saveBest() {
    const pct = clamp(pos.z / LAP * 100, 0, 100);
    if (pct > best) best = pct;
    try { localStorage.setItem("orbit.best", String(best)); } catch (e) { /* ignore */ }
  }

  // ---- input ---------------------------------------------------------------
  const LEFT = new Set(["ArrowLeft", "a", "A"]);
  const RIGHT = new Set(["ArrowRight", "d", "D"]);
  const HOPK = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);
  window.addEventListener("keydown", (e) => {
    if (LEFT.has(e.key)) { input.left = true; e.preventDefault(); }
    else if (RIGHT.has(e.key)) { input.right = true; e.preventDefault(); }
    else if (HOPK.has(e.key)) { if (phase === "play") jumpQueued = true; e.preventDefault(); }
    else if (e.key === "Enter" && phase !== "play") { startPlay(); }
  });
  window.addEventListener("keyup", (e) => {
    if (LEFT.has(e.key)) input.left = false;
    else if (RIGHT.has(e.key)) input.right = false;
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
  hold("touchBrake", () => input.left = true, () => input.left = false);   // ◀ strafe left
  hold("touchThrust", () => input.right = true, () => input.right = false); // ▶ strafe right
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
    get state() { return { phase, pos: { ...pos }, vel: { ...vel }, pct: pos.z / LAP * 100, onSurface, offRamp }; },
    setInput(left, right) { input.left = left; input.right = right; },
    queueJump() { jumpQueued = true; },
    get angle() { return pos.z / LAP * Math.PI * 2; },
    start: startPlay,
  };
})();
