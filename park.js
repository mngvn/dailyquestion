// park.js — "Drift Park". A level-based precision-drifting game.
//
// One idea per spot: build up speed on the approach, kick the handbrake to
// break the rear tires loose, and let the slide swing the car around so it
// settles DEAD-CENTER inside a marked parking bay — pointed the right way and
// stopped. The physics are the same "bicycle with tire grip" model as Drift
// King (velocity split into a forward + lateral component in the car's own
// frame, tires bleeding off the lateral part; the handbrake drops that grip so
// the tail steps out). Here the reward isn't a lap time, it's how cleanly the
// car comes to rest between the lines.
//
// Every bay can be earned by simply parking in it, but the full ★★★ needs a
// genuine drift: enter fast, hold a real slip angle, and land it centered.
// Parked-car neighbours and walls punish a sloppy line. Stars are saved.

(function () {
  "use strict";

  const canvas = document.getElementById("parkCanvas");
  const ctx = canvas.getContext("2d");

  // ---- helpers ---------------------------------------------------------------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rad = (deg) => (deg * Math.PI) / 180;
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  // smallest heading error to a bay's axis — a car parks nose-in OR tail-in, so
  // we fold the error into [0, PI/2]: being 180° off is still "aligned".
  function alignErr(h, axis) {
    let d = Math.abs(angDiff(h, axis));
    if (d > Math.PI / 2) d = Math.PI - d;
    return d;
  }
  const $ = (id) => document.getElementById(id);

  // ---- world -----------------------------------------------------------------
  const WORLD_W = 1500, WORLD_H = 1080;

  // ---- car physics constants (shared feel with Drift King) -------------------
  // A bigger, heavier car: less snatchy accel/brake, slower steering and weight
  // transfer, so momentum carries and a slide has to be set up deliberately.
  const ACCEL = 560;
  const BOOST_ACCEL = 250;    // extra nose push while power-sliding on the gas
  const BRAKE = 900;
  const REV_ACCEL = 340, REV_MAX = 165;
  const DRAG1 = 0.9, DRAG2 = 0.0016;
  // Slightly slippery lot: less lateral tire grip, so once the tail steps out
  // it stays out — slides carry further before the tires re-hook.
  const GRIP_ROAD = 8.0;
  const GRIP_DRIFT = 2.3;
  const GRIP_HAND = 1.35;
  const TURN_RATE = 2.3;
  const TURN_DRIFT = 1.4;
  const HAND_DECEL = 150;
  const SLIP_MIN = 0.26;
  const SLIP_MAX = 1.15;
  const ALIGN_HAND = 1.1;
  const ALIGN_ROAD = 2.8;     // nose re-centers a touch lazier, holding the slide
  const DRIFT_SPEED_MIN = 100;
  const STEER_RESP = 7;       // how fast the wheels turn (lower = heavier)
  const YAW_RESP = 8.5;       // how fast the body follows the wheels
  const CAR_L = 58, CAR_HW = 13;  // bigger body — reads chunkier up close
  const CAR_R = 14;               // per-node collision radius…
  const NODE_D = CAR_L * 0.30;    // …two nodes (a capsule) so the long body
                                  //   can't clip neighbours nose-first
  const KMH = 0.45;

  // ---- scoring / settle ------------------------------------------------------
  const SETTLE_SPEED = 26;    // px/s: below this the car counts as "stopped"
  const SETTLE_HOLD = 0.55;   // seconds seated + stopped before the spot locks
  // You can't just roll straight in — the spot only locks if you DRIFT in.
  const DRIFT_IN_SLIP = 0.30; // rad of slip near the bay that counts as sideways
  const DRIFT_IN_GRACE = 2.2; // a qualifying slide arms the lock for this long

  // ---- levels ----------------------------------------------------------------
  // Each level places the car at a start and a bay somewhere across the lot.
  // Neighbour cars (sides) and a back wall are derived from the bay's own frame
  // in buildLevel(), so a bay is always a believable slot in a row.
  //   a: heading in degrees (0 = facing +x / right, -90 = facing up)
  //   halfL: half the bay length (along its facing), halfW: half its width
  const LEVELS = [
    { name: "Pull-In", hint: "Floor it, then tap the handbrake to slide to a stop in the bay.",
      car: { x: 760, y: 930, a: -90 }, bay: { x: 760, y: 380, a: -90 },
      halfL: 50, halfW: 30, sides: false, back: false },
    { name: "Ninety Left", hint: "Build speed, then flick left — let the slide swing you square into the slot.",
      car: { x: 860, y: 900, a: -90 }, bay: { x: 470, y: 470, a: 180 },
      halfL: 48, halfW: 26, sides: true, back: false },
    { name: "Ninety Right", hint: "Same idea, other way — carry pace and drift right between the cars.",
      car: { x: 640, y: 900, a: -90 }, bay: { x: 1030, y: 470, a: 0 },
      halfL: 48, halfW: 25, sides: true, back: true },
    { name: "Reverse Flick", hint: "Come in hot and over-rotate — swing the tail around to back it in.",
      car: { x: 760, y: 910, a: -90 }, bay: { x: 760, y: 360, a: 90 },
      halfL: 50, halfW: 26, sides: true, back: true },
    { name: "Tight Squeeze", hint: "Narrow slot. Judge the entry, hold one clean slide, settle it centered.",
      car: { x: 930, y: 930, a: -90 }, bay: { x: 430, y: 440, a: 180 },
      halfL: 46, halfW: 22, sides: true, back: true },
    { name: "The Pro Spot", hint: "Long run-up, tiny bay, no room for error. Drift it home.",
      car: { x: 760, y: 990, a: -90 }, bay: { x: 760, y: 300, a: 90 },
      halfL: 46, halfW: 21, sides: true, back: true },
  ];

  // ---- state -----------------------------------------------------------------
  const car = {
    x: 0, y: 0, h: 0,
    vx: 0, vy: 0, w: 0,
    steer: 0, grip: GRIP_ROAD,
    slip: 0, drifting: false, boosting: false,
    skidL: null, skidR: null,
  };
  const cam = { x: 0, y: 0, z: 1, shake: 0 };
  const game = {
    state: "intro",          // intro | play | done
    level: 0,
    bay: null,               // { x, y, a, halfL, halfW }
    obstacles: [],           // oriented rects (neighbour cars + walls + arena)
    settle: 0,               // seconds seated + stopped
    driftIn: 0,              // countdown armed by a slide near the bay
    peakSlip: 0, maxSpeed: 0, entrySpeed: 0, bumps: 0,
    t: 0,
  };

  // best stars per level, persisted
  let stars = LEVELS.map(() => 0);
  try {
    const raw = JSON.parse(localStorage.getItem("park.stars") || "[]");
    if (Array.isArray(raw)) stars = LEVELS.map((_, i) => Math.max(0, Math.min(3, +raw[i] || 0)));
  } catch (e) { /* ignore */ }
  const totalStars = () => stars.reduce((a, b) => a + b, 0);
  const isUnlocked = (i) => i === 0 || stars[i - 1] > 0;

  const smoke = [];
  const popups = [];

  // ---- level construction ----------------------------------------------------
  // oriented rect obstacle: center (x,y), axis angle a, half extents hx (along
  // the facing axis) and hy (across it), plus a kind for how it's drawn.
  function rect(x, y, a, hx, hy, kind) {
    return { x, y, a, hx, hy, kind };
  }

  function buildLevel(i) {
    const L = LEVELS[i];
    game.level = i;
    game.bay = { x: L.bay.x, y: L.bay.y, a: rad(L.bay.a), halfL: L.halfL, halfW: L.halfW };
    const b = game.bay;
    const fx = Math.cos(b.a), fy = Math.sin(b.a);      // along bay facing (length)
    const sx = -Math.sin(b.a), sy = Math.cos(b.a);     // across bay (width)
    const obs = [];

    // neighbour cars sit alongside the bay across its width axis, one bay-width
    // + a small gap away on each flagged side.
    if (L.sides) {
      const off = b.halfW * 2 + 10;
      for (const s of [-1, 1]) {
        obs.push(rect(b.x + sx * s * off, b.y + sy * s * off, b.a, b.halfL, b.halfW, "car"));
      }
    }
    // back wall just past the far end of the bay (and its neighbours)
    if (L.back) {
      const span = L.sides ? b.halfW * 3 + 12 : b.halfW + 14;
      obs.push(rect(b.x + fx * (b.halfL + 16), b.y + fy * (b.halfL + 16), b.a, 9, span, "wall"));
    }
    game.obstacles = obs;

    placeCar(L.car.x, L.car.y, rad(L.car.a));
    game.settle = 0; game.driftIn = 0;
    game.peakSlip = 0; game.maxSpeed = 0; game.entrySpeed = 0; game.bumps = 0;
    game.t = 0;
    smoke.length = 0; popups.length = 0;
    skidCtx.clearRect(0, 0, WORLD_W, WORLD_H);
    cam.x = car.x; cam.y = car.y;
    $("hudLevel").textContent = String(i + 1);
    $("hudLevelName").textContent = " " + L.name;
    $("hudStars").textContent = starStr(stars[i]);
    $("parkHint").textContent = L.hint;
  }

  function placeCar(x, y, h) {
    car.x = x; car.y = y; car.h = h;
    car.vx = car.vy = car.w = car.steer = 0;
    car.grip = GRIP_ROAD; car.slip = 0; car.drifting = false; car.boosting = false;
    car.skidL = car.skidR = null;
  }

  function starStr(n) { return "★★★☆☆☆".slice(3 - n, 6 - n); }

  // ---- skid mark layer -------------------------------------------------------
  const SKID_SCALE = 0.5;
  const skidC = document.createElement("canvas");
  skidC.width = WORLD_W * SKID_SCALE; skidC.height = WORLD_H * SKID_SCALE;
  const skidCtx = skidC.getContext("2d");
  skidCtx.scale(SKID_SCALE, SKID_SCALE);
  skidCtx.lineCap = "round";

  // ---- pre-rendered lot background ------------------------------------------
  const staticC = document.createElement("canvas");
  staticC.width = WORLD_W; staticC.height = WORLD_H;
  (() => {
    const g = staticC.getContext("2d");
    // dark asphalt with faint bays painted across the lot for texture
    g.fillStyle = "#20232a";
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = "rgba(0,0,0,0.14)";
    for (let i = 0; i < 1400; i++) g.fillRect(rnd() * WORLD_W, rnd() * WORLD_H, 2 + rnd() * 3, 2 + rnd() * 3);
    // subtle sodium-lit vignette gradient
    const grd = g.createRadialGradient(WORLD_W / 2, WORLD_H / 2, 200, WORLD_W / 2, WORLD_H / 2, 900);
    grd.addColorStop(0, "rgba(255,180,90,0.05)");
    grd.addColorStop(1, "rgba(0,0,0,0.28)");
    g.fillStyle = grd;
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    // painted border curb
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.lineWidth = 8;
    g.strokeRect(24, 24, WORLD_W - 48, WORLD_H - 48);
  })();

  // ---- input -----------------------------------------------------------------
  const input = { gas: false, brake: false, left: false, right: false, hand: false };
  const KEYMAP = {
    ArrowUp: "gas", KeyW: "gas",
    ArrowDown: "brake", KeyS: "brake",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    Space: "hand",
  };
  window.addEventListener("keydown", (e) => {
    const k = KEYMAP[e.code];
    if (k) { input[k] = true; e.preventDefault(); }
    if (e.code === "KeyR" && game.state === "play") restartLevel();
  });
  window.addEventListener("keyup", (e) => {
    const k = KEYMAP[e.code];
    if (k) { input[k] = false; e.preventDefault(); }
  });

  if (window.matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");
  function hold(id, key) {
    const el = $(id);
    if (!el) return;
    const down = (e) => { e.preventDefault(); input[key] = true; };
    const up = (e) => { e.preventDefault(); input[key] = false; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  hold("touchLeft", "left");
  hold("touchRight", "right");
  hold("touchGas", "gas");
  hold("touchDrift", "hand");
  const tr = $("touchReset");
  if (tr) tr.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (game.state === "play") restartLevel();
  });

  function restartLevel() {
    buildLevel(game.level);
    $("parkStatus").hidden = true;
  }

  // ---- physics ---------------------------------------------------------------
  function step(dt) {
    const drive = game.state === "play";
    const gas = drive && input.gas;
    const brake = drive && input.brake;
    const hand = drive && input.hand;
    const steerIn = drive ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;

    const cs = Math.cos(car.h), sn = Math.sin(car.h);
    let vf = car.vx * cs + car.vy * sn;
    let vl = -car.vx * sn + car.vy * cs;

    if (gas) vf += ACCEL * (hand ? 0.6 : 1) * dt;
    // power slide: sliding on the throttle earns a little extra shove forward,
    // so a drift carries speed (and throws flames). Uses last frame's drift
    // state — a frame of lag here is imperceptible.
    car.boosting = drive && gas && car.drifting && vf > 0;
    if (car.boosting) vf += BOOST_ACCEL * dt;
    if (brake) {
      if (vf > 8) vf -= BRAKE * dt;
      else vf = Math.max(vf - REV_ACCEL * dt, -REV_MAX);
    }
    if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), HAND_DECEL * dt);
    vf -= (DRAG1 * vf + DRAG2 * vf * Math.abs(vf)) * dt;

    const gripTarget = hand ? GRIP_HAND : car.drifting ? GRIP_DRIFT : GRIP_ROAD;
    car.grip += (gripTarget - car.grip) * Math.min(1, 5 * dt);
    vl *= Math.exp(-car.grip * dt);

    car.vx = cs * vf - sn * vl;
    car.vy = sn * vf + cs * vl;

    car.steer += (steerIn - car.steer) * Math.min(1, STEER_RESP * dt);
    const auth = clamp(Math.abs(vf) / 250, 0, 1) * (vf < 0 ? -1 : 1);
    let wT = car.steer * TURN_RATE * auth;
    if (car.drifting || hand) wT += car.steer * TURN_DRIFT * auth;
    if (vf > 40) wT += car.slip * (hand ? ALIGN_HAND : car.drifting ? ALIGN_HAND * 1.6 : ALIGN_ROAD);
    car.w += (wT - car.w) * Math.min(1, YAW_RESP * dt);
    car.h += car.w * dt;
    if (vf > 40) {
      const velA = Math.atan2(car.vy, car.vx);
      const sl = angDiff(velA, car.h);
      if (sl > SLIP_MAX) car.h = velA - SLIP_MAX;
      else if (sl < -SLIP_MAX) car.h = velA + SLIP_MAX;
    }

    car.x += car.vx * dt;
    car.y += car.vy * dt;

    const speed = Math.hypot(car.vx, car.vy);
    car.slip = speed > 40 ? angDiff(Math.atan2(car.vy, car.vx), car.h) : 0;
    car.drifting = drive && Math.abs(car.slip) > SLIP_MIN && speed > DRIFT_SPEED_MIN && vf > 0;

    // ---- collisions: lot walls + neighbour cars + back wall ----
    collide(drive);

    // ---- style tracking + "drift-in" arming ----
    if (drive) {
      game.maxSpeed = Math.max(game.maxSpeed, speed);
      if (speed > DRIFT_SPEED_MIN) game.peakSlip = Math.max(game.peakSlip, Math.abs(car.slip));
      // A real slide close to the bay arms the lock. Straight-lining in never
      // arms it, so you can't just drive the car into the spot.
      const b = game.bay;
      const nearBay = Math.hypot(car.x - b.x, car.y - b.y) < b.halfL + 150;
      if (nearBay && car.drifting && Math.abs(car.slip) > DRIFT_IN_SLIP && speed > DRIFT_SPEED_MIN) {
        game.driftIn = DRIFT_IN_GRACE;
      } else {
        game.driftIn = Math.max(0, game.driftIn - dt);
      }
    }

    // ---- seated + settle check ----
    if (drive) {
      const seated = seatInfo();
      const armed = game.driftIn > 0;   // must have drifted in to lock the spot
      if (seated.in && speed < SETTLE_SPEED && armed) {
        game.settle += dt;
        if (game.settle >= SETTLE_HOLD) completeLevel();
      } else {
        game.settle = Math.max(0, game.settle - dt * 2);
      }
      updateStatusPrompt(seated, speed, armed);
      game.t += dt;
    }

    // ---- skid marks + smoke ----
    emitTrail(speed, hand);
  }

  // reflect velocity out of an axis-aligned lot wall with a little scrub
  function killInto(nx, ny) {
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) {
      car.vx -= 1.2 * vn * nx;
      car.vy -= 1.2 * vn * ny;
      car.vx *= 0.7; car.vy *= 0.7;
      registerBump(6);
    }
  }

  // The car is a capsule: two collision nodes (front + rear) so a long body
  // resolves against neighbours and walls without its nose/tail tunnelling
  // through. Each node is a circle of radius CAR_R.
  function collide(drive) {
    const fx = Math.cos(car.h), fy = Math.sin(car.h);
    const nodes = [[car.x + fx * NODE_D, car.y + fy * NODE_D],
                   [car.x - fx * NODE_D, car.y - fy * NODE_D]];
    for (const nd of nodes) {
      // lot bounds
      if (nd[0] < 24 + CAR_R) { const p = 24 + CAR_R - nd[0]; car.x += p; nd[0] += p; killInto(1, 0); }
      if (nd[0] > WORLD_W - 24 - CAR_R) { const p = nd[0] - (WORLD_W - 24 - CAR_R); car.x -= p; nd[0] -= p; killInto(-1, 0); }
      if (nd[1] < 24 + CAR_R) { const p = 24 + CAR_R - nd[1]; car.y += p; nd[1] += p; killInto(0, 1); }
      if (nd[1] > WORLD_H - 24 - CAR_R) { const p = nd[1] - (WORLD_H - 24 - CAR_R); car.y -= p; nd[1] -= p; killInto(0, -1); }
      if (drive) for (const o of game.obstacles) resolveRectNode(o, nd);
    }
  }

  // circle (one capsule node) vs oriented rect: push the whole car out along
  // the shortest axis and kill the inward velocity component.
  function resolveRectNode(o, nd) {
    const ux = Math.cos(o.a), uy = Math.sin(o.a);
    const vx = -Math.sin(o.a), vy = Math.cos(o.a);
    const dx = nd[0] - o.x, dy = nd[1] - o.y;
    const lx = dx * ux + dy * uy;      // along facing
    const ly = dx * vx + dy * vy;      // across
    const cxl = clamp(lx, -o.hx, o.hx);
    const cyl = clamp(ly, -o.hy, o.hy);
    let nx, ny, pen;
    if (Math.abs(lx) <= o.hx && Math.abs(ly) <= o.hy) {
      // node inside the rect: eject along the least-penetrating face
      const px = o.hx - Math.abs(lx), py = o.hy - Math.abs(ly);
      if (px < py) { const s = Math.sign(lx) || 1; nx = ux * s; ny = uy * s; pen = px + CAR_R; }
      else { const s = Math.sign(ly) || 1; nx = vx * s; ny = vy * s; pen = py + CAR_R; }
    } else {
      const closeX = o.x + ux * cxl + vx * cyl;
      const closeY = o.y + uy * cxl + vy * cyl;
      let ex = nd[0] - closeX, ey = nd[1] - closeY;
      let d = Math.hypot(ex, ey);
      if (d >= CAR_R) return;
      if (d < 1e-4) { ex = ux; ey = uy; d = 1; }
      nx = ex / d; ny = ey / d; pen = CAR_R - d;
    }
    car.x += nx * pen; car.y += ny * pen; nd[0] += nx * pen; nd[1] += ny * pen;
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) {
      const e = o.kind === "wall" ? 0.9 : 0.5;
      car.vx -= (1 + e) * vn * nx;
      car.vy -= (1 + e) * vn * ny;
      car.vx *= 0.74; car.vy *= 0.74;
      registerBump(o.kind === "wall" ? 9 : 7);
    }
  }

  function registerBump(shake) {
    cam.shake = Math.max(cam.shake, shake);
    // a hard knock spills any drift style you'd built up
    if (game.peakSlip > 0 && cam.shake >= 7) {
      game.bumps++;
      if (game.state === "play") popups.push({ x: car.x, y: car.y - 26, t: 0, txt: "clang!", color: "#ff6b5e" });
    }
  }

  // ---- seated geometry -------------------------------------------------------
  // Where is the car relative to the bay? "in" just means the car's CENTER sits
  // inside the painted lines (no angle requirement) — that alone is a park worth
  // a star; the star count comes from how much of the body is inside (below).
  function seatInfo() {
    const b = game.bay;
    const ux = Math.cos(b.a), uy = Math.sin(b.a);
    const vx = -Math.sin(b.a), vy = Math.cos(b.a);
    const dx = car.x - b.x, dy = car.y - b.y;
    const along = dx * ux + dy * uy;     // along the bay (length)
    const across = dx * vx + dy * vy;    // across (width)
    const aErr = alignErr(car.h, b.a);
    const inBay = Math.abs(along) < b.halfL && Math.abs(across) < b.halfW;
    return { in: inBay, along, across, aErr };
  }

  // Fraction of the car's footprint that lies between the painted lines. A
  // grid of points across the body is transformed into the bay's frame and
  // counted — so a crooked or half-hanging-out car naturally scores lower.
  function coverageFraction() {
    const b = game.bay;
    const ux = Math.cos(b.a), uy = Math.sin(b.a);
    const vx = -Math.sin(b.a), vy = Math.cos(b.a);
    const fx = Math.cos(car.h), fy = Math.sin(car.h);   // car forward
    const gx = -Math.sin(car.h), gy = Math.cos(car.h);  // car right
    const NL = 5, NW = 3;
    let inside = 0, total = 0;
    for (let i = 0; i < NL; i++) {
      const l = (-0.5 + i / (NL - 1)) * CAR_L;
      for (let j = 0; j < NW; j++) {
        const w = (-0.5 + j / (NW - 1)) * (CAR_HW * 2);
        const px = car.x + fx * l + gx * w;
        const py = car.y + fy * l + gy * w;
        const dx = px - b.x, dy = py - b.y;
        if (Math.abs(dx * ux + dy * uy) <= b.halfL && Math.abs(dx * vx + dy * vy) <= b.halfW) inside++;
        total++;
      }
    }
    return inside / total;
  }

  function updateStatusPrompt(seated, speed, armed) {
    const el = $("parkStatus");
    if (seated.in && speed < SETTLE_SPEED && armed) {
      el.hidden = false;
      el.classList.remove("warn");
      el.textContent = "hold it…";
    } else if (seated.in && speed < SETTLE_SPEED) {
      // stopped in the bay but you rolled straight in — no lock
      el.hidden = false;
      el.classList.add("warn");
      el.textContent = "drift it in!";
    } else if (seated.in) {
      el.hidden = false;
      el.classList.add("warn");
      el.textContent = "too fast — settle down";
    } else {
      el.hidden = true;
    }
  }

  // ---- level completion ------------------------------------------------------
  // Stars are purely about the park itself:
  //   ★    the car is in the spot (center between the lines)
  //   ★★   most of the body is inside (≥ 60% coverage)
  //   ★★★  a flawless park — nearly all of it in AND straight
  function completeLevel() {
    game.state = "done";
    $("parkStatus").hidden = true;
    const cov = coverageFraction();
    const aErr = seatInfo().aErr;
    let earned = 1;
    if (cov >= 0.6) earned = 2;
    if (cov >= 0.9 && aErr < 0.16) earned = 3;

    const isBest = earned > stars[game.level];
    if (isBest) {
      stars[game.level] = earned;
      try { localStorage.setItem("park.stars", JSON.stringify(stars)); } catch (e) { /* ignore */ }
    }

    const covPct = Math.round(cov * 100);
    const angleDeg = Math.round((aErr * 180) / Math.PI);
    $("doneTitle").textContent = earned === 3 ? "👑 Flawless park!" : "🅿️ Parked!";
    $("doneStars").textContent = starStr(earned);
    $("doneStats").innerHTML =
      "In the bay <b>" + covPct + "%</b> · Off-angle <b>" + angleDeg + "°</b>" +
      "<br>Peak drift <b>" + Math.round((game.peakSlip * 180) / Math.PI) + "°</b>" +
      " · Top speed <b>" + Math.round(game.maxSpeed * KMH) + "</b> km/h" +
      (game.bumps > 0 ? " · Bumps <b>" + game.bumps + "</b>" : "") +
      (isBest ? "<span class='newbest'>NEW BEST</span>" : "") +
      (earned < 3 ? "<br><span class='park-tip'></span>" : "");
    // a nudge toward the missing stars
    if (earned < 3) {
      const tip = cov < 0.6
        ? "Get more of the car between the lines for ★★."
        : "Straighten up and center it for ★★★.";
      const span = $("doneStats").querySelector(".park-tip");
      if (span) { span.textContent = tip; span.style.color = "var(--muted)"; }
    }

    const next = $("parkNext");
    next.style.display = game.level < LEVELS.length - 1 ? "" : "none";
    $("parkDone").hidden = false;
    $("hudStars").textContent = starStr(stars[game.level]);
  }

  // ---- trail / particles -----------------------------------------------------
  function emitTrail(speed, hand) {
    const rearX = car.x - Math.cos(car.h) * CAR_L * 0.32;
    const rearY = car.y - Math.sin(car.h) * CAR_L * 0.32;
    const rx = -Math.sin(car.h) * CAR_HW * 0.8, ry = Math.cos(car.h) * CAR_HW * 0.8;
    const skidding = car.drifting || (hand && speed > 60);
    if (skidding) {
      const L = { x: rearX - rx, y: rearY - ry }, R = { x: rearX + rx, y: rearY + ry };
      if (car.skidL) {
        skidCtx.strokeStyle = "rgba(12,13,16,0.42)";
        skidCtx.lineWidth = 4.5;
        skidCtx.beginPath();
        skidCtx.moveTo(car.skidL.x, car.skidL.y); skidCtx.lineTo(L.x, L.y);
        skidCtx.moveTo(car.skidR.x, car.skidR.y); skidCtx.lineTo(R.x, R.y);
        skidCtx.stroke();
      }
      car.skidL = L; car.skidR = R;
      if (smoke.length < 200) {
        smoke.push({
          x: rearX + (Math.random() - 0.5) * 10, y: rearY + (Math.random() - 0.5) * 10,
          vx: car.vx * 0.12 + (Math.random() - 0.5) * 26,
          vy: car.vy * 0.12 + (Math.random() - 0.5) * 26,
          r: 6 + Math.random() * 6, t: 0, life: 0.55 + Math.random() * 0.3, flame: false,
        });
      }
    } else {
      car.skidL = car.skidR = null;
    }
    // power-slide flames licking out of the tailpipe while boosting
    if (car.boosting && smoke.length < 260) {
      const bx = car.x - Math.cos(car.h) * CAR_L * 0.52;
      const by = car.y - Math.sin(car.h) * CAR_L * 0.52;
      smoke.push({
        x: bx + (Math.random() - 0.5) * 7, y: by + (Math.random() - 0.5) * 7,
        vx: -Math.cos(car.h) * 95 + (Math.random() - 0.5) * 34,
        vy: -Math.sin(car.h) * 95 + (Math.random() - 0.5) * 34,
        r: 5 + Math.random() * 4, t: 0, life: 0.26, flame: true,
      });
    }
  }

  // ---- flow ------------------------------------------------------------------
  function startLevel(i) {
    game.state = "play";
    buildLevel(i);
    $("parkIntro").hidden = true;
    $("parkDone").hidden = true;
    $("parkHud").hidden = false;
  }

  $("parkPlayBtn").addEventListener("click", () => {
    // resume at the first level that isn't yet three-starred (but always unlocked)
    let start = 0;
    for (let i = 0; i < LEVELS.length; i++) { if (isUnlocked(i)) start = i; if (stars[i] < 3) break; }
    startLevel(start);
  });
  $("parkNext").addEventListener("click", () => startLevel(Math.min(LEVELS.length - 1, game.level + 1)));
  $("parkReplay").addEventListener("click", () => startLevel(game.level));

  // level picker on the intro
  const levelRow = $("levelRow");
  function paintLevelRow() {
    levelRow.innerHTML = "";
    LEVELS.forEach((L, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.disabled = !isUnlocked(i);
      b.innerHTML = "<span class='lv-name'>" + (i + 1) + ". " + L.name + "</span>" +
        "<span class='lv-stars'>" + starStr(stars[i]) + "</span>";
      b.addEventListener("click", () => { if (isUnlocked(i)) startLevel(i); });
      levelRow.appendChild(b);
    });
  }
  paintLevelRow();

  // ---- view ------------------------------------------------------------------
  const view = { dpr: 1, cw: 0, ch: 0 };
  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.cw = window.innerWidth; view.ch = window.innerHeight;
    canvas.width = Math.round(view.cw * view.dpr);
    canvas.height = Math.round(view.ch * view.dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  function updateCamera(dt) {
    // Close, GTA-ish chase cam: sit tight on the car and look ahead in the
    // direction of travel (plus a little nose lead) so you can still read the
    // bay coming up. Eases back a touch at speed.
    const speed = Math.hypot(car.vx, car.vy);
    const tx = car.x + car.vx * 0.30 + Math.cos(car.h) * 48;
    const ty = car.y + car.vy * 0.30 + Math.sin(car.h) * 48;
    const k = Math.min(1, 4 * dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    const base = clamp(Math.min(view.cw / 760, view.ch / 560), 0.85, 2.1);
    const zt = base * (1.06 - 0.18 * Math.min(speed / 520, 1));
    cam.z += (zt - cam.z) * Math.min(1, 2.6 * dt);
    cam.shake = Math.max(0, cam.shake - 26 * dt);
  }

  // ---- drawing ---------------------------------------------------------------
  function carShape(g) {
    g.beginPath();
    g.moveTo(CAR_L / 2, 0);
    g.lineTo(CAR_L * 0.30, -CAR_HW);
    g.lineTo(-CAR_L * 0.42, -CAR_HW * 0.9);
    g.lineTo(-CAR_L / 2, -CAR_HW * 0.55);
    g.lineTo(-CAR_L / 2, CAR_HW * 0.55);
    g.lineTo(-CAR_L * 0.42, CAR_HW * 0.9);
    g.lineTo(CAR_L * 0.30, CAR_HW);
    g.closePath();
  }

  function drawBay(g) {
    const b = game.bay;
    const seated = game.state === "play" ? seatInfo() : { in: false };
    const good = seated.in || game.state === "done";
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.a);
    // painted slot fill
    g.fillStyle = good ? "rgba(120,255,160,0.14)" : "rgba(255,179,92,0.08)";
    g.fillRect(-b.halfL, -b.halfW, b.halfL * 2, b.halfW * 2);
    // dashed painted lines
    g.setLineDash([16, 12]);
    g.lineWidth = 4;
    g.strokeStyle = good ? "rgba(140,255,170,0.9)" : "rgba(255,210,140,0.85)";
    g.strokeRect(-b.halfL, -b.halfW, b.halfL * 2, b.halfW * 2);
    g.setLineDash([]);
    // a big P at the head of the bay so the target reads instantly
    g.globalAlpha = 0.5;
    g.fillStyle = good ? "rgba(140,255,170,0.9)" : "rgba(255,210,140,0.9)";
    g.font = "700 30px 'Space Grotesk', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.save(); g.rotate(-b.a); g.fillText("P", 0, 0); g.restore();
    g.globalAlpha = 1;
    // ghost target car showing which way to end up (points along +facing)
    g.globalAlpha = 0.22;
    g.rotate(0);
    g.fillStyle = "#dfe7ee";
    carShape(g);
    g.fill();
    g.globalAlpha = 1;
    g.restore();
  }

  function drawObstacleCar(g, o) {
    g.save();
    g.translate(o.x, o.y);
    g.rotate(o.a);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(-o.hx + 3, -o.hy + 4, o.hx * 2, o.hy * 2);
    // body — muted parked cars so the player's car pops
    const grad = g.createLinearGradient(-o.hx, 0, o.hx, 0);
    grad.addColorStop(0, "#3a4653");
    grad.addColorStop(1, "#4c5a68");
    g.fillStyle = grad;
    const s = Math.min(o.hx, o.hy);
    // draw as a car silhouette scaled to the slot
    g.save();
    g.scale(o.hx / (CAR_L / 2), o.hy / CAR_HW);
    carShape(g);
    g.restore();
    g.fill();
    g.fillStyle = "#20262e";
    g.fillRect(-o.hx * 0.4, -o.hy * 0.55, o.hx * 0.7, o.hy * 1.1);
    g.restore();
  }

  function drawWall(g, o) {
    g.save();
    g.translate(o.x, o.y);
    g.rotate(o.a);
    g.fillStyle = "rgba(0,0,0,0.4)";
    g.fillRect(-o.hx + 3, -o.hy + 4, o.hx * 2, o.hy * 2);
    g.fillStyle = "#15181d";
    g.fillRect(-o.hx, -o.hy, o.hx * 2, o.hy * 2);
    // hazard stripes down the wall face
    g.save();
    g.beginPath(); g.rect(-o.hx, -o.hy, o.hx * 2, o.hy * 2); g.clip();
    g.strokeStyle = "rgba(255,190,90,0.5)"; g.lineWidth = 6;
    for (let y = -o.hy - o.hx; y < o.hy + o.hx; y += 18) {
      g.beginPath(); g.moveTo(-o.hx, y); g.lineTo(o.hx, y + o.hx * 2); g.stroke();
    }
    g.restore();
    g.restore();
  }

  function drawCar(g) {
    g.save();
    g.translate(car.x, car.y);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.save(); g.rotate(car.h);
    g.fillRect(-CAR_L / 2 + 3, -CAR_HW + 4, CAR_L, CAR_HW * 2);
    g.restore();
    g.rotate(car.h);

    const braking = input.brake || input.hand;
    g.fillStyle = "#121316";
    const steerA = car.steer * 0.42;
    const wheel = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-5.5, -2.6, 11, 5.2); g.restore(); };
    wheel(CAR_L * 0.30, -CAR_HW * 0.92, steerA);
    wheel(CAR_L * 0.30, CAR_HW * 0.92, steerA);
    wheel(-CAR_L * 0.32, -CAR_HW * 0.92, 0);
    wheel(-CAR_L * 0.32, CAR_HW * 0.92, 0);

    const grad = g.createLinearGradient(-CAR_L / 2, 0, CAR_L / 2, 0);
    grad.addColorStop(0, "#c8402f");
    grad.addColorStop(0.55, "#ff6a3c");
    grad.addColorStop(1, "#ff9d52");
    g.fillStyle = grad;
    carShape(g);
    g.fill();
    g.fillStyle = "#22141a";
    g.fillRect(-CAR_L * 0.18, -CAR_HW * 0.62, CAR_L * 0.34, CAR_HW * 1.24);
    g.fillStyle = "#8e2c1e";
    g.fillRect(-CAR_L / 2 - 2, -CAR_HW * 0.95, 5, CAR_HW * 1.9);
    g.fillStyle = "#ffe9b8";
    g.fillRect(CAR_L / 2 - 4, -CAR_HW * 0.7, 3, 4);
    g.fillRect(CAR_L / 2 - 4, CAR_HW * 0.7 - 4, 3, 4);
    g.fillStyle = braking ? "#ff2e2e" : "#701812";
    g.fillRect(-CAR_L / 2, -CAR_HW * 0.6, 3, 4);
    g.fillRect(-CAR_L / 2, CAR_HW * 0.6 - 4, 3, 4);
    g.restore();
  }

  function render(dt) {
    const g = ctx;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.fillStyle = "#0d1710";
    g.fillRect(0, 0, view.cw, view.ch);

    const shx = (Math.random() - 0.5) * cam.shake;
    const shy = (Math.random() - 0.5) * cam.shake;
    g.translate(view.cw / 2 + shx, view.ch / 2 + shy);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);

    g.drawImage(staticC, 0, 0);
    g.drawImage(skidC, 0, 0, WORLD_W, WORLD_H);

    if (game.bay) drawBay(g);
    for (const o of game.obstacles) (o.kind === "wall" ? drawWall : drawObstacleCar)(g, o);
    drawCar(g);

    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.t += dt;
      if (p.t >= p.life) { smoke.splice(i, 1); continue; }
      const a = 1 - p.t / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.flame) {
        // hot core fading to orange as it trails off
        g.fillStyle = "rgba(255, " + Math.round(120 + 110 * a) + ", 50," + (0.6 * a).toFixed(3) + ")";
        g.beginPath();
        g.arc(p.x, p.y, p.r * a + 1.5, 0, TAU);
        g.fill();
      } else {
        g.fillStyle = "rgba(206, 208, 214," + (0.24 * a).toFixed(3) + ")";
        g.beginPath();
        g.arc(p.x, p.y, p.r + p.t * 26, 0, TAU);
        g.fill();
      }
    }

    g.textAlign = "center";
    g.font = "700 22px 'Space Grotesk', sans-serif";
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.t += dt;
      if (p.t >= 1.1) { popups.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, 2 * (1.1 - p.t));
      g.fillStyle = p.color;
      g.fillText(p.txt, p.x, p.y - p.t * 42);
    }
    g.globalAlpha = 1;

    // settle ring drawn around the car as it locks into the spot
    if (game.state === "play" && game.settle > 0) {
      const frac = clamp(game.settle / SETTLE_HOLD, 0, 1);
      g.strokeStyle = "rgba(140,255,170,0.9)";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(car.x, car.y, 30, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      g.stroke();
    }
  }

  // ---- HUD -------------------------------------------------------------------
  function renderHud() {
    const speed = Math.hypot(car.vx, car.vy);
    $("hudSpeed").textContent = String(Math.round(speed * KMH));
    const slipDeg = Math.round((Math.abs(car.slip) * 180) / Math.PI);
    const styleEl = $("hudStyle");
    styleEl.textContent = car.drifting ? (car.boosting ? slipDeg + "° 🔥" : slipDeg + "°") : "—";
    $("hudStyleWrap").classList.toggle("hot", car.boosting || (car.drifting && slipDeg > 28));
    $("hudSpeed").classList.toggle("boosting", car.boosting);
  }

  (function introStars() {
    const t = totalStars();
    $("introStars").textContent = t > 0
      ? "Stars earned: " + t + " / " + (LEVELS.length * 3) + "."
      : "Your stars are saved.";
  })();

  // ---- main loop -------------------------------------------------------------
  buildLevel(0);
  cam.x = car.x; cam.y = car.y;
  cam.z = clamp(Math.min(view.cw / 760, view.ch / 560), 0.85, 2.1);

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000) || 0.016;
    lastT = now;
    step(dt);
    updateCamera(dt);
    render(dt);
    renderHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // console handle for tuning
  window.__park = { car, game, input, LEVELS, seatInfo, get stars() { return stars; } };
})();
