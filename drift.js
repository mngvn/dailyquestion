// drift.js — "Drift King". A top-down drift racer, now a four-round tour.
//
// The whole game is built around one idea: points only flow while the car is
// SIDEWAYS. The physics use a "bicycle with tire grip + weight transfer"
// model — the velocity is split into a forward and a lateral component in the
// car's own frame, and the tires constantly try to kill the lateral part.
// Three ways to break them loose: pull the handbrake, trail-brake into the
// corner (braking pitches the weight forward and lightens the rears), or just
// carry silly speed. Once sideways, throttle keeps the rears spinning and the
// slide alive; lifting off lets the tires hook back up. The angle between
// where the car POINTS and where it MOVES (the slip angle) is what earns
// drift points.
//
// Four circuits, unlocked in order by finishing the one before. Each has its
// own surface, goals and personality — the last one is packed snow, where the
// grip numbers themselves are scaled down and everything is a drift.
//
// The camera defaults to a chase view that rotates with the car (press C for
// the classic north-up view, M for a full-track overview). Physics run on a
// fixed 120 Hz timestep so the car behaves identically at any frame rate.

(function () {
  "use strict";

  const canvas = document.getElementById("driftCanvas");
  const ctx = canvas.getContext("2d");

  // ---- helpers ---------------------------------------------------------------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // shortest signed difference between two angles
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  const $ = (id) => document.getElementById(id);

  // ---- the tour --------------------------------------------------------------
  // Each track: control points of a closed Catmull-Rom centerline, a world
  // size, a surface grip factor, per-track goals, and a palette so every stop
  // on the tour looks like somewhere else.
  const TRACKS = [
    {
      id: "sunset", name: "Sunset Circuit", icon: "🌇", laps: 3,
      blurb: "Where it all starts: a fast right-hand sweeper, a twisty infield, a chicane across the top.",
      w: 2600, h: 1800, trackW: 150,
      goalScore: 12000, goalTime: 105,
      surface: { grip: 1 },
      coneCorners: 7,
      pal: {
        ground: "#17281a", stripe: "rgba(255,255,255,0.028)", tuft: "rgba(0,0,0,0.16)",
        edge: "#ded8ca", kerb: "#c8402f", road: "#33363d", roadMid: "#383b43",
        dust: "112, 96, 58", map: "rgba(240,234,217,0.5)",
      },
      cps: [
        [420, 1480], [980, 1530], [1560, 1520], [2040, 1420],
        [2320, 1120], [2360, 780], [2160, 520],
        [1840, 460], [1620, 640], [1560, 900],
        [1360, 1060], [1120, 1000], [1040, 760],
        [1200, 520], [1080, 300], [780, 240],
        [480, 300], [300, 560], [240, 900], [280, 1220],
      ],
    },
    {
      id: "docks", name: "Midnight Docks", icon: "🌃", laps: 3,
      blurb: "Container-yard streets under sodium light — narrow, technical, hairpins stacked on hairpins.",
      w: 2400, h: 1700, trackW: 132,
      goalScore: 14000, goalTime: 127,
      surface: { grip: 1 },
      coneCorners: 9,
      pal: {
        ground: "#13161c", stripe: "rgba(255,255,255,0.02)", tuft: "rgba(0,0,0,0.3)",
        edge: "#c9c4b0", kerb: "#d8b62e", road: "#282b32", roadMid: "#2d3139",
        dust: "88, 90, 102", map: "rgba(226,220,190,0.5)",
      },
      cps: [
        [420, 1420], [1000, 1470], [1600, 1450], [2050, 1340],
        [2220, 1080], [2150, 840],
        [1880, 760], [1740, 940], [1500, 1020],
        [1240, 950], [1180, 700], [1360, 520],
        [1620, 460], [1950, 440], [2130, 330],
        [2130, 190], [1950, 110], [1400, 150], [1000, 140],
        [620, 200], [400, 380],
        [560, 610], [710, 730],
        [720, 880], [560, 1000], [330, 1080], [280, 1280],
      ],
    },
    {
      id: "sahara", name: "Sahara Sweep", icon: "🏜️", laps: 3,
      blurb: "Huge, fast and flowing — wide tarmac through the dunes, built for holding fourth-gear slides.",
      w: 3000, h: 2000, trackW: 170,
      goalScore: 10000, goalTime: 100,
      surface: { grip: 1 },
      coneCorners: 5,
      pal: {
        ground: "#4a3a22", stripe: "rgba(255,241,200,0.04)", tuft: "rgba(0,0,0,0.18)",
        edge: "#e8dcc0", kerb: "#c8402f", road: "#3b3d42", roadMid: "#43454c",
        dust: "170, 142, 88", map: "rgba(240,226,190,0.5)",
      },
      cps: [
        [820, 1640], [1400, 1710], [1950, 1690], [2400, 1560],
        [2740, 1250], [2760, 850], [2520, 540],
        [2140, 400], [1750, 430], [1450, 560],
        [1150, 680], [900, 640], [760, 420],
        [480, 300], [260, 480], [230, 780],
        [380, 1000], [490, 1220], [600, 1470],
      ],
    },
    {
      id: "glacier", name: "Glacier Gauntlet", icon: "❄️", laps: 3,
      blurb: "Packed snow, studless tires, no straights worth the name. Everything is a drift whether you like it or not.",
      w: 2600, h: 1800, trackW: 140,
      goalScore: 16000, goalTime: 132,
      surface: { grip: 0.78 },
      coneCorners: 8,
      pal: {
        ground: "#c2ced8", stripe: "rgba(255,255,255,0.2)", tuft: "rgba(74,96,116,0.18)",
        edge: "#eef3f7", kerb: "#2f6fc4", road: "#3c414b", roadMid: "#454b57",
        dust: "236, 243, 249", map: "rgba(30,44,60,0.55)",
      },
      cps: [
        [660, 1545], [1020, 1585], [1400, 1500], [1680, 1320],
        [1900, 1440], [2200, 1400], [2340, 1160],
        [2200, 940], [1960, 900], [1840, 700],
        [2000, 500], [1880, 280], [1560, 240],
        [1320, 380], [1300, 620], [1100, 760],
        [860, 660], [820, 400], [560, 300],
        [300, 420], [260, 700], [420, 880],
        [600, 990], [655, 1160], [545, 1360],
      ],
    },
  ];

  // ---- persistence ---------------------------------------------------------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } },
  };
  // best score/time per track (the old single-track keys migrate into sunset)
  if (store.get("drift.bestScore") && !store.get("drift.best.sunset.score")) {
    store.set("drift.best.sunset.score", store.get("drift.bestScore"));
    store.set("drift.best.sunset.time", store.get("drift.bestTime") || 0);
  }
  function loadBest(id) {
    return {
      score: Math.max(0, +store.get("drift.best." + id + ".score") || 0),
      time: Math.max(0, +store.get("drift.best." + id + ".time") || 0),
    };
  }
  function saveBest(id, b) {
    store.set("drift.best." + id + ".score", b.score);
    store.set("drift.best." + id + ".time", b.time);
  }

  let unlocked = clamp(Math.floor(+store.get("drift.unlocked") || 1), 1, TRACKS.length);
  let trackIdx = Math.max(0, TRACKS.findIndex((t) => t.id === store.get("drift.track")));
  if (trackIdx >= unlocked) trackIdx = 0;

  let camMode = store.get("drift.cam") === "classic" ? "classic" : "chase";

  // ---- track building --------------------------------------------------------
  // Sample the centerline densely. Each sample carries position, unit tangent,
  // unit normal (driver's right-hand side), cumulative distance and curvature.
  function sampleLoop(CPS) {
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
  }

  function buildTrack(def) {
    const { pts, n: m, total } = sampleLoop(def.cps);
    const HW = def.trackW / 2;

    // the longest low-curvature run hosts the start/finish straight: the line
    // sits a third of the way in, so most of the straight is still ahead of
    // you at lights-out, and the grid a little before the line
    let run = 0, bestLen = 0, bestEnd = 0;
    for (let i = 0; i < m * 2; i++) {
      if (Math.abs(pts[i % m].k) < 0.0015) {
        run++;
        if (run > bestLen) { bestLen = run; bestEnd = i % m; }
      } else run = 0;
    }
    const runStart = bestEnd - bestLen + 1;
    const startIdx = ((runStart + Math.floor(bestLen * 0.3)) % m + m) % m;
    const spawnIdx = ((startIdx - Math.min(16, Math.floor(bestLen * 0.3))) % m + m) % m;

    // ---- obstacles: cones at every apex + slalom cones on straights, tire
    // walls waiting on the outside of the fastest corner exits ----------------
    const cones = [];
    const barriers = [];
    const TH = 0.0032;
    const used = new Array(m).fill(false);
    const corners = [];
    for (let i = 0; i < m; i++) {
      if (used[i] || Math.abs(pts[i].k) < TH) continue;
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
        x: p.x + p.nx * latFrac * HW,
        y: p.y + p.ny * latFrac * HW,
        rot: Math.random() * TAU, hit: false, vx: 0, vy: 0, spin: 0,
      });
    };

    // three cones marking the inside of each significant corner
    for (const c of corners.slice(0, def.coneCorners)) {
      const side = Math.sign(pts[c.apex].k) || 1; // inside of the turn
      addCone(c.apex, side * 0.62);
      addCone(c.apex - 9, side * 0.5);
      addCone(c.apex + 9, side * 0.5);
    }
    // tire walls catch you on the OUTSIDE of the fastest corner exits — but
    // circuits fold close to themselves, so only keep spots that stay clear
    // of every OTHER piece of track (and its kerbs)
    const BARRIER_R = 28;
    for (const c of corners.slice(0, 6)) {
      if (barriers.length >= 3) break;
      const idx = (c.apex + 26) % m;
      const side = -(Math.sign(pts[c.apex].k) || 1);
      const p = pts[idx];
      const bx = p.x + p.nx * side * HW * 1.68;
      const by = p.y + p.ny * side * HW * 1.68;
      let clear = true;
      for (let j = 0; j < m; j++) {
        const away = Math.min(Math.abs(j - idx), m - Math.abs(j - idx));
        if (away < 30) continue; // its own stretch of track is allowed nearby
        const q = pts[j];
        if (Math.hypot(q.x - bx, q.y - by) < HW + 15 + BARRIER_R + 6) { clear = false; break; }
      }
      if (clear) barriers.push({ x: bx, y: by, r: BARRIER_R });
    }
    // slalom cones down the long straights: alternate sides, forcing a weave
    run = 0;
    for (let i = 0; i < m; i++) {
      const straight = Math.abs(pts[i].k) < 0.0012;
      run = straight ? run + 1 : 0;
      const nearStart = Math.min(Math.abs(i - startIdx), m - Math.abs(i - startIdx)) < 26;
      if (run > 0 && run % 26 === 0 && !nearStart) {
        addCone(i, (Math.floor(run / 26) % 2 === 0 ? 1 : -1) * 0.4);
      }
    }

    // ---- pre-rendered static layer: ground + kerbs + asphalt, painted once --
    const pal = def.pal;
    const staticC = document.createElement("canvas");
    staticC.width = def.w; staticC.height = def.h;
    {
      const g = staticC.getContext("2d");
      g.fillStyle = pal.ground;
      g.fillRect(0, 0, def.w, def.h);
      g.fillStyle = pal.stripe;
      for (let y = 0; y < def.h; y += 240) g.fillRect(0, y, def.w, 120);
      // a scattering of flecks so the ground reads as texture at speed
      g.fillStyle = pal.tuft;
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 900; i++) {
        g.fillRect(rnd() * def.w, rnd() * def.h, 3 + rnd() * 4, 2 + rnd() * 3);
      }

      const path = () => {
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < m; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
      };
      g.lineJoin = "round"; g.lineCap = "round";
      // striped kerbs peeking out on both edges
      path(); g.lineWidth = def.trackW + 30; g.strokeStyle = pal.edge; g.stroke();
      g.setLineDash([26, 26]);
      path(); g.lineWidth = def.trackW + 30; g.strokeStyle = pal.kerb; g.stroke();
      g.setLineDash([]);
      // asphalt, with a lighter worn band in the middle
      path(); g.lineWidth = def.trackW; g.strokeStyle = pal.road; g.stroke();
      path(); g.lineWidth = def.trackW - 34; g.strokeStyle = pal.roadMid; g.stroke();
      // start/finish checkers laid across the track
      const s = pts[startIdx];
      g.save();
      g.translate(s.x, s.y);
      g.rotate(Math.atan2(s.ty, s.tx));
      const sq = 12, cols = 2, rows = Math.ceil(def.trackW / sq);
      for (let cx = 0; cx < cols; cx++) {
        for (let ry = 0; ry < rows; ry++) {
          g.fillStyle = (cx + ry) % 2 === 0 ? "#e8e4da" : "#17181c";
          g.fillRect(cx * sq - sq, ry * sq - def.trackW / 2, sq, sq);
        }
      }
      g.restore();
    }

    // minimap outline, pre-rendered once
    const mapBase = document.createElement("canvas");
    {
      const w = 200, h = 150;
      mapBase.width = w; mapBase.height = h;
      const g = mapBase.getContext("2d");
      const sc = Math.min((w - 24) / def.w, (h - 24) / def.h);
      const ox = (w - def.w * sc) / 2, oy = (h - def.h * sc) / 2;
      mapBase.sc = sc; mapBase.ox = ox; mapBase.oy = oy;
      g.beginPath();
      g.moveTo(ox + pts[0].x * sc, oy + pts[0].y * sc);
      for (let i = 1; i < m; i++) g.lineTo(ox + pts[i].x * sc, oy + pts[i].y * sc);
      g.closePath();
      g.lineJoin = "round";
      g.lineWidth = 7; g.strokeStyle = "rgba(0,0,0,0.55)"; g.stroke();
      g.lineWidth = 4; g.strokeStyle = pal.map; g.stroke();
      const s = pts[startIdx];
      g.fillStyle = "#ffb35c";
      g.beginPath(); g.arc(ox + s.x * sc, oy + s.y * sc, 3, 0, TAU); g.fill();
    }

    return { def, pts, n: m, total, halfW: HW, startIdx, spawnIdx, cones, barriers, staticC, mapBase };
  }

  // the current circuit (built on demand — only one lives in memory at a time)
  let T = null;

  function nearestSample(x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < T.n; i++) {
      const p = T.pts[i];
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, dist: Math.sqrt(bd) };
  }

  // skid marks accumulate here for the whole run (half resolution is plenty)
  const SKID_SCALE = 0.5;
  const skidC = document.createElement("canvas");
  let skidCtx = null;
  function initSkid() {
    skidC.width = T.def.w * SKID_SCALE;
    skidC.height = T.def.h * SKID_SCALE;
    skidCtx = skidC.getContext("2d");
    skidCtx.scale(SKID_SCALE, SKID_SCALE);
    skidCtx.lineCap = "round";
  }

  const mapCanvas = $("driftMap");

  // ---- car physics constants ---------------------------------------------
  const PHYS_DT = 1 / 120;   // fixed timestep: identical car at any frame rate
  const ACCEL = 640;         // engine push (px/s²)
  const BRAKE = 680;         // footbrake — firm, but soft enough to trail
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
  const WT_GAS = 0.45;       // weight transfer: throttle squats the rear (stable)…
  const WT_BRAKE = 1.0;      //   …braking pitches forward, lightening the rears
  const WT_GRIP = 0.58;      // how much that transfer swings the rear grip
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

  // ---- state ---------------------------------------------------------------
  const car = {
    x: 0, y: 0, h: 0,        // position, heading
    vx: 0, vy: 0, w: 0,      // velocity, yaw rate
    steer: 0, grip: GRIP_ROAD, wt: 0,
    slip: 0, drifting: false, onTrack: true,
    skidL: null, skidR: null, // previous rear-tire points for skid segments
  };
  const cam = { x: 0, y: 0, z: 1, rot: 0, anchor: 0.5, shake: 0 };
  const race = {
    state: "intro",          // intro | count | race | done
    t: 0, count: 0,
    lap: 1, lapAcc: 0, lastS: 0, lapStamp: 0, lapTimes: [],
    score: 0, pending: 0, combo: 1, chain: 0, grace: 0, boost: 0,
    conesHit: 0, wallsHit: 0,
  };
  let best = { score: 0, time: 0 };

  // ---- ghost riders ---------------------------------------------------------
  // A ghost is a point-mass pace car that follows the centerline with proper
  // braking physics: it reads the curvature ahead, works out the fastest speed
  // it can carry into each corner (v = √(latg/κ)), and brakes just in time.
  // Difficulty scales its top speed, cornering grip, and acceleration — and
  // the track's surface scales the ghost the same way it scales you.
  const GHOST_DIFFS = {
    easy:   { label: "easy",   vmax: 192, latg: 36,  acc: 168, brk: 480, tint: "141, 255, 176" },
    medium: { label: "medium", vmax: 248, latg: 68,  acc: 265, brk: 690, tint: "127, 183, 255" },
    hard:   { label: "hard",   vmax: 315, latg: 108, acc: 415, brk: 920, tint: "201, 143, 255" },
  };
  let ghostDiff = store.get("drift.ghost") || "easy";
  if (ghostDiff !== "none" && !GHOST_DIFFS[ghostDiff]) ghostDiff = "easy";
  let ghost = null;

  function initGhost() {
    const base = GHOST_DIFFS[ghostDiff];
    if (!base) { ghost = null; return; }
    const surf = T.def.surface.grip;
    const p = {
      label: base.label, tint: base.tint,
      vmax: base.vmax * (surf < 1 ? 0.88 : 1),
      latg: base.latg * surf * surf,
      acc: base.acc * surf, brk: base.brk * surf,
    };
    const s0 = T.pts[T.spawnIdx];
    ghost = {
      p, dist: 0, v: 0, i: T.spawnIdx,
      x: s0.x, y: s0.y, h: Math.atan2(s0.ty, s0.tx),
      done: false, finishT: 0,
    };
  }

  function stepGhost(dt, now) {
    if (!ghost || ghost.done) return;
    const p = ghost.p, pts = T.pts, m = T.n;
    // how fast may it go RIGHT NOW, given the corners within braking range?
    let lim = p.vmax;
    let idx = ghost.i, dAcc = 0;
    const horizon = (ghost.v * ghost.v) / (2 * p.brk) + 140;
    let guard = 0;
    while (dAcc < horizon && guard++ < m) {
      const nidx = (idx + 1) % m;
      let seg = pts[nidx].d - pts[idx].d;
      if (seg <= 0) seg += T.total;
      dAcc += seg;
      const vCorner = Math.sqrt(p.latg / (Math.abs(pts[nidx].k) + 1e-6));
      const vAllowed = Math.sqrt(vCorner * vCorner + 2 * p.brk * dAcc);
      if (vAllowed < lim) lim = vAllowed;
      idx = nidx;
    }
    if (ghost.v < lim) ghost.v = Math.min(lim, ghost.v + p.acc * dt);
    else ghost.v = Math.max(lim, ghost.v - p.brk * dt);
    ghost.dist += ghost.v * dt;
    if (ghost.dist >= T.def.laps * T.total) {
      ghost.dist = T.def.laps * T.total;
      ghost.done = true;
      ghost.finishT = now;
    }
    // resolve world position along the centerline
    const s = (pts[T.spawnIdx].d + ghost.dist) % T.total;
    guard = 0;
    for (;;) {
      const a = pts[ghost.i], b = pts[(ghost.i + 1) % m];
      let seg = b.d - a.d;
      if (seg <= 0) seg += T.total;
      let off = s - a.d;
      if (off < 0) off += T.total;
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

  const smoke = [];   // drift smoke + dust/snow-spray particles
  const popups = [];  // floating "+1234" style texts

  function placeCarAt(idx) {
    const p = T.pts[idx];
    car.x = p.x; car.y = p.y;
    car.h = Math.atan2(p.ty, p.tx);
    car.vx = car.vy = car.w = car.steer = car.wt = 0;
    car.grip = GRIP_ROAD; car.slip = 0; car.drifting = false;
    car.skidL = car.skidR = null;
    race.lastS = p.d / T.total;
  }

  function snapCamera() {
    cam.x = car.x; cam.y = car.y;
    cam.rot = camMode === "chase" ? -car.h - Math.PI / 2 : 0;
    cam.anchor = camMode === "chase" ? 0.62 : 0.5;
    cam.z = clamp(Math.min(view.cw / 1350, view.ch / 950), 0.42, 1.5);
  }

  function resetRun() {
    race.t = 0; race.lap = 1; race.lapAcc = 0; race.lapStamp = 0;
    race.lapTimes = [];
    race.score = 0; race.pending = 0; race.combo = 1; race.chain = 0; race.grace = 0;
    race.boost = 0;
    race.conesHit = 0; race.wallsHit = 0;
    initGhost();
    for (const c of T.cones) { c.hit = false; c.vx = c.vy = c.spin = 0; }
    smoke.length = 0; popups.length = 0;
    skidCtx.clearRect(0, 0, T.def.w, T.def.h);
    placeCarAt(T.spawnIdx);
    snapCamera();
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
    if (e.code === "KeyC") {
      camMode = camMode === "chase" ? "classic" : "chase";
      store.set("drift.cam", camMode);
      popups.push({ x: car.x, y: car.y, t: 0, txt: "camera: " + camMode, color: "#9dc9ff" });
    }
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
  hold("touchBrake", "brake");
  hold("touchDrift", "hand");
  const tr = $("touchRescue");
  if (tr) tr.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (race.state === "race") rescue();
  });

  // R key / stuck-in-the-weeds rescue: back onto the tarmac, pointed the right
  // way, at a standstill. Costs you the pending points, of course.
  function rescue() {
    spill();
    placeCarAt(nearestSample(car.x, car.y).i);
  }

  // ---- scoring ---------------------------------------------------------------
  function spill() {
    if (race.pending > 1) {
      popups.push({ x: car.x, y: car.y, t: 0, txt: "✗ " + Math.floor(race.pending), color: "#ff6b5e" });
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
      popups.push({ x: car.x, y: car.y, t: 0, txt, color: "#ffb35c" });
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
    const surf = T.def.surface.grip;
    const HW = T.halfW;

    const cs = Math.cos(car.h), sn = Math.sin(car.h);
    // velocity in the car's frame: vf along the nose, vl out the right door
    let vf = car.vx * cs + car.vy * sn;
    let vl = -car.vx * sn + car.vy * cs;
    const speed0 = Math.hypot(car.vx, car.vy);

    // trail-braking: braking while turning hard at speed spends part of the
    // brake force on rotating the car instead of stopping it
    const trailing = brake && Math.abs(car.steer) > 0.4 && vf > 140;
    if (gas) vf += ACCEL * (hand ? 0.6 : 1) * dt;
    if (brake) {
      if (vf > 8) vf -= BRAKE * (trailing ? 0.45 : 1) * dt;
      else vf = Math.max(vf - REV_ACCEL * dt, -REV_MAX);
    }
    if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), HAND_DECEL * dt);
    // nitro burn: extra push along the nose, well past the normal top speed
    if (drive && race.boost > 0) {
      vf += BOOST_ACCEL * dt;
      race.boost = Math.max(0, race.boost - dt);
    }
    vf -= (DRAG1 * vf + DRAG2 * vf * Math.abs(vf)) * dt;

    // weight transfer: throttle loads the rear axle, braking throws the mass
    // onto the nose. A light rear is a loose rear — brake INTO the corner and
    // the tail wants to come around without ever touching the handbrake.
    const wtT = (gas ? WT_GAS : 0) - (brake && vf > 60 ? WT_BRAKE : 0);
    car.wt += (wtT - car.wt) * Math.min(1, 5 * dt);

    // off the racing surface is treacle: big drag and no fun allowed
    const near = nearestSample(car.x, car.y);
    car.onTrack = near.dist <= HW + 8;
    if (!car.onTrack) vf -= vf * Math.min(1, 2.3 * dt);

    // tires: bleed off lateral velocity. Handbrake or an established slide
    // means far less lateral grip — and while sliding, throttle keeps the
    // rears lit (slide holds) while lifting lets them hook back up.
    let gripTarget = !car.onTrack ? GRIP_ROAD + 3
      : hand ? GRIP_HAND
      : car.drifting ? GRIP_DRIFT * (gas ? 0.82 : 1.45)
      : GRIP_ROAD;
    // weight transfer only matters while the tires still hold — once the car
    // is sliding, the gas/lift modifier above owns the rear axle
    if (car.onTrack && !hand && !car.drifting) gripTarget *= clamp(1 + WT_GRIP * car.wt, 0.42, 1.2);
    gripTarget *= surf;                       // snow scales everything down
    gripTarget *= 1 / (1 + speed0 * 0.0004);  // tires get greasy at big speed
    car.grip += (gripTarget - car.grip) * Math.min(1, 6 * dt);
    vl *= Math.exp(-car.grip * dt);

    car.vx = cs * vf - sn * vl;
    car.vy = sn * vf + cs * vl;

    // steering: authority scales up with speed (you can't pivot a parked car),
    // plus extra yaw while sliding so you can hold the angle or counter-steer.
    // Weight on the nose sharpens turn-in; weight on the tail washes it out.
    car.steer += (steerIn - car.steer) * Math.min(1, 9 * dt);
    const speed = Math.hypot(car.vx, car.vy);
    const auth = clamp(Math.abs(vf) / 250, 0, 1) * (vf < 0 ? -1 : 1) *
      clamp(1 - 0.22 * car.wt, 0.8, 1.25);
    let wT = car.steer * TURN_RATE * auth;
    if (car.drifting || hand || trailing) wT += car.steer * TURN_DRIFT * auth;
    // aligning torque: the tires constantly pull the nose back toward the
    // direction of travel — weakly under handbrake, firmly on grip
    if (vf > 40) {
      const align = hand ? ALIGN_HAND
        : car.drifting ? (gas ? ALIGN_HAND * 1.15 : ALIGN_HAND * 1.6)
        : ALIGN_ROAD;
      wT += car.slip * align * surf;
    }
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
    car.x = clamp(car.x, 30, T.def.w - 30);
    car.y = clamp(car.y, 30, T.def.h - 30);

    // slip angle: where the car points vs. where it travels
    car.slip = speed > 40 ? angDiff(Math.atan2(car.vy, car.vx), car.h) : 0;
    const wasDrifting = car.drifting;
    car.drifting = drive && Math.abs(car.slip) > SLIP_MIN &&
      speed > DRIFT_SPEED_MIN && vf > 0 && car.onTrack;

    // kerb rumble: ride the painted strip and the car buzzes
    const onKerb = car.onTrack && near.dist > HW * 0.74 && speed > 150;
    if (onKerb) cam.shake = Math.max(cam.shake, 1.4);

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
      if (smoke.length < 220 && Math.random() < 65 * dt) {
        smoke.push({
          x: rearX + (Math.random() - 0.5) * 10, y: rearY + (Math.random() - 0.5) * 10,
          vx: car.vx * 0.12 + (Math.random() - 0.5) * 26,
          vy: car.vy * 0.12 + (Math.random() - 0.5) * 26,
          r: 6 + Math.random() * 6, t: 0, life: 0.55 + Math.random() * 0.3, dust: false,
        });
      }
    } else {
      car.skidL = car.skidR = null;
    }
    if ((!car.onTrack && speed > 120 || onKerb) && smoke.length < 220 && Math.random() < 60 * dt) {
      smoke.push({
        x: rearX, y: rearY,
        vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
        r: 4 + Math.random() * 4, t: 0, life: 0.5, dust: true,
      });
    }
    // nitro flames licking out of the back while the boost burns
    if (drive && race.boost > 0 && smoke.length < 260 && Math.random() < 70 * dt) {
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
      for (const c of T.cones) {
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
          popups.push({ x: c.x, y: c.y, t: 0, txt: "cone!", color: "#ff6b5e" });
          car.vx *= 0.86; car.vy *= 0.86;
          cam.shake = Math.max(cam.shake, 4);
        }
      }
      for (const b of T.barriers) {
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
            popups.push({ x: car.x, y: car.y, t: 0, txt: "tire wall!", color: "#ff6b5e" });
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
      const s = T.pts[near.i].d / T.total;
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
        if (race.lap >= T.def.laps) finish();
        else {
          race.lap++;
          popups.push({ x: car.x, y: car.y, t: 0, txt: "lap " + (race.lap - 1) + " — " + fmtTime(lt), color: "#9dffb0" });
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
    const def = T.def;
    const total = race.t;
    const goals = [
      { txt: "🏁 finished " + def.laps + " laps", ok: true },
      { txt: "💨 " + def.goalScore.toLocaleString() + " drift pts", ok: race.score >= def.goalScore },
      { txt: "⏱️ under " + fmtTime(def.goalTime), ok: total <= def.goalTime },
    ];
    const newScore = race.score > best.score;
    const newTime = best.time === 0 || total < best.time;
    if (newScore) best.score = race.score;
    if (newTime) best.time = total;
    saveBest(def.id, best);

    // finishing a round unlocks the next stop on the tour
    let unlockLine = "";
    if (trackIdx + 1 < TRACKS.length && unlocked < trackIdx + 2) {
      unlocked = trackIdx + 2;
      store.set("drift.unlocked", unlocked);
      const nt = TRACKS[trackIdx + 1];
      unlockLine = "<br>🔓 New track unlocked: <b>" + nt.icon + " " + nt.name + "</b>";
      paintTrackRow();
    }

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
    $("doneTitle").textContent = goals.every((g) => g.ok)
      ? "👑 Drift King of " + def.name + "!"
      : "🏁 Checkered flag!";
    $("doneStats").innerHTML =
      def.icon + " <b>" + def.name + "</b><br>" +
      "Time <b>" + fmtTime(total) + "</b>" + (newTime ? "<span class='newbest'>NEW BEST</span>" : "") +
      " · Drift score <b>" + race.score.toLocaleString() + "</b>" + (newScore ? "<span class='newbest'>NEW BEST</span>" : "") +
      "<br>Best lap <b>" + fmtTime(bestLap) + "</b> · Cones <b>" + race.conesHit +
      "</b> · Tire walls <b>" + race.wallsHit + "</b>" + unlockLine + ghostLine;
    const dg = $("doneGoals");
    dg.innerHTML = "";
    for (const g of goals) {
      const el = document.createElement("span");
      el.textContent = (g.ok ? "★ " : "☆ ") + g.txt;
      if (g.ok) el.classList.add("earned");
      dg.appendChild(el);
    }
    const nextBtn = $("driftNext");
    nextBtn.hidden = !(trackIdx + 1 < TRACKS.length && unlocked > trackIdx + 1);
    if (!nextBtn.hidden) {
      nextBtn.textContent = "▶ Next: " + TRACKS[trackIdx + 1].icon + " " + TRACKS[trackIdx + 1].name;
    }
    $("driftDone").hidden = false;
  }

  $("driftPlayBtn").addEventListener("click", startRace);
  $("driftRetry").addEventListener("click", startRace);
  $("driftNext").addEventListener("click", () => {
    if (trackIdx + 1 < TRACKS.length && unlocked > trackIdx + 1) {
      loadTrack(trackIdx + 1);
      startRace();
    }
  });

  // ghost difficulty picker (choice is remembered)
  const ghostBtns = document.querySelectorAll("#ghostRow button");
  function paintGhostRow() {
    ghostBtns.forEach((b) => b.classList.toggle("sel", b.dataset.ghost === ghostDiff));
  }
  ghostBtns.forEach((b) => b.addEventListener("click", () => {
    ghostDiff = b.dataset.ghost;
    store.set("drift.ghost", ghostDiff);
    paintGhostRow();
  }));
  paintGhostRow();

  // ---- track picker ----------------------------------------------------------
  const trackRow = $("trackRow");
  function paintTrackRow() {
    trackRow.querySelectorAll("button").forEach((b) => {
      const i = +b.dataset.track;
      const locked = i >= unlocked;
      b.classList.toggle("sel", i === trackIdx);
      b.classList.toggle("locked", locked);
      b.disabled = locked;
      b.textContent = (locked ? "🔒" : TRACKS[i].icon) + " " + TRACKS[i].name;
      b.title = locked ? "Finish " + TRACKS[i - 1].name + " to unlock" : TRACKS[i].blurb;
    });
  }
  TRACKS.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.track = String(i);
    b.addEventListener("click", () => {
      if (i >= unlocked) return;
      loadTrack(i);
    });
    trackRow.appendChild(b);
  });

  function paintIntroInfo() {
    const def = T.def;
    $("trackBlurb").textContent = def.blurb;
    $("introGoals").innerHTML = "";
    for (const txt of [
      "🏁 finish " + def.laps + " laps",
      "💨 bank " + def.goalScore.toLocaleString() + " drift pts",
      "⏱️ under " + fmtTime(def.goalTime),
    ]) {
      const el = document.createElement("span");
      el.textContent = txt;
      $("introGoals").appendChild(el);
    }
    $("introBest").textContent = (best.score > 0 || best.time > 0)
      ? "Your " + def.name + " bests — score " +
        (best.score > 0 ? best.score.toLocaleString() : "—") + ", time " +
        (best.time > 0 ? fmtTime(best.time) : "—") + "."
      : "Your best score and time are saved per track.";
  }

  function loadTrack(i) {
    trackIdx = i;
    const def = TRACKS[i];
    store.set("drift.track", def.id);
    T = buildTrack(def);
    best = loadBest(def.id);
    initSkid();
    smoke.length = 0; popups.length = 0;
    canvas.style.background = def.pal.ground;
    $("driftChip").textContent = "🏎️ " + def.icon + " " + def.name;
    $("hudLapTotal").textContent = "/" + def.laps;
    placeCarAt(T.spawnIdx);
    snapCamera();
    paintTrackRow();
    paintIntroInfo();
  }

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
    let rotT = 0, anchorT = 0.5;
    if (overview) {
      const zt = Math.min(view.cw / (T.def.w + 80), view.ch / (T.def.h + 80));
      cam.x += (T.def.w / 2 - cam.x) * Math.min(1, 4 * dt);
      cam.y += (T.def.h / 2 - cam.y) * Math.min(1, 4 * dt);
      cam.z += (zt - cam.z) * Math.min(1, 4 * dt);
    } else {
      const speed = Math.hypot(car.vx, car.vy);
      // chase cam: look further down the road, sit the car low in the frame,
      // and rotate the world so the nose points up the screen
      const lead = camMode === "chase" ? 0.46 : 0.32;
      const tx = car.x + car.vx * lead;
      const ty = car.y + car.vy * lead;
      const k = Math.min(1, 3.2 * dt);
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
      const base = clamp(Math.min(view.cw / 1350, view.ch / 950), 0.42, 1.5);
      const zt = camMode === "chase"
        ? base * (1.28 - 0.34 * Math.min(speed / 620, 1))
        : base * (1.06 - 0.24 * Math.min(speed / 620, 1));
      cam.z += (zt - cam.z) * Math.min(1, 2.5 * dt);
      if (camMode === "chase") { rotT = -car.h - Math.PI / 2; anchorT = 0.62; }
    }
    cam.rot += angDiff(rotT, cam.rot) * Math.min(1, 3.6 * dt);
    cam.anchor += (anchorT - cam.anchor) * Math.min(1, 3 * dt);
    cam.shake = Math.max(0, cam.shake - 26 * dt);
  }

  // ---- drawing ---------------------------------------------------------------
  // text that stays upright no matter how the chase camera has the world tilted
  function worldText(g, txt, x, y, rise) {
    g.save();
    g.translate(x, y);
    g.rotate(-cam.rot);
    g.fillText(txt, 0, -rise);
    g.restore();
  }

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
    worldText(g, "👻", ghost.x, ghost.y, 24 - Math.sin(performance.now() / 260) * 3);
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
    const pal = T.def.pal;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.fillStyle = pal.ground;
    g.fillRect(0, 0, view.cw, view.ch);

    const shx = (Math.random() - 0.5) * cam.shake;
    const shy = (Math.random() - 0.5) * cam.shake;
    g.translate(view.cw / 2 + shx, view.ch * cam.anchor + shy);
    g.scale(cam.z, cam.z);
    g.rotate(cam.rot);
    g.translate(-cam.x, -cam.y);

    g.drawImage(T.staticC, 0, 0);
    g.drawImage(skidC, 0, 0, T.def.w, T.def.h);

    for (const b of T.barriers) drawBarrier(g, b);
    for (const c of T.cones) drawCone(g, c);
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
        : p.dust
        ? "rgba(" + pal.dust + "," + (0.35 * a).toFixed(3) + ")"
        : "rgba(206, 208, 214," + (0.26 * a).toFixed(3) + ")";
      g.beginPath();
      g.arc(p.x, p.y, p.flame ? p.r * a + 1.5 : p.r + p.t * 26, 0, TAU);
      g.fill();
    }

    // floating score popups (upright regardless of camera rotation)
    g.textAlign = "center";
    g.font = "700 22px 'Space Grotesk', sans-serif";
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.t += dt;
      if (p.t >= 1.1) { popups.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, 2 * (1.1 - p.t));
      g.fillStyle = p.color;
      worldText(g, p.txt, p.x, p.y, 30 + p.t * 42);
    }
    g.globalAlpha = 1;

    // live combo readout hovering by the car while a slide is cooking
    if (race.pending >= 1 && race.state === "race") {
      g.font = "700 17px 'Space Grotesk', sans-serif";
      g.fillStyle = car.drifting ? "#ffb35c" : "rgba(255,179,92,0.55)";
      worldText(g, Math.floor(race.pending) + (race.combo > 1 ? "  ×" + race.combo : ""), car.x, car.y, 34);
    }
  }

  function renderMap() {
    const g = mapCanvas.getContext("2d");
    g.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    g.drawImage(T.mapBase, 0, 0);
    const sc = T.mapBase.sc, ox = T.mapBase.ox, oy = T.mapBase.oy;
    if (ghost) {
      g.fillStyle = "rgba(" + ghost.p.tint + ", 0.8)";
      g.beginPath();
      g.arc(ox + ghost.x * sc, oy + ghost.y * sc, 3.5, 0, TAU);
      g.fill();
    }
    // the player is a little arrowhead so the map shows heading too
    g.save();
    g.translate(ox + car.x * sc, oy + car.y * sc);
    g.rotate(car.h);
    g.fillStyle = car.drifting ? "#ffb35c" : "#ff5a3c";
    g.beginPath();
    g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-2, 0); g.lineTo(-4, 4);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ---- HUD -------------------------------------------------------------------
  const hud = {
    lap: $("hudLap"), time: $("hudTime"), score: $("hudScore"),
    pending: $("hudPending"), combo: $("hudCombo"), comboWrap: $("hudComboWrap"),
    speed: $("hudSpeed"), best: $("hudBest"),
    ghost: $("hudGhost"), ghostWrap: $("hudGhostWrap"),
  };
  function renderHud() {
    hud.lap.textContent = String(Math.min(race.lap, T.def.laps));
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
      const playerDist = (race.lap - 1 + race.lapAcc) * T.total;
      const gap = (playerDist - ghost.dist) * KMH / 3.6;
      hud.ghost.textContent = (gap >= 0 ? "+" : "−") + Math.abs(Math.round(gap)) + "m";
      hud.ghost.classList.toggle("ahead", gap >= 0);
      hud.ghost.classList.toggle("behind", gap < 0);
    }
  }

  // ---- main loop ---------------------------------------------------------
  loadTrack(trackIdx);

  const countEl = $("driftCount");
  let last = performance.now();
  let physAcc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
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

    // fixed-step physics: the car handles the same at 30, 60 or 144 fps
    physAcc += dt;
    let steps = 0;
    while (physAcc >= PHYS_DT && steps < 6) {
      step(PHYS_DT);
      physAcc -= PHYS_DT;
      steps++;
    }
    if (steps === 6) physAcc = 0; // don't spiral on a slow tab

    updateCamera(dt);
    render(dt);
    renderMap();
    renderHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // tiny handle for tuning the physics from the console
  window.__drift = {
    car, race, input, cam, TRACKS, loadTrack, step, stepGhost, angDiff,
    get track() { return T; }, get ghost() { return ghost; },
  };
})();
