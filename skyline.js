// skyline.js — the city: a handful of towers seen from close to, across the
// street and a good way up, with the rest of the skyline behind them.
//
// Nothing is loaded; all of it is drawn from rectangles. What doesn't move —
// the far skyline, the nearer one, the towers in front — is painted once, onto
// three layers, when the page is laid out. Every frame those are put down over
// the sky, and what does move is drawn in between and on top: stars, clouds, a
// plane now and then, the red lights on the masts, steam off the roofs, a lift
// going up and down its shaft, and windows far off going on and off.
//
// The windows of the towers in front are kept in `windows`: city.js lights a
// few of them at a time (drawLit) and puts a fact in each.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- Colour -----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// darker below 1, lighter above it
const tone = (c, f) => (f <= 1 ? [c[0] * f, c[1] * f, c[2] * f] : mix(c, [255, 255, 255], Math.min(1, (f - 1) * 0.5)));
const css = (c, a = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

// Night when the system is dark, the last of the sunset when it is light.
export const PALETTES = {
  dark: {
    sky: [[0, "#03051a"], [0.38, "#0a1134"], [0.7, "#1c1c4c"], [0.9, "#3d2b5e"], [1, "#643a62"]],
    stars: 1,
    moon: [238, 242, 255],
    cloud: [74, 72, 128],
    cloudA: 0.5,
    far: "#232659", mid: "#161a40",
    haze: [52, 42, 104],
    lights: [[255, 214, 140], [255, 188, 108], [222, 236, 255], [255, 238, 196], [150, 230, 220]],
    on: 0.3,
    styles: { brick: "#2b1e2c", glass: "#0e1730", deco: "#232240", slab: "#1c2038" },
    glassHi: [84, 108, 170], glassLo: [8, 12, 28],
    street: [255, 150, 92], streetA: 0.2,
    iron: [120, 96, 110]
  },
  light: {
    sky: [[0, "#243267"], [0.32, "#55508e"], [0.6, "#b46f8f"], [0.82, "#ee9c78"], [1, "#ffd092"]],
    stars: 0.22,
    moon: [255, 244, 232],
    cloud: [255, 176, 150],
    cloudA: 0.62,
    far: "#8f6f9c", mid: "#66527f",
    haze: [240, 150, 130],
    lights: [[255, 226, 160], [255, 204, 130], [255, 244, 214]],
    on: 0.16,
    styles: { brick: "#4a2f40", glass: "#2c3158", deco: "#463a5e", slab: "#3d3a5c" },
    glassHi: [255, 168, 128], glassLo: [38, 36, 76],
    street: [255, 190, 120], streetA: 0.16,
    iron: [150, 112, 120]
  }
};

// Where the towers stand, for a wide page, a squarish one and a tall one.
// x and w are parts of the page's width; top is a part of its height, and a
// tower whose top is above the page has no roof to be seen. One of them is
// short enough to carry the crossword's hoarding on its roof ("board"), and
// one tall one has the arcade's sign down its front ("blade").
function plan(W, H) {
  const a = W / H;
  if (a >= 1.25) {
    return {
      towers: [
        { x: -0.03, w: 0.245, top: -0.3 },
        { x: 0.245, w: 0.205, top: 0.42, has: "board" },
        { x: 0.48, w: 0.245, top: -0.3, has: "blade" },
        { x: 0.765, w: 0.27, top: 0.2, has: "tank" }
      ],
      moon: [0.35, 0.13]
    };
  }
  if (a >= 0.8) {
    return {
      towers: [
        { x: -0.04, w: 0.33, top: -0.3, has: "blade" },
        { x: 0.325, w: 0.31, top: 0.4, has: "board" },
        { x: 0.67, w: 0.37, top: 0.14, has: "tank" }
      ],
      moon: [0.48, 0.12]
    };
  }
  return {
    towers: [
      { x: -0.1, w: 0.55, top: -0.3, has: "blade" },
      { x: 0.49, w: 0.62, top: 0.34, has: "board" }
    ],
    moon: [0.76, 0.1]
  };
}

function layer(w, h, scale) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext("2d");
  g.setTransform(scale, 0, 0, scale, 0, 0);
  return { c, g, w, h };
}

const PAD = 28;   // how much wider than the page the layers behind are, each side, to slide about in

export class Skyline {
  constructor(still) {
    this.still = still;
    this.windows = [];
    this.signs = {};
    this.shift = 0;        // where the pointer has pushed the layers behind, -1…1
  }

  // ----- Laying it out, and painting what doesn't move -----
  layout(W, H, dpr, P, seed) {
    Object.assign(this, { W, H, dpr, P });
    const R0 = rng(seed);
    const R = (a = 1, b) => (b === undefined ? R0() * a : a + R0() * (b - a));
    this.R = R;
    const comp = plan(W, H);
    const mirror = R0() < 0.5;
    const px = this.px = clamp(W / 22, 46, 78);
    const py = this.py = px * 1.3;
    const u = this.u = px / 62;                 // the size of things, against a middling page

    // the four kinds of front, dealt out differently each day
    const kinds = ["brick", "glass", "deco", "slab"];
    for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(R0() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }

    this.windows = [];
    this.beacons = [];
    this.vents = [];
    this.lift = null;
    this.signs = {};
    this.moon = { x: (mirror ? 1 - comp.moon[0] : comp.moon[0]) * W, y: comp.moon[1] * H, r: clamp(Math.min(W, H) * 0.045, 20, 44) };

    this.far = layer(W + PAD * 2, H, Math.min(dpr, 1.5));
    this.mid = layer(W + PAD * 2, H, Math.min(dpr, 1.5));
    this.near = layer(W, H, dpr);
    this.twinkle = [];
    this.paintBehind(this.far, { color: hex(P.far), top: [0.3, 0.62], width: [34, 88], cell: 6 * clamp(u, 0.8, 1.2), hazeA: 0.5, spire: 0.3 }, R);
    this.paintBehind(this.mid, { color: hex(P.mid), top: [0.1, 0.5], width: [70, 150], cell: 10 * clamp(u, 0.8, 1.2), hazeA: 0.22, spire: 0.45 }, R);

    this.towers = comp.towers.map((t, i) => {
      const w = Math.round(t.w * W), x = Math.round((mirror ? 1 - t.x - t.w : t.x) * W);
      return { i, x, w, top: Math.round(t.top * H), has: t.has, kind: kinds[i % kinds.length], roof: t.top > 0 };
    });
    for (const T of this.towers) this.paintTower(T, R);
    this.paintStreet();

    // the sky's own
    this.stars = Array.from({ length: Math.round(clamp(W * H / 9000, 60, 190)) }, () => ({
      x: R(W), y: R(H * 0.8) * R(0.4, 1), r: R(0.5, 1.4), a: R(0.3, 1), sp: R(0.6, 2.4), ph: R(TAU)
    }));
    this.clouds = Array.from({ length: W > 900 ? 5 : 3 }, (_, i) => this.cloud(R, i));
    this.plane = null;
    this.planeIn = R(4, 12);
    this.steam = [];
    this.flock = null;
    this.flockIn = R(9, 20);
  }

  // A row of buildings a long way off: boxes with the odd spire, and windows
  // too small to be anything but lights.
  paintBehind(L, o, R) {
    const { g } = L, { W, H, P } = this;
    let x = -R(20);
    while (x < L.w) {
      const w = R(o.width[0], o.width[1]) * clamp(this.u, 0.7, 1.3);
      const top = R(o.top[0], o.top[1]) * H;
      const body = tone(o.color, R(0.82, 1.18));
      g.fillStyle = css(body);
      g.fillRect(x, top, w, H - top);
      // what it is topped with
      const cap = R();
      if (cap < o.spire) {
        // set back twice, and a mast
        const s1 = w * R(0.6, 0.8), h1 = R(10, 26) * this.u, s2 = s1 * R(0.4, 0.7), h2 = R(8, 22) * this.u;
        g.fillRect(x + (w - s1) / 2, top - h1, s1, h1 + 1);
        g.fillRect(x + (w - s2) / 2, top - h1 - h2, s2, h2 + 1);
        const mast = R(18, 60) * this.u;
        g.fillRect(x + w / 2 - 0.75, top - h1 - h2 - mast, 1.5, mast);
        if (R() < 0.7) this.beacons.push({ x: x + w / 2 - PAD, y: top - h1 - h2 - mast, r: 1.6 * this.u, ph: R(TAU), L, sp: R(0.7, 1.3) });
      } else if (cap < o.spire + 0.2) {
        // a slant
        g.beginPath(); g.moveTo(x, top + 1); g.lineTo(x + w, top + 1); g.lineTo(x + w, top - R(8, 30) * this.u); g.closePath(); g.fill();
      } else if (cap < o.spire + 0.4) {
        // plant on the roof
        g.fillRect(x + w * R(0.1, 0.5), top - 5 * this.u, w * R(0.2, 0.4), 5 * this.u + 1);
      }
      // a lighter edge down the side the light is on
      g.fillStyle = css(tone(body, 1.3), 0.5);
      g.fillRect(x, top, 1.5, H - top);
      // its windows
      const cw = o.cell, ch = o.cell * 1.45, ww = cw * 0.52, wh = ch * 0.5;
      const cols = Math.max(1, Math.floor((w - 4) / cw)), left = x + (w - cols * cw) / 2;
      const busy = P.on * R(0.4, 1.7);
      for (let ry = top + ch * 0.6; ry < H; ry += ch) {
        const floorOn = R() < 0.07;              // a whole floor working late
        for (let c = 0; c < cols; c++) {
          const wx = left + c * cw + (cw - ww) / 2;
          const on = R() < (floorOn ? 0.85 : busy);
          const col = P.lights[Math.floor(R() * R() * P.lights.length)];
          const a = R(0.45, 0.95);
          if (on) { g.fillStyle = css(col, a); g.fillRect(wx, ry, ww, wh); }
          else { g.fillStyle = css(tone(body, 1.5), 0.35); g.fillRect(wx, ry, ww, wh); }
          if (R() < 0.05 && ry < H * 0.94) this.twinkle.push({ L, x: wx, y: ry, w: ww, h: wh, on, body, col, a });
        }
      }
      x += w + R(-8, 12) * this.u;
    }
    // the air between here and there
    const haze = g.createLinearGradient(0, H * 0.15, 0, H);
    haze.addColorStop(0, css(P.haze, 0));
    haze.addColorStop(1, css(P.haze, o.hazeA));
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = haze;
    g.fillRect(0, 0, L.w, H);
    g.globalCompositeOperation = "source-over";
  }

  // A pane of glass with nothing on behind it: the sky, dimly.
  glass(g, x, y, w, h, R) {
    const { P, H } = this;
    const up = 1 - clamp(y / H, 0, 1);                       // the higher, the more sky in it
    const hi = mix(P.glassLo, P.glassHi, clamp(R(0.08, 0.42) + up * 0.3, 0, 1));
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, css(hi));
    grad.addColorStop(1, css(mix(P.glassLo, P.glassHi, R(0, 0.12))));
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    const what = R();
    if (what < 0.22) {
      // a blind, part of the way down
      g.fillStyle = css(mix(P.glassHi, [255, 255, 255], 0.2), 0.14);
      g.fillRect(x, y, w, h * R(0.2, 0.7));
    } else if (what < 0.5) {
      // a streak of something bright across the street
      g.fillStyle = css(P.glassHi, 0.16);
      g.beginPath(); g.moveTo(x, y + h * R(0.3, 0.9)); g.lineTo(x, y); g.lineTo(x + w * R(0.3, 0.9), y); g.closePath(); g.fill();
    }
  }

  paintTower(T, R) {
    const { g } = this.near, { H, P, px: PX, py: PY, u } = this;
    const base = hex(P.styles[T.kind]);
    const top = T.top, bottom = H + 6;
    const side = Math.round(PX * 0.3);                      // the wall round the corner, in shadow

    g.fillStyle = css(tone(base, 0.5));
    g.fillRect(T.x + T.w - 1, top + 5 * u, side + 1, bottom - top);
    for (let y = top + PY * 0.4; y < bottom; y += PY) {
      g.fillStyle = css(mix(P.glassLo, P.glassHi, 0.1));
      g.fillRect(T.x + T.w + side * 0.3, y, side * 0.4, PY * 0.5);
    }

    // the front, lit from the left
    const face = g.createLinearGradient(T.x, 0, T.x + T.w, 0);
    face.addColorStop(0, css(tone(base, 1.28)));
    face.addColorStop(0.35, css(base));
    face.addColorStop(1, css(tone(base, 0.78)));
    g.fillStyle = face;
    g.fillRect(T.x, top, T.w, bottom - top);

    const pad = T.kind === "glass" ? 9 * u : 12 * u;
    const cols = Math.max(2, Math.round((T.w - pad * 2) / PX));
    const cw = (T.w - pad * 2) / cols;
    const head = T.roof ? PY * 0.42 : -R(PY);                // where the top floor starts
    const y0 = top + head;
    const rows = Math.ceil((bottom - y0) / PY);
    const trim = css(tone(base, 1.6)), trimLo = css(tone(base, 1.3)), dark = css(tone(base, 0.4));
    const add = (x, y, w, h, c, r, mull) => {
      const win = { x, y, w, h, tower: T.i, col: c, row: r, mull, bar: css(tone(base, 0.55)), blocked: false };
      this.windows.push(win);
      return win;
    };

    if (T.kind === "brick") {
      // courses of brick
      g.fillStyle = "rgba(0, 0, 0, 0.13)";
      for (let y = top; y < bottom; y += 5 * u) g.fillRect(T.x, y, T.w, 1);
      g.fillStyle = css(tone(base, 1.5), 0.05);
      for (let i = 0; i < T.w * (bottom - top) / 900; i++) g.fillRect(T.x + R(T.w - 9), top + Math.floor(R(bottom - top) / (5 * u)) * 5 * u + 1, 9 * u, 4 * u - 1);
      const ww = cw * 0.56, wh = PY * 0.62;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = T.x + pad + c * cw + (cw - ww) / 2, y = y0 + r * PY + PY * 0.18;
          g.fillStyle = trim; g.fillRect(x - 4 * u, y - 7 * u, ww + 8 * u, 7 * u);            // lintel
          g.fillStyle = "rgba(0, 0, 0, 0.4)"; g.fillRect(x - 5 * u, y + wh + 5 * u, ww + 10 * u, 4 * u);
          g.fillStyle = trim; g.fillRect(x - 6 * u, y + wh, ww + 12 * u, 5 * u);              // sill
          g.fillStyle = dark; g.fillRect(x, y, ww, wh);
          this.glass(g, x + 2, y + 2, ww - 4, wh / 2 - 3, R);
          this.glass(g, x + 2, y + wh / 2 + 1, ww - 4, wh / 2 - 3, R);
          add(x, y, ww, wh, c, r, { v: [0.5], h: [0.5] });
        }
      }
      if (cols >= 3) this.fireEscape(T, R, { pad, cw, cols, y0, rows, ww, wh });
    } else if (T.kind === "glass") {
      const wh = PY * 0.76;
      for (let r = 0; r < rows; r++) {
        const y = y0 + r * PY;
        g.fillStyle = css(tone(base, 1.5)); g.fillRect(T.x, y + wh, T.w, PY - wh);            // the floor between
        g.fillStyle = css(tone(base, 2.1), 0.5); g.fillRect(T.x, y + wh, T.w, 1);
        for (let c = 0; c < cols; c++) {
          const x = T.x + pad + c * cw + 1.5;
          this.glass(g, x, y + 2, cw - 3, wh - 3, R);
          add(x, y + 2, cw - 3, wh - 3, c, r, { v: cw > 56 ? [0.5] : [], h: [] });
        }
      }
      // the fins between
      g.fillStyle = css(tone(base, 2.3), 0.75);
      for (let c = 0; c <= cols; c++) g.fillRect(T.x + pad + c * cw - 1, top, 2, bottom - top);
      // the whole of it catching the light
      g.save();
      g.beginPath(); g.rect(T.x, top, T.w, bottom - top); g.clip();
      g.fillStyle = css(P.glassHi, 0.07);
      for (let i = 0; i < 3; i++) {
        const sx = T.x + R(-0.4, 1) * T.w, sw = R(0.12, 0.3) * T.w;
        g.beginPath(); g.moveTo(sx, bottom); g.lineTo(sx + sw, bottom); g.lineTo(sx + sw + H * 0.5, top); g.lineTo(sx + H * 0.5, top); g.closePath(); g.fill();
      }
      g.restore();
      // a lift in a glass shaft up one edge
      this.lift = { x: T.x + 1.5 * u, w: pad - 3 * u, y0, rows, at: R(rows), to: R(rows), wait: R(2, 5), top, bottom };
      g.fillStyle = css(tone(base, 0.5)); g.fillRect(this.lift.x, top, this.lift.w, bottom - top);
    } else if (T.kind === "deco") {
      const ww = cw * 0.5, wh = PY * 0.64;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = T.x + pad + c * cw + (cw - ww) / 2, y = y0 + r * PY + PY * 0.06;
          // the panel under each window, with its chevron
          g.fillStyle = css(tone(base, 0.72)); g.fillRect(x, y + wh, ww, PY - wh);
          g.strokeStyle = trimLo; g.lineWidth = 1.2 * u;
          const my = y + wh + (PY - wh) / 2;
          g.beginPath(); g.moveTo(x + 3 * u, my + 4 * u); g.lineTo(x + ww / 2, my - 4 * u); g.lineTo(x + ww - 3 * u, my + 4 * u); g.stroke();
          g.fillStyle = dark; g.fillRect(x, y, ww, wh);
          this.glass(g, x + 2, y + 2, ww - 4, wh * 0.3 - 2, R);
          this.glass(g, x + 2, y + wh * 0.3 + 2, ww - 4, wh * 0.7 - 4, R);
          add(x, y, ww, wh, c, r, { v: [0.5], h: [0.3] });
        }
      }
      // the piers, all the way up
      for (let c = 0; c <= cols; c++) {
        const x = T.x + pad + c * cw - cw * 0.17;
        g.fillStyle = css(tone(base, 1.34)); g.fillRect(x, top, cw * 0.34, bottom - top);
        g.fillStyle = css(tone(base, 1.8)); g.fillRect(x, top, 1.5 * u, bottom - top);
        g.fillStyle = css(tone(base, 0.7)); g.fillRect(x + cw * 0.34 - 1.5 * u, top, 1.5 * u, bottom - top);
      }
    } else {
      // slab: concrete floors and fins, wide windows set back between them
      const ww = cw - 14 * u, wh = PY * 0.56;
      for (let r = 0; r < rows; r++) {
        const y = y0 + r * PY;
        for (let c = 0; c < cols; c++) {
          const x = T.x + pad + c * cw + 7 * u;
          g.fillStyle = dark; g.fillRect(x, y + PY * 0.2, ww, wh);
          const pw = (ww - 4) / 3;
          for (let i = 0; i < 3; i++) this.glass(g, x + 2 + i * pw, y + PY * 0.2 + 2, pw - 1.5, wh - 4, R);
          add(x, y + PY * 0.2, ww, wh, c, r, { v: [1 / 3, 2 / 3], h: [] });
          // a balcony rail, on some
          if ((c + r) % 3 === 0) {
            g.strokeStyle = css(tone(base, 2), 0.55); g.lineWidth = 1;
            const by = y + PY * 0.2 + wh;
            g.beginPath(); g.moveTo(x - 2, by - 9 * u); g.lineTo(x + ww + 2, by - 9 * u); g.stroke();
          }
        }
        g.fillStyle = css(tone(base, 1.5)); g.fillRect(T.x, y - 3 * u, T.w, 8 * u);
        g.fillStyle = "rgba(0, 0, 0, 0.3)"; g.fillRect(T.x, y + 5 * u, T.w, 3 * u);
      }
      g.fillStyle = css(tone(base, 1.3));
      for (let c = 0; c <= cols; c++) g.fillRect(T.x + pad + c * cw - 2.5 * u, top, 5 * u, bottom - top);
    }

    if (T.roof) this.paintRoof(T, R, base, side);

    // the sign down the front of a tall one: a bare strip of wall behind it
    if (T.has === "blade") {
      const colAt = T.x + T.w / 2 < this.W / 2 ? cols - 1 : 0;       // the side nearer the middle of the page
      const cx = T.x + pad + (colAt + 0.5) * cw;
      const sw = clamp(cw * 0.72, 34, 50), sh = clamp(H * 0.36, 190, 300);
      const sy = clamp(H * 0.15, 56, 150);
      this.signs.blade = { x: clamp(cx - sw / 2, 8, this.W - sw - 8), y: sy, w: sw, h: sh };
      for (const win of this.windows) {
        if (win.tower === T.i && win.col === colAt && win.y + win.h > sy - 12 && win.y < sy + sh + 12) win.blocked = true;
      }
    }
  }

  // The roof of one short enough to see: a parapet, and what is kept up there.
  paintRoof(T, R, base, side) {
    const { g } = this.near, { u, W } = this;
    const top = T.top;
    g.fillStyle = css(tone(base, 1.5)); g.fillRect(T.x - 3 * u, top - 7 * u, T.w + 6 * u, 9 * u);
    g.fillStyle = css(tone(base, 0.55)); g.fillRect(T.x + T.w + 3 * u, top - 7 * u, side - 3 * u, 12 * u);
    g.fillStyle = "rgba(0, 0, 0, 0.35)"; g.fillRect(T.x, top + 2 * u, T.w, 4 * u);
    const dim = css(tone(base, 0.62)), lit = css(tone(base, 1.2));
    // what can be seen of this roof
    const x0 = Math.max(T.x, 0), x1 = Math.min(T.x + T.w, W);

    if (T.has === "board") {
      // the hoarding stands here: city.js puts it up. Leave it room, and put
      // the stair head and a vent at the ends.
      const bw = clamp((x1 - x0) - 36 * u, 150, 320), bh = clamp(bw * 0.4, 78, 118);
      const bx = (x0 + x1) / 2 - bw / 2;
      this.signs.board = { x: bx, y: top - 7 * u - bh - 20 * u, w: bw, h: bh, foot: 20 * u };
      if (x1 - x0 - bw > 70 * u) {
        g.fillStyle = dim; g.fillRect(x0 + 6 * u, top - 22 * u, 12 * u, 16 * u);
        this.vents.push({ x: x0 + 12 * u, y: top - 22 * u });
      }
      return;
    }
    // the stair head
    const hx = x0 + (x1 - x0) * 0.12, hw = 46 * u, hh = 34 * u;
    g.fillStyle = dim; g.fillRect(hx, top - 7 * u - hh, hw, hh);
    g.fillStyle = lit; g.fillRect(hx, top - 7 * u - hh, hw, 3 * u);
    g.fillStyle = css(tone(base, 0.4)); g.fillRect(hx + hw * 0.34, top - 7 * u - hh * 0.62, hw * 0.3, hh * 0.62);
    // a water tank on its legs
    const tx = x0 + (x1 - x0) * 0.56, tw = 46 * u, th = 44 * u, leg = 26 * u, ty = top - 7 * u - leg - th;
    g.strokeStyle = dim; g.lineWidth = 2.4 * u;
    g.beginPath();
    for (const f of [0.08, 0.36, 0.64, 0.92]) { g.moveTo(tx + tw * f, ty + th); g.lineTo(tx + tw * f, top - 7 * u); }
    g.moveTo(tx + tw * 0.08, ty + th + leg * 0.2); g.lineTo(tx + tw * 0.92, top - 7 * u - leg * 0.15);
    g.moveTo(tx + tw * 0.92, ty + th + leg * 0.2); g.lineTo(tx + tw * 0.08, top - 7 * u - leg * 0.15);
    g.stroke();
    const barrel = g.createLinearGradient(tx, 0, tx + tw, 0);
    barrel.addColorStop(0, css(tone(base, 1.5))); barrel.addColorStop(0.4, css(tone(base, 1.05))); barrel.addColorStop(1, css(tone(base, 0.55)));
    g.fillStyle = barrel; g.fillRect(tx, ty, tw, th);
    g.fillStyle = "rgba(0, 0, 0, 0.22)";
    for (let i = 1; i < 7; i++) g.fillRect(tx + (tw * i) / 7, ty, 1, th);
    g.fillRect(tx, ty + th * 0.3, tw, 2 * u); g.fillRect(tx, ty + th * 0.72, tw, 2 * u);
    g.fillStyle = css(tone(base, 0.8));
    g.beginPath(); g.moveTo(tx - 3 * u, ty); g.lineTo(tx + tw / 2, ty - 18 * u); g.lineTo(tx + tw + 3 * u, ty); g.closePath(); g.fill();
    // a mast, with a light on it
    const mx = x0 + (x1 - x0) * 0.86, mh = 92 * u;
    g.strokeStyle = dim; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(mx, top - 7 * u); g.lineTo(mx, top - 7 * u - mh);
    g.moveTo(mx - 9 * u, top - 7 * u - mh * 0.55); g.lineTo(mx + 9 * u, top - 7 * u - mh * 0.55);
    g.moveTo(mx - 6 * u, top - 7 * u - mh * 0.75); g.lineTo(mx + 6 * u, top - 7 * u - mh * 0.75);
    g.stroke();
    this.beacons.push({ x: mx, y: top - 7 * u - mh, r: 3 * u, ph: R(TAU), sp: 1 });
    // a vent, steaming
    const vx = x0 + (x1 - x0) * 0.36;
    g.fillStyle = dim; g.fillRect(vx - 7 * u, top - 20 * u, 14 * u, 14 * u);
    g.fillStyle = lit; g.fillRect(vx - 8 * u, top - 21 * u, 16 * u, 3 * u);
    this.vents.push({ x: vx, y: top - 21 * u });
  }

  // Iron landings and ladders down two bays of the brick one. The windows
  // behind it are left dark.
  fireEscape(T, R, o) {
    const { g } = this.near, { u, P, py: PY } = this;
    const mid = T.x + T.w / 2 < this.W / 2 ? 0 : o.cols - 2;         // down the side away from the middle
    const c0 = clamp(mid, 0, o.cols - 2);
    const xa = T.x + o.pad + c0 * o.cw + (o.cw - o.ww) / 2 - 8 * u;
    const xb = T.x + o.pad + (c0 + 1) * o.cw + (o.cw + o.ww) / 2 + 8 * u;
    g.strokeStyle = css(P.iron, 0.9);
    g.lineCap = "butt";
    for (let r = 0; r < o.rows; r++) {
      const y = o.y0 + r * PY + PY * 0.18 + o.wh + 9 * u;            // the landing, under the sills
      const rail = y - PY * 0.3;
      g.lineWidth = 2.6 * u;
      g.beginPath(); g.moveTo(xa, y); g.lineTo(xb, y); g.stroke();
      g.lineWidth = 1.3 * u;
      g.beginPath(); g.moveTo(xa, rail); g.lineTo(xb, rail);
      for (let x = xa; x <= xb + 0.5; x += (xb - xa) / Math.round((xb - xa) / (7 * u))) { g.moveTo(x, rail); g.lineTo(x, y); }
      // the ladder up to the next
      const up = y - PY, flip = r % 2 === 0;
      const lx0 = flip ? xa + (xb - xa) * 0.18 : xb - (xb - xa) * 0.18, lx1 = flip ? xb - (xb - xa) * 0.24 : xa + (xb - xa) * 0.24;
      g.moveTo(lx0, y); g.lineTo(lx1, up);
      g.moveTo(lx0 + 6 * u, y); g.lineTo(lx1 + 6 * u, up);
      g.stroke();
    }
    for (const win of this.windows) if (win.tower === T.i && (win.col === c0 || win.col === c0 + 1)) win.blocked = true;
  }

  // What comes up from the street, a long way down, and the dark at the edges.
  paintStreet() {
    const { g } = this.near, { W, H, P } = this;
    g.globalCompositeOperation = "source-atop";
    const up = g.createLinearGradient(0, H * 0.55, 0, H);
    up.addColorStop(0, css(P.street, 0));
    up.addColorStop(1, css(P.street, P.streetA));
    g.fillStyle = up; g.fillRect(0, 0, W, H);
    const down = g.createLinearGradient(0, 0, 0, H * 0.3);
    down.addColorStop(0, "rgba(0, 0, 10, 0.34)");
    down.addColorStop(1, "rgba(0, 0, 10, 0)");
    g.fillStyle = down; g.fillRect(0, 0, W, H * 0.3);
    g.globalCompositeOperation = "source-over";
  }

  cloud(R, i) {
    const { W, H, P } = this;
    const w = R(260, 520) * clamp(this.u, 0.7, 1.3), h = w * R(0.2, 0.3);
    const L = layer(w, h, 1);
    for (let k = 0; k < 9; k++) {
      const cx = R(0.15, 0.85) * w, cy = R(0.35, 0.65) * h, r = R(0.14, 0.3) * w;
      const grad = L.g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, css(P.cloud, 0.34));
      grad.addColorStop(1, css(P.cloud, 0));
      L.g.fillStyle = grad;
      L.g.save(); L.g.translate(cx, cy); L.g.scale(1, (h / w) * 1.9); L.g.translate(-cx, -cy);
      L.g.fillRect(cx - r, cy - r, r * 2, r * 2);
      L.g.restore();
    }
    return { L, x: R(-0.2, 1) * W, y: R(0.02, 0.5) * H + i * 4, sp: R(3, 9) * (R() < 0.5 ? 1 : 0.6) };
  }

  // ----- Every frame -----
  draw(g, t, dt, pointer) {
    const { W, H, P, still } = this;

    // the pointer leans the far skyline one way and the near one a bit further
    const want = pointer && pointer.on ? clamp(pointer.x / W - 0.5, -0.5, 0.5) * 2 : 0;
    this.shift += (want - this.shift) * Math.min(1, dt * 2.2);
    const farX = -PAD - this.shift * PAD * 0.45, midX = -PAD - this.shift * PAD * 0.95;

    // the sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    for (const [at, c] of P.sky) sky.addColorStop(at, c);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    for (const s of this.stars) {
      const a = s.a * P.stars * (still ? 0.8 : 0.62 + 0.38 * Math.sin(t * s.sp + s.ph));
      g.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
      g.fillRect(s.x, s.y, s.r, s.r);
    }
    this.drawMoon(g);

    for (const c of this.clouds) {
      if (!still) { c.x += c.sp * dt; if (c.x > W + 20) c.x = -c.L.w - 20; }
      g.globalAlpha = P.cloudA;
      g.drawImage(c.L.c, c.x, c.y, c.L.w, c.L.h);
    }
    g.globalAlpha = 1;

    if (!still) { this.stepPlane(g, t, dt); this.stepFlock(g, t, dt); }

    g.drawImage(this.far.c, farX, 0, this.far.w, H);
    this.blink(g, t, this.far, farX + PAD);
    g.drawImage(this.mid.c, midX, 0, this.mid.w, H);
    this.blink(g, t, this.mid, midX + PAD);
    if (!still) this.stepTwinkle(dt);

    if (!still) this.stepSteam(g, dt);
    g.drawImage(this.near.c, 0, 0, W, H);
    this.blink(g, t, undefined, 0);
    if (this.lift) this.stepLift(g, dt);
  }

  drawMoon(g) {
    const { moon: m, P } = this;
    const halo = g.createRadialGradient(m.x, m.y, m.r * 0.6, m.x, m.y, m.r * 5);
    halo.addColorStop(0, css(P.moon, 0.2));
    halo.addColorStop(1, css(P.moon, 0));
    g.fillStyle = halo; g.fillRect(m.x - m.r * 5, m.y - m.r * 5, m.r * 10, m.r * 10);
    g.fillStyle = css(P.moon, 0.96);
    g.beginPath(); g.arc(m.x, m.y, m.r, 0, TAU); g.fill();
    // its seas
    g.fillStyle = css(mix(P.moon, [120, 130, 170], 0.5), 0.3);
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.26], [0.25, 0.1, 0.34], [-0.1, 0.45, 0.2], [0.42, -0.42, 0.14]]) {
      g.beginPath(); g.arc(m.x + dx * m.r, m.y + dy * m.r, r * m.r, 0, TAU); g.fill();
    }
  }

  // The red lights on the masts.
  blink(g, t, L, dx) {
    g.globalCompositeOperation = "lighter";
    for (const b of this.beacons) {
      if (b.L !== L) continue;
      const k = this.still ? 0.8 : Math.pow(0.5 + 0.5 * Math.sin(t * 2.1 * b.sp + b.ph), 3);
      if (k < 0.03) continue;
      const x = b.x + dx, r = b.r * 5;
      const grad = g.createRadialGradient(x, b.y, 0, x, b.y, r);
      grad.addColorStop(0, `rgba(255, 110, 90, ${(0.95 * k).toFixed(3)})`);
      grad.addColorStop(0.25, `rgba(255, 60, 50, ${(0.5 * k).toFixed(3)})`);
      grad.addColorStop(1, "rgba(255, 40, 40, 0)");
      g.fillStyle = grad; g.fillRect(x - r, b.y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
  }

  // Far off, a light goes on, or off.
  stepTwinkle(dt) {
    this.twinkleIn = (this.twinkleIn || 0) - dt;
    if (this.twinkleIn > 0 || !this.twinkle.length) return;
    this.twinkleIn = 0.1 + Math.random() * 0.5;
    const w = this.twinkle[Math.floor(Math.random() * this.twinkle.length)];
    const g = w.L.g;
    w.on = !w.on;
    g.fillStyle = css(w.body); g.fillRect(w.x - 0.5, w.y - 0.5, w.w + 1, w.h + 1);
    g.fillStyle = w.on ? css(w.col, w.a) : css(tone(w.body, 1.5), 0.35);
    g.fillRect(w.x, w.y, w.w, w.h);
  }

  stepPlane(g, t, dt) {
    const { W, H } = this;
    if (!this.plane) {
      if ((this.planeIn -= dt) > 0) return;
      const ltr = Math.random() < 0.5;
      this.plane = { x: ltr ? -20 : W + 20, y: H * (0.05 + Math.random() * 0.25), vx: (ltr ? 1 : -1) * (26 + Math.random() * 20), vy: -2 - Math.random() * 5 };
    }
    const p = this.plane;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < -40 || p.x > W + 40) { this.plane = null; this.planeIn = 14 + Math.random() * 26; return; }
    g.fillStyle = "rgba(255, 255, 255, 0.85)";
    g.fillRect(p.x, p.y, 2, 1.6);
    g.fillStyle = "rgba(120, 255, 160, 0.8)";
    g.fillRect(p.x - Math.sign(p.vx) * 4, p.y + 0.5, 1.6, 1.6);
    if (t % 1.2 < 0.12) {
      g.fillStyle = "rgba(255, 90, 80, 1)";
      g.beginPath(); g.arc(p.x - Math.sign(p.vx) * 2, p.y + 1, 2.4, 0, TAU); g.fill();
    }
  }

  // A few birds going over, now and then.
  stepFlock(g, t, dt) {
    const { W, H, P } = this;
    if (!this.flock) {
      if ((this.flockIn -= dt) > 0) return;
      const ltr = Math.random() < 0.5, n = 4 + Math.floor(Math.random() * 6);
      this.flock = {
        x: ltr ? -60 : W + 60, y: H * (0.08 + Math.random() * 0.3), v: (ltr ? 1 : -1) * (40 + Math.random() * 25),
        birds: Array.from({ length: n }, (_, i) => ({ dx: -i * 13 - Math.random() * 8, dy: (i % 2 ? 1 : -1) * i * 5 + Math.random() * 6, ph: Math.random() * TAU }))
      };
    }
    const f = this.flock;
    f.x += f.v * dt;
    if (f.x < -220 || f.x > W + 220) { this.flock = null; this.flockIn = 18 + Math.random() * 30; return; }
    g.strokeStyle = css(mix(hex(P.mid), [0, 0, 0], 0.5), 0.85);
    g.lineWidth = 1.2;
    g.beginPath();
    for (const b of f.birds) {
      const x = f.x + b.dx * Math.sign(f.v), y = f.y + b.dy + Math.sin(t * 1.3 + b.ph) * 2, flap = Math.sin(t * 9 + b.ph) * 2.6;
      g.moveTo(x - 4, y - flap); g.lineTo(x, y); g.lineTo(x + 4, y - flap);
    }
    g.stroke();
  }

  stepSteam(g, dt) {
    for (const v of this.vents) {
      if (Math.random() < dt * 9) this.steam.push({ x: v.x + (Math.random() - 0.5) * 6, y: v.y, vx: 5 + Math.random() * 9, vy: -(14 + Math.random() * 12), age: 0, life: 2.6 + Math.random() * 2.2, r: 3 + Math.random() * 3 });
    }
    for (const s of this.steam) {
      s.age += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.r += dt * 5;
      const k = s.age / s.life;
      g.fillStyle = css(mix(this.P.cloud, [255, 255, 255], 0.5), 0.2 * (1 - k) * Math.min(1, k * 6));
      g.beginPath(); g.arc(s.x, s.y, s.r * this.u, 0, TAU); g.fill();
    }
    this.steam = this.steam.filter((s) => s.age < s.life);
  }

  // The lift: it stops at a floor, waits, and goes to another.
  stepLift(g, dt) {
    const l = this.lift, py = this.py;
    if (!this.still) {
      if (l.wait > 0) { l.wait -= dt; if (l.wait <= 0) l.to = Math.floor(Math.random() * l.rows); }
      else {
        const d = l.to - l.at, step = dt * 2.4;
        if (Math.abs(d) <= step) { l.at = l.to; l.wait = 2 + Math.random() * 6; }
        else l.at += Math.sign(d) * step;
      }
    }
    const y = l.y0 + l.at * py + py * 0.14, h = py * 0.56;
    g.globalCompositeOperation = "lighter";
    const cx = l.x + l.w / 2, cy = y + h / 2, r = h * 0.95;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    glow.addColorStop(0, "rgba(255, 226, 170, 0.22)");
    glow.addColorStop(1, "rgba(255, 226, 170, 0)");
    g.fillStyle = glow; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgba(255, 234, 190, 0.95)";
    g.fillRect(l.x + 1, y, l.w - 2, h);
    g.fillStyle = "rgba(60, 40, 40, 0.7)";
    g.fillRect(l.x + l.w * 0.36, y + h * 0.4, l.w * 0.3, h * 0.6);
  }

  // ----- A window with the light on -----
  // k is how bright (it flickers on, and gutters out); hue is the colour of
  // the fact inside; room is which of the rooms it is.
  drawLit(g, win, k, hue, t, room) {
    if (k <= 0.01) return;
    const { x, y, w, h } = win;
    const warm = mix([255, 228, 176], hue, 0.4);
    const cx = x + w / 2, cy = y + h / 2;
    g.save();
    // what it throws on the wall round it
    g.globalCompositeOperation = "lighter";
    const r = Math.max(w, h) * 1.9;
    const halo = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, r);
    halo.addColorStop(0, css(hue, 0.4 * k));
    halo.addColorStop(0.5, css(hue, 0.12 * k));
    halo.addColorStop(1, css(hue, 0));
    g.fillStyle = halo; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over";

    g.globalAlpha = clamp(k, 0, 1);
    const wall = g.createLinearGradient(0, y, 0, y + h);
    wall.addColorStop(0, css(tone(warm, 1.5)));
    wall.addColorStop(1, css(tone(warm, 0.86)));
    g.fillStyle = wall; g.fillRect(x, y, w, h);
    g.beginPath(); g.rect(x, y, w, h); g.clip();

    // who, or what, is in
    const ink = css(tone(mix(hue, [40, 30, 50], 0.6), 0.55), 0.78);
    g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = "round"; g.lineJoin = "round";
    const sway = this.still ? 0 : Math.sin(t * 0.8 + win.x) * w * 0.02;
    switch (room) {
      case 0: {                                             // somebody standing at it
        const px = x + w * 0.5 + sway;
        g.beginPath(); g.arc(px, y + h * 0.5, w * 0.13, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(px, y + h * 1.02, w * 0.27, h * 0.4, 0, 0, TAU); g.fill();
        break;
      }
      case 1: {                                             // somebody working late, by a lamp
        g.lineWidth = Math.max(1.5, w * 0.04);
        g.beginPath(); g.moveTo(x + w * 0.24, y + h); g.lineTo(x + w * 0.24, y + h * 0.56); g.stroke();
        g.beginPath(); g.moveTo(x + w * 0.1, y + h * 0.56); g.lineTo(x + w * 0.38, y + h * 0.56); g.lineTo(x + w * 0.31, y + h * 0.38); g.lineTo(x + w * 0.17, y + h * 0.38); g.closePath(); g.fill();
        const px = x + w * 0.68 + sway * 0.5;
        g.beginPath(); g.arc(px, y + h * 0.62, w * 0.11, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(px, y + h * 1.04, w * 0.22, h * 0.32, 0, 0, TAU); g.fill();
        break;
      }
      case 2: {                                             // a plant on the sill
        const bx = x + w * 0.42;
        g.beginPath(); g.moveTo(bx - w * 0.13, y + h * 0.8); g.lineTo(bx + w * 0.13, y + h * 0.8); g.lineTo(bx + w * 0.09, y + h); g.lineTo(bx - w * 0.09, y + h); g.closePath(); g.fill();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i - 2.5) * 0.42 + sway * 0.02, len = h * (0.28 + (i % 3) * 0.07);
          g.beginPath(); g.ellipse(bx + Math.cos(a) * len * 0.5, y + h * 0.8 + Math.sin(a) * len * 0.5, len * 0.5, w * 0.045, a, 0, TAU); g.fill();
        }
        break;
      }
      case 3: {                                             // a cat, watching the street
        const bx = x + w * 0.56, by = y + h;
        g.beginPath(); g.ellipse(bx, by - h * 0.1, w * 0.17, h * 0.17, 0, 0, TAU); g.fill();
        g.beginPath(); g.arc(bx + w * 0.07, by - h * 0.3, w * 0.09, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(bx - w * 0.01, by - h * 0.34); g.lineTo(bx + w * 0.02, by - h * 0.44); g.lineTo(bx + w * 0.07, by - h * 0.37); g.lineTo(bx + w * 0.12, by - h * 0.44); g.lineTo(bx + w * 0.15, by - h * 0.34); g.closePath(); g.fill();
        g.lineWidth = Math.max(1.5, w * 0.045);
        const flick = this.still ? 0 : Math.sin(t * 1.7 + win.y) * w * 0.05;
        g.beginPath(); g.moveTo(bx - w * 0.15, by - h * 0.04); g.quadraticCurveTo(bx - w * 0.32, by - h * 0.06, bx - w * 0.3 + flick, by - h * 0.22); g.stroke();
        break;
      }
      case 4: {                                             // shelves of books, and a lamp hung over them
        const R = rng(Math.round(win.x * 7 + win.y * 13));
        for (const f of [0.42, 0.68, 0.94]) {
          g.fillRect(x, y + h * f, w, Math.max(1, h * 0.02));
          for (let bx = x + 2; bx < x + w - 3;) { const bw = 2 + R() * 3.5, bh = h * (0.12 + R() * 0.1); if (R() < 0.85) g.fillRect(bx, y + h * f - bh, bw, bh); bx += bw + 1; }
        }
        g.fillRect(x + w * 0.5 - 0.6, y, 1.2, h * 0.1);
        g.beginPath(); g.arc(x + w * 0.5, y + h * 0.16, w * 0.09, Math.PI, 0); g.fill();
        break;
      }
      case 5: {                                             // curtains, not quite drawn
        for (const s of [0, 1]) {
          const ex = s ? x + w : x, d = s ? -1 : 1;
          g.beginPath(); g.moveTo(ex, y); g.lineTo(ex + d * w * 0.34, y);
          g.quadraticCurveTo(ex + d * w * (0.3 + sway * 0.02), y + h * 0.6, ex + d * w * 0.16, y + h);
          g.lineTo(ex, y + h); g.closePath(); g.fill();
        }
        break;
      }
      default: {                                            // nobody: a bulb on its flex
        g.fillRect(x + w * 0.5 - 0.6, y, 1.2, h * 0.22);
        g.fillStyle = "rgba(255, 255, 255, 0.9)";
        g.beginPath(); g.arc(x + w * 0.5, y + h * 0.26, Math.max(2, w * 0.05), 0, TAU); g.fill();
      }
    }
    // the glazing bars, against the light
    g.fillStyle = win.bar;
    const bar = Math.max(1.5, w * 0.035);
    for (const f of win.mull.v) g.fillRect(x + w * f - bar / 2, y, bar, h);
    for (const f of win.mull.h) g.fillRect(x, y + h * f - bar / 2, w, bar);
    g.restore();
  }

  // The window under a point, if there is one.
  windowAt(x, y) {
    for (const w of this.windows) if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w;
    return null;
  }
}

export { clamp, smooth };
