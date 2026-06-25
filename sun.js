// sun.js — "Sunball": a throwable, light-emitting sun in a dark arena.
//
// Free play  : grab the sun with the mouse and fling it; it bounces with
//              gravity and lights up everything it passes.
// Play (5 lv): no gravity — the sun flies straight and reflects off walls.
//              Throw it from the start point and bounce it around to touch
//              every enemy in ONE throw. Leave the arena or exceed the
//              bounce budget and the level resets.

(function () {
  "use strict";

  const W = 960, H = 600;
  const canvas = document.getElementById("sunCanvas");
  const ctx = canvas.getContext("2d");

  const R = 15;            // sun radius
  const WALL_T = 12;       // wall thickness (visual)
  const PAD = WALL_T / 2;  // collision padding
  const GRAB_R = 95;
  const HOLD_R = 72;       // how far you can pull the sun from the start point

  // ----- Arena helpers ------------------------------------------------------
  const M = 28, L = M, Rg = W - M, T = M, B = H - M;
  function box(extra) { // four boundary walls; `extra` merges in more segments
    return [
      [L, T, Rg, T], [Rg, T, Rg, B], [Rg, B, L, B], [L, B, L, T]
    ].concat(extra || []);
  }
  // top wall with a gap between gx1..gx2 (an opening you can fly out of)
  function boxGapTop(gx1, gx2, extra) {
    return [
      [L, T, gx1, T], [gx2, T, Rg, T],
      [Rg, T, Rg, B], [Rg, B, L, B], [L, B, L, T]
    ].concat(extra || []);
  }

  // ----- Levels -------------------------------------------------------------
  const LEVELS = [
    {
      name: "Warm Up",
      walls: box(),
      obstacles: [],
      enemies: [[470, 110], [660, 300], [300, 300]],
      start: [150, 460], budget: 10
    },
    {
      name: "The Pillar",
      walls: box(),
      obstacles: [[480, 300, 56]],
      enemies: [[140, 140], [820, 140], [140, 460], [820, 460]],
      start: [480, 520], budget: 14
    },
    {
      name: "Mind the Gap",
      walls: boxGapTop(420, 540),
      obstacles: [],
      enemies: [[140, 200], [820, 200], [480, 440]],
      start: [480, 520], budget: 12
    },
    {
      name: "Zigzag",
      walls: box([[330, 120, 330, 360], [630, 240, 630, 480]]),
      obstacles: [],
      enemies: [[150, 300], [810, 300], [480, 110], [480, 490], [480, 300]],
      start: [150, 520], budget: 16
    },
    {
      name: "Bumper Room",
      walls: box(),
      obstacles: [[300, 300, 46], [660, 300, 46]],
      enemies: [[140, 140], [820, 140], [140, 460], [820, 460], [480, 110], [480, 490]],
      start: [480, 540], budget: 18
    }
  ];

  // ----- State --------------------------------------------------------------
  let mode = "sandbox";     // sandbox | puzzle
  let phase = "intro";      // intro | free | aim | live | win | fail | clear
  let levelIndex = 0;
  let walls = box(), obstacles = [], enemies = [], start = [W / 2, H / 2], budget = 0;
  let bounces = 0, attemptStart = 0;
  const sun = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  let held = false;
  const samples = [];       // recent pointer positions for throw velocity
  let aim = { vx: 0, vy: 0 };
  const flashes = [];       // enemy hit pops
  let overlayTimer = null;

  // ----- DOM ----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const hud = $("sunHud"), chip = $("sunChip"), hint = $("sunHint");
  const elLevel = $("sunLevel"), elEnemies = $("sunEnemies"), elBounces = $("sunBounces"), elBudget = $("sunBudget");
  const ovIntro = $("sunIntro"), ovWin = $("sunWin"), ovFail = $("sunFail"), ovClear = $("sunClear");

  function hideOverlays() { [ovIntro, ovWin, ovFail, ovClear].forEach((o) => (o.hidden = true)); }

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
    walls = box(); obstacles = []; enemies = [];
    sun.x = W / 2; sun.y = H * 0.4; sun.vx = 0; sun.vy = 0;
    held = false; flashes.length = 0;
    hud.hidden = true; chip.textContent = "✨ free play";
    hint.textContent = "Drag the sun and let go to throw. Fling it fast — it bounces and lights up the room.";
    clearTimeout(overlayTimer); hideOverlays();
  }

  function startPuzzle() {
    mode = "puzzle"; levelIndex = 0; hud.hidden = false;
    loadLevel(0);
  }

  function loadLevel(i) {
    levelIndex = i;
    const lv = LEVELS[i];
    walls = lv.walls; obstacles = lv.obstacles;
    enemies = lv.enemies.map(([x, y]) => ({ x, y, r: 14, dead: false }));
    start = lv.start.slice(); budget = lv.budget;
    sun.x = start[0]; sun.y = start[1]; sun.vx = sun.vy = 0;
    bounces = 0; held = false; flashes.length = 0;
    phase = "aim";
    chip.textContent = "▶ level " + (i + 1);
    hint.textContent = "Grab the sun and fling it. Bounce off walls to hit every enemy in one throw.";
    clearTimeout(overlayTimer); hideOverlays();
    updateHud();
  }

  function updateHud() {
    elLevel.textContent = levelIndex + 1;
    elEnemies.textContent = enemies.filter((e) => !e.dead).length;
    elBounces.textContent = bounces;
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
    for (let i = samples.length - 1; i >= 0; i--) { // a sample ~70ms back
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

  function onDown(e) {
    if (phase !== "free" && phase !== "aim") return;
    const p = toCanvas(e);
    if (Math.hypot(p.x - sun.x, p.y - sun.y) > GRAB_R) return;
    held = true;
    canvas.classList.add("grabbing");
    samples.length = 0; pushSample(p);
    sun.vx = sun.vy = 0;
    e.preventDefault();
  }
  function onMove(e) {
    if (!held) return;
    const p = toCanvas(e);
    pushSample(p);
    if (mode === "sandbox") {
      sun.x = Math.max(L + R, Math.min(Rg - R, p.x));
      sun.y = Math.max(T + R, Math.min(B - R, p.y));
    } else { // puzzle: tethered near the start point
      const dx = p.x - start[0], dy = p.y - start[1];
      const d = Math.hypot(dx, dy);
      const k = d > HOLD_R ? HOLD_R / d : 1;
      sun.x = start[0] + dx * k;
      sun.y = start[1] + dy * k;
    }
    const v = throwVelocity(); aim.vx = v.vx; aim.vy = v.vy;
  }
  function onUp() {
    if (!held) return;
    held = false; canvas.classList.remove("grabbing");
    const v = clampSpeed(throwVelocity(), mode === "sandbox" ? 2600 : 1800);
    if (mode === "sandbox") {
      sun.vx = v.vx; sun.vy = v.vy;
    } else {
      if (Math.hypot(v.vx, v.vy) < 80) { // too soft — reset to start
        sun.x = start[0]; sun.y = start[1];
        return;
      }
      sun.vx = v.vx; sun.vy = v.vy;
      bounces = 0; phase = "live"; attemptStart = performance.now();
    }
  }

  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  // buttons
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

  function showOverlay(ov) { hideOverlays(); ov.hidden = false; }

  // ----- Physics ------------------------------------------------------------
  function reflect(nx, ny, rest) {
    const vn = sun.vx * nx + sun.vy * ny;
    if (vn < 0) {
      sun.vx -= (1 + rest) * vn * nx;
      sun.vy -= (1 + rest) * vn * ny;
      return true;
    }
    return false;
  }

  function collide() {
    const rest = mode === "sandbox" ? 0.82 : 1.0;
    let bounced = false;

    for (const w of walls) {
      const [cx, cy] = closestOnSeg(sun.x, sun.y, w[0], w[1], w[2], w[3]);
      let dx = sun.x - cx, dy = sun.y - cy;
      let d = Math.hypot(dx, dy);
      const min = R + PAD;
      if (d < min) {
        if (d < 0.01) { dx = 0; dy = -1; d = 1; }
        const nx = dx / d, ny = dy / d;
        sun.x += nx * (min - d); sun.y += ny * (min - d);
        if (reflect(nx, ny, rest)) bounced = true;
      }
    }
    for (const o of obstacles) {
      let dx = sun.x - o[0], dy = sun.y - o[1];
      let d = Math.hypot(dx, dy);
      const min = R + o[2];
      if (d < min) {
        if (d < 0.01) { dx = 0; dy = -1; d = 1; }
        const nx = dx / d, ny = dy / d;
        sun.x += nx * (min - d); sun.y += ny * (min - d);
        if (reflect(nx, ny, rest)) bounced = true;
      }
    }
    if (bounced && mode === "puzzle") bounces++;

    for (const en of enemies) {
      if (en.dead) continue;
      if (Math.hypot(sun.x - en.x, sun.y - en.y) < R + en.r) {
        en.dead = true;
        flashes.push({ x: en.x, y: en.y, t0: performance.now() });
      }
    }
  }

  function step(dt) {
    if (held) return;
    if (mode === "puzzle" && phase !== "live") return;
    if (mode === "sandbox" && phase !== "free") return;

    if (mode === "sandbox") {
      sun.vy += 1700 * dt;
      sun.vx *= Math.pow(0.86, dt);   // gentle air drag so throws stay lively
      sun.vy *= Math.pow(0.92, dt);
    } else {
      clampSpeed(sun, 1900);
    }

    const speed = Math.hypot(sun.vx, sun.vy);
    const sub = Math.max(1, Math.min(16, Math.ceil((speed * dt) / (R * 0.6))));
    for (let i = 0; i < sub; i++) {
      sun.x += (sun.vx * dt) / sub;
      sun.y += (sun.vy * dt) / sub;
      collide();
      if (sun.x < -40 || sun.x > W + 40 || sun.y < -40 || sun.y > H + 40) break;
    }

    if (mode === "puzzle" && phase === "live") {
      updateHud();
      const out = sun.x < -30 || sun.x > W + 30 || sun.y < -30 || sun.y > H + 30;
      const alive = enemies.filter((e) => !e.dead).length;
      if (alive === 0) return finish(true);
      if (out) return finish(false, "The sun flew out of bounds.");
      if (bounces > budget) return finish(false, "Too many bounces — out of energy.");
      if (performance.now() - attemptStart > 16000) return finish(false, "The sun ran out of momentum.");
      if (speed < 6) return finish(false, "The sun fizzled out.");
    } else if (mode === "sandbox") {
      // keep it in the box and let it rest
      if (Math.abs(sun.vx) < 4 && Math.abs(sun.vy) < 4 && sun.y > B - R - 2) { sun.vx *= 0.9; }
    }
  }

  const WIN_MSGS = ["Every enemy, one throw. Beautiful.", "Bank shot of the century.", "The sun says: easy.", "Flawless. Did you even try?"];
  function finish(won, reason) {
    sun.vx = sun.vy = 0;
    if (won) {
      phase = "win";
      $("sunWinTitle").textContent = "Level cleared! ☀";
      $("sunWinMsg").textContent = WIN_MSGS[Math.floor(Math.random() * WIN_MSGS.length)];
      if (levelIndex + 1 >= LEVELS.length) {
        $("sunNextBtn").textContent = "Finish →";
      } else {
        $("sunNextBtn").textContent = "Next level →";
      }
      overlayTimer = setTimeout(() => showOverlay(ovWin), 550);
    } else {
      phase = "fail";
      $("sunFailMsg").textContent = reason || "Some enemies are still standing.";
      const left = enemies.filter((e) => !e.dead).length;
      $("sunFailTitle").textContent = left === 0 ? "So close!" : "Missed it.";
      overlayTimer = setTimeout(() => showOverlay(ovFail), 550);
    }
    updateHud();
  }

  // ----- Rendering ----------------------------------------------------------
  function draw(time) {
    // base scene
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#06060c";
    ctx.fillRect(0, 0, W, H);

    // faint floor dots for spatial reference
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let x = 60; x < W; x += 60) for (let y = 60; y < H; y += 60) { ctx.fillRect(x, y, 2, 2); }

    // walls
    ctx.strokeStyle = "#262642";
    ctx.lineWidth = WALL_T; ctx.lineCap = "round";
    for (const w of walls) { ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); ctx.stroke(); }
    // obstacles
    for (const o of obstacles) {
      ctx.fillStyle = "#262642";
      ctx.beginPath(); ctx.arc(o[0], o[1], o[2], 0, 7); ctx.fill();
      ctx.fillStyle = "#1a1a30";
      ctx.beginPath(); ctx.arc(o[0], o[1], o[2] - 6, 0, 7); ctx.fill();
    }

    // start marker (aim)
    if (mode === "puzzle" && phase === "aim") {
      const pr = 22 + Math.sin(time / 260) * 4;
      ctx.strokeStyle = "rgba(255,216,107,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(start[0], start[1], pr, 0, 7); ctx.stroke();
    }

    // enemy bodies (dark)
    for (const en of enemies) {
      if (en.dead) continue;
      ctx.fillStyle = "#3a1622";
      ctx.beginPath(); ctx.arc(en.x, en.y, en.r, 0, 7); ctx.fill();
    }

    // vignette to deepen the dark at the edges
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // ---- additive light pass ----
    ctx.globalCompositeOperation = "lighter";

    // enemy glints so they're visible in the dark + brighter when lit
    for (const en of enemies) {
      if (en.dead) continue;
      const dl = Math.hypot(en.x - sun.x, en.y - sun.y);
      const lit = Math.max(0, 1 - dl / 260);
      const a = 0.25 + lit * 0.6;
      const g = ctx.createRadialGradient(en.x, en.y, 0, en.x, en.y, en.r + 14);
      g.addColorStop(0, "rgba(255,120,90," + a + ")");
      g.addColorStop(1, "rgba(255,80,90,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 14, 0, 7); ctx.fill();
    }

    // the sun's big warm light pool
    const lr = 260;
    const lg = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, lr);
    lg.addColorStop(0, "rgba(255,225,160,0.85)");
    lg.addColorStop(0.18, "rgba(255,190,110,0.45)");
    lg.addColorStop(0.5, "rgba(255,150,70,0.14)");
    lg.addColorStop(1, "rgba(255,150,70,0)");
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(sun.x, sun.y, lr, 0, 7); ctx.fill();

    // hit flashes
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]; const age = (time - f.t0) / 1000;
      if (age > 0.5) { flashes.splice(i, 1); continue; }
      const rr = 18 + age * 120; const a = (1 - age / 0.5) * 0.7;
      ctx.strokeStyle = "rgba(255,210,120," + a + ")"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, 7); ctx.stroke();
    }

    // sun core
    const cg = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, R + 6);
    cg.addColorStop(0, "#ffffff"); cg.addColorStop(0.5, "#fff0b0"); cg.addColorStop(1, "#ffb347");
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(sun.x, sun.y, R + 4, 0, 7); ctx.fill();

    // rotating rays
    ctx.strokeStyle = "rgba(255,210,120,0.85)"; ctx.lineWidth = 3; ctx.lineCap = "round";
    const rot = time / 700;
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4;
      const r1 = R + 7, r2 = R + 13 + Math.sin(time / 200 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(sun.x + Math.cos(a) * r1, sun.y + Math.sin(a) * r1);
      ctx.lineTo(sun.x + Math.cos(a) * r2, sun.y + Math.sin(a) * r2);
      ctx.stroke();
    }

    // aim arrow while holding
    ctx.globalCompositeOperation = "source-over";
    if (held) {
      const s = Math.hypot(aim.vx, aim.vy);
      if (s > 40) {
        const len = Math.min(150, s * 0.06);
        const ax = aim.vx / s, ay = aim.vy / s;
        const ex = sun.x + ax * len, ey = sun.y + ay * len;
        ctx.strokeStyle = "rgba(255,216,107,0.8)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sun.x, sun.y); ctx.lineTo(ex, ey); ctx.stroke();
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
  setSandbox();          // sun is alive & throwable behind the intro panel
  phase = "free";
  showOverlay(ovIntro);  // ...but show the mode picker on top
  requestAnimationFrame(frame);
})();
