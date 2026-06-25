// sun.js — "Sunball": a throwable, light-emitting sun in a dark arena.
//
// Free play  : grab the sun with the mouse and fling it; it bounces with
//              gravity and lights up everything it passes.
// Play (5 lv): no gravity — suns fly straight and reflect off walls. Throw
//              from the start point and bounce around to touch every enemy.
//              Grab a ✦ split orb and the sun multiplies, so it's much
//              easier to sweep the room. Each sun burns out on its own after
//              its bounce budget; you only fail when every sun is gone with
//              enemies still standing (or a sun flies out of bounds and none
//              are left).

(function () {
  "use strict";

  const W = 960, H = 600;
  const canvas = document.getElementById("sunCanvas");
  const ctx = canvas.getContext("2d");

  const R = 15;            // sun radius
  const WALL_T = 12;
  const PAD = WALL_T / 2;
  const GRAB_R = 95;
  const HOLD_R = 72;
  const MAX_BALLS = 16;

  // ----- Arena helpers ------------------------------------------------------
  const M = 28, L = M, Rg = W - M, T = M, B = H - M;
  function box(extra) {
    return [[L, T, Rg, T], [Rg, T, Rg, B], [Rg, B, L, B], [L, B, L, T]].concat(extra || []);
  }
  function boxGapTop(gx1, gx2, extra) {
    return [
      [L, T, gx1, T], [gx2, T, Rg, T],
      [Rg, T, Rg, B], [Rg, B, L, B], [L, B, L, T]
    ].concat(extra || []);
  }

  // ----- Levels (now with split orbs + bigger bounce budgets) --------------
  const LEVELS = [
    {
      name: "Warm Up",
      walls: box(), obstacles: [],
      enemies: [[470, 110], [660, 300], [300, 300]],
      powerups: [[480, 450]],
      start: [150, 460], budget: 18
    },
    {
      name: "The Pillar",
      walls: box(), obstacles: [[480, 300, 56]],
      enemies: [[140, 140], [820, 140], [140, 460], [820, 460]],
      powerups: [[300, 300], [660, 300]],
      start: [480, 520], budget: 22
    },
    {
      name: "Mind the Gap",
      walls: boxGapTop(420, 540), obstacles: [],
      enemies: [[140, 200], [820, 200], [480, 440]],
      powerups: [[480, 300]],
      start: [480, 520], budget: 20
    },
    {
      name: "Zigzag",
      walls: box([[330, 120, 330, 360], [630, 240, 630, 480]]), obstacles: [],
      enemies: [[150, 300], [810, 300], [480, 110], [480, 490], [480, 300]],
      powerups: [[230, 480], [730, 150]],
      start: [150, 520], budget: 26
    },
    {
      name: "Bumper Room",
      walls: box(), obstacles: [[300, 300, 46], [660, 300, 46]],
      enemies: [[140, 140], [820, 140], [140, 460], [820, 460], [480, 110], [480, 490]],
      powerups: [[480, 300], [480, 150]],
      start: [480, 540], budget: 30
    }
  ];

  // ----- State --------------------------------------------------------------
  let mode = "sandbox";
  let phase = "intro";
  let levelIndex = 0;
  let walls = box(), obstacles = [], enemies = [], powerups = [], start = [W / 2, H / 2], budget = 0;
  let attemptStart = 0;
  let balls = [];            // {x,y,vx,vy,bounces}
  let held = false;
  const samples = [];
  let aim = { vx: 0, vy: 0 };
  const flashes = [];
  let overlayTimer = null;

  const makeBall = (x, y, vx, vy) => ({ x, y, vx: vx || 0, vy: vy || 0, bounces: 0 });

  // ----- DOM ----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const hud = $("sunHud"), chip = $("sunChip"), hint = $("sunHint");
  const elLevel = $("sunLevel"), elEnemies = $("sunEnemies"), elBalls = $("sunBalls"),
    elBounces = $("sunBounces"), elBudget = $("sunBudget");
  const ovIntro = $("sunIntro"), ovWin = $("sunWin"), ovFail = $("sunFail"), ovClear = $("sunClear");
  function hideOverlays() { [ovIntro, ovWin, ovFail, ovClear].forEach((o) => (o.hidden = true)); }
  function showOverlay(ov) { hideOverlays(); ov.hidden = false; }

  // ----- Geometry -----------------------------------------------------------
  function closestOnSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return [x1 + t * dx, y1 + t * dy];
  }

  // ----- Mode setup ---------------------------------------------------------
  function setSandbox() {
    mode = "sandbox"; phase = "free";
    walls = box(); obstacles = []; enemies = []; powerups = [];
    balls = [makeBall(W / 2, H * 0.4)];
    held = false; flashes.length = 0;
    hud.hidden = true; chip.textContent = "✨ free play";
    hint.textContent = "Drag the sun and let go to throw. Fling it fast — it bounces and lights up the room.";
    clearTimeout(overlayTimer); hideOverlays();
  }

  function startPuzzle() { mode = "puzzle"; hud.hidden = false; loadLevel(0); }

  function loadLevel(i) {
    levelIndex = i;
    const lv = LEVELS[i];
    walls = lv.walls; obstacles = lv.obstacles;
    enemies = lv.enemies.map(([x, y]) => ({ x, y, r: 14, dead: false }));
    powerups = (lv.powerups || []).map(([x, y]) => ({ x, y, r: 16, taken: false }));
    start = lv.start.slice(); budget = lv.budget;
    balls = [makeBall(start[0], start[1])];
    held = false; flashes.length = 0;
    phase = "aim";
    chip.textContent = "▶ level " + (i + 1);
    hint.textContent = "Fling the sun and bounce it off the walls. Grab a ✦ orb to split into more suns!";
    clearTimeout(overlayTimer); hideOverlays();
    updateHud();
  }

  function maxBounces() { return balls.reduce((m, b) => Math.max(m, b.bounces), 0); }
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
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }
  function pushSample(p) {
    const now = performance.now();
    samples.push({ x: p.x, y: p.y, t: now });
    while (samples.length && now - samples[0].t > 120) samples.shift();
  }
  function throwVelocity() {
    if (samples.length < 2) return { vx: 0, vy: 0 };
    const last = samples[samples.length - 1];
    let ref = samples[0];
    for (let i = samples.length - 1; i >= 0; i--) {
      if (last.t - samples[i].t >= 60) { ref = samples[i]; break; }
    }
    const dt = (last.t - ref.t) / 1000 || 0.016;
    return { vx: (last.x - ref.x) / dt, vy: (last.y - ref.y) / dt };
  }
  function clampSpeed(v, max) {
    const s = Math.hypot(v.vx, v.vy);
    if (s > max) { v.vx = v.vx / s * max; v.vy = v.vy / s * max; }
    return v;
  }

  function aimBall() { return balls[0]; }

  function onDown(e) {
    if (phase !== "free" && phase !== "aim") return;
    const b = aimBall(); if (!b) return;
    const p = toCanvas(e);
    if (Math.hypot(p.x - b.x, p.y - b.y) > GRAB_R) return;
    held = true; canvas.classList.add("grabbing");
    samples.length = 0; pushSample(p);
    b.vx = b.vy = 0;
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
    } else {
      const dx = p.x - start[0], dy = p.y - start[1];
      const d = Math.hypot(dx, dy);
      const k = d > HOLD_R ? HOLD_R / d : 1;
      b.x = start[0] + dx * k; b.y = start[1] + dy * k;
    }
    const v = throwVelocity(); aim.vx = v.vx; aim.vy = v.vy;
  }
  function onUp() {
    if (!held) return;
    held = false; canvas.classList.remove("grabbing");
    const b = aimBall(); if (!b) return;
    const v = clampSpeed(throwVelocity(), mode === "sandbox" ? 2600 : 1800);
    if (mode === "sandbox") { b.vx = v.vx; b.vy = v.vy; return; }
    if (Math.hypot(v.vx, v.vy) < 80) { b.x = start[0]; b.y = start[1]; return; }
    b.vx = v.vx; b.vy = v.vy; b.bounces = 0;
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

  // ----- Physics ------------------------------------------------------------
  function reflect(b, nx, ny, rest) {
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny; return true; }
    return false;
  }

  function collide(b) {
    const rest = mode === "sandbox" ? 0.82 : 1.0;
    let bounced = false;

    for (const w of walls) {
      const [cx, cy] = closestOnSeg(b.x, b.y, w[0], w[1], w[2], w[3]);
      let dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      const min = R + PAD;
      if (d < min) {
        if (d < 0.01) { dx = 0; dy = -1; d = 1; }
        const nx = dx / d, ny = dy / d;
        b.x += nx * (min - d); b.y += ny * (min - d);
        if (reflect(b, nx, ny, rest)) bounced = true;
      }
    }
    for (const o of obstacles) {
      let dx = b.x - o[0], dy = b.y - o[1], d = Math.hypot(dx, dy);
      const min = R + o[2];
      if (d < min) {
        if (d < 0.01) { dx = 0; dy = -1; d = 1; }
        const nx = dx / d, ny = dy / d;
        b.x += nx * (min - d); b.y += ny * (min - d);
        if (reflect(b, nx, ny, rest)) bounced = true;
      }
    }
    if (bounced && mode === "puzzle") b.bounces++;

    for (const en of enemies) {
      if (en.dead) continue;
      if (Math.hypot(b.x - en.x, b.y - en.y) < R + en.r) {
        en.dead = true;
        flashes.push({ x: en.x, y: en.y, t0: performance.now(), c: "200,120" });
      }
    }
    // split orbs
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

  // turn one sun into three: original keeps going, two peel off at ±28°
  function splitBall(b) {
    const speed = Math.hypot(b.vx, b.vy) || 600;
    let ang = Math.atan2(b.vy, b.vx);
    const spread = 0.49; // ~28°
    for (const da of [-spread, spread]) {
      if (balls.length >= MAX_BALLS) break;
      const a = ang + da;
      const nb = makeBall(b.x, b.y, Math.cos(a) * speed, Math.sin(a) * speed);
      nb.bounces = b.bounces;
      balls.push(nb);
    }
  }

  function stepBall(b, dt) {
    if (mode === "sandbox") {
      b.vy += 1700 * dt;
      b.vx *= Math.pow(0.86, dt);
      b.vy *= Math.pow(0.92, dt);
    } else {
      clampSpeed(b, 1900);
    }
    const speed = Math.hypot(b.vx, b.vy);
    const sub = Math.max(1, Math.min(16, Math.ceil((speed * dt) / (R * 0.6))));
    for (let i = 0; i < sub; i++) {
      b.x += (b.vx * dt) / sub;
      b.y += (b.vy * dt) / sub;
      collide(b);
      if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) break;
    }
  }

  function step(dt) {
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

    // retire suns that left the arena, burned through their bounces, or stalled
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      const out = b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30;
      const spent = b.bounces > budget;
      const stalled = Math.hypot(b.vx, b.vy) < 6;
      if (out || spent || stalled) balls.splice(i, 1);
    }
    updateHud();

    const alive = enemies.filter((e) => !e.dead).length;
    if (alive === 0) return finish(true);
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
      overlayTimer = setTimeout(() => showOverlay(ovWin), 550);
    } else {
      phase = "fail";
      $("sunFailMsg").textContent = reason || "Some enemies are still standing.";
      const left = enemies.filter((e) => !e.dead).length;
      $("sunFailTitle").textContent = left === 0 ? "So close!" : "Missed a few.";
      overlayTimer = setTimeout(() => showOverlay(ovFail), 550);
    }
    updateHud();
  }

  // ----- Rendering ----------------------------------------------------------
  function draw(time) {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#06060c";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let x = 60; x < W; x += 60) for (let y = 60; y < H; y += 60) ctx.fillRect(x, y, 2, 2);

    ctx.strokeStyle = "#262642"; ctx.lineWidth = WALL_T; ctx.lineCap = "round";
    for (const w of walls) { ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); ctx.stroke(); }
    for (const o of obstacles) {
      ctx.fillStyle = "#262642"; ctx.beginPath(); ctx.arc(o[0], o[1], o[2], 0, 7); ctx.fill();
      ctx.fillStyle = "#1a1a30"; ctx.beginPath(); ctx.arc(o[0], o[1], o[2] - 6, 0, 7); ctx.fill();
    }

    if (mode === "puzzle" && phase === "aim") {
      const pr = 22 + Math.sin(time / 260) * 4;
      ctx.strokeStyle = "rgba(255,216,107,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(start[0], start[1], pr, 0, 7); ctx.stroke();
    }

    for (const en of enemies) {
      if (en.dead) continue;
      ctx.fillStyle = "#3a1622"; ctx.beginPath(); ctx.arc(en.x, en.y, en.r, 0, 7); ctx.fill();
    }

    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // ---- additive light pass ----
    ctx.globalCompositeOperation = "lighter";

    // nearest sun distance helper for enemy/orb lighting
    const nearest = (x, y) => {
      let m = 1e9;
      for (const b of balls) m = Math.min(m, Math.hypot(x - b.x, y - b.y));
      return m;
    };

    for (const en of enemies) {
      if (en.dead) continue;
      const lit = Math.max(0, 1 - nearest(en.x, en.y) / 260);
      const a = 0.25 + lit * 0.6;
      const g = ctx.createRadialGradient(en.x, en.y, 0, en.x, en.y, en.r + 14);
      g.addColorStop(0, "rgba(255,120,90," + a + ")");
      g.addColorStop(1, "rgba(255,80,90,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 14, 0, 7); ctx.fill();
    }

    // split orbs (cyan), pulsing
    for (const pu of powerups) {
      if (pu.taken) continue;
      const pulse = 0.6 + Math.sin(time / 230) * 0.25;
      const g = ctx.createRadialGradient(pu.x, pu.y, 0, pu.x, pu.y, pu.r + 16);
      g.addColorStop(0, "rgba(150,240,255," + pulse + ")");
      g.addColorStop(1, "rgba(80,200,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pu.x, pu.y, pu.r + 16, 0, 7); ctx.fill();
    }

    // light pools — dim a bit when there are lots of suns so it doesn't blow out
    const lr = 250;
    const f = Math.max(0.45, Math.min(1, 3.2 / (balls.length + 1)));
    for (const b of balls) {
      const lg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, lr);
      lg.addColorStop(0, "rgba(255,225,160," + (0.85 * f) + ")");
      lg.addColorStop(0.18, "rgba(255,190,110," + (0.45 * f) + ")");
      lg.addColorStop(0.5, "rgba(255,150,70," + (0.14 * f) + ")");
      lg.addColorStop(1, "rgba(255,150,70,0)");
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(b.x, b.y, lr, 0, 7); ctx.fill();
    }

    // hit flashes
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i]; const age = (time - fl.t0) / 1000;
      if (age > 0.5) { flashes.splice(i, 1); continue; }
      const rr = 18 + age * 120; const a = (1 - age / 0.5) * 0.7;
      ctx.strokeStyle = "rgba(" + (fl.c || "255,210") + ",120," + a + ")"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(fl.x, fl.y, rr, 0, 7); ctx.stroke();
    }

    // sun cores
    for (const b of balls) {
      const cg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R + 6);
      cg.addColorStop(0, "#ffffff"); cg.addColorStop(0.5, "#fff0b0"); cg.addColorStop(1, "#ffb347");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(b.x, b.y, R + 4, 0, 7); ctx.fill();
    }

    // rays only on the first/primary sun (keeps it readable with many balls)
    if (balls[0]) {
      const b = balls[0];
      ctx.strokeStyle = "rgba(255,210,120,0.85)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      const rot = time / 700;
      for (let i = 0; i < 8; i++) {
        const a = rot + (i * Math.PI) / 4;
        const r1 = R + 7, r2 = R + 13 + Math.sin(time / 200 + i) * 3;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
        ctx.lineTo(b.x + Math.cos(a) * r2, b.y + Math.sin(a) * r2);
        ctx.stroke();
      }
    }

    // aim arrow while holding
    ctx.globalCompositeOperation = "source-over";
    if (held && balls[0]) {
      const b = balls[0];
      const s = Math.hypot(aim.vx, aim.vy);
      if (s > 40) {
        const len = Math.min(150, s * 0.06);
        const ax = aim.vx / s, ay = aim.vy / s;
        const ex = b.x + ax * len, ey = b.y + ay * len;
        ctx.strokeStyle = "rgba(255,216,107,0.8)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = "rgba(255,216,107,0.9)";
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ax * 12 - ay * 7, ey - ay * 12 + ax * 7);
        ctx.lineTo(ex - ax * 12 + ay * 7, ey - ay * 12 - ax * 7);
        ctx.fill();
      }
    }
  }

  // ----- Loop ---------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 1 / 30) dt = 1 / 30;
    step(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  // ----- Boot ---------------------------------------------------------------
  setSandbox();
  phase = "free";
  showOverlay(ovIntro);
  requestAnimationFrame(frame);
})();
