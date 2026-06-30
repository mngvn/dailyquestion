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
  const PR = 0.95;           // player radius (world units) — a bit chunkier
  const PIPE_HW = 8.5;       // half-width of a half-pipe (lip to lip from centre)
  const OFF = 13;            // lateral offset of alternating pipe centres (±OFF) — set wide apart
  const CURVE = 0.09;        // how steeply the pipe curves up its walls (lower = shallower walls)
  const HOLE_HW = 4;         // half-width of a floor hole (windy pipes)
  const HOLE_HL = 5;         // half-length (along z) of a floor hole
  const VOID = 26;           // how far you can fall below the pipe before you're lost

  // physics (tuned for 60fps; scaled by frame-time factor f)
  const G = 0.0175;          // gravity accel (−y) — low, so you float across the cuts
  const CURVE_GAIN = 1.3;    // strength of the pipe's curve pulling you toward the bottom (the surf)
  const STRAFE = 0.028;      // lateral steer accel — gentle, for fine control
  const STRAFE_AIR = 0.024;  // gentler in the air
  const VX_CAP = 0.85;       // lateral speed cap — enough to cross, lips contain you so you can't fly off
  const HOP = 0.82;          // launch impulse — fired ALONG the surface normal; the shallow walls
                             //   make it easy to clear the lip and launch
  const RIDE_DRAG = 0.985;   // light: lets you surf up + back down the walls
  const AIR_DRAG = 0.99;     // in the air: gently bleeds sideways speed
  const LIP_SLOPE = 2 * CURVE * PIPE_HW;   // wall steepness at the lip (dy/dx) — converts speed → launch
  const LIP_LAUNCH = 0.26;   // outward speed above which you pop off the lip instead of being caught
  const LIP_VY_MAX = 0.9;    // cap on a momentum launch so you don't fly to the moon
  const HOP_AIR = 2 * HOP / G;   // ≈ airtime of a launch, in frames (used to size the course)

  // forward pace: starts slow and accelerates EXTREMELY gradually over distance
  const VZ0 = 0.32, VZK = 0.00006, VZMAX = 1.1;
  const THRUST_Z = 0.007;    // how gently forward speed climbs toward the cap
  function vzCap(z) { return clamp(VZ0 + z * VZK, VZ0, VZMAX); }

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
      const gap = clamp(reach * (0.32 + grand() * 0.3), 14, 60);
      genZ = z1 + gap; segIdx++;
      return;
    }

    // randomly-cut straight half-pipes: lengths + gaps vary, runway up front
    let len = clamp(reach * (0.7 + grand() * 0.5), 40, 120);
    if (segIdx === 0) len += 50; else if (segIdx < 3) len += 22;
    const z1 = z0 + len;
    segs.push({ windy: false, side, xc: side * OFF, z0, z1, holes: null });
    const gap = clamp(reach * (0.32 + grand() * 0.33), 14, 60);   // the random "cut"
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
  let best = 0, clock = 0, shake = 0, camYsmooth = 0;
  let jumpQueued = false;
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
    cam.x = pos.x; cam.y = pos.y; camYsmooth = pos.y;
    particles = []; trail = []; shake = 0;
    input.left = input.right = false; jumpQueued = false;
  }

  // ---- physics -------------------------------------------------------------
  function step(f) {
    // forward pace: ramp toward the (possibly boosted) cap, decay back after a boost
    if (boost > 0) boost = Math.max(0, boost - f);
    const cap = vzCap(pos.z) * (boost > 0 ? BOOST_VZ : 1);
    if (vel.z < cap) vel.z = Math.min(cap, vel.z + THRUST_Z * (boost > 0 ? 3 : 1) * f);
    else vel.z = Math.max(cap, vel.z - 0.012 * f);

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (riding) {
      // surfing the half-pipe: the curve pulls you toward the bottom (so you
      // ride up a wall and swing back), and your strafe pumps you up the walls.
      // Windy pipes weave, so re-read the centre each frame.
      const sc = segAt(pos.z);
      ridingXc = sc ? centerOf(sc, pos.z) : ridingXc;
      vel.x += -CURVE_GAIN * 2 * CURVE * (pos.x - ridingXc) * G * f;   // gravity along the curve
      if (dir) vel.x = clamp(vel.x + dir * STRAFE * f, -VX_CAP, VX_CAP);
      else vel.x *= Math.pow(RIDE_DRAG, f);
      pos.x += vel.x * f; pos.z += vel.z * f;
      const sc2 = segAt(pos.z);
      const cx = sc2 ? centerOf(sc2, pos.z) : ridingXc;
      const dx = pos.x - cx;
      // At a lip: carry your speed up the curve into a LAUNCH if you're moving
      // out fast enough; otherwise the lip gently catches you (slow drift stays
      // contained, so you don't accidentally fly off).
      if (dx < -PIPE_HW) {
        if (vel.x < -LIP_LAUNCH) { riding = false; vel.y = Math.min(-vel.x * LIP_SLOPE, LIP_VY_MAX); burst(pos.x, pos.y, pos.z, 9, "#5ffbf1"); }
        else { pos.x = cx - PIPE_HW; if (vel.x < 0) vel.x = 0; }
      } else if (dx > PIPE_HW) {
        if (vel.x > LIP_LAUNCH) { riding = false; vel.y = Math.min(vel.x * LIP_SLOPE, LIP_VY_MAX); burst(pos.x, pos.y, pos.z, 9, "#5ffbf1"); }
        else { pos.x = cx + PIPE_HW; if (vel.x > 0) vel.x = 0; }
      }
      if (riding) {
        const s = surfaceAt(pos.x, pos.z);
        if (s.onWall) {
          pos.y = s.y + PR; onSurface = true; offRamp = false;
          if (Math.random() < 0.22) spark(pos.x, s.y, pos.z);
          if (jumpQueued) {                     // deliberate launch ALONG the normal → up + inward
            const n = norm3(s.nx, s.ny, s.nz);
            vel.x += n.x * HOP; vel.y = n.y * HOP; vel.z += n.z * HOP;
            riding = false; onSurface = false; burst(pos.x, s.y, pos.z, 9, "#5ffbf1"); jumpQueued = false;
          }
        } else { riding = false; onSurface = false; offRamp = true; }   // ran off the end / into a hole → airborne
      } else { onSurface = false; offRamp = true; }
    } else {
      // airborne: gravity + air-steer, until we drop back into a pipe
      vel.y -= G * f;
      if (dir) vel.x = clamp(vel.x + dir * STRAFE_AIR * f, -VX_CAP, VX_CAP);
      vel.x *= Math.pow(AIR_DRAG, f);
      pos.x += vel.x * f; pos.y += vel.y * f; pos.z += vel.z * f;
      const s = surfaceAt(pos.x, pos.z);
      offRamp = !s.onWall; onSurface = false;
      if (s.onWall && pos.y <= s.y + PR && vel.y <= 0) {
        pos.y = s.y + PR; vel.y = 0; vel.x *= 0.6;     // drop in (lips will catch any leftover skid)
        riding = true; ridingXc = centerOf(s.seg, pos.z); onSurface = true; offRamp = false;
        burst(pos.x, s.y, pos.z, 6, "#9fd0ff");
      }
    }
    if (!riding) jumpQueued = false;        // no mid-air launches; the request is dropped

    // bounce-pad contact (super-bounce + speed boost). Generous trigger volume:
    // crossing down through the centre column catches it, no pixel-perfect land.
    for (const p of plats) {
      if (p.used) continue;
      if (Math.abs(pos.x - p.x) < PLAT_HX && Math.abs(pos.z - p.z) < PLAT_HZ &&
          vel.y <= 0 && pos.y <= p.topY + PR && pos.y > p.topY - 13) {
        vel.y = SUPER_BOUNCE; boost = BOOST_TIME; p.used = true;
        riding = false; onSurface = false;
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
        // glowing rails along the two lips
        drawEdge(ca - PIPE_HW, z, cb - PIPE_HW, z + STEP, pipeY(z, -PIPE_HW), pipeY(z + STEP, -PIPE_HW), fog, "#5ffbf1");
        drawEdge(ca + PIPE_HW, z, cb + PIPE_HW, z + STEP, pipeY(z, PIPE_HW), pipeY(z + STEP, PIPE_HW), fog, "#5ffbf1");
      }
      for (const p of plats) if (p.z >= z && p.z < z + STEP) drawPlatform(p);
    }
    ctx.globalAlpha = 1;
  }

  function drawEdge(xa, za, xb, zb, ya, yb, fog, color) {
    const pa = project(xa, ya, za), pb = project(xb, yb, zb);
    if (!pa || !pb) return;
    ctx.globalAlpha = fog;
    ctx.lineWidth = clamp(40 / pa.depth, 1, 5);
    ctx.strokeStyle = "rgba(95,251,241,0.3)";
    ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
    ctx.lineWidth = clamp(20 / pa.depth, 0.6, 2.5);
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
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
    const roll = clamp(-vel.x * 0.5, -0.6, 0.6);
    const hot = boost > 0;
    ctx.save();
    ctx.translate(p.sx, p.sy);
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * (hot ? 3.1 : 2.4));
    gl.addColorStop(0, hot ? "rgba(255,210,120,0.95)" : "rgba(150,210,255,0.85)");
    gl.addColorStop(1, hot ? "rgba(255,210,120,0)" : "rgba(150,210,255,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, sc * (hot ? 3.1 : 2.4), 0, Math.PI * 2); ctx.fill();
    ctx.rotate(roll);
    ctx.fillStyle = "#3a7bff";
    ctx.fillRect(-sc * 2.0, -sc * 0.32, sc * 1.0, sc * 0.64);
    ctx.fillRect(sc * 1.0, -sc * 0.32, sc * 1.0, sc * 0.64);
    ctx.strokeStyle = "#2a5fd0"; ctx.lineWidth = sc * 0.08;
    ctx.beginPath(); ctx.moveTo(-sc * 1.0, 0); ctx.lineTo(sc * 1.0, 0); ctx.stroke();
    ctx.fillStyle = hot ? "#fff0cf" : "#eaf2ff";
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
    const dist = Math.floor(pos.z);
    const spd = Math.hypot(vel.x, vel.y, vel.z);
    elPct.textContent = dist;
    elSpeed.textContent = Math.round(spd * SPEED_SCALE);
    elAlt.textContent = boost > 0 ? Math.ceil(boost / 60) + "s" : "—";
    elBest.textContent = Math.floor(best);
    elAltWrap.classList.toggle("warn", boost > 0);
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
  const tj = $("touchJump");
  if (tj) tj.addEventListener("pointerdown", (e) => { e.preventDefault(); if (phase === "play") jumpQueued = true; });

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
    get state() { return { phase, pos: { ...pos }, vel: { ...vel }, dist: pos.z, onSurface, offRamp, boost }; },
    get segs() { return segs.map((s) => ({ ...s })); },
    get plats() { return plats.map((p) => ({ ...p })); },
    consts: { PIPE_HW, OFF },
    setInput(left, right) { input.left = left; input.right = right; },
    queueJump() { jumpQueued = true; },
    start: startPlay,
  };
})();
