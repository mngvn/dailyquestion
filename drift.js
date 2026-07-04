// drift.js — "Drift King". A top-down drift racer around a closed circuit.
//
// The whole game is built around one idea: points only flow while the car is
// SIDEWAYS. The physics use a simple "bicycle with tire grip" model — the
// velocity is split into a forward and a lateral component in the car's own
// frame, and the tires constantly try to kill the lateral part. Pulling the
// handbrake (or carrying big speed into a corner) drops that lateral grip, the
// tail steps out, and the angle between where the car POINTS and where it
// MOVES (the slip angle) is what earns drift points.
//
// Objectives: finish 3 laps, bank 12,000 drift points, and do it in under
// 2:20. Cones (knockable) and tire walls (very much not knockable) punish a
// sloppy line by burning the un-banked points and resetting the combo.
// Best score and best time are saved.

(function () {
  "use strict";

  const canvas = document.getElementById("driftCanvas");
  const ctx = canvas.getContext("2d");

  // ---- helpers ---------------------------------------------------------------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // shortest signed difference between two angles
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  const $ = (id) => document.getElementById(id);

  // ---- world / track ---------------------------------------------------------
  const WORLD_W = 2600, WORLD_H = 1800;
  const TRACK_W = 150, HALF_W = TRACK_W / 2;
  const LAPS_TOTAL = 3;

  // control points of the circuit's centerline (a closed Catmull-Rom loop):
  // a long bottom straight, a fast right-hand sweeper up the side, a dip into
  // a twisty infield complex, a chicane across the top, then a long left-hand
  // arc back down to the line. Drawn/driven clockwise on screen.
  const CPS = [
    [420, 1480], [980, 1530], [1560, 1520], [2040, 1420],
    [2320, 1120], [2360, 780], [2160, 520],
    [1840, 460], [1620, 640], [1560, 900],
    [1360, 1060], [1120, 1000], [1040, 760],
    [1200, 520], [1080, 300], [780, 240],
    [480, 300], [300, 560], [240, 900], [280, 1220],
  ];

  // Sample the loop densely. Each sample carries position, unit tangent,
  // unit normal (driver's right-hand side), cumulative distance and curvature.
  const track = (() => {
    const pts = [];
    const n = CPS.length;
    for (let i = 0; i < n; i++) {
      const p0 = CPS[(i - 1 + n) % n], p1 = CPS[i];
      const p2 = CPS[(i + 1) % n], p3 = CPS[(i + 2) % n];
      const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = clamp(Math.round(chord / 14), 8, 44);
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        pts.push({ x, y });
      }
    }
    const m = pts.length;
    let total = 0;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % m];
      a.d = total;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    for (let i = 0; i < m; i++) {
      const prev = pts[(i - 1 + m) % m], next = pts[(i + 1) % m];
      const tx = next.x - prev.x, ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1;
      pts[i].tx = tx / tl; pts[i].ty = ty / tl;
      // rotate tangent +90°: with y pointing down this is the driver's right
      pts[i].nx = -pts[i].ty; pts[i].ny = pts[i].tx;
    }
    // curvature = heading change per unit distance over a small window
    const K = 6;
    for (let i = 0; i < m; i++) {
      const a = pts[(i - K + m) % m], b = pts[(i + K) % m];
      const da = angDiff(Math.atan2(b.ty, b.tx), Math.atan2(a.ty, a.tx));
      let ds = b.d - a.d;
      if (ds <= 0) ds += total;
      pts[i].k = da / ds; // >0 turns right on screen, <0 turns left
    }
    return { pts, n: m, total };
  })();

  function nearestSample(x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < track.n; i++) {
      const p = track.pts[i];
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, dist: Math.sqrt(bd) };
  }

  const START_IDX = 26; // start/finish line sits partway down the bottom straight
  const SPAWN_IDX = 12; // grid spot: on the same straight, a little before the line

  // ---- obstacles: cones at every apex + slalom cones on straights, tire
  // walls waiting on the outside of the fastest corner exits ----------------
  const cones = [];
  const barriers = [];
  (() => {
    const pts = track.pts, m = track.n;
    // find corner clusters where curvature is meaningful
    const TH = 0.0032;
    const used = new Array(m).fill(false);
    const corners = [];
    for (let i = 0; i < m; i++) {
      if (used[i] || Math.abs(pts[i].k) < TH) continue;
      // walk the cluster
      let a = i, b = i;
      while (Math.abs(pts[(b + 1) % m].k) >= TH && b - a < m) b++;
      let apex = i, kmax = 0;
      for (let j = a; j <= b; j++) {
        used[j % m] = true;
        if (Math.abs(pts[j % m].k) > kmax) { kmax = Math.abs(pts[j % m].k); apex = j % m; }
      }
      corners.push({ apex, kmax, len: b - a });
    }
    corners.sort((c1, c2) => c2.kmax - c1.kmax);

    const addCone = (idx, latFrac) => {
      const p = pts[((idx % m) + m) % m];
      cones.push({
        x: p.x + p.nx * latFrac * HALF_W,
        y: p.y + p.ny * latFrac * HALF_W,
        rot: Math.random() * TAU, hit: false, vx: 0, vy: 0, spin: 0,
      });
    };

    // three cones marking the inside of each significant corner
    for (const c of corners.slice(0, 7)) {
      const side = Math.sign(pts[c.apex].k) || 1; // inside of the turn
      addCone(c.apex, side * 0.62);
      addCone(c.apex - 9, side * 0.5);
      addCone(c.apex + 9, side * 0.5);
    }
    // tire walls catch you on the OUTSIDE of the fastest corner exits — but
    // the circuit folds close to itself, so only keep spots that stay clear
    // of every OTHER piece of track (and its kerbs)
    const BARRIER_R = 28;
    for (const c of corners.slice(0, 5)) {
      if (barriers.length >= 3) break;
      const idx = (c.apex + 26) % m;
      const side = -(Math.sign(pts[c.apex].k) || 1);
      const p = pts[idx];
      const bx = p.x + p.nx * side * HALF_W * 1.68;
      const by = p.y + p.ny * side * HALF_W * 1.68;
      let clear = true;
      for (let j = 0; j < m; j++) {
        const away = Math.min(Math.abs(j - idx), m - Math.abs(j - idx));
        if (away < 30) continue; // its own stretch of track is allowed nearby
        const q = pts[j];
        if (Math.hypot(q.x - bx, q.y - by) < HALF_W + 15 + BARRIER_R + 6) { clear = false; break; }
      }
      if (clear) barriers.push({ x: bx, y: by, r: BARRIER_R });
    }
    // slalom cones down the long straights: alternate sides, forcing a weave
    let run = 0;
    for (let i = 0; i < m; i++) {
      const straight = Math.abs(pts[i].k) < 0.0012;
      run = straight ? run + 1 : 0;
      const nearStart = Math.min(Math.abs(i - START_IDX), m - Math.abs(i - START_IDX)) < 26;
      if (run > 0 && run % 26 === 0 && !nearStart) {
        addCone(i, (Math.floor(run / 26) % 2 === 0 ? 1 : -1) * 0.4);
      }
    }
  })();

  // ---- pre-rendered layers ---------------------------------------------------
  // The circuit never changes, so grass + kerbs + asphalt are painted once.
  const staticC = document.createElement("canvas");
  staticC.width = WORLD_W; staticC.height = WORLD_H;
  (() => {
    const g = staticC.getContext("2d");
    // infield grass with faint mowing stripes
    g.fillStyle = "#17281a";
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = "rgba(255,255,255,0.028)";
    for (let y = 0; y < WORLD_H; y += 240) g.fillRect(0, y, WORLD_W, 120);
    // a scattering of dark tufts so the grass reads as texture at speed
    g.fillStyle = "rgba(0,0,0,0.16)";
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 900; i++) {
      g.fillRect(rnd() * WORLD_W, rnd() * WORLD_H, 3 + rnd() * 4, 2 + rnd() * 3);
    }

    const path = () => {
      g.beginPath();
      g.moveTo(track.pts[0].x, track.pts[0].y);
      for (let i = 1; i < track.n; i++) g.lineTo(track.pts[i].x, track.pts[i].y);
      g.closePath();
    };
    g.lineJoin = "round"; g.lineCap = "round";
    // red/white kerbs peeking out on both edges
    path(); g.lineWidth = TRACK_W + 30; g.strokeStyle = "#ded8ca"; g.stroke();
    g.setLineDash([26, 26]);
    path(); g.lineWidth = TRACK_W + 30; g.strokeStyle = "#c8402f"; g.stroke();
    g.setLineDash([]);
    // asphalt, with a lighter worn band in the middle
    path(); g.lineWidth = TRACK_W; g.strokeStyle = "#33363d"; g.stroke();
    path(); g.lineWidth = TRACK_W - 34; g.strokeStyle = "#383b43"; g.stroke();
    // start/finish checkers laid across the track
    const s = track.pts[START_IDX];
    g.save();
    g.translate(s.x, s.y);
    g.rotate(Math.atan2(s.ty, s.tx));
    const sq = 12, cols = 2, rows = Math.ceil(TRACK_W / sq);
    for (let cx = 0; cx < cols; cx++) {
      for (let ry = 0; ry < rows; ry++) {
        g.fillStyle = (cx + ry) % 2 === 0 ? "#e8e4da" : "#17181c";
        g.fillRect(cx * sq - sq, ry * sq - TRACK_W / 2, sq, sq);
      }
    }
    g.restore();
  })();

  // skid marks accumulate here for the whole run (half resolution is plenty)
  const SKID_SCALE = 0.5;
  const skidC = document.createElement("canvas");
  skidC.width = WORLD_W * SKID_SCALE; skidC.height = WORLD_H * SKID_SCALE;
  const skidCtx = skidC.getContext("2d");
  skidCtx.scale(SKID_SCALE, SKID_SCALE);
  skidCtx.lineCap = "round";

  // minimap outline, pre-rendered once
  const mapCanvas = $("driftMap");
  const mapBase = document.createElement("canvas");
  (() => {
    const w = 200, h = 150;
    mapBase.width = w; mapBase.height = h;
    const g = mapBase.getContext("2d");
    const sc = Math.min((w - 24) / WORLD_W, (h - 24) / WORLD_H);
    const ox = (w - WORLD_W * sc) / 2, oy = (h - WORLD_H * sc) / 2;
    mapBase.sc = sc; mapBase.ox = ox; mapBase.oy = oy;
    g.beginPath();
    g.moveTo(ox + track.pts[0].x * sc, oy + track.pts[0].y * sc);
    for (let i = 1; i < track.n; i++) g.lineTo(ox + track.pts[i].x * sc, oy + track.pts[i].y * sc);
    g.closePath();
    g.lineJoin = "round";
    g.lineWidth = 7; g.strokeStyle = "rgba(0,0,0,0.55)"; g.stroke();
    g.lineWidth = 4; g.strokeStyle = "rgba(240,234,217,0.5)"; g.stroke();
    const s = track.pts[START_IDX];
    g.fillStyle = "#ffb35c";
    g.beginPath(); g.arc(ox + s.x * sc, oy + s.y * sc, 3, 0, TAU); g.fill();
  })();

  // ---- car physics constants ---------------------------------------------
  const ACCEL = 640;         // engine push (px/s²)
  const BRAKE = 1000;        // footbrake
  const REV_ACCEL = 380, REV_MAX = 190;
  const DRAG1 = 0.9, DRAG2 = 0.0016;   // linear + quadratic drag -> ~560 px/s top speed
  const GRIP_ROAD = 9.5;     // lateral velocity decay /s with tires gripping
  const GRIP_DRIFT = 3.1;    // reduced grip once the car is already sliding
  const GRIP_HAND = 1.9;     // handbrake: rears basically let go
  const TURN_RATE = 2.5;     // base steering authority (rad/s)
  const TURN_DRIFT = 1.35;   // extra yaw authority while sideways (to hold/counter-steer)
  const HAND_DECEL = 150;    // dragging locked rears scrubs a little speed
  const SLIP_MIN = 0.26;     // rad of slip before it counts as "drifting"
  const SLIP_MAX = 1.05;     // ~60°: the tires' aligning torque never lets the
                             //   nose run further from the velocity than this,
                             //   so a slide is always catchable, never a spin
  const ALIGN_HAND = 1.1;    // strength of that self-straightening torque…
  const ALIGN_ROAD = 3.2;    //   …weak with the rears locked, strong on grip
  const DRIFT_SPEED_MIN = 110;
  const CAR_L = 42, CAR_HW = 10;  // body length / half width
  const KMH = 0.45;          // px/s -> pretend km/h for the HUD

  // nitro: banking a drift pays out a speed boost scaled by how long the
  // slide was held. Spilling the points spills the nitro with them.
  const BOOST_ACCEL = 560;   // extra push while the nitro burns (px/s²)
  const BOOST_MAX = 2.4;     // seconds of stored boost, cap
  const BOOST_MIN_PTS = 25;  // tiny scrubs don't earn nitro

  // scoring
  const SCORE_RATE = 1.0;    // pts/s = speed(px/s) × |slip|(rad) × combo
  const COMBO_STEP = 1.6;    // seconds of sustained slide per extra ×
  const COMBO_MAX = 5;
  const BANK_GRACE = 0.9;    // straighten out for this long and pending banks
  const GOAL_SCORE = 12000;
  const GOAL_TIME = 105;     // seconds (1:45) — drifting is slower than gripping,
                             //   so the score goal and the time goal fight each other

  // ---- state ---------------------------------------------------------------
  const car = {
    x: 0, y: 0, h: 0,        // position, heading
    vx: 0, vy: 0, w: 0,      // velocity, yaw rate
    steer: 0, grip: GRIP_ROAD,
    slip: 0, drifting: false, onTrack: true,
    skidL: null, skidR: null, // previous rear-tire points for skid segments
  };
  const cam = { x: 0, y: 0, z: 1, shake: 0 };
  const race = {
    state: "intro",          // intro | count | race | done
    t: 0, count: 0,
    lap: 1, lapAcc: 0, lastS: 0, lapStamp: 0, lapTimes: [],
    score: 0, pending: 0, combo: 1, chain: 0, grace: 0, boost: 0,
    conesHit: 0, wallsHit: 0,
  };

  // ---- ghost riders ---------------------------------------------------------
  // A ghost is a point-mass pace car that follows the centerline with proper
  // braking physics: it reads the curvature ahead, works out the fastest speed
  // it can carry into each corner (v = √(latg/κ)), and brakes just in time.
  // Difficulty scales its top speed, cornering grip, and acceleration — every
  // tier is tuned to a beatable total time (checked against real runs).
  const GHOST_DIFFS = {
    easy:   { label: "easy",   vmax: 168, latg: 26,  acc: 138, brk: 420, tint: "141, 255, 176" },
    medium: { label: "medium", vmax: 220, latg: 53,  acc: 212, brk: 600, tint: "127, 183, 255" },
    hard:   { label: "hard",   vmax: 280, latg: 83,  acc: 320, brk: 800, tint: "201, 143, 255" },
  };
  let ghostDiff = "easy";
  try { ghostDiff = localStorage.getItem("drift.ghost") || "easy"; } catch (e) { /* ignore */ }
  if (ghostDiff !== "none" && !GHOST_DIFFS[ghostDiff]) ghostDiff = "easy";
  let ghost = null;

  function initGhost() {
    const p = GHOST_DIFFS[ghostDiff];
    if (!p) { ghost = null; return; }
    const s0 = track.pts[SPAWN_IDX];
    ghost = {
      p, dist: 0, v: 0, i: SPAWN_IDX,
      x: s0.x, y: s0.y, h: Math.atan2(s0.ty, s0.tx),
      done: false, finishT: 0,
    };
  }

  function stepGhost(dt, now) {
    if (!ghost || ghost.done) return;
    const p = ghost.p, pts = track.pts, m = track.n;
    // how fast may it go RIGHT NOW, given the corners within braking range?
    let lim = p.vmax;
    let idx = ghost.i, dAcc = 0;
    const horizon = (ghost.v * ghost.v) / (2 * p.brk) + 140;
    let guard = 0;
    while (dAcc < horizon && guard++ < m) {
      const nidx = (idx + 1) % m;
      let seg = pts[nidx].d - pts[idx].d;
      if (seg <= 0) seg += track.total;
      dAcc += seg;
      const vCorner = Math.sqrt(p.latg / (Math.abs(pts[nidx].k) + 1e-6));
      const vAllowed = Math.sqrt(vCorner * vCorner + 2 * p.brk * dAcc);
      if (vAllowed < lim) lim = vAllowed;
      idx = nidx;
    }
    if (ghost.v < lim) ghost.v = Math.min(lim, ghost.v + p.acc * dt);
    else ghost.v = Math.max(lim, ghost.v - p.brk * dt);
    ghost.dist += ghost.v * dt;
    if (ghost.dist >= LAPS_TOTAL * track.total) {
      ghost.dist = LAPS_TOTAL * track.total;
      ghost.done = true;
      ghost.finishT = now;
    }
    // resolve world position along the centerline
    const s = (pts[SPAWN_IDX].d + ghost.dist) % track.total;
    guard = 0;
    for (;;) {
      const a = pts[ghost.i], b = pts[(ghost.i + 1) % m];
      let seg = b.d - a.d;
      if (seg <= 0) seg += track.total;
      let off = s - a.d;
      if (off < 0) off += track.total;
      if (off < seg || guard++ > m) {
        const t = clamp(off / seg, 0, 1);
        ghost.x = a.x + (b.x - a.x) * t;
        ghost.y = a.y + (b.y - a.y) * t;
        // cosmetic drift angle: nose leans into the corner with lateral load
        const lean = clamp(a.k * ghost.v * 0.28, -0.55, 0.55);
        ghost.h = Math.atan2(a.ty, a.tx) + lean;
        break;
      }
      ghost.i = (ghost.i + 1) % m;
    }
  }
  let best = { score: 0, time: 0 };
  try {
    best.score = Math.max(0, +localStorage.getItem("drift.bestScore") || 0);
    best.time = Math.max(0, +localStorage.getItem("drift.bestTime") || 0);
  } catch (e) { /* ignore */ }

  const smoke = [];   // drift smoke + grass dust particles
  const popups = [];  // floating "+1234" style texts

  function placeCarAt(idx) {
    const p = track.pts[idx];
    car.x = p.x; car.y = p.y;
    car.h = Math.atan2(p.ty, p.tx);
    car.vx = car.vy = car.w = car.steer = 0;
    car.grip = GRIP_ROAD; car.slip = 0; car.drifting = false;
    car.skidL = car.skidR = null;
    race.lastS = p.d / track.total;
  }

  function resetRun() {
    race.t = 0; race.lap = 1; race.lapAcc = 0; race.lapStamp = 0;
    race.lapTimes = [];
    race.score = 0; race.pending = 0; race.combo = 1; race.chain = 0; race.grace = 0;
    race.boost = 0;
    race.conesHit = 0; race.wallsHit = 0;
    initGhost();
    for (const c of cones) { c.hit = false; c.vx = c.vy = c.spin = 0; }
    smoke.length = 0; popups.length = 0;
    skidCtx.clearRect(0, 0, WORLD_W, WORLD_H);
    placeCarAt(SPAWN_IDX);
    cam.x = car.x; cam.y = car.y;
  }

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
    if (e.code === "KeyR" && race.state === "race") rescue();
    if (e.code === "KeyM") overview = !overview;
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
  const tr = $("touchRescue");
  if (tr) tr.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (race.state === "race") rescue();
  });

  // R key / stuck-in-the-grass rescue: back onto the tarmac, pointed the right
  // way, at a standstill. Costs you the pending points, of course.
  function rescue() {
    spill();
    placeCarAt(nearestSample(car.x, car.y).i);
  }

  // ---- scoring ---------------------------------------------------------------
  function spill() {
    if (race.pending > 1) {
      popups.push({ x: car.x, y: car.y - 30, t: 0, txt: "✗ " + Math.floor(race.pending), color: "#ff6b5e" });
    }
    race.pending = 0; race.chain = 0; race.combo = 1; race.grace = 0;
    race.boost = 0; // fumbling the slide dumps the nitro too
  }
  function bank() {
    if (race.pending >= 1) {
      race.score += Math.floor(race.pending);
      let txt = "+" + Math.floor(race.pending);
      if (race.pending >= BOOST_MIN_PTS) {
        // nitro payout: the longer the slide was held, the bigger the boost
        race.boost = Math.min(BOOST_MAX, race.boost + 0.35 + race.chain * 0.5);
        txt += " 🔥";
      }
      popups.push({ x: car.x, y: car.y - 30, t: 0, txt, color: "#ffb35c" });
    }
    race.pending = 0; race.chain = 0; race.combo = 1; race.grace = 0;
  }

  // ---- physics ---------------------------------------------------------------
  function step(dt) {
    const drive = race.state === "race";
    const gas = drive && input.gas;
    const brake = drive && input.brake;
    const hand = drive && input.hand;
    const steerIn = drive ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;

    const cs = Math.cos(car.h), sn = Math.sin(car.h);
    // velocity in the car's frame: vf along the nose, vl out the right door
    let vf = car.vx * cs + car.vy * sn;
    let vl = -car.vx * sn + car.vy * cs;

    if (gas) vf += ACCEL * (hand ? 0.6 : 1) * dt;
    if (brake) {
      if (vf > 8) vf -= BRAKE * dt;
      else vf = Math.max(vf - REV_ACCEL * dt, -REV_MAX);
    }
    if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), HAND_DECEL * dt);
    // nitro burn: extra push along the nose, well past the normal top speed
    if (drive && race.boost > 0) {
      vf += BOOST_ACCEL * dt;
      race.boost = Math.max(0, race.boost - dt);
    }
    vf -= (DRAG1 * vf + DRAG2 * vf * Math.abs(vf)) * dt;

    // grass is treacle: big drag on everything and no fun allowed
    car.onTrack = nearestSample(car.x, car.y).dist <= HALF_W + 8;
    if (!car.onTrack) vf -= vf * Math.min(1, 2.3 * dt);

    // tires: bleed off lateral velocity. Handbrake or an established slide
    // means far less lateral grip, which is exactly what keeps a drift alive.
    const gripTarget = !car.onTrack ? GRIP_ROAD + 3
      : hand ? GRIP_HAND
      : car.drifting ? GRIP_DRIFT
      : GRIP_ROAD;
    car.grip += (gripTarget - car.grip) * Math.min(1, 6 * dt);
    vl *= Math.exp(-car.grip * dt);

    car.vx = cs * vf - sn * vl;
    car.vy = sn * vf + cs * vl;

    // steering: authority scales up with speed (you can't pivot a parked car),
    // plus extra yaw while sliding so you can hold the angle or counter-steer
    car.steer += (steerIn - car.steer) * Math.min(1, 9 * dt);
    const speed = Math.hypot(car.vx, car.vy);
    const auth = clamp(Math.abs(vf) / 250, 0, 1) * (vf < 0 ? -1 : 1);
    let wT = car.steer * TURN_RATE * auth;
    if (car.drifting || hand) wT += car.steer * TURN_DRIFT * auth;
    // aligning torque: the tires constantly pull the nose back toward the
    // direction of travel — weakly under handbrake, firmly on grip
    if (vf > 40) wT += car.slip * (hand ? ALIGN_HAND : car.drifting ? ALIGN_HAND * 1.6 : ALIGN_ROAD);
    car.w += (wT - car.w) * Math.min(1, 10 * dt);
    car.h += car.w * dt;
    // hard slip cap so momentum can never swap the car fully around
    if (vf > 40) {
      const velA = Math.atan2(car.vy, car.vx);
      const sl = angDiff(velA, car.h);
      if (sl > SLIP_MAX) car.h = velA - SLIP_MAX;
      else if (sl < -SLIP_MAX) car.h = velA + SLIP_MAX;
    }

    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.x = clamp(car.x, 30, WORLD_W - 30);
    car.y = clamp(car.y, 30, WORLD_H - 30);

    // slip angle: where the car points vs. where it travels
    car.slip = speed > 40 ? angDiff(Math.atan2(car.vy, car.vx), car.h) : 0;
    const wasDrifting = car.drifting;
    car.drifting = drive && Math.abs(car.slip) > SLIP_MIN &&
      speed > DRIFT_SPEED_MIN && vf > 0 && car.onTrack;

    // ---- drift scoring ----
    if (drive) {
      if (car.drifting) {
        race.chain += dt;
        race.grace = BANK_GRACE;
        race.combo = Math.min(COMBO_MAX, 1 + Math.floor(race.chain / COMBO_STEP));
        race.pending += speed * Math.abs(car.slip) * SCORE_RATE * race.combo * dt;
      } else if (race.grace > 0) {
        race.grace -= dt;
        if (race.grace <= 0) bank();
      }
      if (!car.onTrack && wasDrifting) spill();
    }

    // ---- skid marks + smoke ----
    const rearX = car.x - Math.cos(car.h) * CAR_L * 0.32;
    const rearY = car.y - Math.sin(car.h) * CAR_L * 0.32;
    const rx = -Math.sin(car.h) * CAR_HW * 0.8, ry = Math.cos(car.h) * CAR_HW * 0.8;
    const skidding = (car.drifting || (hand && speed > 60)) && car.onTrack;
    if (skidding) {
      const L = { x: rearX - rx, y: rearY - ry }, R = { x: rearX + rx, y: rearY + ry };
      if (car.skidL) {
        skidCtx.strokeStyle = "rgba(16,17,20,0.42)";
        skidCtx.lineWidth = 4.5;
        skidCtx.beginPath();
        skidCtx.moveTo(car.skidL.x, car.skidL.y); skidCtx.lineTo(L.x, L.y);
        skidCtx.moveTo(car.skidR.x, car.skidR.y); skidCtx.lineTo(R.x, R.y);
        skidCtx.stroke();
      }
      car.skidL = L; car.skidR = R;
      if (smoke.length < 220) {
        smoke.push({
          x: rearX + (Math.random() - 0.5) * 10, y: rearY + (Math.random() - 0.5) * 10,
          vx: car.vx * 0.12 + (Math.random() - 0.5) * 26,
          vy: car.vy * 0.12 + (Math.random() - 0.5) * 26,
          r: 6 + Math.random() * 6, t: 0, life: 0.55 + Math.random() * 0.3, grass: false,
        });
      }
    } else {
      car.skidL = car.skidR = null;
    }
    if (!car.onTrack && speed > 120 && smoke.length < 220) {
      smoke.push({
        x: rearX, y: rearY,
        vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
        r: 4 + Math.random() * 4, t: 0, life: 0.5, grass: true,
      });
    }
    // nitro flames licking out of the back while the boost burns
    if (drive && race.boost > 0 && smoke.length < 260) {
      const bx = car.x - Math.cos(car.h) * CAR_L * 0.55;
      const by = car.y - Math.sin(car.h) * CAR_L * 0.55;
      smoke.push({
        x: bx + (Math.random() - 0.5) * 6, y: by + (Math.random() - 0.5) * 6,
        vx: -Math.cos(car.h) * 90 + (Math.random() - 0.5) * 30,
        vy: -Math.sin(car.h) * 90 + (Math.random() - 0.5) * 30,
        r: 5 + Math.random() * 4, t: 0, life: 0.28, flame: true,
      });
    }

    // ---- obstacles ----
    if (drive) {
      for (const c of cones) {
        if (c.hit) {
          c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.spin * dt;
          const f = Math.exp(-3 * dt);
          c.vx *= f; c.vy *= f; c.spin *= f;
          continue;
        }
        const dx = car.x - c.x, dy = car.y - c.y;
        if (dx * dx + dy * dy < 26 * 26) {
          c.hit = true;
          c.vx = car.vx * 0.45 + (Math.random() - 0.5) * 80;
          c.vy = car.vy * 0.45 + (Math.random() - 0.5) * 80;
          c.spin = (Math.random() - 0.5) * 14;
          race.conesHit++;
          spill();
          popups.push({ x: c.x, y: c.y - 20, t: 0, txt: "cone!", color: "#ff6b5e" });
          car.vx *= 0.86; car.vy *= 0.86;
          cam.shake = Math.max(cam.shake, 4);
        }
      }
      for (const b of barriers) {
        const dx = car.x - b.x, dy = car.y - b.y;
        const d = Math.hypot(dx, dy), rr = b.r + 16;
        if (d < rr && d > 0.001) {
          const nx = dx / d, ny = dy / d;
          car.x = b.x + nx * rr; car.y = b.y + ny * rr;
          const vn = car.vx * nx + car.vy * ny;
          if (vn < 0) {
            car.vx -= 1.55 * vn * nx;
            car.vy -= 1.55 * vn * ny;
            car.vx *= 0.72; car.vy *= 0.72;
            race.wallsHit++;
            spill();
            popups.push({ x: car.x, y: car.y - 30, t: 0, txt: "tire wall!", color: "#ff6b5e" });
            cam.shake = Math.max(cam.shake, 9);
          }
        }
      }
    }

    // ---- lap progress ----
    // Progress is the fraction of the centerline nearest the car; laps come
    // from ACCUMULATED signed progress, so driving backwards un-earns it and
    // there's nothing to exploit by weaving over the line.
    if (drive) {
      const s = track.pts[nearestSample(car.x, car.y).i].d / track.total;
      let dS = s - race.lastS;
      if (dS > 0.5) dS -= 1;
      if (dS < -0.5) dS += 1;
      if (Math.abs(dS) < 0.08) race.lapAcc += dS;
      race.lastS = s;
      if (race.lapAcc >= 0.997) {
        race.lapAcc -= 1;
        const lt = race.t - race.lapStamp;
        race.lapStamp = race.t;
        race.lapTimes.push(lt);
        if (race.lap >= LAPS_TOTAL) finish();
        else {
          race.lap++;
          popups.push({ x: car.x, y: car.y - 40, t: 0, txt: "lap " + (race.lap - 1) + " — " + fmtTime(lt), color: "#9dffb0" });
        }
      }
      race.t += dt;
      stepGhost(dt, race.t);
    }
  }

  // ---- race flow -------------------------------------------------------------
  function fmtTime(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  function startRace() {
    resetRun();
    race.state = "count";
    race.count = 3.5;
    $("driftIntro").hidden = true;
    $("driftDone").hidden = true;
    $("driftHud").hidden = false;
    mapCanvas.hidden = false;
    $("driftCount").hidden = false;
  }

  function finish() {
    // whatever is still pending counts — you crossed the line sideways, respect
    bank();
    race.state = "done";
    const total = race.t;
    const goals = [
      { txt: "🏁 finished 3 laps", ok: true },
      { txt: "💨 " + GOAL_SCORE.toLocaleString() + " drift pts", ok: race.score >= GOAL_SCORE },
      { txt: "⏱️ under " + fmtTime(GOAL_TIME), ok: total <= GOAL_TIME },
    ];
    const newScore = race.score > best.score;
    const newTime = best.time === 0 || total < best.time;
    if (newScore) best.score = race.score;
    if (newTime) best.time = total;
    try {
      localStorage.setItem("drift.bestScore", String(best.score));
      localStorage.setItem("drift.bestTime", String(best.time));
    } catch (e) { /* ignore */ }

    // settle the ghost race: let the ghost finish its run for an exact margin
    let ghostLine = "";
    if (ghost) {
      let t = race.t, guard = 0;
      while (!ghost.done && guard++ < 20000) { t += 0.05; stepGhost(0.05, t); }
      const margin = ghost.finishT - race.t;
      ghostLine = margin >= 0
        ? "<br>👻 You beat the <b>" + ghost.p.label + "</b> ghost by <b>" + margin.toFixed(1) + "s</b>!"
        : "<br>👻 The <b>" + ghost.p.label + "</b> ghost got you by <b>" + (-margin).toFixed(1) +
          "s</b> — it finished at " + fmtTime(ghost.finishT) + ".";
    }

    const bestLap = Math.min.apply(null, race.lapTimes);
    $("doneTitle").textContent = goals.every((g) => g.ok) ? "👑 Drift King!" : "🏁 Checkered flag!";
    $("doneStats").innerHTML =
      "Time <b>" + fmtTime(total) + "</b>" + (newTime ? "<span class='newbest'>NEW BEST</span>" : "") +
      " · Drift score <b>" + race.score.toLocaleString() + "</b>" + (newScore ? "<span class='newbest'>NEW BEST</span>" : "") +
      "<br>Best lap <b>" + fmtTime(bestLap) + "</b> · Cones <b>" + race.conesHit +
      "</b> · Tire walls <b>" + race.wallsHit + "</b>" + ghostLine;
    const dg = $("doneGoals");
    dg.innerHTML = "";
    for (const g of goals) {
      const el = document.createElement("span");
      el.textContent = (g.ok ? "★ " : "☆ ") + g.txt;
      if (g.ok) el.classList.add("earned");
      dg.appendChild(el);
    }
    $("driftDone").hidden = false;
  }

  $("driftPlayBtn").addEventListener("click", startRace);
  $("driftRetry").addEventListener("click", startRace);

  // ghost difficulty picker (choice is remembered)
  const ghostBtns = document.querySelectorAll("#ghostRow button");
  function paintGhostRow() {
    ghostBtns.forEach((b) => b.classList.toggle("sel", b.dataset.ghost === ghostDiff));
  }
  ghostBtns.forEach((b) => b.addEventListener("click", () => {
    ghostDiff = b.dataset.ghost;
    try { localStorage.setItem("drift.ghost", ghostDiff); } catch (e) { /* ignore */ }
    paintGhostRow();
  }));
  paintGhostRow();

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

  let overview = false; // M key: zoom out and study the whole circuit
  function updateCamera(dt) {
    if (overview) {
      const zt = Math.min(view.cw / (WORLD_W + 80), view.ch / (WORLD_H + 80));
      cam.x += (WORLD_W / 2 - cam.x) * Math.min(1, 4 * dt);
      cam.y += (WORLD_H / 2 - cam.y) * Math.min(1, 4 * dt);
      cam.z += (zt - cam.z) * Math.min(1, 4 * dt);
      return;
    }
    const speed = Math.hypot(car.vx, car.vy);
    const tx = car.x + car.vx * 0.32;
    const ty = car.y + car.vy * 0.32;
    const k = Math.min(1, 3.2 * dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    const base = clamp(Math.min(view.cw / 1350, view.ch / 950), 0.42, 1.5);
    const zt = base * (1.06 - 0.24 * Math.min(speed / 620, 1));
    cam.z += (zt - cam.z) * Math.min(1, 2.5 * dt);
    cam.shake = Math.max(0, cam.shake - 26 * dt);
  }

  // ---- drawing ---------------------------------------------------------------
  function drawCone(g, c) {
    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.rot);
    g.globalAlpha = c.hit ? 0.8 : 1;
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(-8, -8, 17, 17); // shadow-ish base
    g.fillStyle = "#e8681c";
    g.fillRect(-7, -7, 14, 14);
    g.fillStyle = "#f5f0e4";
    g.fillRect(-7, -2, 14, 4);
    g.fillStyle = "#ff8b3d";
    g.beginPath(); g.arc(0, 0, 3.4, 0, TAU); g.fill();
    g.restore();
  }

  function drawBarrier(g, b) {
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath(); g.arc(b.x + 3, b.y + 4, b.r, 0, TAU); g.fill();
    g.fillStyle = "#191b1e";
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill();
    g.strokeStyle = "#2c2f34"; g.lineWidth = 5;
    g.beginPath(); g.arc(b.x, b.y, b.r - 6, 0, TAU); g.stroke();
    g.fillStyle = "#3a3d43";
    g.beginPath(); g.arc(b.x, b.y, b.r - 17, 0, TAU); g.fill();
  }

  function drawGhost(g) {
    if (!ghost) return;
    g.save();
    g.translate(ghost.x, ghost.y);
    g.rotate(ghost.h);
    g.globalAlpha = 0.42;
    g.fillStyle = "rgb(" + ghost.p.tint + ")";
    g.beginPath();
    g.moveTo(CAR_L / 2, 0);
    g.lineTo(CAR_L * 0.30, -CAR_HW);
    g.lineTo(-CAR_L * 0.42, -CAR_HW * 0.9);
    g.lineTo(-CAR_L / 2, -CAR_HW * 0.55);
    g.lineTo(-CAR_L / 2, CAR_HW * 0.55);
    g.lineTo(-CAR_L * 0.42, CAR_HW * 0.9);
    g.lineTo(CAR_L * 0.30, CAR_HW);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(10, 14, 12, 0.7)";
    g.fillRect(-CAR_L * 0.18, -CAR_HW * 0.62, CAR_L * 0.34, CAR_HW * 1.24);
    g.restore();
    // a little 👻 bobbing over the roof so it reads as the ghost at a glance
    g.save();
    g.globalAlpha = 0.6;
    g.font = "16px sans-serif";
    g.textAlign = "center";
    g.fillText("👻", ghost.x, ghost.y - 24 + Math.sin(performance.now() / 260) * 3);
    g.restore();
  }

  function drawCar(g) {
    g.save();
    g.translate(car.x, car.y);
    // drop shadow
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.save(); g.rotate(car.h);
    g.fillRect(-CAR_L / 2 + 3, -CAR_HW + 4, CAR_L, CAR_HW * 2);
    g.restore();
    g.rotate(car.h);

    const braking = input.brake || input.hand;
    // wheels (fronts turned with the steering input)
    g.fillStyle = "#121316";
    const steerA = car.steer * 0.42;
    const wheel = (x, y, a) => {
      g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-5.5, -2.6, 11, 5.2); g.restore();
    };
    wheel(CAR_L * 0.30, -CAR_HW * 0.92, steerA);
    wheel(CAR_L * 0.30, CAR_HW * 0.92, steerA);
    wheel(-CAR_L * 0.32, -CAR_HW * 0.92, 0);
    wheel(-CAR_L * 0.32, CAR_HW * 0.92, 0);
    // body
    const grad = g.createLinearGradient(-CAR_L / 2, 0, CAR_L / 2, 0);
    grad.addColorStop(0, "#c8402f");
    grad.addColorStop(0.55, "#ff6a3c");
    grad.addColorStop(1, "#ff9d52");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(CAR_L / 2, 0);
    g.lineTo(CAR_L * 0.30, -CAR_HW);
    g.lineTo(-CAR_L * 0.42, -CAR_HW * 0.9);
    g.lineTo(-CAR_L / 2, -CAR_HW * 0.55);
    g.lineTo(-CAR_L / 2, CAR_HW * 0.55);
    g.lineTo(-CAR_L * 0.42, CAR_HW * 0.9);
    g.lineTo(CAR_L * 0.30, CAR_HW);
    g.closePath();
    g.fill();
    // cabin + spoiler
    g.fillStyle = "#22141a";
    g.fillRect(-CAR_L * 0.18, -CAR_HW * 0.62, CAR_L * 0.34, CAR_HW * 1.24);
    g.fillStyle = "#8e2c1e";
    g.fillRect(-CAR_L / 2 - 2, -CAR_HW * 0.95, 5, CAR_HW * 1.9);
    // headlights / brake lights
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
    g.fillStyle = "#17281a";
    g.fillRect(0, 0, view.cw, view.ch);

    const shx = (Math.random() - 0.5) * cam.shake;
    const shy = (Math.random() - 0.5) * cam.shake;
    g.translate(view.cw / 2 + shx, view.ch / 2 + shy);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);

    g.drawImage(staticC, 0, 0);
    g.drawImage(skidC, 0, 0, WORLD_W, WORLD_H);

    for (const b of barriers) drawBarrier(g, b);
    for (const c of cones) drawCone(g, c);
    drawGhost(g);
    drawCar(g);

    // smoke over the car
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.t += dt;
      if (p.t >= p.life) { smoke.splice(i, 1); continue; }
      const a = 1 - p.t / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt;
      g.fillStyle = p.flame
        ? "rgba(255, " + Math.round(120 + 100 * a) + ", 50," + (0.55 * a).toFixed(3) + ")"
        : p.grass
        ? "rgba(112, 96, 58," + (0.35 * a).toFixed(3) + ")"
        : "rgba(206, 208, 214," + (0.26 * a).toFixed(3) + ")";
      g.beginPath();
      g.arc(p.x, p.y, p.flame ? p.r * a + 1.5 : p.r + p.t * 26, 0, TAU);
      g.fill();
    }

    // floating score popups
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

    // live combo readout hovering by the car while a slide is cooking
    if (race.pending >= 1 && race.state === "race") {
      g.font = "700 17px 'Space Grotesk', sans-serif";
      g.fillStyle = car.drifting ? "#ffb35c" : "rgba(255,179,92,0.55)";
      g.fillText(Math.floor(race.pending) + (race.combo > 1 ? "  ×" + race.combo : ""), car.x, car.y - 34);
    }
  }

  function renderMap() {
    const g = mapCanvas.getContext("2d");
    g.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    g.drawImage(mapBase, 0, 0);
    const sc = mapBase.sc, ox = mapBase.ox, oy = mapBase.oy;
    if (ghost) {
      g.fillStyle = "rgba(" + ghost.p.tint + ", 0.8)";
      g.beginPath();
      g.arc(ox + ghost.x * sc, oy + ghost.y * sc, 3.5, 0, TAU);
      g.fill();
    }
    g.fillStyle = car.drifting ? "#ffb35c" : "#ff5a3c";
    g.beginPath();
    g.arc(ox + car.x * sc, oy + car.y * sc, 4, 0, TAU);
    g.fill();
  }

  // ---- HUD -------------------------------------------------------------------
  const hud = {
    lap: $("hudLap"), time: $("hudTime"), score: $("hudScore"),
    pending: $("hudPending"), combo: $("hudCombo"), comboWrap: $("hudComboWrap"),
    speed: $("hudSpeed"), best: $("hudBest"),
    ghost: $("hudGhost"), ghostWrap: $("hudGhostWrap"),
  };
  function renderHud() {
    hud.lap.textContent = String(Math.min(race.lap, LAPS_TOTAL));
    hud.time.textContent = fmtTime(race.t);
    hud.score.textContent = race.score.toLocaleString();
    hud.pending.textContent = race.pending >= 1 ? " +" + Math.floor(race.pending) : "";
    hud.combo.textContent = "×" + race.combo;
    hud.comboWrap.classList.toggle("hot", race.combo >= 3);
    hud.speed.textContent = String(Math.round(Math.hypot(car.vx, car.vy) * KMH));
    hud.speed.classList.toggle("boosting", race.boost > 0);
    hud.best.textContent = best.score > 0 ? best.score.toLocaleString() : "—";
    hud.ghostWrap.hidden = !ghost;
    if (ghost) {
      // signed gap in flavour-metres: + means you're ahead of the ghost
      const playerDist = (race.lap - 1 + race.lapAcc) * track.total;
      const gap = (playerDist - ghost.dist) * KMH / 3.6;
      hud.ghost.textContent = (gap >= 0 ? "+" : "−") + Math.abs(Math.round(gap)) + "m";
      hud.ghost.classList.toggle("ahead", gap >= 0);
      hud.ghost.classList.toggle("behind", gap < 0);
    }
  }

  (function introBest() {
    if (best.score > 0 || best.time > 0) {
      $("introBest").textContent = "Your bests — score " +
        (best.score > 0 ? best.score.toLocaleString() : "—") + ", time " +
        (best.time > 0 ? fmtTime(best.time) : "—") + ".";
    }
  })();

  // ---- main loop ---------------------------------------------------------
  placeCarAt(SPAWN_IDX);
  cam.x = car.x; cam.y = car.y;
  cam.z = clamp(Math.min(view.cw / 1350, view.ch / 950), 0.42, 1.5);

  const countEl = $("driftCount");
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000) || 0.016;
    last = now;

    if (race.state === "count") {
      race.count -= dt;
      const c = Math.ceil(race.count - 0.5);
      if (race.count <= 0.5) {
        countEl.textContent = "GO!";
        countEl.classList.add("go");
      } else {
        countEl.textContent = String(c);
        countEl.classList.remove("go");
      }
      if (race.count <= 0) {
        countEl.hidden = true;
        race.state = "race";
      }
    }

    step(dt);
    updateCamera(dt);
    render(dt);
    renderMap();
    renderHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // tiny handle for tuning the physics from the console
  window.__drift = { car, race, input, track, stepGhost, get ghost() { return ghost; } };
})();
