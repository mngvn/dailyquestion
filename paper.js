// paper.js — a crumpled note, lying on the desk among everything else.
//
// A port of React Bits' Paper Crumple (reactbits.dev/micro/paper-crumple,
// MIT) out of React and into plain three.js, so the home page can keep running
// without a build step. The solver that balls the sheet up lives in
// paper-solver.js, kept as written; it runs in paper-worker.js so the page
// stays smooth while five notes are being crumpled, and what it works out is
// kept in IndexedDB, so on a later visit there is nothing to work out.
//
// The original draws its own little scene. Here the sheet is just a mesh, so
// it sits in the desk's scene: lit by the same candle, throwing its shadow on
// the chart, picked up and read in front of the camera. Where it goes is up to
// stage.js; this only knows how crumpled it is.
//
//   const note = await makePaperNote({ texture, seed, size, paperColor, open });
//   scene.add(note.object);
//   note.fold(amount, crease)  → 0 flat … 1 balled tight; crease is the relief
//                                 left in a sheet that has been opened
//   note.update(dt)            → true while it is still moving
//   note.setTexture(canvas)    → swaps what is printed on it
//   note.dispose()

import * as THREE from "three";
import { buildMesh, createPaperPath } from "./paper-solver.js";

export const WAD = 0.94;     // how tightly a fresh note is balled up (0 flat, 1 tightest)
export const CREASE = 0.16;  // relief left in the open sheet

const DEFAULTS = {
  width: 360, height: 460, seed: 7, detail: 64, foldCount: 6, foldSharpness: 0.6, wrinkleDepth: 0.65,
  paperColor: "#f3eee4", size: 2.4, anisotropy: 8, open: false
};

const spring = (value = 0) => ({ value, target: value, velocity: 0 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function advance(s, dt, duration, instant) {
  if (instant || duration <= 0) {
    s.value = s.target;
    s.velocity = 0;
    return false;
  }
  const omega = 8 / Math.max(0.06, duration);
  const offset = s.value - s.target;
  const term = s.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  s.value = s.target + (offset + term * dt) * decay;
  s.velocity = (s.velocity - omega * term * dt) * decay;
  if (Math.abs(s.value - s.target) < 0.0001 && Math.abs(s.velocity) < 0.001) {
    s.value = s.target;
    s.velocity = 0;
    return false;
  }
  return true;
}

// ----- Solving, off the main thread -----
// A few workers share the notes between them; each shape of note is solved
// once, and kept for next time (below). Where module workers aren't
// available it is done here instead, a note at a time between frames.
const solved = new Map();
let pool = null, nextJob = 0, turn = 0;
const jobs = new Map();

function workers() {
  if (pool) return pool;
  pool = [];
  try {
    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL("./paper-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (e) => {
        const job = jobs.get(e.data.id);
        jobs.delete(e.data.id);
        if (job) job.resolve({ samples: e.data.samples, creased: e.data.creased });
      };
      worker.onerror = () => failOver(worker);
      pool.push(worker);
    }
  } catch (e) {
    pool = [];
  }
  return pool;
}

// A worker that can't start (an old browser, a file:// page) hands its
// jobs back to the main thread.
function failOver(worker) {
  pool = pool.filter((w) => w !== worker);
  worker.terminate();
  for (const [id, job] of jobs) {
    if (job.worker !== worker) continue;
    jobs.delete(id);
    job.resolve(solveHere(job.opts));
  }
}

function solveHere(opts) {
  return new Promise((resolve) => setTimeout(() => {
    const mesh = buildMesh(opts.width, opts.height, opts.seed, opts.detail);
    resolve(createPaperPath(mesh.original, mesh.indices, mesh.shortSide,
      opts.foldCount, opts.foldSharpness, opts.wrinkleDepth, opts.seed));
  }, 0));
}

function solveFresh(opts) {
  const list = workers();
  if (!list.length) return solveHere(opts);
  return new Promise((resolve) => {
    const id = ++nextJob;
    const worker = list[turn++ % list.length];
    jobs.set(id, { resolve, worker, opts });
    const { width, height, seed, detail, foldCount, foldSharpness, wrinkleDepth } = opts;
    worker.postMessage({ id, width, height, seed, detail, foldCount, foldSharpness, wrinkleDepth });
  });
}

function solve(opts) {
  const key = "v1:" + JSON.stringify([opts.width, opts.height, opts.seed, opts.detail, opts.foldCount, opts.foldSharpness, opts.wrinkleDepth]);
  if (solved.has(key)) return solved.get(key);
  const promise = recall(key).then((kept) => kept || solveFresh(opts).then((path) => {
    keep(key, path);
    return path;
  }));
  solved.set(key, promise);
  return promise;
}

// ----- Kept between visits -----
// The same seed always crumples the same way, so a solved sheet is kept in
// IndexedDB and the next visit's notes arrive without any solving at all.
// Anything going wrong here just means solving it again.
const STORE = "paths";
let db;

function database() {
  if (db) return db;
  db = new Promise((resolve) => {
    try {
      const request = indexedDB.open("daily-paper", 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  return db;
}

function recall(key) {
  return database().then((d) => d && new Promise((resolve) => {
    try {
      const request = d.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => {
        const v = request.result;
        resolve(v && v.samples && v.creased ? v : null);
      };
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  }));
}

function keep(key, path) {
  database().then((d) => {
    if (!d) return;
    try {
      d.transaction(STORE, "readwrite").objectStore(STORE).put({ samples: path.samples, creased: path.creased }, key);
    } catch (e) { /* not kept; it will be solved again next time */ }
  });
}

export async function makePaperNote(options) {
  const opts = { ...DEFAULTS, ...options };
  const path = await solve(opts);
  return new PaperNote(opts, path);
}

// The front carries the note; the back is bare paper. `print` fades the
// lighting out so the writing reads at its own colour — all the way when the
// note is held up to be read, not at all when it lies on the desk in the
// candlelight. `tint` warms that unlit colour to the room's light.
function buildMaterials(grain, paperColor) {
  const uniforms = { paperLighting: { value: 1 }, paperTint: { value: new THREE.Color(1, 1, 1) } };
  const shared = { roughness: 0.92, metalness: 0, bumpMap: grain, bumpScale: 0.08 * 0.32 };
  const front = new THREE.MeshStandardMaterial({ ...shared, side: THREE.FrontSide });
  const back = new THREE.MeshStandardMaterial({ ...shared, side: THREE.BackSide, color: paperColor });
  for (const material of [front, back]) {
    const bare = material === back;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.paperLighting = uniforms.paperLighting;
      shader.uniforms.paperTint = uniforms.paperTint;
      shader.fragmentShader = "uniform float paperLighting;\nuniform vec3 paperTint;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        #ifdef USE_MAP
          ${bare ? "diffuseColor.rgb = diffuse;" : ""}
        #endif
      `);
      shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
        outgoingLight = mix(diffuseColor.rgb * paperTint, outgoingLight, paperLighting);
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => `note-${bare ? "stock" : "print"}`;
  }
  return { front, back, uniforms };
}

function paperGrain(rng, aspect) {
  const data = new Uint8Array(128 * 128 * 4);
  for (let i = 0; i < data.length; i += 4) {
    const value = 100 + Math.floor(rng() * 155);
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  const grain = new THREE.DataTexture(data, 128, 128);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(5, 5 * aspect);
  grain.magFilter = grain.minFilter = THREE.LinearFilter;
  grain.needsUpdate = true;
  return grain;
}

export class PaperNote {
  constructor(opts, path) {
    this.opts = opts;
    const mesh = buildMesh(opts.width, opts.height, opts.seed, opts.detail);
    this.mesh = mesh;
    this.path = path;

    const n = mesh.indices.length;
    this.positions = new Float32Array(mesh.count * 3);
    this.renderPositions = new Float32Array(n * 3);
    this.renderNormals = new Float32Array(n * 3);
    this.faceNormals = new Float32Array(n);
    this.incidentFaces = Array.from({ length: mesh.count }, () => []);
    const renderUvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      renderUvs[i * 2] = mesh.uvs[mesh.indices[i] * 2];
      renderUvs[i * 2 + 1] = mesh.uvs[mesh.indices[i] * 2 + 1];
      this.incidentFaces[mesh.indices[i]].push(Math.floor(i / 3) * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.renderPositions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("normal", new THREE.BufferAttribute(this.renderNormals, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.BufferAttribute(renderUvs, 2));
    this.geometry = geometry;

    this.grain = paperGrain(mesh.rng, mesh.aspect);
    this.materials = buildMaterials(this.grain, opts.paperColor);
    this.front = new THREE.Mesh(geometry, this.materials.front);
    this.back = new THREE.Mesh(geometry, this.materials.back);
    this.front.castShadow = true;
    this.front.receiveShadow = this.back.receiveShadow = true;
    // the sheet is drawn in the XY plane facing +Z; `object` is what gets posed
    this.sheet = new THREE.Group();
    this.sheet.scale.setScalar(opts.size);
    this.sheet.add(this.front, this.back);
    this.object = new THREE.Group();
    this.object.add(this.sheet);
    this.hits = [this.front, this.back];

    // a note already opened today starts out flat, creases and all
    this.amount = spring(opts.open ? 0 : WAD);
    this.memory = spring(opts.open ? CREASE : 0);
    this.print = spring(0);
    this.previousAmount = this.previousMemory = -1;
    this.setTexture(opts.texture);
    this.deform();
  }

  get size() { return this.sheet.scale.x; }
  get aspect() { return this.mesh.aspect; }
  get folded() { return this.amount.value; }

  // What is printed on the note: a canvas, drawn once and uploaded.
  setTexture(source) {
    if (!source) return;
    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.opts.anisotropy;
    const old = this.texture;
    this.texture = texture;
    const { front, back } = this.materials;
    front.map = back.map = texture;
    front.needsUpdate = back.needsUpdate = true;
    if (old) old.dispose();
  }

  fold(amount, crease = 0) {
    this.amount.target = clamp(amount, 0, 1);
    this.memory.target = crease;
  }

  // 1 shows the print at its own colour; 0 leaves it to the room's light
  setPrint(value, tint) {
    this.print.target = value;
    if (tint) this.materials.uniforms.paperTint.value.copy(tint);
  }

  update(dt, { foldSeconds = 0.4, instant = false } = {}) {
    let moving = advance(this.amount, dt, foldSeconds, instant);
    moving = advance(this.memory, dt, foldSeconds, instant) || moving;
    moving = advance(this.print, dt, 0.5, instant) || moving;
    this.deform();
    const fold = clamp(this.amount.value, 0, 1);
    const open = 1 - THREE.MathUtils.smoothstep(fold + this.memory.value, 0, 0.4);
    this.materials.uniforms.paperLighting.value = 1 - this.print.value * open;
    return moving;
  }

  // How far the lowest point of the paper hangs below its centre, in the
  // sheet's own +Z: lying face up, that is how high it must sit to rest.
  restHeight() {
    const box = this.geometry.boundingBox;
    return box ? -box.min.z * this.size : 0;
  }

  // ----- Shape -----
  deform() {
    const { amount, memory, path, positions, mesh } = this;
    if (amount.value === this.previousAmount && memory.value === this.previousMemory) return;
    this.previousAmount = amount.value;
    this.previousMemory = memory.value;
    const fold = clamp(amount.value, 0, 1);
    const at = fold * (path.samples.length - 1);
    const lower = Math.floor(at);
    const upper = Math.min(lower + 1, path.samples.length - 1);
    const mix = at - lower;
    const from = path.samples[lower], to = path.samples[upper];
    for (let i = 0; i < positions.length; i++) {
      positions[i] = from[i] + (to[i] - from[i]) * mix;
      positions[i] += (path.creased[i] - mesh.original[i]) * memory.value * (1 - fold);
    }
    this.computeNormals();
  }

  computeNormals() {
    const { positions, faceNormals, renderPositions, renderNormals, incidentFaces, geometry } = this;
    const indices = this.mesh.indices;
    const sharpness = this.opts.foldSharpness;
    for (let face = 0; face < indices.length; face += 3) {
      const a = indices[face] * 3, b = indices[face + 1] * 3, c = indices[face + 2] * 3;
      const bx = positions[b] - positions[a], by = positions[b + 1] - positions[a + 1], bz = positions[b + 2] - positions[a + 2];
      const cx = positions[c] - positions[a], cy = positions[c + 1] - positions[a + 1], cz = positions[c + 2] - positions[a + 2];
      const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const length = Math.hypot(nx, ny, nz) || 1;
      faceNormals[face] = nx / length;
      faceNormals[face + 1] = ny / length;
      faceNormals[face + 2] = nz / length;
    }
    for (let i = 0; i < indices.length; i++) {
      const source = indices[i] * 3;
      const face = Math.floor(i / 3) * 3;
      let nx = 0, ny = 0, nz = 0;
      for (const neighbor of incidentFaces[indices[i]]) {
        const dot = faceNormals[face] * faceNormals[neighbor] + faceNormals[face + 1] * faceNormals[neighbor + 1] +
          faceNormals[face + 2] * faceNormals[neighbor + 2];
        const weight = THREE.MathUtils.smoothstep(dot, 0.88 - (1 - sharpness) * 0.18, 0.98);
        nx += faceNormals[neighbor] * weight;
        ny += faceNormals[neighbor + 1] * weight;
        nz += faceNormals[neighbor + 2] * weight;
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      renderPositions[i * 3] = positions[source];
      renderPositions[i * 3 + 1] = positions[source + 1];
      renderPositions[i * 3 + 2] = positions[source + 2];
      renderNormals[i * 3] = nx / length;
      renderNormals[i * 3 + 1] = ny / length;
      renderNormals[i * 3 + 2] = nz / length;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }

  dispose() {
    this.geometry.dispose();
    this.materials.front.dispose();
    this.materials.back.dispose();
    this.grain.dispose();
    if (this.texture) this.texture.dispose();
  }
}
