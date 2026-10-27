// room-props.js — the cartographer's desk, modelled in three.js.
//
// Everything on the desk is built here from primitives, and every surface is
// painted on a canvas at load; nothing is fetched. The desk and its sea chart,
// the candle in its chamberstick, a pocket compass whose needle hunts for the
// pointer, and an inkwell with a quill stood in it. The notes are paper.js.

import * as THREE from "three";

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- Canvases -----
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

export function tex(c, { color = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Smooth value noise, tiled, a few octaves: leather, plaster, stains.
function valueNoise(size, seed, cells, octaves) {
  const r = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const grid = Array.from({ length: n * n }, r);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * n, y0 = Math.floor(gy), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * n, x0 = Math.floor(gx), fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[(y0 % n) * n + (x0 % n)], b = grid[(y0 % n) * n + ((x0 + 1) % n)];
        const c = grid[((y0 + 1) % n) * n + (x0 % n)], d = grid[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        out[y * size + x] += (lerp(a, b, sx) * (1 - sy) + lerp(c, d, sx) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function noiseCanvas(size, seed, cells, octaves, lo = 0, hi = 255) {
  const [c, g] = canvas(size, size);
  const n = valueNoise(size, seed, cells, octaves);
  const img = g.createImageData(size, size);
  for (let i = 0; i < n.length; i++) {
    const v = lo + (hi - lo) * n[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Fine grit for bump maps: paper tooth, cast brass, cork.
function grit(size, seed, lo = 90, hi = 255) {
  const [c, g] = canvas(size, size);
  const r = rng(seed);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = lo + (hi - lo) * r();
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// The desk top: four planks of walnut, the grain running their length.
function woodCanvas(seed) {
  const [c, g] = canvas(2048, 1024);
  const r = rng(seed);
  const planks = 4, ph = 1024 / planks;
  for (let p = 0; p < planks; p++) {
    g.save();
    g.beginPath();
    g.rect(0, p * ph, 2048, ph);
    g.clip();
    const tone = r();
    const grad = g.createLinearGradient(0, p * ph, 0, (p + 1) * ph);
    grad.addColorStop(0, `rgb(${92 + tone * 18}, ${54 + tone * 10}, ${30 + tone * 6})`);
    grad.addColorStop(0.5, `rgb(${104 + tone * 18}, ${62 + tone * 10}, ${35 + tone * 6})`);
    grad.addColorStop(1, `rgb(${86 + tone * 18}, ${50 + tone * 10}, ${28 + tone * 6})`);
    g.fillStyle = grad;
    g.fillRect(0, p * ph, 2048, ph);
    for (let i = 0; i < 340; i++) {
      const y0 = p * ph + r() * ph;
      const amp = 2 + r() * 9, freq = 0.0015 + r() * 0.004, ph0 = r() * TAU;
      const dark = r() < 0.62;
      g.strokeStyle = dark ? `rgba(38, 18, 6, ${0.05 + r() * 0.16})` : `rgba(170, 118, 72, ${0.04 + r() * 0.09})`;
      g.lineWidth = 0.6 + r() * 2.6;
      g.beginPath();
      for (let x = -32; x <= 2080; x += 32) {
        const y = y0 + Math.sin(x * freq + ph0) * amp + Math.sin(x * freq * 3.3 + ph0 * 2) * amp * 0.3;
        if (x < 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    // a knot or two, with the grain bending round it
    const knots = r() < 0.7 ? 1 : 2;
    for (let k = 0; k < knots; k++) {
      const kx = 200 + r() * 1650, ky = p * ph + 40 + r() * (ph - 80);
      for (let ring = 9; ring > 0; ring--) {
        g.strokeStyle = `rgba(40, 18, 6, ${0.08 + (9 - ring) * 0.03})`;
        g.lineWidth = 1.4;
        g.beginPath();
        g.ellipse(kx, ky, ring * 7, ring * 2.6, 0, 0, TAU);
        g.stroke();
      }
      g.fillStyle = "rgba(30, 12, 4, 0.55)";
      g.beginPath();
      g.ellipse(kx, ky, 6, 2.5, 0, 0, TAU);
      g.fill();
    }
    g.restore();
    g.fillStyle = "rgba(12, 5, 2, 0.75)";
    g.fillRect(0, p * ph, 2048, 3);
  }
  // years of elbows have worn the middle paler
  const wear = g.createRadialGradient(1024, 560, 60, 1024, 560, 900);
  wear.addColorStop(0, "rgba(190, 140, 90, 0.10)");
  wear.addColorStop(1, "rgba(0, 0, 0, 0.18)");
  g.fillStyle = wear;
  g.fillRect(0, 0, 2048, 1024);
  return c;
}

// ----- The sea chart -----
function roseStar(g, cx, cy, r) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const len = i % 2 === 0 ? r : r * 0.6;
    const tip = [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
    for (const side of [-1, 1]) {
      const b = a + side * 0.4;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(b) * r * 0.16, cy + Math.sin(b) * r * 0.16);
      g.lineTo(tip[0], tip[1]);
      g.closePath();
      g.fillStyle = side < 0 ? "#3b2a12" : "#eadcb6";
      g.fill();
      g.strokeStyle = "#3b2a12";
      g.lineWidth = 1.2;
      g.stroke();
    }
  }
}

// The sea chart the notes lie on: faded coastlines, rhumb lines fanning out
// from two wind roses, and a cartouche in the corner with the one thing to
// know. It is drawn to the chart's own proportions, so it is never stretched;
// `u` sizes everything to how it looks on a 1200 × 800 chart.
export function chartCanvas(world, aspect) {
  const size = 1536;
  const w = aspect >= 1 ? size : Math.round(size * aspect);
  const h = aspect >= 1 ? Math.round(size / aspect) : size;
  const [c, g] = canvas(w, h);
  const r = rng(31);
  const u = Math.min(w / 1200, h / 800);
  const base = g.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.62);
  base.addColorStop(0, "#f3e7c8");
  base.addColorStop(0.55, "#e6d4a8");
  base.addColorStop(1, "#c4a56a");
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // tea stains and foxing
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, rad = (30 + r() * 220) * u / 1.7;
    const st = g.createRadialGradient(x, y, 0, x, y, rad);
    st.addColorStop(0, `rgba(150, 100, 40, ${0.03 + r() * 0.07})`);
    st.addColorStop(0.8, `rgba(130, 80, 30, ${0.02 + r() * 0.05})`);
    st.addColorStop(1, "rgba(130, 80, 30, 0)");
    g.fillStyle = st;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // rhumb lines from two wind roses
  const roses = [[w * 0.275, h * 0.475, 70 * u, 0.75], [w * 0.817, h * 0.3, 46 * u, 0.6]];
  g.lineWidth = 0.7 * u;
  for (const [cx, cy] of roses) {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * TAU;
      g.strokeStyle = i % 4 === 0 ? "rgba(125, 29, 18, 0.32)" : i % 2 === 0 ? "rgba(46, 90, 58, 0.28)" : "rgba(59, 42, 18, 0.26)";
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 4000, cy + Math.sin(a) * 4000);
      g.stroke();
    }
  }
  // the coastlines, faded, across the full width
  if (world) {
    const k = (w * 1.02) / 720;
    g.save();
    g.translate(-w * 0.01, (h - 284 * k) / 2);
    g.scale(k, k);
    const land = new Path2D(world);
    g.fillStyle = "rgba(138, 106, 58, 0.17)";
    g.fill(land);
    g.strokeStyle = "rgba(90, 60, 23, 0.55)";
    g.lineWidth = 1.5 / k;
    g.stroke(land);
    g.restore();
  }
  for (const [cx, cy, rad, alpha] of roses) {
    g.globalAlpha = alpha;
    roseStar(g, cx, cy, rad);
    g.globalAlpha = 1;
  }
  g.strokeStyle = "rgba(59, 42, 18, 0.75)";
  g.lineWidth = 1.2 * u;
  g.beginPath();
  g.arc(roses[0][0], roses[0][1], 16 * u, 0, TAU);
  g.stroke();
  // the cartouche, up in the corner
  g.save();
  g.translate(w - 330 * u, 34 * u);
  g.scale(u, u);
  g.fillStyle = "#efe2bf";
  g.strokeStyle = "#3b2a12";
  g.lineWidth = 1.6;
  g.beginPath();
  g.roundRect(0, 0, 300, 110, 6);
  g.fill();
  g.stroke();
  g.lineWidth = 0.7;
  g.beginPath();
  g.roundRect(8, 8, 284, 94, 4);
  g.stroke();
  g.textAlign = "center";
  g.fillStyle = "#3b2a12";
  g.font = '30px "IM Fell English SC", Georgia, serif';
  g.fillText("Carta Diurna", 150, 52);
  g.font = 'italic 17px "IM Fell English", Georgia, serif';
  g.fillStyle = "#5a3c17";
  g.fillText("hold a note, and it will open", 150, 80);
  g.restore();
  // where it has been folded in quarters, and the edges darkened by hands
  g.strokeStyle = "rgba(255, 250, 235, 0.35)";
  g.lineWidth = 2.2 * u;
  g.beginPath();
  g.moveTo(w / 2, 0); g.lineTo(w / 2, h);
  g.moveTo(0, h / 2); g.lineTo(w, h / 2);
  g.stroke();
  g.strokeStyle = "rgba(90, 60, 20, 0.22)";
  g.lineWidth = 1.5 * u;
  g.beginPath();
  g.moveTo(w / 2 + 2 * u, 0); g.lineTo(w / 2 + 2 * u, h);
  g.moveTo(0, h / 2 + 2 * u); g.lineTo(w, h / 2 + 2 * u);
  g.stroke();
  const edge = (x0, y0, x1, y1) => {
    const e = g.createLinearGradient(x0, y0, x1, y1);
    e.addColorStop(0, "rgba(90, 50, 15, 0.55)");
    e.addColorStop(1, "rgba(90, 50, 15, 0)");
    return e;
  };
  const e = 52 * u;
  g.fillStyle = edge(0, 0, e, 0); g.fillRect(0, 0, e, h);
  g.fillStyle = edge(w, 0, w - e, 0); g.fillRect(w - e, 0, e, h);
  g.fillStyle = edge(0, 0, 0, e); g.fillRect(0, 0, w, e);
  g.fillStyle = edge(0, h, 0, h - e); g.fillRect(0, h - e, w, e);
  return c;
}

function compassFace() {
  const [c, g] = canvas(512, 512);
  const grad = g.createRadialGradient(230, 210, 20, 256, 256, 256);
  grad.addColorStop(0, "#f6ecd2");
  grad.addColorStop(1, "#d2bd8c");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.translate(256, 256);
  g.strokeStyle = "#3b2a12";
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    const r1 = i % 16 === 0 ? 176 : i % 8 === 0 ? 196 : i % 2 === 0 ? 210 : 218;
    g.lineWidth = i % 8 === 0 ? 3 : 1.5;
    g.beginPath();
    g.moveTo(Math.sin(a) * r1, -Math.cos(a) * r1);
    g.lineTo(Math.sin(a) * 232, -Math.cos(a) * 232);
    g.stroke();
  }
  g.beginPath();
  g.arc(0, 0, 234, 0, TAU);
  g.lineWidth = 3;
  g.stroke();
  g.globalAlpha = 0.28;
  roseStar(g, 0, 0, 150);
  g.globalAlpha = 1;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = '44px "IM Fell English SC", Georgia, serif';
  const marks = [["N", 0, "#7d1d12"], ["E", 1, "#3b2a12"], ["S", 2, "#3b2a12"], ["W", 3, "#3b2a12"]];
  for (const [letter, q, color] of marks) {
    const a = q * Math.PI / 2;
    g.fillStyle = color;
    g.fillText(letter, Math.sin(a) * 140, -Math.cos(a) * 140);
  }
  return c;
}

// A feather, drawn with its barbs, on a transparent ground.
function featherCanvas() {
  const [c, g] = canvas(128, 1024);
  const r = rng(13);
  g.translate(64, 0);
  for (let y = 120; y < 980; y += 3) {
    const t = (y - 120) / 860;
    const half = Math.sin(Math.pow(t, 0.7) * Math.PI) * 54 * (1 - t * 0.25);
    const tone = 228 + r() * 24;
    g.strokeStyle = `rgba(${tone}, ${tone - 8}, ${tone - 26}, ${0.75 + r() * 0.25})`;
    g.lineWidth = 2.2;
    const gap = r() < 0.03;
    for (const side of [-1, 1]) {
      if (gap && side > 0) continue;
      g.beginPath();
      g.moveTo(0, y);
      g.quadraticCurveTo(side * half * 0.6, y - 10, side * half, y - 26 - r() * 6);
      g.stroke();
    }
  }
  g.strokeStyle = "#cdbb98";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, 40); g.lineTo(0, 1010);
  g.stroke();
  g.strokeStyle = "#2a2018";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(0, 46);
  g.stroke();
  return c;
}

// ----- Materials -----
export function makeMaterials() {
  const brassBump = tex(grit(128, 3, 150, 255), { color: false, repeat: [3, 3] });
  const wood = woodCanvas(17);
  const woodMap = tex(wood, { aniso: 16 });
  return {
    desk: new THREE.MeshStandardMaterial({
      map: woodMap, bumpMap: tex(wood, { color: false }), bumpScale: 1.4, roughness: 0.5
    }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x3a2213, roughness: 0.6, map: woodMap }),
    wall: new THREE.MeshStandardMaterial({ color: 0x2b2019, roughness: 1, bumpMap: tex(noiseCanvas(256, 4, 8, 5), { color: false, repeat: [6, 4] }), bumpScale: 2 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x150d08, roughness: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xcaa253, metalness: 1, roughness: 0.3, bumpMap: brassBump, bumpScale: 0.3 }),
    oldBrass: new THREE.MeshStandardMaterial({ color: 0x9c7a3a, metalness: 1, roughness: 0.42, bumpMap: brassBump, bumpScale: 0.4 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.8 }),
    ink: new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.08 }),
    inkGlass: new THREE.MeshStandardMaterial({ color: 0x1e2230, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.9 }),
    coverGlass: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false })
  };
}

// ----- Helpers -----
function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function lathe(points, material, segments = 48) {
  return mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments), material);
}

// Every prop shares this shape: a root to place, the meshes a pointer can
// hit, and an update for anything it does by itself.
function prop(root, extra) {
  return Object.assign({ root, hits: [], update() { return false; } }, extra);
}

// ----- The desk, the chart, the room -----
export function makeDesk(M, width, depth) {
  const root = new THREE.Group();
  const top = mesh(new THREE.BoxGeometry(width, 0.7, depth), M.desk, { cast: false });
  top.position.y = -0.35;
  root.add(top);
  // a rounded nosing along the front edge, and the apron below it
  const nose = mesh(new THREE.CylinderGeometry(0.12, 0.12, width, 16, 1), M.desk, { cast: false });
  nose.rotation.z = Math.PI / 2;
  nose.position.set(0, -0.12, depth / 2 - 0.04);
  root.add(nose);
  const apron = mesh(new THREE.BoxGeometry(width - 0.6, 1.5, 0.3), M.darkWood, { cast: false });
  apron.position.set(0, -1.4, depth / 2 - 0.5);
  root.add(apron);
  return root;
}

export function makeChart(M, map, w, d) {
  const geometry = new THREE.PlaneGeometry(w, d, 72, 48);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const corners = [[-w / 2, -d / 2, 0.42], [w / 2, -d / 2, 0.3], [-w / 2, d / 2, 0.14], [w / 2, d / 2, 0.22]];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = 0.04;
    for (const [cx, cz, lift] of corners) {
      const k = Math.max(0, 1 - Math.hypot(x - cx, z - cz) / 2.1);
      y += Math.pow(k, 2.4) * lift;
    }
    // ridges where it was folded in quarters, and a gentle cockle
    y += Math.exp(-Math.pow(x / 0.16, 2)) * 0.028 + Math.exp(-Math.pow(z / 0.16, 2)) * 0.022;
    y += Math.sin(x * 1.3 + z * 0.7) * 0.012 + Math.sin(z * 2.1 - x * 0.4) * 0.008;
    pos.setY(i, y);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map, roughness: 0.88, side: THREE.DoubleSide,
    bumpMap: tex(grit(256, 41, 180, 255), { color: false, repeat: [8, 6] }), bumpScale: 0.4
  });
  return mesh(geometry, material, { cast: false, receive: true });
}

// ----- The candle in its chamberstick -----
export function makeCandle(M) {
  const root = new THREE.Group();
  const dish = lathe([
    [0, 0], [0.72, 0], [0.8, 0.025], [0.84, 0.08], [0.82, 0.125], [0.76, 0.11], [0.68, 0.06],
    [0.33, 0.055], [0.29, 0.075], [0.27, 0.1], [0.27, 0.28], [0.3, 0.3], [0.29, 0.325], [0.22, 0.32], [0, 0.32]
  ], M.brass, 64);
  root.add(dish);
  // the finger ring on the rim
  const ring = mesh(new THREE.TorusGeometry(0.17, 0.038, 12, 36), M.brass);
  ring.position.set(0.98, 0.15, 0);
  ring.rotation.x = Math.PI / 2;
  ring.rotation.y = 0.35;
  root.add(ring);
  const tab = mesh(new THREE.BoxGeometry(0.2, 0.03, 0.12), M.brass);
  tab.position.set(0.82, 0.12, 0);
  root.add(tab);

  // The wax, with an uneven melted rim and a few runs down the side. Its top
  // glows from within with the flame, which is most of what makes it read as
  // wax rather than plaster.
  const glow = (() => {
    const [c, g] = canvas(8, 256);
    const grad = g.createLinearGradient(0, 256, 0, 0);
    // LatheGeometry hands out v by profile point, not by length: the side of
    // the wax runs from 0 to 0.5 and the melted top from there to 1
    grad.addColorStop(0, "#000");
    grad.addColorStop(0.22, "#120602");
    grad.addColorStop(0.5, "#7a3812");
    grad.addColorStop(0.62, "#b8601c");
    grad.addColorStop(1, "#ffb060");
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    return tex(c);
  })();
  const wax = new THREE.MeshStandardMaterial({
    color: 0xe9d6b0, roughness: 0.62, emissive: 0xffa040, emissiveMap: glow, emissiveIntensity: 0.55
  });
  const waxBody = lathe([
    [0.0, 0.28], [0.222, 0.28], [0.226, 0.6], [0.221, 1.0], [0.216, 1.16], [0.205, 1.2], [0.17, 1.19], [0.1, 1.17], [0.0, 1.165]
  ], wax, 48);
  const p = waxBody.geometry.attributes.position;
  const lumps = rng(3);
  const bumps = Array.from({ length: 6 }, () => [lumps() * TAU, 0.01 + lumps() * 0.03]);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 1.1) continue;
    const a = Math.atan2(p.getZ(i), p.getX(i));
    let dy = 0;
    for (const [at, h] of bumps) dy += Math.exp(-Math.pow(Math.atan2(Math.sin(a - at), Math.cos(a - at)) / 0.35, 2)) * h;
    p.setY(i, y + dy);
  }
  waxBody.geometry.computeVertexNormals();
  root.add(waxBody);
  for (let i = 0; i < 4; i++) {
    const a = 0.6 + i * 1.7 + lumps() * 0.4;
    const len = 0.08 + lumps() * 0.26;
    const drip = mesh(new THREE.CapsuleGeometry(0.022 + lumps() * 0.012, len, 4, 8), wax);
    drip.position.set(Math.cos(a) * 0.222, 1.15 - len / 2, Math.sin(a) * 0.222);
    root.add(drip);
  }
  // the wick, bent a little by the heat, and the ember at its tip
  const wick = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    V(0, 1.15, 0), V(0, 1.24, 0), V(0.012, 1.3, 0), V(0.03, 1.335, 0.005)
  ]), 12, 0.013, 6), M.iron, { cast: false });
  root.add(wick);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.2, 0.2), toneMapped: false, transparent: true, opacity: 0 }));
  ember.position.set(0.03, 1.335, 0.005);
  root.add(ember);

  const flameAnchor = new THREE.Object3D();
  flameAnchor.position.set(0.0, 1.2, 0);
  root.add(flameAnchor);
  return prop(root, { wax, ember, flameAnchor, hits: [dish, waxBody] });
}

// ----- The pocket compass; its needle swings to the pointer -----
export function makeCompass(M) {
  const root = new THREE.Group();
  const caseBody = lathe([[0, 0], [0.6, 0], [0.66, 0.04], [0.67, 0.14], [0.62, 0.17], [0.58, 0.12], [0, 0.12]], M.brass, 64);
  root.add(caseBody);
  const bow = mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 24), M.brass);
  bow.position.set(0, 0.08, -0.76);
  bow.rotation.x = Math.PI / 2;
  root.add(bow);
  const stem = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), M.brass);
  stem.rotation.x = Math.PI / 2;
  stem.position.set(0, 0.08, -0.66);
  root.add(stem);
  const face = mesh(new THREE.CircleGeometry(0.58, 64), new THREE.MeshStandardMaterial({ map: tex(compassFace()), roughness: 0.75 }), { cast: false });
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.122;
  root.add(face);
  const needle = new THREE.Group();
  needle.position.y = 0.16;
  root.add(needle);
  const half = (color, dir) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.05); shape.lineTo(0.45 * dir, 0); shape.lineTo(0, -0.05); shape.lineTo(0, 0.05);
    // the needle moves, so it casts no shadow: the shadows are only redrawn
    // when something on the desk is moved
    const m = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }), { cast: false });
    m.rotation.x = -Math.PI / 2;
    return m;
  };
  needle.add(half(0x9b2516, 1), half(0x2c2a28, -1));
  const cap = mesh(new THREE.SphereGeometry(0.045, 12, 8), M.brass, { cast: false });
  needle.add(cap);
  const glass = mesh(new THREE.CircleGeometry(0.6, 48), M.coverGlass, { cast: false, receive: false });
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = 0.2;
  root.add(glass);
  let angle = 0, vel = 0, want = 0;
  return prop(root, {
    hits: [caseBody],
    // points the needle (its red end) at a spot on the desk, in world space
    point(target) {
      const p = new THREE.Vector3();
      root.getWorldPosition(p);
      want = Math.atan2(-(target.z - p.z), target.x - p.x) - root.rotation.y;
    },
    update(dt, t) {
      const diff = Math.atan2(Math.sin(want - angle), Math.cos(want - angle));
      vel += diff * 30 * dt;
      vel *= Math.pow(0.08, dt);
      angle += vel * dt;
      needle.rotation.y = angle;
      return Math.abs(vel) > 0.001 || Math.abs(diff) > 0.001;
    }
  });
}

// ----- The inkwell, with a quill stood in it -----
export function makeInkwell(M) {
  const root = new THREE.Group();
  const well = lathe([[0, 0], [0.42, 0], [0.46, 0.05], [0.46, 0.28], [0.36, 0.38], [0.2, 0.42], [0.17, 0.5], [0.2, 0.52], [0.13, 0.52], [0.13, 0.42], [0, 0.4]], M.inkGlass, 48);
  root.add(well);
  const ink = mesh(new THREE.CircleGeometry(0.13, 24), M.ink, { cast: false });
  ink.rotation.x = -Math.PI / 2;
  ink.position.y = 0.46;
  root.add(ink);
  const tray = lathe([[0, 0], [0.62, 0], [0.64, 0.04], [0.6, 0.06], [0, 0.05]], M.oldBrass, 48);
  root.add(tray);
  // the feather: a strip of canvas bent along its length
  const map = tex(featherCanvas());
  const geometry = new THREE.PlaneGeometry(0.42, 2.5, 1, 30);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + 1.25) / 2.5;
    pos.setZ(i, Math.pow(t, 2) * 0.35 + Math.abs(pos.getX(i)) * 0.25);
  }
  geometry.computeVertexNormals();
  geometry.translate(0, 1.25, 0);
  const featherMat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  const feather = mesh(geometry, featherMat);
  feather.customDistanceMaterial = new THREE.MeshDistanceMaterial({ alphaMap: map, alphaTest: 0.4 });
  feather.customDepthMaterial = new THREE.MeshDepthMaterial({ alphaMap: map, alphaTest: 0.4 });
  const quill = new THREE.Group();
  quill.position.set(0, 0.32, 0);
  quill.rotation.set(-0.5, 0.6, 0.55);
  quill.add(feather);
  root.add(quill);
  return prop(root, { hits: [well, feather] });
}
