// scene.js — everything round the web: the wind, the sky behind, and the
// plants it is slung between.
//
// By night it hangs in front of a moon, out of focus, with fireflies about;
// by day in the low sun of a misty morning. (theme.js says which, from the
// system setting.) Two twigs reach in at the top, a dry stalk stands up each
// side and grass grows along the bottom; the web's six guy lines are tied to
// them, and they all lean with the wind — which is why the web is never still.
//
// The far things are painted once, small, and blown up, which is all the
// blurring they need. The near ones are drawn afresh every frame.

import { rng } from "./silk.js";

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// ----- The wind -----
// Never steady: it breathes, and every so often a squall comes through. It
// blows mostly through the web (z, away from the eye) and a little along it.
export class Wind {
  constructor(still) {
    this.o = { x: 0, y: 0, z: 0 };
    this.calm = still ? 0.22 : 1;
    this.gust = 0.3; this.gx = 0.3; this.gz = 0.3;
    this.squall = 0; this.squallAt = 6 + Math.random() * 5; this.squallT = -1;
  }
  update(t, dt) {
    if (this.squallT < 0 && t > this.squallAt) this.squallT = 0;
    let sq = 0;
    if (this.squallT >= 0) {
      this.squallT += dt;
      const u = this.squallT / 3.2;
      sq = u >= 1 ? 0 : Math.sin(u * Math.PI) ** 2 * (0.75 + 0.25 * Math.sin(this.squallT * 5));
      if (u >= 1) { this.squallT = -1; this.squallAt = t + 8 + Math.random() * 12; }
    }
    this.squall = sq;
    const base = 0.4 + 0.24 * Math.sin(t * 0.37) + 0.17 * Math.sin(t * 0.83 + 1.3) + 0.1 * Math.sin(t * 2.1 + 0.4);
    this.gust = (Math.max(0.05, base) + sq * 1.25) * this.calm;
    this.gx = this.gust; this.gz = this.gust;
  }
  // The push on something at (x, y), as an acceleration. One object, reused.
  at(x, y, t) {
    const wave = Math.sin(x * 0.0062 - t * 1.9 + y * 0.003);
    const cross = Math.sin(y * 0.011 + t * 1.27 + x * 0.004);
    const f = this.gust * (0.75 + 0.55 * wave + 0.3 * cross);
    const o = this.o;
    o.z = -230 * f + 90 * this.calm * Math.sin(t * 0.9 + x * 0.002);
    o.x = 240 * f + 110 * this.gust * Math.sin(t * 1.4 - y * 0.004);
    o.y = 140 * cross * this.gust;
    return o;
  }
  // How hard it is leaning on something at x, for the plants: 0 to about 2.
  lean(x, t, phase) {
    return this.gust * (0.7 + 0.45 * Math.sin(t * 1.5 + phase - x * 0.004)) + 0.05 * this.calm * Math.sin(t * 0.6 + phase * 2);
  }
}

export const PALETTES = {
  dark: {
    sky: ["#0b1330", "#0c1a38", "#070c1c", "#04060d"],
    orb: { x: 0.77, y: 0.22, r: 0.06, core: "#f3f6ff", halo: "rgba(150, 180, 255, 0.5)", wash: "rgba(90, 125, 220, 0.4)" },
    foliage: ["#03060f", "#071022", "#0a1730"],
    bokeh: ["rgba(150, 185, 255, A)", "rgba(120, 220, 215, A)", "rgba(190, 170, 255, A)"],
    plant: "#04070f", plantRim: "rgba(150, 185, 245, 0.42)", leaf: "#071020", leafRim: "rgba(140, 180, 240, 0.3)",
    mote: "rgba(200, 220, 255, A)", mist: "rgba(120, 150, 210, 0.07)", shaft: "rgba(160, 190, 255, 0.035)",
    firefly: "190, 255, 120", stars: true, vignette: "rgba(1, 2, 6, 0.78)",
    silk: (f) => `rgba(${Math.round(160 + 95 * f)}, ${Math.round(185 + 70 * f)}, ${Math.round(225 + 30 * f)}, ${0.3 + 0.7 * f})`,
    bead: (f) => `rgba(${Math.round(185 + 70 * f)}, ${Math.round(210 + 45 * f)}, 255, ${0.34 + 0.66 * f})`,
    fringe: ["rgba(255, 225, 150, 0.4)", "rgba(150, 255, 200, 0.36)", "rgba(120, 225, 255, 0.34)", "rgba(200, 160, 255, 0.26)"],
    bloom: "rgba(140, 180, 255, 0.07)", glint: "rgba(255, 255, 255, 0.95)",
    dew: "rgba(150, 190, 255, 0.32)", dewLit: "rgba(255, 255, 255, 0.95)"
  },
  light: {
    sky: ["#f0cf94", "#c3bd8c", "#7c9477", "#3a5346"],
    orb: { x: 0.2, y: 0.2, r: 0.1, core: "#fffbe6", halo: "rgba(255, 238, 170, 0.75)", wash: "rgba(255, 214, 130, 0.55)" },
    foliage: ["#24382c", "#35503a", "#587350"],
    bokeh: ["rgba(255, 244, 200, A)", "rgba(215, 240, 170, A)", "rgba(255, 220, 160, A)"],
    plant: "#1c2a20", plantRim: "rgba(255, 236, 170, 0.6)", leaf: "#26392a", leafRim: "rgba(255, 240, 180, 0.42)",
    mote: "rgba(255, 250, 220, A)", mist: "rgba(255, 246, 220, 0.1)", shaft: "rgba(255, 240, 190, 0.07)",
    firefly: null, stars: false, vignette: "rgba(26, 38, 28, 0.6)",
    silk: (f) => `rgba(255, ${Math.round(246 + 9 * f)}, ${Math.round(222 + 33 * f)}, ${0.42 + 0.58 * f})`,
    bead: (f) => `rgba(255, 255, ${Math.round(235 + 20 * f)}, ${0.45 + 0.55 * f})`,
    fringe: ["rgba(255, 220, 130, 0.5)", "rgba(190, 255, 170, 0.42)", "rgba(150, 235, 255, 0.42)", "rgba(230, 170, 255, 0.32)"],
    bloom: "rgba(255, 240, 190, 0.08)", glint: "rgba(255, 255, 255, 1)",
    dew: "rgba(255, 255, 255, 0.4)", dewLit: "rgba(255, 255, 255, 1)"
  }
};

// A stem: a curve from its foot to its tip that leans downwind, more the
// further up it you go.
class Stem {
  constructor(o) {
    Object.assign(this, { bow: 0, give: 20, width: 5, phase: 0, heavy: 1 }, o);
    this.lean = 0;
    const dx = this.tip.x - this.foot.x, dy = this.tip.y - this.foot.y;
    this.len = Math.hypot(dx, dy);
    // the bend is to one side of the straight line from foot to tip
    this.cx = (this.foot.x + this.tip.x) / 2 - dy / this.len * this.bow;
    this.cy = (this.foot.y + this.tip.y) / 2 + dx / this.len * this.bow;
  }
  at(u, out) {
    const w = 1 - u, s = this.lean * this.give * u * u;
    out.x = w * w * this.foot.x + 2 * w * u * this.cx + u * u * this.tip.x + s;
    out.y = w * w * this.foot.y + 2 * w * u * this.cy + u * u * this.tip.y + Math.abs(s) * 0.12;
    return out;
  }
  // which way it is heading at u
  dir(u) {
    const a = this.at(Math.max(0, u - 0.02), tmpA), b = this.at(Math.min(1, u + 0.02), tmpB);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}
const tmpA = { x: 0, y: 0 }, tmpB = { x: 0, y: 0 }, tmpC = { x: 0, y: 0 };

export class Scene {
  constructor(wind) {
    this.wind = wind;
    this.anchors = Array.from({ length: 6 }, () => ({ x: 0, y: 0, z: 0 }));
  }

  layout(W, H, P, seed) {
    this.W = W; this.H = H; this.P = P;
    const rnd = this.rnd = rng(seed);
    const k = this.k = clamp(Math.min(W, H) / 760, 0.5, 1.4);
    const tall = H > W * 1.15;
    const hub = this.hub = { x: W * 0.5, y: H * (tall ? 0.45 : 0.48) };
    // how far out the web's spiral goes: a circle, as big as the page allows
    const R0 = this.R0 = tall ? Math.min(W * 0.44, H * 0.36) : Math.min(W * 0.46, H * 0.41);

    // The stems the web is tied to, clockwise from the top left. The knots
    // want to be evenly round the hub, so the frame is a fair hexagon: each
    // stem is tied wherever along it is nearest the bearing it is to hold.
    const S = (o) => new Stem(o);
    const bear = tall ? [-114, -66, 0, 66, 114, 180] : [-122, -58, 0, 60, 120, 180];
    const foot = (deg) => hub.x + (H * 0.94 - hub.y) / Math.tan(deg * Math.PI / 180);
    this.stems = [
      S({ kind: "twig", foot: { x: -50, y: H * 0.2 }, tip: { x: W * (tall ? 0.52 : 0.4), y: H * 0.035 }, bow: -H * 0.03, give: 5, width: 13 * k, phase: 0.3 }),
      S({ kind: "twig", foot: { x: W + 50, y: H * 0.23 }, tip: { x: W * (tall ? 0.5 : 0.62), y: H * 0.045 }, bow: H * 0.03, give: 6, width: 12 * k, phase: 1.9 }),
      S({ kind: "umbel", foot: { x: W * (tall ? 1.06 : 0.985) + 10, y: H + 40 }, tip: { x: W * (tall ? 1.02 : 0.955), y: H * 0.3 }, bow: -W * 0.012, give: 30 * k, width: 5 * k, phase: 3.1 }),
      S({ kind: "blade", foot: { x: foot(bear[3]) + 16, y: H + 20 }, tip: { x: foot(bear[3]) - 4, y: H * 0.9 }, bow: 8, give: 16 * k, width: 5 * k, knot: 0.78, phase: 4.4 }),
      S({ kind: "blade", foot: { x: foot(bear[4]) - 16, y: H + 20 }, tip: { x: foot(bear[4]) + 4, y: H * 0.905 }, bow: -8, give: 16 * k, width: 5 * k, knot: 0.78, phase: 5.2 }),
      S({ kind: "plume", foot: { x: W * (tall ? -0.06 : 0.015) - 10, y: H + 40 }, tip: { x: W * (tall ? -0.02 : 0.045), y: H * 0.33 }, bow: W * 0.012, give: 34 * k, width: 6.5 * k, phase: 0.9 })
    ];
    this.stems.forEach((s, i) => {
      if (s.knot) return;
      let best = 0.5, off = Infinity;
      for (let u = 0.2; u <= 0.96; u += 0.01) {
        const p = s.at(u, tmpC);
        let d = (Math.atan2(p.y - hub.y, p.x - hub.x) * 180 / Math.PI - bear[i]) % 360;
        if (d > 180) d -= 360; if (d < -180) d += 360;
        if (Math.abs(d) < off) { off = Math.abs(d); best = u; }
      }
      s.knot = best;
    });
    // leaves along the twigs
    for (const s of this.stems) {
      s.leaves = [];
      if (s.kind !== "twig") continue;
      const count = tall ? 6 : 9;
      for (let q = 0; q < count; q++) {
        const u = 0.16 + 0.84 * (q + rnd() * 0.6) / count;
        s.leaves.push({ u, side: q % 2 ? 1 : -1, len: (34 + rnd() * 30) * k * (1.1 - 0.4 * u), tilt: 0.5 + rnd() * 0.7, phase: rnd() * TAU, droop: rnd() });
      }
    }
    // grass along the bottom, thicker in the corners
    this.grass = [];
    const blades = Math.round(clamp(W / 16, 26, 90));
    for (let q = 0; q < blades; q++) {
      const u = (q + rnd()) / blades, edge = Math.abs(u - 0.5) * 2;
      const h = (20 + 70 * rnd() + 80 * edge * edge * rnd()) * k;
      this.grass.push(S({ kind: "grass", foot: { x: u * W, y: H + 8 }, tip: { x: u * W + (rnd() - 0.5) * 40 * k, y: H - h }, bow: (rnd() - 0.5) * 20, give: (10 + rnd() * 16) * k, width: (2.2 + rnd() * 2.6) * k, phase: rnd() * TAU }));
    }
    // dust, seeds and the like on the wind
    this.motes = Array.from({ length: Math.round(clamp(W * H / 22000, 22, 70)) }, () => ({
      x: rnd() * W, y: rnd() * H, z: rnd(), r: 0.5 + rnd() * 1.4, ph: rnd() * TAU, sp: 0.5 + rnd()
    }));
    this.fireflies = P.firefly ? Array.from({ length: tall ? 5 : 8 }, () => ({
      x: rnd() * W, y: H * (0.25 + rnd() * 0.7), ph: rnd() * TAU, sp: 0.4 + rnd() * 0.6, r: (2 + rnd() * 3) * k, a: rnd() * TAU
    })) : [];
    this.paintBack();
    this.paintFront();
    this.sway(0);
  }

  // The sky and everything too far off to be in focus, painted once.
  paintBack() {
    const { W, H, P, k } = this, rnd = rng(77);
    const c = this.back = document.createElement("canvas");
    c.width = Math.ceil(W); c.height = Math.ceil(H);
    const g = c.getContext("2d");
    const sky = g.createLinearGradient(0, 0, 0, H);
    P.sky.forEach((col, i) => sky.addColorStop([0, 0.4, 0.78, 1][i], col));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    const ox = P.orb.x * W, oy = P.orb.y * H, or = P.orb.r * Math.min(W, H) * 1.2;
    let rg = g.createRadialGradient(ox, oy, 0, ox, oy, Math.max(W, H) * 0.7);
    rg.addColorStop(0, P.orb.wash); rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg; g.fillRect(0, 0, W, H);

    if (P.stars) {
      for (let q = 0; q < 140; q++) {
        g.globalAlpha = 0.15 + rnd() * 0.5;
        g.fillStyle = "#dfe8ff";
        g.beginPath(); g.arc(rnd() * W, rnd() * H * 0.7, 0.3 + rnd() * 0.9, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }

    // foliage, far off: painted very small and blown up, so it is all blur
    const q = 10, sw = Math.ceil(W / q), sh = Math.ceil(H / q);
    const small = document.createElement("canvas");
    small.width = sw; small.height = sh;
    const s = small.getContext("2d");
    const clump = (x, y, r, col, a) => {
      s.globalAlpha = a; s.fillStyle = col;
      for (let b = 0; b < 7; b++) {
        s.beginPath();
        s.ellipse(x + (rnd() - 0.5) * r * 1.6, y + (rnd() - 0.5) * r * 1.2, r * (0.3 + rnd() * 0.5), r * (0.2 + rnd() * 0.4), rnd() * 3, 0, TAU);
        s.fill();
      }
    };
    for (let b = 0; b < 26; b++) {
      const side = b % 4, t = rnd();
      const x = side === 0 ? t * sw : side === 1 ? rnd() * sw * 0.2 : side === 2 ? sw - rnd() * sw * 0.2 : t * sw;
      const y = side === 0 ? sh - rnd() * sh * 0.24 : side === 3 ? rnd() * sh * 0.16 : t * sh;
      clump(x, y, (10 + rnd() * 16) * k, P.foliage[b % 3], 0.55 + rnd() * 0.4);
    }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(small, 0, 0, sw, sh, 0, 0, W, H);

    // lights out of focus
    for (let b = 0; b < 46; b++) {
      const near = rnd() < 0.45;
      const x = near ? ox + (rnd() - 0.5) * W * 0.7 : rnd() * W;
      const y = near ? oy + (rnd() - 0.5) * H * 0.7 : rnd() * H;
      const r = (12 + rnd() * rnd() * 70) * k;
      if (Math.hypot(x - ox, y - oy) < or * 1.6 + r) continue;
      const a = 0.03 + rnd() * 0.07;
      const col = P.bokeh[b % 3];
      const bg = g.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, col.replace("A", a * 0.7));
      bg.addColorStop(0.82, col.replace("A", a));
      bg.addColorStop(0.93, col.replace("A", a * 1.7));
      bg.addColorStop(1, col.replace("A", 0));
      g.fillStyle = bg;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }

    // the moon, or the sun: not quite in focus either
    rg = g.createRadialGradient(ox, oy, or * 0.2, ox, oy, or * 4.2);
    rg.addColorStop(0, P.orb.halo); rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(ox, oy, or * 4.2, 0, TAU); g.fill();
    rg = g.createRadialGradient(ox, oy, 0, ox, oy, or);
    rg.addColorStop(0, P.orb.core); rg.addColorStop(0.62, P.orb.core); rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(ox, oy, or, 0, TAU); g.fill();
    if (P.stars) {
      // the moon's seas, faintly
      for (const [mx, my, mr] of [[-0.28, -0.2, 0.34], [0.2, 0.1, 0.4], [-0.1, 0.4, 0.24], [0.33, -0.33, 0.2]]) {
        const sg = g.createRadialGradient(ox + mx * or, oy + my * or, 0, ox + mx * or, oy + my * or, mr * or);
        sg.addColorStop(0, "rgba(92, 111, 156, 0.2)"); sg.addColorStop(1, "rgba(92, 111, 156, 0)");
        g.fillStyle = sg;
        g.beginPath(); g.arc(ox + mx * or, oy + my * or, mr * or, 0, TAU); g.fill();
      }
    }
    this.orb = { x: ox, y: oy, r: or };

    // grain, to keep the gradients from banding
    const grain = g.getImageData(0, 0, c.width, c.height), d = grain.data;
    for (let i = 0; i < d.length; i += 4) {
      const nz = (Math.random() - 0.5) * 9;
      d[i] += nz; d[i + 1] += nz; d[i + 2] += nz;
    }
    g.putImageData(grain, 0, 0);

    // one soft blob, for the mist
    const m = this.mistBlob = document.createElement("canvas");
    m.width = m.height = 256;
    const mg = m.getContext("2d");
    const mr = mg.createRadialGradient(128, 128, 0, 128, 128, 128);
    mr.addColorStop(0, P.mist); mr.addColorStop(1, P.mist.replace(/[\d.]+\)$/, "0)"));
    mg.fillStyle = mr; mg.fillRect(0, 0, 256, 256);
  }

  // What is nearer than the web and out of focus the other way: big dark
  // leaves in two corners, and the darkening towards the edges.
  paintFront() {
    const { W, H, P, k } = this, rnd = rng(31);
    const q = 8, sw = Math.ceil(W / q), sh = Math.ceil(H / q);
    const small = document.createElement("canvas");
    small.width = sw; small.height = sh;
    const s = small.getContext("2d");
    s.fillStyle = P.plant;
    const leaf = (x, y, a, len, wid) => {
      s.save(); s.translate(x, y); s.rotate(a);
      s.beginPath(); s.moveTo(0, 0);
      s.bezierCurveTo(len * 0.3, -wid, len * 0.8, -wid * 0.6, len, 0);
      s.bezierCurveTo(len * 0.8, wid * 0.6, len * 0.3, wid, 0, 0);
      s.fill(); s.restore();
    };
    const L = 34 * k;
    for (let b = 0; b < 4; b++) leaf(sw + 2, sh * (0.02 + b * 0.05), Math.PI * (0.78 + rnd() * 0.3), L * (0.7 + rnd() * 0.5), L * 0.2);
    for (let b = 0; b < 4; b++) leaf(-2, sh * (0.98 - b * 0.06), -Math.PI * (0.12 + rnd() * 0.3), L * (0.7 + rnd() * 0.6), L * 0.22);
    const c = this.front = document.createElement("canvas");
    c.width = Math.ceil(W); c.height = Math.ceil(H);
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.globalAlpha = 0.92;
    g.drawImage(small, 0, 0, sw, sh, 0, 0, W, H);
    g.globalAlpha = 1;
    const v = g.createRadialGradient(W / 2, H * 0.47, Math.min(W, H) * 0.42, W / 2, H * 0.47, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, P.vignette);
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }

  // Lean every stem to the wind, and say where the knots are now.
  sway(t) {
    const { wind } = this;
    for (const s of this.stems) s.lean = wind.lean(s.foot.x, t, s.phase);
    for (const s of this.grass) s.lean = wind.lean(s.foot.x, t, s.phase);
    this.stems.forEach((s, i) => {
      s.at(s.knot, this.anchors[i]);
      this.anchors[i].z = -wind.gust * s.give * 0.5 * s.knot;
    });
  }

  drawBack(g, t) {
    const { W, H, P, wind } = this;
    g.drawImage(this.back, 0, 0, W, H);
    // shafts of light, slanting down from the moon or sun
    g.save();
    g.globalCompositeOperation = "lighter";
    g.translate(this.orb.x, this.orb.y);
    const toMid = Math.atan2(H * 0.6 - this.orb.y, W * 0.5 - this.orb.x);
    for (let b = 0; b < 5; b++) {
      const a = toMid + (b - 2) * 0.2 + 0.05 * Math.sin(t * 0.11 + b);
      const wd = 0.035 + 0.02 * Math.sin(t * 0.23 + b * 1.7);
      g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 0.31 + b * 2.1);
      const far = Math.hypot(W, H);
      const lg = g.createLinearGradient(0, 0, Math.cos(a) * far, Math.sin(a) * far);
      lg.addColorStop(0, P.shaft); lg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a - wd) * far, Math.sin(a - wd) * far);
      g.lineTo(Math.cos(a + wd) * far, Math.sin(a + wd) * far);
      g.fill();
    }
    g.restore();
    // mist, low down, drifting with the wind
    for (let b = 0; b < 4; b++) {
      const w = W * (0.7 + 0.2 * b);
      const x = ((t * (9 + b * 5) * (0.4 + wind.gust) + b * W * 0.37) % (W + w)) - w;
      g.drawImage(this.mistBlob, x, H * (0.5 + 0.1 * b), w, H * 0.5);
    }
    // fireflies
    for (const f of this.fireflies) {
      f.a += Math.sin(t * 0.7 + f.ph) * 0.03;
      f.x += Math.cos(f.a) * f.sp * 0.5 + wind.gust * 0.25; f.y += Math.sin(f.a) * f.sp * 0.4;
      if (f.x > W + 30) f.x = -30; if (f.x < -30) f.x = W + 30;
      if (f.y < H * 0.15 || f.y > H) f.a = -f.a;
      const on = Math.max(0, Math.sin(t * f.sp * 1.6 + f.ph)) ** 3;
      if (on < 0.02) continue;
      const fg = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 7);
      fg.addColorStop(0, `rgba(${P.firefly}, ${0.75 * on})`);
      fg.addColorStop(0.2, `rgba(${P.firefly}, ${0.22 * on})`);
      fg.addColorStop(1, `rgba(${P.firefly}, 0)`);
      g.fillStyle = fg;
      g.beginPath(); g.arc(f.x, f.y, f.r * 7, 0, TAU); g.fill();
    }
  }

  // The stems: behind the web, since it is tied to them.
  drawPlants(g, t) {
    const { P, k } = this;
    for (const s of this.grass) this.blade(g, s, 0.9);
    for (const s of this.stems) {
      if (s.kind === "blade") { this.blade(g, s, 1); continue; }
      this.stalk(g, s);
      if (s.kind === "twig") this.leaves(g, s, t);
      if (s.kind === "umbel") this.umbel(g, s, t);
      if (s.kind === "plume") this.plume(g, s, t);
    }
    // the knots: a dab of silk where each guy line is made fast
    g.fillStyle = P.silk(0.7);
    for (const a of this.anchors) { g.beginPath(); g.arc(a.x, a.y, 1.8 * k, 0, TAU); g.fill(); }
  }

  // a stalk or twig: thick at the foot, thin at the tip, lit along one edge
  stalk(g, s) {
    const { P } = this, n = 16;
    const L = [], R = [];
    for (let q = 0; q <= n; q++) {
      const u = q / n, p = s.at(u, tmpC), a = s.dir(u) + Math.PI / 2;
      const w = s.width * (1 - 0.82 * u) * 0.5 + 0.4;
      L.push([p.x + Math.cos(a) * w, p.y + Math.sin(a) * w]);
      R.push([p.x - Math.cos(a) * w, p.y - Math.sin(a) * w]);
    }
    g.fillStyle = P.plant;
    g.beginPath();
    L.forEach(([x, y], q) => (q ? g.lineTo(x, y) : g.moveTo(x, y)));
    R.reverse().forEach(([x, y]) => g.lineTo(x, y));
    g.closePath(); g.fill();
    // the lit edge is whichever faces the moon or sun
    const lit = (L[8][0] - this.orb.x) ** 2 + (L[8][1] - this.orb.y) ** 2 < (R[n - 8][0] - this.orb.x) ** 2 + (R[n - 8][1] - this.orb.y) ** 2 ? L : R.reverse();
    g.strokeStyle = P.plantRim; g.lineWidth = 1;
    g.beginPath();
    lit.forEach(([x, y], q) => (q ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }

  blade(g, s, alpha) {
    const { P } = this;
    const a = s.at(0, tmpA), ax = a.x, ay = a.y;
    const m = s.at(0.55, tmpB), mx = m.x, my = m.y;
    const e = s.at(1, tmpC);
    const w = s.width;
    g.globalAlpha = alpha;
    g.fillStyle = P.plant;
    g.beginPath();
    g.moveTo(ax - w, ay);
    g.quadraticCurveTo(mx - w * 0.7, my, e.x, e.y);
    g.quadraticCurveTo(mx + w * 0.7, my, ax + w, ay);
    g.closePath(); g.fill();
    g.strokeStyle = P.plantRim; g.lineWidth = 0.8;
    g.beginPath();
    if (this.orb.x > mx) { g.moveTo(ax + w, ay); g.quadraticCurveTo(mx + w * 0.7, my, e.x, e.y); }
    else { g.moveTo(ax - w, ay); g.quadraticCurveTo(mx - w * 0.7, my, e.x, e.y); }
    g.stroke();
    g.globalAlpha = 1;
  }

  leaves(g, s, t) {
    const { P, wind } = this;
    for (const lf of s.leaves) {
      const p = s.at(lf.u, tmpC);
      const flutter = Math.sin(t * (3 + lf.droop * 2) + lf.ph) * 0.1 * (0.3 + wind.gust) + wind.gust * 0.16;
      const a = s.dir(lf.u) + lf.side * lf.tilt + flutter;
      const len = lf.len, wid = len * 0.3;
      g.save();
      g.translate(p.x, p.y); g.rotate(a);
      g.fillStyle = P.leaf;
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(len * 0.25, -wid, len * 0.75, -wid * 0.7, len, 0);
      g.bezierCurveTo(len * 0.75, wid * 0.7, len * 0.25, wid, 0, 0);
      g.fill();
      g.strokeStyle = P.leafRim; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(len * 0.25, -wid, len * 0.75, -wid * 0.7, len, 0);
      g.moveTo(len * 0.08, 0); g.lineTo(len * 0.9, 0);
      for (let v = 1; v < 5; v++) {
        const vx = len * (0.12 + v * 0.16);
        g.moveTo(vx, 0); g.lineTo(vx + len * 0.12, -wid * (0.62 - 0.07 * v));
      }
      g.stroke();
      g.restore();
    }
  }

  // a dry seed head: spokes, and a little burst at the end of each
  umbel(g, s, t) {
    const { P, k, wind } = this;
    const p = s.at(1, tmpC), px = p.x, py = p.y;
    const up = s.dir(1), sway = wind.gust * 0.1 + 0.03 * Math.sin(t * 2.3);
    g.strokeStyle = P.plant; g.fillStyle = P.plant; g.lineCap = "round";
    const rays = 11, len = 58 * k;
    for (let q = 0; q < rays; q++) {
      const a = up + (q - (rays - 1) / 2) * 0.2 + sway * (1 + Math.abs(q - 5) * 0.1);
      const l = len * (0.78 + 0.22 * Math.cos((q - 5) * 0.34));
      const ex = px + Math.cos(a) * l, ey = py + Math.sin(a) * l;
      g.lineWidth = 1.3 * k;
      g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(up) * l * 0.5, py + Math.sin(up) * l * 0.5, ex, ey); g.stroke();
      g.lineWidth = 0.8 * k;
      for (let b = 0; b < 7; b++) {
        const ba = a + (b - 3) * 0.3, bl = 10 * k;
        const bx = ex + Math.cos(ba) * bl, by = ey + Math.sin(ba) * bl;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(bx, by); g.stroke();
        g.beginPath(); g.arc(bx, by, 1.5 * k, 0, TAU); g.fill();
      }
    }
    // lit from behind: a few of the seeds catch it
    g.fillStyle = P.plantRim;
    for (let q = 0; q < rays; q += 2) {
      const a = up + (q - (rays - 1) / 2) * 0.2 + sway * (1 + Math.abs(q - 5) * 0.1);
      const l = len * (0.78 + 0.22 * Math.cos((q - 5) * 0.34)) + 10 * k;
      g.beginPath(); g.arc(px + Math.cos(a) * l, py + Math.sin(a) * l, 1.1 * k, 0, TAU); g.fill();
    }
  }

  // a feathery grass head
  plume(g, s, t) {
    const { P, k, wind } = this;
    g.strokeStyle = P.plant; g.lineCap = "round"; g.lineWidth = 1.7 * k;
    g.beginPath();
    for (let q = 0; q < 26; q++) {
      const u = 0.72 + 0.28 * q / 25;
      const p = s.at(u, tmpC), a = s.dir(u);
      const side = q % 2 ? 1 : -1;
      const l = (30 - 18 * (q / 25)) * k * (0.8 + 0.2 * Math.sin(q * 2.1));
      const b = a - side * (0.5 + 0.1 * Math.sin(t * 2 + q)) + wind.gust * 0.12;
      g.moveTo(p.x, p.y);
      g.quadraticCurveTo(p.x + Math.cos(b) * l * 0.6, p.y + Math.sin(b) * l * 0.6, p.x + Math.cos(b + side * 0.5) * l, p.y + Math.sin(b + side * 0.5) * l);
    }
    g.stroke();
    g.strokeStyle = P.plantRim; g.lineWidth = 0.7;
    g.beginPath();
    for (let q = 1; q < 26; q += 3) {
      const u = 0.72 + 0.28 * q / 25;
      const p = s.at(u, tmpC), a = s.dir(u) - 0.5 + wind.gust * 0.12;
      const l = (30 - 18 * (q / 25)) * k;
      g.moveTo(p.x + Math.cos(a) * l * 0.5, p.y + Math.sin(a) * l * 0.5);
      g.lineTo(p.x + Math.cos(a) * l, p.y + Math.sin(a) * l);
    }
    g.stroke();
  }

  // What drifts in front of the web, and the dark round the edges.
  drawFront(g, t, dt) {
    const { W, H, P, wind } = this;
    for (const m of this.motes) {
      const sp = (18 + 70 * m.z) * (0.25 + wind.gust * 1.5) * m.sp;
      m.x += sp * dt;
      m.y += (Math.sin(t * 0.8 + m.ph) * 9 + 5 * wind.gust * Math.sin(t * 2.4 + m.ph * 3)) * dt;
      if (m.x > W + 10) { m.x = -10; m.y = Math.random() * H; }
      const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.3 * m.sp + m.ph));
      g.fillStyle = P.mote.replace("A", (0.1 + 0.5 * m.z) * tw);
      g.beginPath(); g.arc(m.x, m.y, m.r * (0.6 + m.z), 0, TAU); g.fill();
    }
    const push = wind.gust * 6;
    g.drawImage(this.front, -12 + push, -8, W + 24, H + 16);
  }
}

export { smooth, clamp, lerp, TAU };
