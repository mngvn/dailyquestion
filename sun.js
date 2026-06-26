// sun.js — "Sunball": a throwable, light-emitting sun in a dark arena.
// Full-screen canvas. Free play = grab & fling. Play = slingshot the sun
// from the start point (pull back, aim arrow + trajectory preview, release)
// and bounce it off the walls to touch every enemy in one throw. Grab a
// split orb to multiply. Mind the gaps — a sun that leaves the room is gone.

(function () {
  "use strict";

  const W = 960, H = 600;                 // design (logical) space
  const canvas = document.getElementById("sunCanvas");
  const ctx = canvas.getContext("2d");

  const R = 15, WALL_T = 12, PAD = WALL_T / 2;
  const GRAB_R = 110, MAX_BALLS = 16;
  const MAX_PULL = 230, MAX_LAUNCH = 1700;

  // ----- View / full-screen scaling ----------------------------------------
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const scale = Math.min(cw / W, ch / H);
    view.scale = scale; view.dpr = dpr;
    view.ox = (cw - W * scale) / 2;
    view.oy = (ch - H * scale) / 2;
  }
  window.addEventListener("resize", resize);

  // ----- Arena helpers ------------------------------------------------------
  const M = 28, L = M, Rg = W - M, T = M, B = H - M;
  function box(extra) {
    return [[L, T, Rg, T], [Rg, T, Rg, B], [Rg, B, L, B], [L, B, L, T]].concat(extra || []);
  }
  function arena(g, extra) {
    g = g || {};
    const segs = [];
    const horiz = (y, gap) => gap ? (segs.push([L, y, gap[0], y]), segs.push([gap[1], y, Rg, y])) : segs.push([L, y, Rg, y]);
    const vert = (x, gap) => gap ? (segs.push([x, T, x, gap[0]]), segs.push([x, gap[1], x, B])) : segs.push([x, T, x, B]);
    horiz(T, g.top); horiz(B, g.bottom); vert(L, g.left); vert(Rg, g.right);
    return segs.concat(extra || []);
  }

  // ----- Levels (one split orb each now) -----------------------------------
  const LEVELS = [
    { name: "Warm Up", walls: box(), obstacles: [],
      enemies: [[470, 110], [660, 300], [300, 300]], powerups: [[480, 450]],
      start: [150, 460], budget: 18 },
    { name: "The Pillar", walls: box(), obstacles: [{ x: 480, y: 300, r: 56 }],
      enemies: [[140, 140], [820, 140], [140, 460], [820, 460]], powerups: [[300, 300]],
      start: [480, 520], budget: 22 },
    { name: "Mind the Gap", walls: arena({ top: [420, 540] }), obstacles: [],
      enemies: [[140, 200], [820, 200], [480, 440]], powerups: [[480, 300]],
      start: [480, 520], budget: 20 },
    { name: "Zigzag", walls: arena({ left: [270, 360], right: [270, 360] }, [[330, 120, 330, 360], [630, 240, 630, 480]]),
      obstacles: [], enemies: [[150, 300], [810, 300], [480, 110], [480, 490], [480, 300]],
      powerups: [[730, 150]], start: [150, 520], budget: 26 },
    { name: "Bumper Room", walls: arena({ top: [440, 520], bottom: [440, 520] }),
      obstacles: [{ x: 300, y: 300, r: 46 }, { x: 660, y: 300, r: 46 }],
      enemies: [[140, 140], [820, 140], [140, 460], [820, 460], [480, 110], [480, 490]],
      powerups: [[480, 300]], start: [120, 300], budget: 30 },
    { name: "Sliding Doors", walls: arena({ left: [250, 350], right: [250, 350] }),
      obstacles: [
        { x: 360, y: 300, r: 34, move: { ax: 0, ay: 1, amp: 150, period: 3 } },
        { x: 600, y: 300, r: 34, move: { ax: 0, ay: 1, amp: 150, period: 3, phase: Math.PI } }],
      enemies: [[140, 140], [820, 140], [140, 460], [820, 460], [480, 120]], powerups: [[480, 300]],
      start: [480, 540], budget: 28 },
    { name: "Carousel", walls: arena({ top: [200, 300], bottom: [660, 760] }),
      bars: [{ cx: 480, cy: 300, len: 300, ang: 0, spin: 1.1 }], obstacles: [],
      enemies: [[140, 150], [820, 150], [140, 450], [820, 450], [480, 90]], powerups: [[200, 500]],
      start: [480, 540], budget: 30 },
    { name: "Pinball", walls: arena({ top: [80, 170], right: [260, 360] }),
      obstacles: [
        { x: 300, y: 200, r: 38 }, { x: 660, y: 200, r: 38 }, { x: 480, y: 410, r: 44 },
        { x: 480, y: 200, r: 28, move: { ax: 1, ay: 0, amp: 190, period: 2.6 } }],
      enemies: [[140, 120], [820, 470], [140, 470], [820, 120], [300, 470], [660, 470]],
      powerups: [[200, 470]], start: [480, 540], budget: 32 },
    { name: "The Gauntlet", walls: arena({ top: [440, 520], bottom: [200, 280], left: [270, 350], right: [270, 350] }),
      bars: [{ cx: 300, cy: 300, len: 200, ang: 0, spin: 1.4 }, { cx: 660, cy: 300, len: 200, ang: 1, spin: -1.2 }],
      obstacles: [{ x: 480, y: 300, r: 30, move: { ax: 0, ay: 1, amp: 120, period: 2 } }],
      enemies: [[120, 120], [840, 120], [120, 480], [840, 480], [480, 90], [480, 510], [120, 300]],
      powerups: [[760, 400]], start: [480, 555], budget: 36 }
  ];

  // ----- State --------------------------------------------------------------
  let mode = "sandbox", phase = "intro", levelIndex = 0;
  let walls = box(), obstacles = [], bars = [], liveBars = [], enemies = [], powerups = [];
  let start = [W / 2, H / 2], budget = 0, attemptStart = 0, clock = 0;
  let balls = [], held = false;
  const samples = [];
  let aim = { vx: 0, vy: 0 }, pull = { x: 0, y: 0 }, pulling = false;
  const flashes = [], particles = [];
  let overlayTimer = null;
  const makeBall = (x, y, vx, vy) => ({ x, y, vx: vx || 0, vy: vy || 0, bounces: 0 });

  // ----- DOM ----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const hud = $("sunHud"), chip = $("sunChip"), hint = $("sunHint");
  const elLevel = $("sunLevel"), elEnemies = $("sunEnemies"), elBalls = $("sunBalls"),
    elBounces = $("sunBounces"), elBudget = $("sunBudget");
  const ovIntro = $("sunIntro"), ovWin = $("sunWin"), ovFail = $("sunFail"), ovClear = $("sunClear");
  const hideOverlays = () => [ovIntro, ovWin, ovFail, ovClear].forEach((o) => (o.hidden = true));
  const showOverlay = (ov) => { hideOverlays(); ov.hidden = false; };

  const ENEMY_PALETTE = [
    { core: "#ff5a4a", rim: "#601414", glow: "255,110,80" },
    { core: "#ff9a3c", rim: "#5e340c", glow: "255,160,70" },
    { core: "#ff5c9c", rim: "#5e1440", glow: "255,110,170" }
  ];

  // ----- Geometry -----------------------------------------------------------
  function closestOnSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return [x1 + t * dx, y1 + t * dy];
  }

  // ----- Mode setup ---------------------------------------------------------
  function setSandbox() {
    mode = "sandbox"; phase = "free";
    walls = box(); obstacles = []; bars = []; liveBars = []; enemies = []; powerups = [];
    balls = [makeBall(W / 2, H * 0.4)];
    held = false; pulling = false; flashes.length = 0; particles.length = 0;
    hud.hidden = true; chip.textContent = "✨ free play";
    hint.textContent = "Drag the sun and let go to throw — it bounces and lights up the room.";
    clearTimeout(overlayTimer); hideOverlays();
  }
  function startPuzzle() { mode = "puzzle"; hud.hidden = false; loadLevel(0); }

  function loadLevel(i) {
    levelIndex = i;
    const lv = LEVELS[i];
    walls = lv.walls;
    obstacles = (lv.obstacles || []).map((o) => ({
      x: o.x, y: o.y, r: o.r, cx: o.x, cy: o.y, moving: !!o.move,
      move: o.move ? { ax: o.move.ax, ay: o.move.ay, amp: o.move.amp, w: (2 * Math.PI) / o.move.period, ph: o.move.phase || 0 } : null
    }));
    bars = (lv.bars || []).map((b) => ({
      cx: b.cx, cy: b.cy, len: b.len, ang: b.ang || 0, spin: b.spin || 0,
      move: b.move ? { ax: b.move.ax, ay: b.move.ay, amp: b.move.amp, w: (2 * Math.PI) / b.move.period, ph: b.move.phase || 0 } : null
    }));
    liveBars = [];
    enemies = lv.enemies.map(([x, y], k) => ({
      x, y, r: 16, dead: false, phase: Math.random() * 6.28,
      type: k % ENEMY_PALETTE.length, spin: (Math.random() * 0.7 + 0.3) * (Math.random() < 0.5 ? -1 : 1)
    }));
    powerups = (lv.powerups || []).map(([x, y]) => ({ x, y, r: 16, taken: false }));
    start = lv.start.slice(); budget = lv.budget;
    balls = [makeBall(start[0], start[1])];
    held = false; pulling = false; flashes.length = 0; particles.length = 0;
    phase = "aim";
    chip.textContent = "▶ level " + (i + 1);
    hint.textContent = "Pull the sun back like a slingshot and release. Grab a ✦ orb to split!";
    clearTimeout(overlayTimer); hideOverlays();
    tickMovers(clock); updateHud();
  }

  const maxBounces = () => balls.reduce((m, b) => Math.max(m, b.bounces), 0);
  function updateHud() {
    elLevel.textContent = levelIndex + 1;
    elEnemies.textContent = enemies.filter((e) => !e.dead).length;
    elBalls.textContent = mode === "puzzle" ? balls.length : 1;
    elBounces.textContent = maxBounces();
    elBudget.textContent = budget;
  }

  // ----- Input --------------------------------------------------------------
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.scale, y: (e.clientY - r.top - view.oy) / view.scale };
  }
  function pushSample(p) {
    const now = performance.now();
    samples.push({ x: p.x, y: p.y, t: now });
    while (samples.length && now - samples[0].t > 120) samples.shift();
  }
  function flickVelocity() {
    if (samples.length < 2) return { vx: 0, vy: 0 };
    const last = samples[samples.length - 1];
    let ref = samples[0];
    for (let i = samples.length - 1; i >= 0; i--) if (last.t - samples[i].t >= 60) { ref = samples[i]; break; }
    const dt = (last.t - ref.t) / 1000 || 0.016;
    return { vx: (last.x - ref.x) / dt, vy: (last.y - ref.y) / dt };
  }
  function clampSpeed(v, max) {
    const s = Math.hypot(v.vx, v.vy);
    if (s > max) { v.vx = v.vx / s * max; v.vy = v.vy / s * max; }
    return v;
  }
  const aimBall = () => balls[0];

  function onDown(e) {
    if (phase !== "free" && phase !== "aim") return;
    const b = aimBall(); if (!b) return;
    const p = toCanvas(e);
    if (Math.hypot(p.x - b.x, p.y - b.y) > GRAB_R) return;
    held = true; canvas.classList.add("grabbing");
    samples.length = 0; pushSample(p);
    b.vx = b.vy = 0;
    if (mode === "puzzle") pulling = true;
    e.preventDefault();
  }
  function onMove(e) {
    if (!held) return;
    const b = aimBall(); if (!b) return;
    const p = toCanvas(e);
    pushSample(p);
    if (mode === "sandbox") {
      b.x = Math.max(L + R, Math.min(Rg - R, p.x));
      b.y = Math.max(T + R, Math.min(B - R, p.y));
      const v = flickVelocity(); aim.vx = v.vx; aim.vy = v.vy;
    } else {
      // slingshot: pull away from the start, launch in the opposite direction
      let dx = p.x - start[0], dy = p.y - start[1];
      const d = Math.hypot(dx, dy);
      const k = d > MAX_PULL ? MAX_PULL / d : 1;
      pull.x = dx * k; pull.y = dy * k;
      b.x = start[0] + pull.x; b.y = start[1] + pull.y;
      const pd = Math.hypot(pull.x, pull.y);
      const power = (pd / MAX_PULL) * MAX_LAUNCH;
      if (pd > 1) { aim.vx = -pull.x / pd * power; aim.vy = -pull.y / pd * power; }
      else { aim.vx = aim.vy = 0; }
    }
  }
  function onUp() {
    if (!held) return;
    held = false; pulling = false; canvas.classList.remove("grabbing");
    const b = aimBall(); if (!b) return;
    if (mode === "sandbox") {
      const v = clampSpeed(flickVelocity(), 2600);
      b.vx = v.vx; b.vy = v.vy;
      return;
    }
    if (Math.hypot(aim.vx, aim.vy) < 120) { b.x = start[0]; b.y = start[1]; return; } // too soft
    b.x = start[0]; b.y = start[1];
    b.vx = aim.vx; b.vy = aim.vy; b.bounces = 0;
    phase = "live"; attemptStart = performance.now();
  }

  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  $("sunPlayBtn").addEventListener("click", startPuzzle);
  $("sunFreeBtn").addEventListener("click", setSandbox);
  $("sunFreeBtn2").addEventListener("click", setSandbox);
  $("sunExit").addEventListener("click", setSandbox);
  $("sunRetry").addEventListener("click", () => loadLevel(levelIndex));
  $("sunRetry2").addEventListener("click", () => loadLevel(levelIndex));
  $("sunNextBtn").addEventListener("click", () => {
    if (levelIndex + 1 >= LEVELS.length) { phase = "clear"; showOverlay(ovClear); }
    else loadLevel(levelIndex + 1);
  });
  $("sunReplayBtn").addEventListener("click", startPuzzle);

  // ----- Movers -------------------------------------------------------------
  function tickMovers(t) {
    for (const o of obstacles) {
      if (o.move) {
        const d = o.move.amp * Math.sin(t * o.move.w + o.move.ph);
        o.cx = o.x + o.move.ax * d; o.cy = o.y + o.move.ay * d;
      } else { o.cx = o.x; o.cy = o.y; }
    }
    liveBars = [];
    for (const ba of bars) {
      const ang = ba.ang + ba.spin * t;
      let cx = ba.cx, cy = ba.cy;
      if (ba.move) {
        const d = ba.move.amp * Math.sin(t * ba.move.w + ba.move.ph);
        cx += ba.move.ax * d; cy += ba.move.ay * d;
      }
      const hx = Math.cos(ang) * ba.len / 2, hy = Math.sin(ang) * ba.len / 2;
      liveBars.push([cx - hx, cy - hy, cx + hx, cy + hy]);
    }
  }

  // ----- Physics ------------------------------------------------------------
  function reflect(b, nx, ny, rest) {
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny; return true; }
    return false;
  }
  function segHit(b, seg, rest) {
    const [cx, cy] = closestOnSeg(b.x, b.y, seg[0], seg[1], seg[2], seg[3]);
    let dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    const min = R + PAD;
    if (d < min) {
      if (d < 0.01) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d;
      b.x += nx * (min - d); b.y += ny * (min - d);
      return reflect(b, nx, ny, rest);
    }
    return false;
  }
  function circHit(b, cx, cy, rad, rest) {
    let dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    const min = R + rad;
    if (d < min) {
      if (d < 0.01) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d;
      b.x += nx * (min - d); b.y += ny * (min - d);
      return reflect(b, nx, ny, rest);
    }
    return false;
  }

  function collide(b) {
    const rest = mode === "sandbox" ? 0.82 : 1.0;
    let bounced = false;
    for (const w of walls) if (segHit(b, w, rest)) bounced = true;
    for (const w of liveBars) if (segHit(b, w, rest)) bounced = true;
    for (const o of obstacles) if (circHit(b, o.cx, o.cy, o.r, rest)) bounced = true;
    if (bounced && mode === "puzzle") b.bounces++;

    for (const en of enemies) {
      if (en.dead) continue;
      if (Math.hypot(b.x - en.x, b.y - en.y) < R + en.r) { killEnemy(en); }
    }
    if (mode === "puzzle") {
      for (const pu of powerups) {
        if (pu.taken) continue;
        if (Math.hypot(b.x - pu.x, b.y - pu.y) < R + pu.r) {
          pu.taken = true;
          flashes.push({ x: pu.x, y: pu.y, t0: performance.now(), c: "120,230" });
          splitBall(b);
        }
      }
    }
  }

  function killEnemy(en) {
    en.dead = true;
    flashes.push({ x: en.x, y: en.y, t0: performance.now(), c: "255,200" });
    const pal = ENEMY_PALETTE[en.type];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, sp = 60 + Math.random() * 260;
      particles.push({ x: en.x, y: en.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, max: 0.9, glow: pal.glow });
    }
  }
  function splitBall(b) {
    const speed = Math.hypot(b.vx, b.vy) || 600;
    const ang = Math.atan2(b.vy, b.vx);
    for (const da of [-0.49, 0.49]) {
      if (balls.length >= MAX_BALLS) break;
      const a = ang + da;
      const nb = makeBall(b.x, b.y, Math.cos(a) * speed, Math.sin(a) * speed);
      nb.bounces = b.bounces; balls.push(nb);
    }
  }

  function stepBall(b, dt) {
    if (mode === "sandbox") {
      b.vy += 1700 * dt; b.vx *= Math.pow(0.86, dt); b.vy *= Math.pow(0.92, dt);
    } else clampSpeed(b, 1900);
    const speed = Math.hypot(b.vx, b.vy);
    const sub = Math.max(1, Math.min(16, Math.ceil((speed * dt) / (R * 0.6))));
    for (let i = 0; i < sub; i++) {
      b.x += (b.vx * dt) / sub; b.y += (b.vy * dt) / sub;
      collide(b);
      if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) break;
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.1, dt); p.vy *= Math.pow(0.1, dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function step(dt) {
    updateParticles(dt);
    if (held) return;

    if (mode === "sandbox") {
      if (phase !== "free") return;
      stepBall(balls[0], dt);
      const b = balls[0];
      if (Math.abs(b.vx) < 4 && Math.abs(b.vy) < 4 && b.y > B - R - 2) b.vx *= 0.9;
      return;
    }
    if (phase !== "live") return;

    for (const b of balls) stepBall(b, dt);
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      const out = b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30;
      if (out || b.bounces > budget || Math.hypot(b.vx, b.vy) < 6) balls.splice(i, 1);
    }
    updateHud();
    if (enemies.every((e) => e.dead)) return finish(true);
    if (balls.length === 0) return finish(false, "All your suns burned out.");
    if (performance.now() - attemptStart > 22000) return finish(false, "The suns ran out of momentum.");
  }

  const WIN_MSGS = ["Every enemy, lights out. Beautiful.", "Bank shot of the century.", "The sun says: easy.", "Flawless. Did you even try?"];
  function finish(won, reason) {
    balls.forEach((b) => { b.vx = b.vy = 0; });
    if (won) {
      phase = "win";
      $("sunWinTitle").textContent = "Level cleared! ☀";
      $("sunWinMsg").textContent = WIN_MSGS[Math.floor(Math.random() * WIN_MSGS.length)];
      $("sunNextBtn").textContent = levelIndex + 1 >= LEVELS.length ? "Finish →" : "Next level →";
      overlayTimer = setTimeout(() => showOverlay(ovWin), 600);
    } else {
      phase = "fail";
      $("sunFailMsg").textContent = reason || "Some enemies are still standing.";
      $("sunFailTitle").textContent = enemies.every((e) => e.dead) ? "So close!" : "Missed a few.";
      overlayTimer = setTimeout(() => showOverlay(ovFail), 600);
    }
    updateHud();
  }

  // ----- Detailed drawing ---------------------------------------------------
  function nearestBall(x, y) {
    let m = 1e9;
    for (const b of balls) m = Math.min(m, Math.hypot(x - b.x, y - b.y));
    return m;
  }

  function drawEnemy(en, time) {
    const pal = ENEMY_PALETTE[en.type];
    const s = 1 + Math.sin(time * 0.004 + en.phase) * 0.07;
    const r = en.r * s;
    const rot = en.phase + time * 0.0009 * en.spin;

    // spikes
    ctx.fillStyle = pal.rim;
    for (let i = 0; i < 9; i++) {
      const a = rot + (i * 6.2832) / 9;
      const tx = en.x + Math.cos(a) * (r + 8), ty = en.y + Math.sin(a) * (r + 8);
      const a1 = a + 0.2, a2 = a - 0.2;
      ctx.beginPath();
      ctx.moveTo(en.x + Math.cos(a1) * r, en.y + Math.sin(a1) * r);
      ctx.lineTo(tx, ty);
      ctx.lineTo(en.x + Math.cos(a2) * r, en.y + Math.sin(a2) * r);
      ctx.closePath(); ctx.fill();
    }
    // body
    const g = ctx.createRadialGradient(en.x - r * 0.3, en.y - r * 0.3, 1, en.x, en.y, r);
    g.addColorStop(0, pal.core); g.addColorStop(0.7, pal.core); g.addColorStop(1, pal.rim);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(en.x, en.y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 2; ctx.stroke();

    // eyes track the nearest sun
    let dx = 0, dy = 1, best = 1e9;
    for (const b of balls) { const d = Math.hypot(b.x - en.x, b.y - en.y); if (d < best) { best = d; dx = (b.x - en.x) / (d || 1); dy = (b.y - en.y) / (d || 1); } }
    const px = -dy, py = dx;
    for (const sdir of [1, -1]) {
      const ex = en.x + px * sdir * r * 0.42 + dx * r * 0.18;
      const ey = en.y + py * sdir * r * 0.42 + dy * r * 0.18;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, r * 0.32, 0, 7); ctx.fill();
      ctx.fillStyle = "#140810"; ctx.beginPath(); ctx.arc(ex + dx * r * 0.16, ey + dy * r * 0.16, r * 0.16, 0, 7); ctx.fill();
    }
    // grimace
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
    const mx = en.x + dx * r * 0.45, my = en.y + dy * r * 0.45;
    ctx.beginPath(); ctx.moveTo(mx - px * r * 0.34, my - py * r * 0.34); ctx.lineTo(mx + px * r * 0.34, my + py * r * 0.34); ctx.stroke();
  }

  function drawObstacle(o, time) {
    if (o.moving) {
      // glowing energy node
      const g = ctx.createRadialGradient(o.cx, o.cy, 1, o.cx, o.cy, o.r);
      g.addColorStop(0, "#2a2150"); g.addColorStop(1, "#16122a");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, 7); ctx.fill();
      ctx.strokeStyle = "#6a4fd0"; ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        const a0 = time * 0.004 + k * 2.094;
        ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r - 7, a0, a0 + 1.4); ctx.stroke();
      }
      const cg = ctx.createRadialGradient(o.cx, o.cy, 0, o.cx, o.cy, o.r * 0.5);
      cg.addColorStop(0, "#e6d6ff"); cg.addColorStop(1, "#9a6cff");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r * 0.34, 0, 7); ctx.fill();
    } else {
      // metal bumper with rivets + highlight
      const g = ctx.createRadialGradient(o.cx - o.r * 0.3, o.cy - o.r * 0.3, 2, o.cx, o.cy, o.r);
      g.addColorStop(0, "#4a4a66"); g.addColorStop(0.7, "#2e2e44"); g.addColorStop(1, "#171726");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, 7); ctx.fill();
      ctx.strokeStyle = "#565676"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r - 5, 0, 7); ctx.stroke();
      ctx.fillStyle = "#6a6a90";
      for (let i = 0; i < 8; i++) { const a = i * 0.785; ctx.beginPath(); ctx.arc(o.cx + Math.cos(a) * (o.r - 5), o.cy + Math.sin(a) * (o.r - 5), 2.4, 0, 7); ctx.fill(); }
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.beginPath(); ctx.arc(o.cx - o.r * 0.3, o.cy - o.r * 0.32, o.r * 0.4, 0, 7); ctx.fill();
    }
  }

  function drawBar(seg) {
    const x1 = seg[0], y1 = seg[1], x2 = seg[2], y2 = seg[3];
    // base
    ctx.strokeStyle = "#2a2742"; ctx.lineWidth = WALL_T + 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    // hazard stripes
    ctx.save();
    ctx.lineWidth = WALL_T - 2; ctx.strokeStyle = "#ffcf5a"; ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
    // glowing end knobs
    for (const [ex, ey] of [[x1, y1], [x2, y2]]) {
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 12);
      g.addColorStop(0, "#cbb4ff"); g.addColorStop(1, "#6a4fd0");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, 9, 0, 7); ctx.fill();
    }
  }

  // ----- Render -------------------------------------------------------------
  function draw(time) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#04040a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale * view.dpr, 0, 0, view.scale * view.dpr, view.ox * view.dpr, view.oy * view.dpr);

    // arena floor
    ctx.fillStyle = "#06060c"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let x = 60; x < W; x += 60) for (let y = 60; y < H; y += 60) ctx.fillRect(x, y, 2, 2);

    // walls
    ctx.strokeStyle = "#2c2c4a"; ctx.lineWidth = WALL_T; ctx.lineCap = "round";
    for (const w of walls) { ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); ctx.stroke(); }
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 2;
    for (const w of walls) { ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); ctx.stroke(); }

    for (const w of liveBars) drawBar(w);
    for (const o of obstacles) drawObstacle(o, time);

    if (mode === "puzzle" && phase === "aim") {
      const pr = 22 + Math.sin(time / 260) * 4;
      ctx.strokeStyle = "rgba(255,216,107,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(start[0], start[1], pr, 0, 7); ctx.stroke();
    }

    for (const en of enemies) if (!en.dead) drawEnemy(en, time);

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // ---- additive light ----
    ctx.globalCompositeOperation = "lighter";
    for (const en of enemies) {
      if (en.dead) continue;
      const lit = Math.max(0, 1 - nearestBall(en.x, en.y) / 260);
      const pal = ENEMY_PALETTE[en.type];
      const g = ctx.createRadialGradient(en.x, en.y, 0, en.x, en.y, en.r + 20);
      g.addColorStop(0, "rgba(" + pal.glow + "," + (0.25 + lit * 0.6) + ")");
      g.addColorStop(1, "rgba(" + pal.glow + ",0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 20, 0, 7); ctx.fill();
    }
    for (const o of obstacles) {
      if (!o.moving) continue;
      const g = ctx.createRadialGradient(o.cx, o.cy, 0, o.cx, o.cy, o.r + 26);
      g.addColorStop(0, "rgba(154,108,255,0.45)"); g.addColorStop(1, "rgba(154,108,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r + 26, 0, 7); ctx.fill();
    }
    for (const pu of powerups) {
      if (pu.taken) continue;
      const pulse = 0.6 + Math.sin(time / 230) * 0.25;
      const g = ctx.createRadialGradient(pu.x, pu.y, 0, pu.x, pu.y, pu.r + 18);
      g.addColorStop(0, "rgba(150,240,255," + pulse + ")"); g.addColorStop(1, "rgba(80,200,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pu.x, pu.y, pu.r + 18, 0, 7); ctx.fill();
    }

    const f = Math.max(0.45, Math.min(1, 3.2 / (balls.length + 1)));
    for (const b of balls) {
      const lr = 250;
      const lg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, lr);
      lg.addColorStop(0, "rgba(255,225,160," + (0.85 * f) + ")");
      lg.addColorStop(0.18, "rgba(255,190,110," + (0.45 * f) + ")");
      lg.addColorStop(0.5, "rgba(255,150,70," + (0.14 * f) + ")");
      lg.addColorStop(1, "rgba(255,150,70,0)");
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(b.x, b.y, lr, 0, 7); ctx.fill();
    }

    // particles
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7);
      g.addColorStop(0, "rgba(" + p.glow + "," + a + ")"); g.addColorStop(1, "rgba(" + p.glow + ",0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill();
    }

    // hit flashes
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i]; const age = (time - fl.t0) / 1000;
      if (age > 0.5) { flashes.splice(i, 1); continue; }
      const rr = 18 + age * 130; const a = (1 - age / 0.5) * 0.7;
      ctx.strokeStyle = "rgba(" + fl.c + ",120," + a + ")"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(fl.x, fl.y, rr, 0, 7); ctx.stroke();
    }

    // sun cores + rays
    for (const b of balls) {
      const cg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R + 6);
      cg.addColorStop(0, "#ffffff"); cg.addColorStop(0.5, "#fff0b0"); cg.addColorStop(1, "#ffb347");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(b.x, b.y, R + 4, 0, 7); ctx.fill();
    }
    if (balls[0]) {
      const b = balls[0];
      ctx.strokeStyle = "rgba(255,210,120,0.85)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      const rot = time / 700;
      for (let i = 0; i < 8; i++) {
        const a = rot + (i * Math.PI) / 4, r1 = R + 7, r2 = R + 13 + Math.sin(time / 200 + i) * 3;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
        ctx.lineTo(b.x + Math.cos(a) * r2, b.y + Math.sin(a) * r2);
        ctx.stroke();
      }
    }

    // ---- slingshot aim (puzzle) ----
    ctx.globalCompositeOperation = "source-over";
    if (held && mode === "puzzle" && balls[0]) {
      const s = Math.hypot(aim.vx, aim.vy);
      if (s > 60) {
        // pull band
        ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(start[0], start[1]); ctx.lineTo(balls[0].x, balls[0].y); ctx.stroke();
        ctx.setLineDash([]);
        // trajectory preview
        drawTrajectory();
        // aim arrow
        const ax = aim.vx / s, ay = aim.vy / s;
        const len = 60 + (s / MAX_LAUNCH) * 150;
        const ex = start[0] + ax * len, ey = start[1] + ay * len;
        ctx.strokeStyle = "rgba(255,216,107,0.95)"; ctx.lineWidth = 5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(start[0], start[1]); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = "rgba(255,216,107,0.95)";
        ctx.beginPath();
        ctx.moveTo(ex + ax * 14, ey + ay * 14);
        ctx.lineTo(ex - ax * 10 - ay * 9, ey - ay * 10 + ax * 9);
        ctx.lineTo(ex - ax * 10 + ay * 9, ey - ay * 10 - ax * 9);
        ctx.fill();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawTrajectory() {
    const tb = { x: start[0], y: start[1], vx: aim.vx, vy: aim.vy };
    const dtp = 1 / 120; let bnc = 0;
    ctx.fillStyle = "rgba(255,236,180,0.5)";
    for (let i = 0; i < 320; i++) {
      const sp = Math.hypot(tb.vx, tb.vy);
      const sub = Math.max(1, Math.min(6, Math.ceil((sp * dtp) / (R * 0.6))));
      for (let k = 0; k < sub; k++) {
        tb.x += (tb.vx * dtp) / sub; tb.y += (tb.vy * dtp) / sub;
        let hit = false;
        for (const w of walls) if (segHit(tb, w, 1)) hit = true;
        for (const w of liveBars) if (segHit(tb, w, 1)) hit = true;
        for (const o of obstacles) if (circHit(tb, o.cx, o.cy, o.r, 1)) hit = true;
        if (hit) bnc++;
      }
      if (tb.x < -20 || tb.x > W + 20 || tb.y < -20 || tb.y > H + 20) break;
      if (bnc > 3) break;
      if (i % 5 === 0) { ctx.beginPath(); ctx.arc(tb.x, tb.y, 3, 0, 7); ctx.fill(); }
    }
  }

  // ----- Loop ---------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 1 / 30) dt = 1 / 30;
    clock = now / 1000;
    if (mode === "puzzle") tickMovers(clock);
    step(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  // ----- Boot ---------------------------------------------------------------
  const elTotal = $("sunTotal");
  if (elTotal) elTotal.textContent = LEVELS.length;
  $("sunPlayBtn").textContent = "▶ Play · " + LEVELS.length + " levels";
  resize();
  setSandbox();
  phase = "free";
  showOverlay(ovIntro);
  requestAnimationFrame(frame);
})();
