// orbit.js — "Orbit Surfer". A third-person, endless surf runner in orbit.
// The camera floats BEHIND and ABOVE your satellite, looking forward.
//
// Steep surf walls appear on alternating sides, separated by empty space.
// Ride a wall down — it's frictionless and pulls you inward, so you build
// momentum — then take a big LOFTY hop across the void and land on the next
// wall. Catch a glowing pad floating in the middle for a super-bounce and a
// temporary speed boost. The pace starts slow and ramps up the further you
// go. There's no finish line: just see how far you can ride. Best distance
// is saved.

(function () {
  "use strict";

  const VW = 960, VH = 600;                  // logical (letterboxed) viewport
  const canvas = document.getElementById("orbitCanvas");
  const ctx = canvas.getContext("2d");

  // ---- world constants -----------------------------------------------------
  // Each "wall" is a concave HALF-PIPE: a curved U you surf inside. Half-pipes
  // sit on alternating sides and are randomly cut, so you ride up the curve,
  // launch off it into the air, and fly across to the next one.
  const PR = 1.05;           // ball radius (world units)
  const PIPE_HW = 8.5;       // half-width of a half-pipe (lip to lip from centre)
  const OFF = 11;            // lateral offset of alternating pipe centres (±OFF) — wider than the pipes,
                             //   so ramps DON'T overlap: you have to launch off a side lip to cross
  const CURVE = 0.09;        // how steeply the pipe curves up its walls (lower = shallower walls)
  const HOLE_HW = 4;         // half-width of a floor hole (windy pipes)
  const HOLE_HL = 5;         // half-length (along z) of a floor hole
  const VOID = 26;           // how far you can fall below the pipe before you're lost

  // physics (tuned for 60fps; scaled by frame-time factor f)
  const G = 0.04;            // gravity accel (−y) — the ball is heavy, so hops are short + snappy
  const CURVE_GAIN = 0.6;    // curve pull toward the bottom — gentle, so you can roll up the walls
  const STRAFE = 0.04;       // lateral steer accel — stronger than the curve's pull at the lip
                             //   (≈0.037), so holding toward an edge always carries you over it
  const STRAFE_AIR = 0.028;  // a touch more nimble in the air, to line up the landing
  const VX_CAP = 0.8;        // lateral speed cap
  const LAT_FRICTION = 0.99; // light rolling friction — momentum persists so you can pump up the walls
  const AIR_DRAG = 0.992;    // in the air: sideways speed bleed
  const AIR_VZ_KEEP = 0.9985;  // airborne off a LIP LAUNCH: you keep nearly all your momentum
  const AIR_VZ_BLEED = 0.984;  // airborne off a FRONT DROP (or a hole): momentum bleeds away fast
  const LAND_GAIN = 0.4;     // landing DOWN onto a ramp turns your fall into forward momentum — gentle,
                             //   so a landing nudges you faster instead of slingshotting you
  const ROLL_ACC = 0.0022;   // rolling down the course builds forward momentum — slow ramp-up, so speed earns
  const LIP_SLOPE = 2 * CURVE * PIPE_HW;   // wall steepness at the lip (dy/dx) — converts speed → launch
  const LIP_LAUNCH = 0.24;   // outward speed above which you pop off the lip instead of being caught
  const LIP_VY_MAX = 1.25;   // cap on a momentum launch so you don't fly to the moon
  const EDGE_VY = 0.78;      // every ramp edge gives a strong pop UP, so you can loft to the next ramp
  const EDGE_VZ = 0.26;      //   ...and a solid forward kick — launching is how you go fast
  const LAUNCH_CARRY = 0.25; // extra forward kick per unit of outward speed at the lip: hit it hard, fly far
  const COMBO_GAIN = 0.03;   // bonus forward speed per landed launch in a chain...
  const COMBO_CAP = 6;       //   ...up to this chain length

  // momentum: forward speed builds up as you roll and can reach a high top speed.
  const VZ0 = 0.3, VZMAX = 2.0;
  const HOP_AIR = 2 * EDGE_VY / G;   // ≈ airtime of an edge pop, in frames (used to size the course)
  // course-sizing speed estimate (kept modest so a plain edge-pop always clears the cut;
  // real momentum lets you fly much further)
  function vzCap(z) { return clamp(0.42 + z * 0.00012, 0.42, 1.0); }

  // mid-air bounce pads: super-bounce + temporary speed boost. They float over
  // the void's centre; cross down through one and it flings you up and forward.
  const PLAT_HX = 9, PLAT_HZ = 10, PLAT_RISE = 11;
  const SUPER_BOUNCE = 1.0, BOOST_TIME = 150, BOOST_VZ = 1.7;

  // flavour scales for the HUD
  const SPEED_SCALE = 120;   // world u/frame -> "m/s"

  // ---- view / scaling ------------------------------------------------------
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1, cw: VW, ch: VH };
  const CAM_BACK = 16, CAM_UP = 11, PITCH = 0.38;
  const FOC = VH * 1.12;
  const HORIZON = VH * 0.40;
  const cosP = Math.cos(PITCH), sinP = Math.sin(PITCH);
  const cam = { x: 0, y: 0 };

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

  // ---- math helpers --------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function norm3(x, y, z) { const d = Math.hypot(x, y, z) || 1; return { x: x / d, y: y / d, z: z / d }; }

  // ---- the course ----------------------------------------------------------
  // A procedurally generated chain of downhill chutes that alternate left/right,
  // separated by forward gaps. Gap sizes scale with the local speed so one lofty
  // hop always reaches the next chute. Some gaps hold a central bounce pad.
  const SLOPE = 0.1;                                                  // course descends forward — you're falling
  function yBase(z) { return -z * SLOPE + 3 * Math.sin(z * 0.012); }  // downhill pipe-bottom height
  function dYBase(z) { const e = 1.0; return (yBase(z + e) - yBase(z - e)) / (2 * e); }

  let segs = [], plats = [];
  let genZ = 0, segIdx = 0, lastSide = 1, grng = 1;
  const GEN_AHEAD = 340;
  function grand() { grng = (grng * 1103515245 + 12345) & 0x7fffffff; return grng / 0x7fffffff; }

  // weaving centre of a pipe at depth z (windy pipes snake left/right)
  function centerOf(s, z) { return s.windy ? s.baseXc + s.amp * Math.sin(s.freq * (z - s.z0) + s.phase) : s.xc; }

  function genSeg() {
    const side = -lastSide; lastSide = side;             // pipe centre at side*OFF
    const reach = vzCap(genZ) * HOP_AIR;                 // forward distance one launch covers here
    const z0 = genZ;

    // every so often, a long WINDY connected pipe that snakes side to side with
    // holes punched in its floor — ride up the walls or hop to dodge them.
    if (segIdx > 2 && segIdx % 3 === 0) {
      const len = clamp(reach * (1.5 + grand() * 1.0), 110, 280);
      const z1 = z0 + len;
      const seg = { windy: true, side: 0, xc: 0, baseXc: 0,
        amp: 4 + grand() * 4, freq: (2 * Math.PI) / (130 + grand() * 80), phase: 0,   // gentle wind, enters centred
        z0, z1, holes: [] };
      // a few holes, kept clear of the entrance so you have time to read them
      const usable = len - 50;
      const nholes = 1 + Math.floor(usable / 110);
      for (let k = 0; k < nholes; k++) seg.holes.push(z0 + 40 + usable * ((k + 0.5) / nholes));
      segs.push(seg);
      const gap = clamp(reach * (0.45 + grand() * 0.4), 16, 64);
      genZ = z1 + gap; segIdx++;
      return;
    }

    // randomly-cut straight half-pipes: lengths + gaps vary, runway up front
    let len = clamp(reach * (0.7 + grand() * 0.5), 40, 120);
    if (segIdx === 0) len += 50; else if (segIdx < 3) len += 22;
    const z1 = z0 + len;
    segs.push({ windy: false, side, xc: side * OFF, z0, z1, holes: null });
    const gap = clamp(reach * (0.5 + grand() * 0.45), 16, 68);    // the random "cut" — a real jump
    const nextWindy = (segIdx + 1) > 2 && (segIdx + 1) % 3 === 0;
    if (segIdx > 0 && segIdx % 2 === 0 && !nextWindy) {           // no pad right before a windy pipe
      const pz = z1 + gap / 2;
      plats.push({ x: 0, z: pz, topY: yBase(pz) + PLAT_RISE, used: false });
    }
    genZ = z1 + gap; segIdx++;
  }
  function genReset() {
    // first pipe is on the LEFT and straddles z=0, so the player starts in it
    segs = []; plats = []; segIdx = 0; lastSide = 1; genZ = -18; grng = 1;
    while (genZ < pos.z + GEN_AHEAD) genSeg();
  }
  function genMore() {
    while (genZ < pos.z + GEN_AHEAD) genSeg();
    while (segs.length && segs[0].z1 < pos.z - 90) segs.shift();
    while (plats.length && plats[0].z < pos.z - 90) plats.shift();
  }
  function segAt(z) {
    for (const s of segs) if (z >= s.z0 && z <= s.z1) return s;
    return null;
  }

  function inHole(s, z, dx) {
    if (!s.holes || Math.abs(dx) >= HOLE_HW) return false;
    for (const h of s.holes) if (z >= h - HOLE_HL && z <= h + HOLE_HL) return true;
    return false;
  }

  // Surface query: is there a half-pipe at (x,z)? The pipe is a concave U
  // (y = bottom + CURVE·dx²) around its (possibly weaving) centre; the normal
  // tilts inward up the walls, so a launch fired along it flings you up + in.
  // Windy pipes can have holes in the floor (no surface near the centre).
  function surfaceAt(x, z) {
    const s = segAt(z);
    if (s) {
      const dx = x - centerOf(s, z);
      if (Math.abs(dx) <= PIPE_HW && !inHole(s, z, dx)) {
        const slope = 2 * CURVE * dx;                 // dy/dx across the pipe
        return { onWall: true, y: yBase(z) + CURVE * dx * dx, nx: -slope, ny: 1, nz: -dYBase(z), seg: s };
      }
    }
    return { onWall: false, y: yBase(z), seg: null };
  }

  // ---- state ---------------------------------------------------------------
  let phase = "intro";                 // intro | play | fail
  const pos = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
  let riding = false, ridingXc = 0;    // surfing a pipe, and its centre x
  let onSurface = false, offRamp = false, boost = 0;
  let lipLaunched = false, combo = 0;  // airborne via a lip launch; chained-launch counter
  let best = 0, clock = 0, shake = 0, camYsmooth = 0;
  let particles = [], trail = [];
  const input = { left: false, right: false };

  try { best = Math.max(0, +localStorage.getItem("orbit.bestDist") || 0); } catch (e) { /* ignore */ }

  function reset() {
    pos.z = 0; pos.x = -OFF;                    // resting in the bottom of the first (left) pipe
    genReset();
    pos.y = surfaceAt(pos.x, 0).y + PR;
    vel.x = 0; vel.y = 0; vel.z = VZ0;
    riding = true; ridingXc = -OFF;
    onSurface = true; offRamp = false; boost = 0;
    lipLaunched = false; combo = 0;
    cam.x = pos.x; cam.y = pos.y; camYsmooth = pos.y;
    particles = []; trail = []; shake = 0;
    input.left = input.right = false;
  }

  // ---- physics -------------------------------------------------------------
  // The ramps are far apart now, so LAUNCHING is the whole game: pop off a side
  // lip and you keep your momentum in the air, get a forward kick that scales
  // with how hard you hit the lip, and every landed launch extends a combo that
  // pays out bonus speed. Roll off the front (or fall through a hole) and you
  // drop with none of that — momentum bleeds fast and the combo resets.
  function rollOffFront() {                       // a drop, not a launch: no kick, hard bleed, combo lost
    riding = false; onSurface = false; offRamp = true;
    lipLaunched = false; combo = 0;
  }
  function popOffLip() {                          // launch off a side lip with your outward speed
    const out = Math.abs(vel.x);
    vel.y = Math.max(Math.min(out * LIP_SLOPE, LIP_VY_MAX), EDGE_VY);
    vel.z += EDGE_VZ + out * LAUNCH_CARRY;
    riding = false; onSurface = false; offRamp = true; lipLaunched = true;
    burst(pos.x, pos.y, pos.z, 12, "#ffe27a");
  }

  function step(f) {
    if (boost > 0) boost = Math.max(0, boost - f);
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (riding) {
      const sc = segAt(pos.z);
      if (!sc) { rollOffFront(); }
      else {
        ridingXc = centerOf(sc, pos.z);
        // ROLL: build forward momentum as you roll down the course (boost speeds it up)
        const vmax = VZMAX * (boost > 0 ? BOOST_VZ : 1);
        if (vel.z < vmax) vel.z = Math.min(vmax, vel.z + ROLL_ACC * (boost > 0 ? 2.5 : 1) * f);
        else vel.z = Math.max(vmax, vel.z - 0.01 * f);
        // lateral: the curve pulls you to the bottom + your (weak) steer, and rolling
        // friction resists sliding sideways so the ball feels weighty.
        vel.x += -CURVE_GAIN * 2 * CURVE * (pos.x - ridingXc) * G * f;
        if (dir) vel.x = clamp(vel.x + dir * STRAFE * f, -VX_CAP, VX_CAP);
        vel.x *= Math.pow(LAT_FRICTION, f);
        pos.x += vel.x * f; pos.z += vel.z * f;

        const sc2 = segAt(pos.z);
        if (!sc2) { rollOffFront(); }
        else {
          const cx = centerOf(sc2, pos.z), dx = pos.x - cx;
          // At a SIDE lip: STEERING INTO the lip always launches (a deliberate
          // jump), and so does fast outward momentum. Only an idle slow drift
          // is gently caught, so you can't slide off by accident.
          if (dx < -PIPE_HW) {
            if (dir < 0 || vel.x < -LIP_LAUNCH) popOffLip();
            else { pos.x = cx - PIPE_HW; if (vel.x < 0) vel.x = 0; }
          } else if (dx > PIPE_HW) {
            if (dir > 0 || vel.x > LIP_LAUNCH) popOffLip();
            else { pos.x = cx + PIPE_HW; if (vel.x > 0) vel.x = 0; }
          }
          if (riding) {
            const s = surfaceAt(pos.x, pos.z);
            if (s.onWall) { pos.y = s.y + PR; onSurface = true; offRamp = false; if (Math.random() < 0.22) spark(pos.x, s.y, pos.z); }
            else rollOffFront();                                          // fell through a floor hole
          }
        }
      }
    } else {
      // airborne: gravity + air-steer. A LIP LAUNCH carries its momentum through
      // the air almost untouched; a front drop bleeds it fast — launch, don't fall.
      vel.y -= G * f;
      vel.z *= Math.pow(lipLaunched ? AIR_VZ_KEEP : AIR_VZ_BLEED, f);
      if (dir) vel.x = clamp(vel.x + dir * STRAFE_AIR * f, -VX_CAP, VX_CAP);
      vel.x *= Math.pow(AIR_DRAG, f);
      pos.x += vel.x * f; pos.y += vel.y * f; pos.z += vel.z * f;
      const s = surfaceAt(pos.x, pos.z);
      offRamp = !s.onWall; onSurface = false;
      if (s.onWall && vel.y <= 0 && pos.y <= s.y + PR && pos.y > s.y - 2) {
        // land DOWN onto the ramp → convert your fall into forward momentum
        pos.y = s.y + PR; vel.z += Math.min(-vel.y, 1.5) * LAND_GAIN; vel.y = 0; vel.x *= 0.55;
        if (lipLaunched) {
          // a landed launch extends the combo and pays out bonus speed
          combo++;
          vel.z += COMBO_GAIN * Math.min(combo, COMBO_CAP);
          shake = Math.min(12, shake + Math.min(combo, COMBO_CAP));
          burst(pos.x, s.y, pos.z, 8 + 2 * Math.min(combo, COMBO_CAP), "#ffe27a");
        } else {
          combo = 0;
          burst(pos.x, s.y, pos.z, 8, "#9fe8ff");
        }
        lipLaunched = false;
        riding = true; ridingXc = centerOf(s.seg, pos.z); onSurface = true; offRamp = false;
      }
    }

    // bounce-pad contact (super-bounce + speed boost). Generous trigger volume:
    // crossing down through the centre column catches it, no pixel-perfect land.
    for (const p of plats) {
      if (p.used) continue;
      if (Math.abs(pos.x - p.x) < PLAT_HX && Math.abs(pos.z - p.z) < PLAT_HZ &&
          vel.y <= 0 && pos.y <= p.topY + PR && pos.y > p.topY - 13) {
        vel.y = SUPER_BOUNCE; boost = BOOST_TIME; p.used = true;
        riding = false; onSurface = false; lipLaunched = true;   // pad flights keep momentum too
        shake = Math.min(12, shake + 6);
        burst(pos.x, p.topY, pos.z, 20, "#ffd86b");
      }
    }
  }

  function physics(dt) {
    const f = Math.min(2.2, dt * 60);
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const steps = clamp(Math.ceil(speed * f / 1.0), 1, 8);
    const sf = f / steps;
    for (let i = 0; i < steps; i++) step(sf);
    genMore();

    cam.x += (pos.x - cam.x) * Math.min(1, 0.1 * f);
    camYsmooth += (pos.y - camYsmooth) * Math.min(1, 0.07 * f);

    trail.push({ x: pos.x, y: pos.y, z: pos.z, b: boost > 0 }); if (trail.length > 32) trail.shift();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * f; p.y += p.vy * f; p.z += p.vz * f;
      p.vx *= 0.93; p.vy *= 0.93; p.vz *= 0.93;
      p.life -= f; if (p.life <= 0) particles.splice(i, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - f);

    if (pos.y < yBase(pos.z) - VOID) fail("Lost to the void.");
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
  function project(X, Y, Z) {
    const rx = X - cam.x;
    const ry = Y - (camYsmooth + CAM_UP);
    const rz = Z - (pos.z - CAM_BACK);
    const ru = ry * cosP + rz * sinP;
    const rf = -ry * sinP + rz * cosP;
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

    const drift = cam.x * 6;
    for (const s of stars) {
      const sx = ((s.x * cw - drift) % cw + cw) % cw;
      const a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(clock * 2 + s.tw));
      ctx.globalAlpha = a; ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(sx, s.y * ch, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);
    const sh = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.translate(sh, sh);

    drawEarthHorizon();
    drawWorld();
    drawTrail();
    drawPlayer();
    drawParticles();
  }

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

  function quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, fill, alpha) {
    const p1 = project(ax, ay, az), p2 = project(bx, by, bz), p3 = project(cx, cy, cz), p4 = project(dx, dy, dz);
    if (!p1 || !p2 || !p3 || !p4) return;
    ctx.globalAlpha = alpha; ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.lineTo(p3.sx, p3.sy); ctx.lineTo(p4.sx, p4.sy);
    ctx.closePath(); ctx.fill();
  }

  const pipeY = (z, dx) => yBase(z) + CURVE * dx * dx;   // half-pipe surface height

  // Far → near painter's pass over z bands; draw whichever half-pipe (if any)
  // covers each band — a curved U, shaded so the walls read — plus any pad.
  function drawWorld() {
    const STEP = 4, FAR = 240, NX = 8;
    const z0 = Math.floor(pos.z / STEP) * STEP - 12;
    ctx.lineJoin = "round";
    for (let z = z0 + FAR; z >= z0; z -= STEP) {
      const s = segAt(z + STEP / 2);
      const fog = clamp(1 - (z - z0) / FAR, 0.12, 1);
      if (s) {
        const ca = centerOf(s, z), cb = centerOf(s, z + STEP);   // weaving centres
        for (let j = 0; j < NX; j++) {
          const dxa = -PIPE_HW + (2 * PIPE_HW) * j / NX, dxb = -PIPE_HW + (2 * PIPE_HW) * (j + 1) / NX;
          const dmid = (dxa + dxb) / 2;
          // skip the floor cells where a hole is punched (windy pipes)
          if (inHole(s, z + STEP / 2, dmid)) continue;
          const steep = Math.abs(dmid) / PIPE_HW;                  // 0 centre → 1 lip
          const checker = (j + Math.floor(z / 4)) % 2 === 0 ? 1 : 0.86;
          const lit = (1 - steep * 0.55) * checker;
          const fill = `rgb(${Math.round(124 * lit)},${Math.round(100 * lit)},${Math.round(214 * (1 - steep * 0.25))})`;
          quad(ca + dxa, pipeY(z, dxa), z, ca + dxb, pipeY(z, dxb), z, cb + dxb, pipeY(z + STEP, dxb), z + STEP, cb + dxa, pipeY(z + STEP, dxa), z + STEP, fill, fog);
        }
        // glowing rails along the two lips — these are the BOOST edges: hit them
        // with outward speed and you pop UP. Highlighted with a warm pulse + up-arrows.
        drawEdge(ca - PIPE_HW, z, cb - PIPE_HW, z + STEP, pipeY(z, -PIPE_HW), pipeY(z + STEP, -PIPE_HW), fog);
        drawEdge(ca + PIPE_HW, z, cb + PIPE_HW, z + STEP, pipeY(z, PIPE_HW), pipeY(z + STEP, PIPE_HW), fog);
      }
      for (const p of plats) if (p.z >= z && p.z < z + STEP) drawPlatform(p);
    }
    ctx.globalAlpha = 1;
  }

  function drawEdge(xa, za, xb, zb, ya, yb, fog) {
    const pa = project(xa, ya, za), pb = project(xb, yb, zb);
    if (!pa || !pb) return;
    // pulse travels forward along the lip so the boost edge reads as "live energy"
    const pulse = 0.55 + 0.45 * Math.sin(clock * 5 - za * 0.12);
    // wide soft halo
    ctx.globalAlpha = fog * (0.35 + pulse * 0.3);
    ctx.lineWidth = clamp(60 / pa.depth, 1.5, 8);
    ctx.strokeStyle = "rgba(120,255,190,0.35)";
    ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
    // bright core, hue shifting cyan → gold with the pulse to shout "launch here"
    ctx.globalAlpha = fog;
    ctx.lineWidth = clamp(22 / pa.depth, 0.7, 3);
    ctx.strokeStyle = pulse > 0.72 ? "#ffe27a" : "#5ffbf1";
    ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
    // periodic up-arrows sitting on the lip — the boost direction is UP
    if (Math.floor(za / 8) !== Math.floor(zb / 8)) {
      const w = clamp(80 / pa.depth, 2, 12), h = clamp(120 / pa.depth, 3, 16);
      ctx.globalAlpha = fog * (0.4 + pulse * 0.6);
      ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = clamp(26 / pa.depth, 0.8, 3.2); ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pa.sx - w, pa.sy); ctx.lineTo(pa.sx, pa.sy - h); ctx.lineTo(pa.sx + w, pa.sy);
      ctx.stroke();
      ctx.lineCap = "butt";
    }
    ctx.globalAlpha = 1;
  }

  function drawPlatform(p) {
    const c1 = project(-PLAT_HX, p.topY, p.z - PLAT_HZ);
    const c2 = project(PLAT_HX, p.topY, p.z - PLAT_HZ);
    const c3 = project(PLAT_HX, p.topY, p.z + PLAT_HZ);
    const c4 = project(-PLAT_HX, p.topY, p.z + PLAT_HZ);
    if (!c1 || !c2 || !c3 || !c4) return;
    const fog = clamp(1 - (p.z - pos.z) / 240, 0.12, 1);
    ctx.globalAlpha = fog;
    if (p.used) {
      ctx.fillStyle = "rgba(90,100,120,0.5)";
    } else {
      const g = ctx.createLinearGradient(c1.sx, c1.sy, c3.sx, c3.sy);
      g.addColorStop(0, "#ffe9a6"); g.addColorStop(1, "#ffb347");
      ctx.fillStyle = g;
    }
    ctx.beginPath();
    ctx.moveTo(c1.sx, c1.sy); ctx.lineTo(c2.sx, c2.sy); ctx.lineTo(c3.sx, c3.sy); ctx.lineTo(c4.sx, c4.sy);
    ctx.closePath(); ctx.fill();
    if (!p.used) {
      // up-chevron to read "bounce"
      const mid = project(0, p.topY, p.z);
      if (mid) {
        ctx.globalAlpha = fog * (0.6 + 0.4 * Math.sin(clock * 6));
        ctx.strokeStyle = "#fff4cf"; ctx.lineWidth = clamp(40 / mid.depth, 1, 4); ctx.lineCap = "round";
        const w = clamp(120 / mid.depth, 4, 22), h = clamp(140 / mid.depth, 4, 26);
        ctx.beginPath();
        ctx.moveTo(mid.sx - w, mid.sy); ctx.lineTo(mid.sx, mid.sy - h); ctx.lineTo(mid.sx + w, mid.sy);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTrail() {
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i], a = i / trail.length;
      const p = project(t.x, t.y, t.z);
      if (!p) continue;
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = t.b ? "#ffd86b" : "#9fd0ff";
      const rr = clamp((PR * 70) / p.depth, 0.5, 7) * a;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
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
    const hot = boost > 0;
    const spin = pos.z * (1.0 / PR);        // rolling angle from distance travelled
    ctx.save();
    ctx.translate(p.sx, p.sy);
    // glow
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * (hot ? 3.0 : 2.3));
    gl.addColorStop(0, hot ? "rgba(255,210,120,0.95)" : "rgba(150,210,255,0.8)");
    gl.addColorStop(1, hot ? "rgba(255,210,120,0)" : "rgba(150,210,255,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, sc * (hot ? 3.0 : 2.3), 0, Math.PI * 2); ctx.fill();
    // ball body (shaded sphere)
    const bg = ctx.createRadialGradient(-sc * 0.35, -sc * 0.4, sc * 0.1, 0, 0, sc);
    if (hot) { bg.addColorStop(0, "#fff2c8"); bg.addColorStop(0.5, "#ffcf5a"); bg.addColorStop(1, "#d9761a"); }
    else { bg.addColorStop(0, "#eaf4ff"); bg.addColorStop(0.5, "#5aa0ff"); bg.addColorStop(1, "#1e46b0"); }
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, sc, 0, Math.PI * 2); ctx.fill();
    // rolling patches (clipped inside the ball, sweep as it rolls)
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, sc, 0, Math.PI * 2); ctx.clip();
    ctx.rotate(spin);
    ctx.fillStyle = hot ? "rgba(170,80,10,0.45)" : "rgba(18,44,120,0.45)";
    for (const o of [-0.55, 0.55]) { ctx.beginPath(); ctx.ellipse(0, o * sc * 1.15, sc * 0.75, sc * 0.34, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // rim + specular highlight
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = sc * 0.06;
    ctx.beginPath(); ctx.arc(0, 0, sc * 0.95, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath(); ctx.arc(-sc * 0.34, -sc * 0.4, sc * 0.2, 0, Math.PI * 2); ctx.fill();
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
    hint = $("orbitHint"), elCombo = $("orbitCombo"), elComboWrap = $("orbitComboWrap");
  function updateHud() {
    const dist = Math.floor(pos.z);
    const spd = Math.hypot(vel.x, vel.y, vel.z);
    elPct.textContent = dist;
    elSpeed.textContent = Math.round(spd * SPEED_SCALE);
    elAlt.textContent = boost > 0 ? Math.ceil(boost / 60) + "s" : "—";
    elBest.textContent = Math.floor(best);
    elAltWrap.classList.toggle("warn", boost > 0);
    elCombo.textContent = combo > 0 ? "×" + combo : "—";
    elComboWrap.classList.toggle("good", combo > 1);
  }

  // ---- game states ---------------------------------------------------------
  function startPlay() {
    reset();
    phase = "play";
    hud.hidden = false; hint.hidden = false;
    $("orbitIntro").hidden = true; $("orbitFail").hidden = true;
    const win = $("orbitWin"); if (win) win.hidden = true;
  }
  function fail(title) {
    if (phase !== "play") return;
    phase = "fail";
    burst(pos.x, pos.y, pos.z, 26, "#ff7a4d"); shake = 16;
    saveBest();
    $("orbitFailTitle").textContent = title;
    $("orbitFailMsg").innerHTML = "You rode <b>" + Math.floor(pos.z) + " m</b>" +
      (Math.floor(pos.z) >= Math.floor(best) ? " — a new best!" : ". Best: <b>" + Math.floor(best) + " m</b>.");
    setTimeout(() => { $("orbitFail").hidden = false; hud.hidden = true; hint.hidden = true; }, 650);
  }
  function saveBest() {
    if (pos.z > best) best = pos.z;
    try { localStorage.setItem("orbit.bestDist", String(Math.floor(best))); } catch (e) { /* ignore */ }
  }

  // ---- input ---------------------------------------------------------------
  const LEFT = new Set(["ArrowLeft", "a", "A"]);
  const RIGHT = new Set(["ArrowRight", "d", "D"]);
  window.addEventListener("keydown", (e) => {
    if (LEFT.has(e.key)) { input.left = true; e.preventDefault(); }
    else if (RIGHT.has(e.key)) { input.right = true; e.preventDefault(); }
    else if (e.key === "Enter" && phase !== "play") { startPlay(); }
  });
  window.addEventListener("keyup", (e) => {
    if (LEFT.has(e.key)) input.left = false;
    else if (RIGHT.has(e.key)) input.right = false;
  });

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
  hold("touchBrake", () => input.left = true, () => input.left = false);
  hold("touchThrust", () => input.right = true, () => input.right = false);

  $("orbitPlayBtn").addEventListener("click", startPlay);
  $("orbitRetry").addEventListener("click", startPlay);
  const rep = $("orbitReplay"); if (rep) rep.addEventListener("click", startPlay);

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
    get state() { return { phase, pos: { ...pos }, vel: { ...vel }, dist: pos.z, onSurface, offRamp, boost, combo, lipLaunched, riding }; },
    get segs() { return segs.map((s) => ({ ...s })); },
    get plats() { return plats.map((p) => ({ ...p })); },
    consts: { PIPE_HW, OFF },
    setInput(left, right) { input.left = left; input.right = right; },
    start: startPlay,
  };
})();
