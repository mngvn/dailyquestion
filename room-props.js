// room-props.js — the cartographer's desk, modelled in three.js.
//
// Everything on the desk is built here from primitives, and every surface is
// painted on a canvas at load; nothing is fetched. Each prop comes back as a
// small object: a root Group, the meshes a pointer can hit, an update(dt, t)
// for its idle life (the globe turns, the bottle rocks when hovered), and
// open()/close() that play the gesture its section opens with — the logbook's
// cover swings back, the cork pops, the spyglass draws out — before the page
// shows the section itself. open() resolves once the gesture has got far
// enough for the page to take over.

import * as THREE from "three";

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

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

export function chartCanvas(world, w = 2048, h = 1366) {
  const [c, g] = canvas(w, h);
  const r = rng(31);
  const base = g.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, w * 0.62);
  base.addColorStop(0, "#f3e7c8");
  base.addColorStop(0.55, "#e6d4a8");
  base.addColorStop(1, "#c4a56a");
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // tea stains and foxing
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, rad = 30 + r() * 220;
    const s = g.createRadialGradient(x, y, 0, x, y, rad);
    s.addColorStop(0, `rgba(150, 100, 40, ${0.03 + r() * 0.07})`);
    s.addColorStop(0.8, `rgba(130, 80, 30, ${0.02 + r() * 0.05})`);
    s.addColorStop(1, "rgba(130, 80, 30, 0)");
    g.fillStyle = s;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const sx = w / 1200, sy = h / 800;
  g.save();
  g.scale(sx, sy);
  // rhumb lines from two wind roses
  const roses = [[330, 380, 70, 0.75], [980, 220, 46, 0.6]];
  g.lineWidth = 0.7;
  for (const [cx, cy] of roses) {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * TAU;
      g.strokeStyle = i % 4 === 0 ? "rgba(125, 29, 18, 0.32)" : i % 2 === 0 ? "rgba(46, 90, 58, 0.28)" : "rgba(59, 42, 18, 0.26)";
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 2000, cy + Math.sin(a) * 2000);
      g.stroke();
    }
  }
  // the coastlines, faded
  if (world) {
    g.save();
    g.translate(-40, 60);
    g.scale(1.75, 1.75);
    const land = new Path2D(world);
    g.fillStyle = "rgba(138, 106, 58, 0.17)";
    g.fill(land);
    g.strokeStyle = "rgba(90, 60, 23, 0.55)";
    g.lineWidth = 0.55;
    g.stroke(land);
    g.restore();
  }
  for (const [cx, cy, rad, alpha] of roses) {
    g.globalAlpha = alpha;
    roseStar(g, cx, cy, rad);
    g.globalAlpha = 1;
  }
  g.strokeStyle = "rgba(59, 42, 18, 0.75)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(330, 380, 16, 0, TAU);
  g.stroke();
  // the cartouche, up in the corner where the notes won't lie on it
  g.translate(870, 34);
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
  g.font = 'italic 15px "IM Fell English", Georgia, serif';
  g.fillStyle = "#5a3c17";
  g.fillText("a chart of the day, drawn anew each midnight", 150, 80);
  g.restore();
  // where it has been folded in quarters, and the edges darkened by hands
  g.strokeStyle = "rgba(255, 250, 235, 0.35)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w / 2, 0); g.lineTo(w / 2, h);
  g.moveTo(0, h / 2); g.lineTo(w, h / 2);
  g.stroke();
  g.strokeStyle = "rgba(90, 60, 20, 0.22)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w / 2 + 3, 0); g.lineTo(w / 2 + 3, h);
  g.moveTo(0, h / 2 + 3); g.lineTo(w, h / 2 + 3);
  g.stroke();
  const edge = (x0, y0, x1, y1) => {
    const e = g.createLinearGradient(x0, y0, x1, y1);
    e.addColorStop(0, "rgba(90, 50, 15, 0.55)");
    e.addColorStop(1, "rgba(90, 50, 15, 0)");
    return e;
  };
  g.fillStyle = edge(0, 0, 70, 0); g.fillRect(0, 0, 70, h);
  g.fillStyle = edge(w, 0, w - 70, 0); g.fillRect(w - 70, 0, 70, h);
  g.fillStyle = edge(0, 0, 0, 70); g.fillRect(0, 0, w, 70);
  g.fillStyle = edge(0, h, 0, h - 70); g.fillRect(0, h - 70, w, 70);
  return c;
}

// The globe's skin: an equirectangular world on old varnished paper.
function globeCanvas(world) {
  const [c, g] = canvas(2048, 1024);
  const sea = g.createLinearGradient(0, 0, 0, 1024);
  sea.addColorStop(0, "#b49a62");
  sea.addColorStop(0.25, "#dcc894");
  sea.addColorStop(0.5, "#e6d4a2");
  sea.addColorStop(0.75, "#dcc894");
  sea.addColorStop(1, "#b49a62");
  g.fillStyle = sea;
  g.fillRect(0, 0, 2048, 1024);
  g.strokeStyle = "rgba(90, 60, 25, 0.35)";
  g.lineWidth = 1.5;
  for (let lon = 0; lon <= 360; lon += 15) {
    const x = (lon / 360) * 2048;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = ((90 - lat) / 180) * 1024;
    g.beginPath(); g.moveTo(0, y); g.lineTo(2048, y); g.stroke();
  }
  if (world) {
    g.save();
    const k = 2048 / 720;
    g.translate(0, 6 * k);
    g.scale(k, k);
    const land = new Path2D(world);
    g.fillStyle = "#a5824a";
    g.fill(land);
    g.strokeStyle = "#4a3210";
    g.lineWidth = 0.7;
    g.stroke(land);
    g.restore();
  }
  g.strokeStyle = "rgba(125, 29, 18, 0.8)";
  g.lineWidth = 3;
  g.setLineDash([10, 8]);
  g.beginPath(); g.moveTo(0, 512); g.lineTo(2048, 512); g.stroke();
  g.strokeStyle = "rgba(125, 29, 18, 0.45)";
  g.lineWidth = 2;
  for (const lat of [23.4, -23.4]) {
    const y = ((90 - lat) / 180) * 1024;
    g.beginPath(); g.moveTo(0, y); g.lineTo(2048, y); g.stroke();
  }
  g.setLineDash([]);
  return c;
}

// The logbook's cover: tooled leather with the title in gold leaf.
function coverCanvas(day) {
  const [c, g] = canvas(512, 672);
  const n = valueNoise(128, 77, 6, 4);
  const img = g.createImageData(128, 128);
  for (let i = 0; i < n.length; i++) {
    const v = n[i];
    img.data[i * 4] = 88 + v * 50;
    img.data[i * 4 + 1] = 40 + v * 26;
    img.data[i * 4 + 2] = 22 + v * 14;
    img.data[i * 4 + 3] = 255;
  }
  const [tile, tg] = canvas(128, 128);
  tg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tile, 0, 0, 512, 672);
  const v = g.createRadialGradient(220, 230, 40, 256, 336, 420);
  v.addColorStop(0, "rgba(255, 210, 160, 0.10)");
  v.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  g.fillStyle = v;
  g.fillRect(0, 0, 512, 672);
  g.strokeStyle = "rgba(230, 190, 120, 0.7)";
  g.lineWidth = 3;
  g.setLineDash([9, 7]);
  g.strokeRect(30, 30, 452, 612);
  g.setLineDash([]);
  g.lineWidth = 1.5;
  g.strokeRect(44, 44, 424, 584);
  g.textAlign = "center";
  g.fillStyle = "#e3bd6c";
  g.shadowColor = "rgba(0, 0, 0, 0.6)";
  g.shadowOffsetY = 2;
  g.font = '62px "IM Fell English SC", Georgia, serif';
  g.fillText("Captain's", 256, 250);
  g.fillText("Log", 256, 318);
  g.shadowColor = "transparent";
  g.fillRect(140, 360, 232, 2);
  g.font = 'italic 34px "IM Fell English", Georgia, serif';
  g.fillStyle = "#d9b46a";
  g.fillText(`Day ${day}`, 256, 420);
  // a compass rose blind-tooled at the foot
  g.globalAlpha = 0.5;
  g.translate(256, 530);
  for (let i = 0; i < 8; i++) {
    g.rotate(TAU / 8);
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(6, -12); g.lineTo(0, i % 2 ? -34 : -52); g.lineTo(-6, -12);
    g.closePath();
    g.fillStyle = "#c9a35c";
    g.fill();
  }
  return c;
}

// The page the logbook falls open at.
function pageCanvas(day) {
  const [c, g] = canvas(512, 672);
  g.fillStyle = "#efe2c2";
  g.fillRect(0, 0, 512, 672);
  const r = rng(day);
  g.strokeStyle = "rgba(60, 90, 140, 0.18)";
  g.lineWidth = 1;
  for (let y = 120; y < 640; y += 28) { g.beginPath(); g.moveTo(40, y); g.lineTo(480, y); g.stroke(); }
  g.fillStyle = "#3a2a18";
  g.font = 'italic 30px "IM Fell English", Georgia, serif';
  g.fillText(`Day ${day}.`, 48, 90);
  // lines of a hurried hand
  g.strokeStyle = "rgba(40, 30, 20, 0.55)";
  g.lineWidth = 1.6;
  for (let y = 144; y < 600; y += 28) {
    let x = 48;
    const end = 440 + r() * 40;
    g.beginPath();
    g.moveTo(x, y);
    while (x < end) {
      const word = 18 + r() * 52;
      for (let k = 0; k < word; k += 4) g.lineTo(x + k, y - 3 - Math.abs(Math.sin((x + k) * 0.7)) * 6 * r());
      x += word + 10;
      g.moveTo(x, y);
    }
    g.stroke();
  }
  const edge = g.createLinearGradient(0, 0, 60, 0);
  edge.addColorStop(0, "rgba(90, 60, 20, 0.35)");
  edge.addColorStop(1, "rgba(90, 60, 20, 0)");
  g.fillStyle = edge;
  g.fillRect(0, 0, 60, 672);
  return c;
}

// Page edges seen from the side: fine lines.
function pageEdgeCanvas() {
  const [c, g] = canvas(64, 256);
  g.fillStyle = "#e7d7b0";
  g.fillRect(0, 0, 64, 256);
  const r = rng(5);
  for (let y = 0; y < 256; y += 2) {
    g.fillStyle = `rgba(120, 90, 50, ${0.08 + r() * 0.22})`;
    g.fillRect(0, y, 64, 1);
  }
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

function parchmentCanvas(seed) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#e8d6a8";
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let i = 0; i < 40; i++) {
    const y = r() * 256;
    g.fillStyle = `rgba(140, 100, 50, ${0.04 + r() * 0.1})`;
    g.fillRect(0, y, 256, 1 + r() * 2);
  }
  return c;
}

// ----- Materials -----
export function makeMaterials() {
  const brassBump = tex(grit(128, 3, 150, 255), { color: false, repeat: [3, 3] });
  const wood = woodCanvas(17);
  const woodMap = tex(wood, { aniso: 16 });
  const leatherBump = tex(noiseCanvas(256, 9, 16, 4), { color: false, repeat: [2, 2] });
  const corkMap = tex(grit(64, 21, 120, 210), { repeat: [1, 1] });
  return {
    woodMap,
    desk: new THREE.MeshPhysicalMaterial({
      map: woodMap, bumpMap: tex(wood, { color: false }), bumpScale: 1.4,
      roughness: 0.58, clearcoat: 0.35, clearcoatRoughness: 0.42
    }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x3a2213, roughness: 0.6, map: woodMap }),
    wall: new THREE.MeshStandardMaterial({ color: 0x2b2019, roughness: 1, bumpMap: tex(noiseCanvas(256, 4, 8, 5), { color: false, repeat: [6, 4] }), bumpScale: 2 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x150d08, roughness: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xcaa253, metalness: 1, roughness: 0.3, bumpMap: brassBump, bumpScale: 0.3 }),
    oldBrass: new THREE.MeshStandardMaterial({ color: 0x9c7a3a, metalness: 1, roughness: 0.42, bumpMap: brassBump, bumpScale: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b44c, metalness: 1, roughness: 0.26, bumpMap: brassBump, bumpScale: 0.5 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x7a3b22, roughness: 0.72, bumpMap: leatherBump, bumpScale: 1.6 }),
    darkLeather: new THREE.MeshStandardMaterial({ color: 0x2c160b, roughness: 0.65, bumpMap: leatherBump, bumpScale: 1.2 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.8 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xead9b0, roughness: 0.92 }),
    parchment: new THREE.MeshStandardMaterial({ map: tex(parchmentCanvas(8), { repeat: [1, 2] }), roughness: 0.9 }),
    ribbon: new THREE.MeshStandardMaterial({ color: 0x8e2a1e, roughness: 0.55, side: THREE.DoubleSide }),
    cork: new THREE.MeshStandardMaterial({ color: 0xb07d48, map: corkMap, roughness: 0.95, bumpMap: corkMap, bumpScale: 2 }),
    ink: new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05 }),
    inkGlass: new THREE.MeshPhysicalMaterial({ color: 0x1e2230, roughness: 0.12, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.9 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x0d1a22, roughness: 0.05, metalness: 0.3, clearcoat: 1 }),
    glassBack: new THREE.MeshPhysicalMaterial({
      color: 0x2f7559, roughness: 0.08, transparent: true, opacity: 0.32, side: THREE.BackSide, depthWrite: false
    }),
    glassFront: new THREE.MeshPhysicalMaterial({
      color: 0x3f8a6c, roughness: 0.04, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.02,
      specularIntensity: 1, side: THREE.FrontSide, depthWrite: false
    }),
    coverGlass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.12, clearcoat: 1, depthWrite: false
    })
  };
}

// ----- Helpers -----
function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function rod(a, b, r, material, segments = 10) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), segments), material);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  return m;
}

function lathe(points, material, segments = 48) {
  return mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments), material);
}

// A value that runs toward its target at a fixed pace; the props read it
// through an easing. to() resolves when it arrives and at(v) once it has got
// as far as v on its way up. A change of direction resolves everything still
// waiting, so a gesture cut short never leaves anything hanging.
class Phase {
  constructor(seconds) {
    this.v = 0;
    this.target = 0;
    this.seconds = seconds;
    this.waiting = [];
  }
  to(target, seconds) {
    if (seconds) this.seconds = seconds;
    if (target !== this.target) this.flush();
    this.target = target;
    return this.at(target);
  }
  at(mark) {
    return new Promise((resolve) => {
      if (this.v === this.target || (this.target >= mark ? this.v >= mark : this.v <= mark)) resolve();
      else this.waiting.push({ mark, resolve });
    });
  }
  flush() {
    const w = this.waiting;
    this.waiting = [];
    w.forEach((x) => x.resolve());
  }
  update(dt, instant) {
    if (this.v === this.target) return false;
    const step = instant ? 1 : dt / this.seconds;
    const up = this.v < this.target;
    this.v = up ? Math.min(this.target, this.v + step) : Math.max(this.target, this.v - step);
    this.waiting = this.waiting.filter((x) => {
      const reached = this.v === this.target || (up ? this.v >= x.mark : this.v <= x.mark);
      if (reached) x.resolve();
      return !reached;
    });
    return true;
  }
}

// A soft follower for hover states.
function follow(current, target, dt, rate = 10) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// Every prop shares this shape.
function prop(root, extra) {
  return Object.assign({
    root, hits: [], hover: 0, hovered: false, tagHover: false, moving: false,
    hot() { return this.hovered || this.tagHover; },
    update() { return false; }, open() { return Promise.resolve(); }, close() { return Promise.resolve(); }
  }, extra);
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

// A wooden wedge at the front of the desk; the brass plaque with the stats
// is set into its sloping face (the plaque itself is DOM, see stage.js).
export function makeNameplate(M, length = 5.4) {
  const root = new THREE.Group();
  const profile = new THREE.Shape();
  profile.moveTo(0.48, 0);
  profile.lineTo(-0.48, 0);
  profile.lineTo(-0.48, 0.62);
  profile.lineTo(-0.36, 0.66);
  profile.lineTo(0.48, 0.06);
  profile.lineTo(0.48, 0);
  const wedge = mesh(new THREE.ExtrudeGeometry(profile, {
    depth: length, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2
  }), M.darkWood);
  wedge.rotation.y = -Math.PI / 2;    // the profile was drawn in z,y; run it along x
  wedge.position.x = length / 2;
  root.add(wedge);
  // where the plaque goes: the middle of the sloping face, and its tilt
  const slope = Math.atan2(0.6, 0.84);
  return prop(root, { hits: [wedge], face: { y: 0.36, z: 0.06, tilt: slope } });
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

// ----- The painting on its easel -----
// The frame is rebuilt to the painting's proportions once a photograph of it
// arrives; until then it holds the generated study at 3:4.
export function makeFrame(M) {
  const root = new THREE.Group();
  const easel = new THREE.Group();
  root.add(easel);
  const lean = 0.2;                          // the easel leans back this far
  const legTop = 3.15, legBottomZ = 0.42;
  const zAt = (y) => legBottomZ - Math.tan(lean) * y;
  for (const side of [-1, 1]) easel.add(rod(V(side * 0.82, 0, legBottomZ), V(side * 0.14, legTop, zAt(legTop)), 0.05, M.darkWood));
  easel.add(rod(V(0, legTop - 0.2, zAt(legTop - 0.2) - 0.05), V(0, 0, -1.25), 0.045, M.darkWood));
  const ledgeY = 0.52;
  const ledge = mesh(new THREE.BoxGeometry(2.1, 0.08, 0.26), M.darkWood);
  ledge.position.set(0, ledgeY, zAt(ledgeY) + 0.06);
  ledge.rotation.x = -lean;
  easel.add(ledge);
  const lip = mesh(new THREE.BoxGeometry(2.1, 0.12, 0.04), M.darkWood);
  lip.position.set(0, ledgeY + 0.08, zAt(ledgeY) + 0.17);
  lip.rotation.x = -lean;
  easel.add(lip);

  // the frame hangs from a pivot on the ledge, so it can be lifted off
  const pivot = new THREE.Group();
  pivot.position.set(0, ledgeY + 0.04, zAt(ledgeY) + 0.04);
  pivot.rotation.x = -lean;
  root.add(pivot);
  const frame = new THREE.Group();
  pivot.add(frame);

  let artMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1d10, roughness: 0.75 });
  const hits = [];
  let size = { w: 1.9, h: 2.5 };

  function build(aspect) {
    frame.clear();
    hits.length = 0;
    const h = aspect >= 1 ? 2.75 / aspect + 0.44 : 2.6;
    const w = aspect >= 1 ? 2.75 : (h - 0.44) * aspect + 0.44;
    size = { w, h };
    const border = 0.22;
    const outer = new THREE.Shape();
    outer.moveTo(-w / 2, -h / 2); outer.lineTo(w / 2, -h / 2); outer.lineTo(w / 2, h / 2); outer.lineTo(-w / 2, h / 2); outer.lineTo(-w / 2, -h / 2);
    const iw = w - border * 2, ih = h - border * 2;
    const hole = new THREE.Path();
    hole.moveTo(-iw / 2, -ih / 2); hole.lineTo(-iw / 2, ih / 2); hole.lineTo(iw / 2, ih / 2); hole.lineTo(iw / 2, -ih / 2); hole.lineTo(-iw / 2, -ih / 2);
    outer.holes.push(hole);
    const molding = mesh(new THREE.ExtrudeGeometry(outer, {
      depth: 0.08, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.07, bevelSegments: 4, curveSegments: 1
    }), M.gold);
    molding.position.y = h / 2;
    frame.add(molding);
    // an inner bead of darker gilt, and the canvas set back inside it
    const bead = mesh(new THREE.TorusGeometry(1, 0.03, 6, 4), M.oldBrass);
    bead.rotation.z = Math.PI / 4;
    bead.scale.set(iw / Math.SQRT2 + 0.03, ih / Math.SQRT2 + 0.03, 1);
    bead.position.set(0, h / 2, 0.1);
    frame.add(bead);
    const art = mesh(new THREE.PlaneGeometry(iw, ih), artMaterial);
    art.position.set(0, h / 2, 0.04);
    frame.add(art);
    const back = mesh(new THREE.BoxGeometry(w - 0.1, h - 0.1, 0.04), M.darkWood);
    back.position.set(0, h / 2, -0.03);
    frame.add(back);
    hits.push(molding, art);
  }
  build(0.75);

  function setArt(texture, aspect) {
    artMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62 });
    build(clamp(aspect || 0.75, 0.45, 2.2));
  }

  const phase = new Phase(0.55);
  return prop(root, {
    hits, setArt, pivot,
    get size() { return size; },
    update(dt, t, instant) {
      this.hover = follow(this.hover, this.hot() ? 1 : 0, dt);
      const moving = phase.update(dt, instant);
      const k = easeOut(phase.v);
      // lifted off the ledge, turned square to the room and brought forward
      frame.position.set(0, k * 0.9, k * 1.6);
      frame.rotation.x = lean * k * 0.9 - this.hover * 0.04;
      frame.rotation.y = -root.rotation.y * k * 0.8;
      frame.scale.setScalar(1 + k * 0.12);
      return moving || Math.abs(this.hover - (this.hot() ? 1 : 0)) > 0.002;
    },
    open() { return phase.to(1, 0.55); },
    close() { return phase.to(0, 0.6); }
  });
}

// ----- The captain's log -----
export function makeBook(M, day) {
  const root = new THREE.Group();
  const W = 1.9, D = 2.5, T = 0.07, P = 0.36;
  const coverMap = tex(coverCanvas(day));
  const pageMap = tex(pageCanvas(day));
  const edgeMap = tex(pageEdgeCanvas());
  const bottom = mesh(new THREE.BoxGeometry(W, T, D), M.leather);
  bottom.position.set(0, T / 2, 0);
  root.add(bottom);
  const edges = new THREE.MeshStandardMaterial({ map: edgeMap, roughness: 0.9 });
  const pageTop = new THREE.MeshStandardMaterial({ map: pageMap, roughness: 0.92 });
  const pages = mesh(new THREE.BoxGeometry(W - 0.14, P, D - 0.14), [edges, edges, pageTop, edges, edges, edges]);
  pages.position.set(0.04, T + P / 2, 0);
  root.add(pages);
  const spine = mesh(new THREE.CylinderGeometry((P + T * 2) / 2, (P + T * 2) / 2, D, 20, 1, false, Math.PI, Math.PI), M.leather);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(-W / 2 + 0.02, (P + T * 2) / 2, 0);
  root.add(spine);
  for (const z of [-0.8, 0, 0.8]) {
    const band = mesh(new THREE.TorusGeometry((P + T * 2) / 2 + 0.005, 0.02, 6, 20, Math.PI), M.darkLeather);
    band.rotation.y = Math.PI / 2;
    band.position.set(-W / 2 + 0.02, (P + T * 2) / 2, z);
    root.add(band);
  }
  // the cover swings on the spine
  const hinge = new THREE.Group();
  hinge.position.set(-W / 2 + 0.02, T + P + T / 2, 0);
  root.add(hinge);
  const coverTop = new THREE.MeshStandardMaterial({ map: coverMap, roughness: 0.7, bumpMap: M.leather.bumpMap, bumpScale: 1.2 });
  const cover = mesh(new THREE.BoxGeometry(W, T, D), [M.leather, M.leather, coverTop, M.leather, M.leather, M.leather]);
  cover.position.x = W / 2 - 0.02;
  hinge.add(cover);
  const strap = mesh(new THREE.BoxGeometry(0.16, T + P + T + 0.04, D + 0.02), M.darkLeather);
  strap.position.set(W / 2 - 0.36, (T + P + T) / 2, 0);
  root.add(strap);
  // a leaf that turns after the cover
  const leafHinge = new THREE.Group();
  leafHinge.position.set(-W / 2 + 0.06, T + P + 0.005, 0);
  root.add(leafHinge);
  const leaf = mesh(new THREE.PlaneGeometry(W - 0.16, D - 0.16), new THREE.MeshStandardMaterial({ map: pageMap, roughness: 0.92, side: THREE.DoubleSide }));
  leaf.rotation.x = -Math.PI / 2;
  leaf.position.x = (W - 0.16) / 2;
  leafHinge.add(leaf);
  leaf.visible = false;
  const ribbon = mesh(new THREE.PlaneGeometry(0.09, 0.7), M.ribbon, { cast: false });
  ribbon.rotation.x = -Math.PI / 2;
  ribbon.rotation.z = 0.25;
  ribbon.position.set(-0.2, 0.012, D / 2 + 0.3);
  root.add(ribbon);

  const phase = new Phase(0.6);
  return prop(root, {
    hits: [bottom, pages, cover, strap, spine],
    update(dt, t, instant) {
      this.hover = follow(this.hover, this.hot() ? 1 : 0, dt);
      const moving = phase.update(dt, instant);
      const k = phase.v;
      // hovering lifts the cover a crack, as if to peek inside
      const open = easeOut(clamp(k / 0.75, 0, 1)) * 2.95 + this.hover * 0.12 * (1 - k);
      hinge.rotation.z = open;
      strap.visible = k < 0.05;
      const turn = clamp((k - 0.35) / 0.65, 0, 1);
      leaf.visible = turn > 0;
      leafHinge.rotation.z = easeOut(turn) * 2.6 + Math.sin(turn * Math.PI) * 0.2;
      return moving || Math.abs(this.hover - (this.hot() ? 1 : 0)) > 0.002;
    },
    open() { phase.to(1, 0.75); return phase.at(0.62); },
    close() { return phase.to(0, 0.6); }
  });
}

// ----- The globe on its stand -----
export function makeGlobe(M, world) {
  const root = new THREE.Group();
  const base = lathe([[0, 0], [0.78, 0], [0.8, 0.05], [0.72, 0.12], [0.5, 0.16], [0.3, 0.2], [0, 0.2]], M.darkWood, 48);
  root.add(base);
  const centerY = 1.62, R = 0.94;
  const horizon = mesh(new THREE.TorusGeometry(R + 0.16, 0.05, 8, 80), M.darkWood);
  horizon.rotation.x = Math.PI / 2;
  horizon.scale.z = 0.5;
  horizon.position.y = centerY;
  root.add(horizon);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    const top = V(Math.cos(a) * (R + 0.16), centerY - 0.02, Math.sin(a) * (R + 0.16));
    const knee = V(Math.cos(a) * 0.72, 0.75, Math.sin(a) * 0.72);
    const foot = V(Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5);
    root.add(rod(foot, knee, 0.045, M.darkWood), rod(knee, top, 0.045, M.darkWood));
  }
  const tilt = new THREE.Group();
  tilt.position.y = centerY;
  tilt.rotation.z = 0.41;
  tilt.rotation.x = -0.15;
  root.add(tilt);
  const meridian = mesh(new THREE.TorusGeometry(R + 0.07, 0.035, 10, 96), M.brass);
  tilt.add(meridian);
  for (const s of [-1, 1]) {
    const pin = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), M.brass);
    pin.position.y = s * (R + 0.03);
    tilt.add(pin);
  }
  const ball = mesh(new THREE.SphereGeometry(R, 64, 48), new THREE.MeshPhysicalMaterial({
    map: tex(globeCanvas(world), { aniso: 8 }), roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.25
  }));
  tilt.add(ball);
  let speed = 0.12, spin = Math.random() * TAU;
  const phase = new Phase(0.5);
  return prop(root, {
    hits: [ball, meridian, base, horizon],
    update(dt, t, instant) {
      this.hover = follow(this.hover, this.hot() ? 1 : 0, dt);
      const moving = phase.update(dt, instant);
      const want = 0.12 + this.hover * 0.9 + easeOut(phase.v) * 9;
      speed = follow(speed, want, dt, 3);
      spin += speed * dt;
      ball.rotation.y = spin;
      tilt.scale.setScalar(1 + easeOut(phase.v) * 0.08);
      return true;
    },
    open() { phase.to(1, 0.45); return phase.at(0.8); },
    close() { return phase.to(0, 0.8); }
  });
}

// ----- The message in a bottle -----
export function makeBottle(M) {
  const root = new THREE.Group();
  const lie = new THREE.Group();       // the bottle's own axis runs along +x
  lie.rotation.z = -Math.PI / 2;
  lie.position.y = 0.42;
  root.add(lie);
  const profile = [
    [0, 0], [0.3, 0], [0.38, 0.03], [0.42, 0.12], [0.42, 1.25], [0.38, 1.45], [0.26, 1.63], [0.15, 1.73],
    [0.125, 1.8], [0.125, 2.0], [0.15, 2.02], [0.15, 2.09], [0.11, 2.1]
  ].map(([x, y]) => new THREE.Vector2(x, y - 1.05));
  const geometry = new THREE.LatheGeometry(profile, 48);
  const back = mesh(geometry, M.glassBack, { cast: false, receive: false });
  const front = mesh(geometry, M.glassFront, { cast: true, receive: false });
  back.renderOrder = 2;
  front.renderOrder = 3;
  lie.add(back, front);
  // the letter inside, rolled and tied
  const scroll = new THREE.Group();
  lie.add(scroll);
  const roll = mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 24), M.parchment);
  scroll.add(roll);
  const tie = mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.09, 24), M.ribbon);
  scroll.add(tie);
  scroll.position.y = -0.25;
  scroll.rotation.y = 0.4;
  // the cork
  const cork = mesh(new THREE.CylinderGeometry(0.14, 0.112, 0.3, 20), M.cork);
  const corkHome = new THREE.Vector3(0, 1.0, 0);
  cork.position.copy(corkHome);
  lie.add(cork);

  const phase = new Phase(0.7);
  let rock = 0;
  return prop(root, {
    hits: [front, cork],
    update(dt, t, instant) {
      this.hover = follow(this.hover, this.hot() ? 1 : 0, dt);
      const moving = phase.update(dt, instant);
      rock = this.hover * Math.sin(t * 5) * 0.06;
      lie.rotation.x = rock;
      const k = phase.v;
      // the cork pops out along the neck, flies up in an arc and comes down on
      // its side by the bottle (the bottle's own +x points at the floor)
      const pop = clamp(k / 0.45, 0, 1);
      const out = easeOut(pop);
      cork.position.set(-Math.sin(pop * Math.PI) * 0.9 + out * 0.3, corkHome.y + out * 0.75, out * 0.35);
      cork.rotation.set(pop * 7, 0, pop * Math.PI * 2);
      // then the letter slides out of the neck
      const slide = easeOut(clamp((k - 0.3) / 0.7, 0, 1));
      scroll.position.y = -0.25 + slide * 1.45;
      scroll.scale.setScalar(1 - slide * 0.12);
      return moving || this.hover > 0.002;
    },
    open() { phase.to(1, 0.85); return phase.at(0.7); },
    close() { return phase.to(0, 0.6); }
  });
}

// ----- The spyglass -----
export function makeSpyglass(M) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.24;
  root.add(body);
  const tube = (r, len, mat) => {
    const m = mesh(new THREE.CylinderGeometry(r, r, len, 32), mat);
    m.rotation.z = Math.PI / 2;
    return m;
  };
  const band = (r) => {
    const m = mesh(new THREE.TorusGeometry(r, 0.025, 8, 32), M.brass);
    m.rotation.y = Math.PI / 2;
    return m;
  };
  // the barrel, with its leather grip and the lens at the far end
  const barrel = new THREE.Group();
  body.add(barrel);
  barrel.add(tube(0.22, 1.25, M.brass));
  const grip = tube(0.226, 0.6, M.darkLeather);
  grip.position.x = 0.1;
  barrel.add(grip);
  const hood = tube(0.245, 0.22, M.brass);
  hood.position.x = 0.62;
  barrel.add(hood);
  for (const x of [-0.62, 0.52, 0.73]) {
    const b = band(0.235);
    b.position.x = x;
    barrel.add(b);
  }
  const lens = mesh(new THREE.CircleGeometry(0.2, 32), M.lens, { cast: false });
  lens.rotation.y = Math.PI / 2;
  lens.position.x = 0.735;
  barrel.add(lens);
  // the draws, which slide out of each other
  const draws = [[0.18, 0.95], [0.15, 0.85], [0.12, 0.6]].map(([r, len]) => {
    const g = new THREE.Group();
    const t = tube(r, len, M.brass);
    t.position.x = -len / 2;
    const b = band(r + 0.012);
    b.position.x = -len + 0.02;
    g.add(t, b);
    body.add(g);
    return { g, len };
  });
  const eyecup = tube(0.1, 0.12, M.oldBrass);
  draws[2].g.add(eyecup);
  eyecup.position.x = -0.66;
  const cradle = mesh(new THREE.BoxGeometry(0.3, 0.12, 0.42), M.darkWood);
  cradle.position.set(-1.2, 0.06, 0);
  root.add(cradle);

  const phase = new Phase(0.6);
  return prop(root, {
    hits: [barrel.children[0], grip, ...draws.map((d) => d.g.children[0])],
    update(dt, t, instant) {
      this.hover = follow(this.hover, this.hot() ? 1 : 0, dt);
      const moving = phase.update(dt, instant);
      const k = easeOut(phase.v);
      // half drawn at rest, drawn out to full length when opened
      const draw = 0.45 + this.hover * 0.12 + k * 0.55;
      let x = -0.55;
      draws.forEach((d) => {
        d.g.position.x = x;
        x -= d.len * (0.25 + 0.6 * draw);
      });
      cradle.position.x = x + 0.25;
      // and lifted to the eye
      body.rotation.z = -k * 0.32;
      body.position.y = 0.24 + k * 0.5;
      body.rotation.y = k * 0.35;
      return moving || Math.abs(this.hover - (this.hot() ? 1 : 0)) > 0.002;
    },
    eyepiece() {
      const p = new THREE.Vector3();
      eyecup.getWorldPosition(p);
      return p;
    },
    open() { phase.to(1, 0.6); return phase.at(0.75); },
    close() { return phase.to(0, 0.55); }
  });
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
    const m = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }));
    m.rotation.x = -Math.PI / 2;
    return m;
  };
  needle.add(half(0x9b2516, 1), half(0x2c2a28, -1));
  const cap = mesh(new THREE.SphereGeometry(0.045, 12, 8), M.brass);
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
  return prop(root, {
    hits: [well, feather],
    update(dt, t) {
      this.hover = follow(this.hover, this.hot() ? 1 : 0, dt);
      quill.rotation.z = 0.55 + Math.sin(t * 9) * 0.04 * this.hover;
      return this.hover > 0.002;
    }
  });
}
