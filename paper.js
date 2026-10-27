// paper.js — a crumpled note you pull open.
//
// A port of React Bits' Paper Crumple (reactbits.dev/micro/paper-crumple,
// MIT) out of React and into a plain class, so the home page can keep running
// without a build step. The paper solver in createPaperPath is theirs, kept as
// written: it relaxes a triangulated sheet into a wad once, records the frames,
// and every crumple afterwards just scrubs through them.
//
// The original is a flat image that crumples while you hold it. Here it runs
// backwards. The note starts as a wad, and holding it — or tugging it about —
// pulls it open a little at a time. Let go early and it springs partly shut.
// Once it is all the way open it stays flat, with the creases still showing,
// and reports onOpen so the page can show what was written on it.
//
//   const sheet = new PaperSheet(root, { texture, width, height, seed, label });
//   sheet.crumple()          → wads it back up (resolves when it has settled)
//   sheet.setTexture(canvas) → swaps what is printed on it
//   sheet.destroy()

import * as THREE from "three";

const WAD = 0.94;            // how tightly a fresh note is balled up (0 flat, 1 tightest)
const HOLD_SECONDS = 1.8;    // holding still opens it in about this long
const TUG_PX = 2600;         // dragging this far opens it on its own
const SPRING_BACK = 0.88;    // letting go early keeps this much of the progress
const CREASE = 0.16;         // relief left in the open sheet
const NUDGE_MS = 4200;       // an untouched wad rocks this often, to invite a grab

const spring = (value = 0) => ({ value, target: value, velocity: 0 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = (t) => t * t * (3 - 2 * t);

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

function randomSource(seed) {
  let value = seed | 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- The paper solver (React Bits, unchanged) -----
function createPaperPath(rest, triangles, shortSide, density, sharpness, depth, seed) {
  const count = rest.length / 3;
  const points = Float64Array.from(rest);
  const previous = Float64Array.from(rest);
  const before = Float64Array.from(rest);
  const edges = [];
  const hinges = [];
  const adjacency = new Map();
  const random = randomSource(seed);
  const guides = Array.from({ length: density }, () => {
    const angle = random() * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle), phase: random() * Math.PI * 2, weight: random() * 0.6 + 0.4 };
  });
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t + k], b = triangles[t + ((k + 1) % 3)], opposite = triangles[t + ((k + 2) % 3)];
      const key = Math.min(a, b) * count + Math.max(a, b);
      const other = adjacency.get(key);
      if (!other) {
        adjacency.set(key, { a, b, opposite });
        const length = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1]);
        edges.push(a * 3, b * 3, length);
      } else {
        const c = other.opposite * 3, d = opposite * 3;
        const length = Math.hypot(rest[c] - rest[d], rest[c + 1] - rest[d + 1]);
        const mx = (rest[c] + rest[d]) * 0.5, my = (rest[c + 1] + rest[d + 1]) * 0.5;
        let weakness = 0;
        for (const guide of guides) {
          const distance = Math.abs(Math.sin(((mx * guide.x + my * guide.y) / shortSide) * 4 + guide.phase));
          weakness = Math.max(weakness, Math.exp(-distance * distance * 80) * guide.weight);
        }
        hinges.push(c, d, length, 0.12 + (1 - weakness) * 0.75);
      }
    }
  }
  const spacing = Math.sqrt((shortSide * shortSide) / count);
  const thickness = shortSide * 0.008;
  const samples = [rest.slice()];
  const frameCount = 64;
  const stepsPerFrame = 3;
  const totalSteps = frameCount * stepsPerFrame;
  let initialRadius = 0;
  for (let i = 0; i < rest.length; i += 3)
    initialRadius = Math.max(initialRadius, Math.hypot(rest[i] / 0.94, rest[i + 1] / 1.02));
  initialRadius *= 1.02;

  function constrain(list, stride, stiffness, reverse) {
    for (let n = 0; n < list.length; n += stride) {
      const edge = reverse ? list.length - stride - n : n;
      const a = list[edge], b = list[edge + 1];
      const dx = points[b] - points[a], dy = points[b + 1] - points[a + 1], dz = points[b + 2] - points[a + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length < 0.000001) continue;
      const weight = stride === 4 ? list[edge + 3] : 1;
      const amount = (1 - list[edge + 2] / length) * 0.5 * stiffness * weight;
      points[a] += dx * amount; points[b] -= dx * amount;
      points[a + 1] += dy * amount; points[b + 1] -= dy * amount;
      points[a + 2] += dz * amount; points[b + 2] -= dz * amount;
    }
  }

  function separateLayers() {
    const margin = thickness * 2;
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
      const ax = points[a], ay = points[a + 1], az = points[a + 2];
      const bx = points[b] - ax, by = points[b + 1] - ay, bz = points[b + 2] - az;
      const cx = points[c] - ax, cy = points[c + 1] - ay, cz = points[c + 2] - az;
      let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 0.0000001) continue;
      nx /= length; ny /= length; nz /= length;
      const minX = Math.min(ax, points[b], points[c]) - margin, maxX = Math.max(ax, points[b], points[c]) + margin;
      const minY = Math.min(ay, points[b + 1], points[c + 1]) - margin, maxY = Math.max(ay, points[b + 1], points[c + 1]) + margin;
      const minZ = Math.min(az, points[b + 2], points[c + 2]) - margin, maxZ = Math.max(az, points[b + 2], points[c + 2]) + margin;
      const bb = bx * bx + by * by + bz * bz, cc = cx * cx + cy * cy + cz * cz;
      const bc = bx * cx + by * cy + bz * cz;
      const determinant = bb * cc - bc * bc;
      if (determinant < 0.0000000001) continue;
      for (let p = 0; p < points.length; p += 3) {
        if (p === a || p === b || p === c) continue;
        if (points[p] < minX || points[p] > maxX || points[p + 1] < minY || points[p + 1] > maxY ||
            points[p + 2] < minZ || points[p + 2] > maxZ) continue;
        const rx = rest[p] - (rest[a] + rest[b] + rest[c]) / 3;
        const ry = rest[p + 1] - (rest[a + 1] + rest[b + 1] + rest[c + 1]) / 3;
        if (rx * rx + ry * ry < spacing * spacing * 6) continue;
        const dx = points[p] - ax, dy = points[p + 1] - ay, dz = points[p + 2] - az;
        const distance = dx * nx + dy * ny + dz * nz;
        const previousDistance =
          (before[p] - before[a]) * nx + (before[p + 1] - before[a + 1]) * ny + (before[p + 2] - before[a + 2]) * nz;
        const side = previousDistance >= 0 ? 1 : -1;
        if (distance * side >= thickness || Math.abs(distance) > margin) continue;
        const pb = dx * bx + dy * by + dz * bz, pc = dx * cx + dy * cy + dz * cz;
        const u = (cc * pb - bc * pc) / determinant;
        const v = (bb * pc - bc * pb) / determinant;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const w = 1 - u - v;
        const correction = (thickness * side - distance) / (1 + w * w + u * u + v * v);
        for (let axis = 0; axis < 3; axis++) {
          const normal = axis === 0 ? nx : axis === 1 ? ny : nz;
          const movement = normal * correction;
          points[p + axis] += movement;
          points[a + axis] -= movement * w;
          points[b + axis] -= movement * u;
          points[c + axis] -= movement * v;
        }
      }
    }
  }

  for (let step = 1; step <= totalSteps; step++) {
    const progress = step / totalSteps;
    const compression = progress * progress * (3 - 2 * progress);
    const radius = initialRadius * (1 - compression) + shortSide * (0.19 - depth * 0.025) * compression;
    before.set(points);
    for (let i = 0; i < points.length; i += 3) {
      const x = rest[i] / shortSide, y = rest[i + 1] / shortSide;
      let buckle = 0;
      for (const guide of guides) buckle += Math.sin((x * guide.x + y * guide.y) * 5 + guide.phase) * guide.weight;
      for (let axis = 0; axis < 3; axis++) {
        const velocity = (points[i + axis] - previous[i + axis]) * 0.55;
        previous[i + axis] = points[i + axis];
        points[i + axis] += clamp(velocity, -spacing * 0.15, spacing * 0.15);
      }
      points[i + 2] += (buckle / density) * shortSide * 0.0007 * Math.sin(progress * Math.PI);
    }
    for (let pass = 0; pass < 18; pass++) {
      constrain(hinges, 4, 0.45 * (1 - sharpness * 0.4), pass % 2 === 0);
      for (let i = 0; i < points.length; i += 3) {
        const x = points[i] / 0.94, y = points[i + 1] / 1.02, z = points[i + 2] / 0.86;
        const distance = Math.hypot(x, y, z);
        if (distance > radius) {
          const push = (1 - radius / distance) * 0.55;
          points[i] -= points[i] * push;
          points[i + 1] -= points[i + 1] * push;
          points[i + 2] -= points[i + 2] * push;
        }
      }
      constrain(edges, 3, 1, pass % 2 !== 0);
      if (pass === 8 || pass === 17) separateLayers();
    }
    for (let h = 0; h < hinges.length; h += 4) {
      const a = hinges[h], b = hinges[h + 1];
      const length = Math.hypot(points[a] - points[b], points[a + 1] - points[b + 1], points[a + 2] - points[b + 2]);
      if (length < hinges[h + 2] * 0.86) hinges[h + 2] += (length - hinges[h + 2]) * 0.12;
    }
    if (step % stepsPerFrame === 0) samples.push(Float32Array.from(points));
  }
  const folded = Float64Array.from(points);
  for (let step = 1; step <= 80; step++) {
    const t = step / 80;
    const unfold = t * t * (3 - 2 * t);
    for (let pass = 0; pass < 12; pass++) {
      for (let i = 0; i < points.length; i++) {
        const target = folded[i] + (rest[i] - folded[i]) * unfold;
        points[i] += (target - points[i]) * (i % 3 === 2 ? 0.04 : 0.22);
      }
      constrain(hinges, 4, 0.7, pass % 2 === 0);
      constrain(edges, 3, 1, pass % 2 !== 0);
    }
  }
  return { samples, creased: Float32Array.from(points) };
}

// ----- The mesh -----
// A jittered grid, so the folds don't run along tidy rows. Built from the seed,
// so the same note always crumples the same way.
function buildMesh(width, height, seed, detail) {
  const aspect = height / width;
  const resolution = Math.round(clamp(detail / 4, 8, 24));
  const columns = Math.max(8, Math.round(resolution / Math.max(1, aspect)));
  const rows = Math.max(8, Math.round(resolution * Math.min(1, aspect)));
  const rng = randomSource(seed);
  const count = (columns + 1) * (rows + 1);
  const original = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const index = row * (columns + 1) + col;
      const u = (col + (col > 0 && col < columns ? (rng() - 0.5) * 0.5 : 0)) / columns;
      const v = (row + (row > 0 && row < rows ? (rng() - 0.5) * 0.5 : 0)) / rows;
      original[index * 3] = u - 0.5;
      original[index * 3 + 1] = (v - 0.5) * aspect;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
      if (col < columns && row < rows) {
        const a = index, b = index + 1, c = index + columns + 1, d = c + 1;
        if (rng() > 0.5) indices.push(a, b, d, a, d, c);
        else indices.push(a, b, c, b, d, c);
      }
    }
  }
  return { aspect, count, original, uvs, indices, rng, shortSide: Math.min(1, aspect) };
}

// Solving the wad takes a moment, so it is done once per shape of note.
const pathCache = new Map();
function paperPathFor(key, mesh, opts) {
  if (!pathCache.has(key)) {
    pathCache.set(key, createPaperPath(mesh.original, mesh.indices, mesh.shortSide,
      opts.foldCount, opts.foldSharpness, opts.wrinkleDepth, opts.seed));
  }
  return pathCache.get(key);
}

// The front carries the note; the back is bare paper. When the sheet lies flat
// the lighting fades out entirely, so the writing reads at its true colour.
function buildMaterials(grain, paperColor) {
  const lighting = { value: 0 };
  const shared = {
    roughness: 0.92, metalness: 0, bumpMap: grain, bumpScale: 0.08 * 0.32,
    alphaTest: 0.04, alphaToCoverage: true, flatShading: false
  };
  const front = new THREE.MeshStandardMaterial({ ...shared, side: THREE.FrontSide });
  const back = new THREE.MeshStandardMaterial({ ...shared, side: THREE.BackSide, color: paperColor });
  for (const material of [front, back]) {
    const bare = material === back;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.paperLighting = lighting;
      shader.fragmentShader = "uniform float paperLighting;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        #ifdef USE_MAP
          ${bare ? "diffuseColor.rgb = diffuse;" : ""}
        #endif
      `);
      shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
        outgoingLight = mix(diffuseColor.rgb, outgoingLight, paperLighting);
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => `note-${bare ? "stock" : "print"}`;
  }
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.04, side: THREE.DoubleSide });
  return { front, back, depth, lighting };
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

export const supported = (() => {
  try {
    const probe = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (probe.getContext("webgl2") || probe.getContext("webgl")));
  } catch (e) {
    return false;
  }
})();

export class PaperSheet {
  constructor(root, options) {
    this.root = root;
    this.opts = {
      width: 360, height: 460, seed: 7, detail: 64, foldCount: 6, foldSharpness: 0.6, wrinkleDepth: 0.65,
      paperColor: "#f3eee4", label: "A crumpled note", onOpen: null, onProgress: null, ...options
    };
    this.state = "wad";
    this.progress = 0;
    this.listeners = [];
    this.build();
  }

  build() {
    const { root, opts } = this;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "paper-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.hit = document.createElement("button");
    this.hit.type = "button";
    this.hit.className = "paper-hit";
    this.hit.setAttribute("aria-label",
      `${opts.label}. Press and hold to unfold it — Space or Enter works too.`);
    root.append(this.canvas, this.hit);
    root.dataset.state = "wad";

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const mesh = buildMesh(opts.width, opts.height, opts.seed, opts.detail);
    this.mesh = mesh;
    const key = JSON.stringify([opts.width, opts.height, opts.seed, opts.detail, opts.foldCount, opts.foldSharpness, opts.wrinkleDepth]);
    this.path = paperPathFor(key, mesh, opts);

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

    this.amount = spring(WAD);
    this.memory = spring(0);
    this.posX = spring(); this.posY = spring();
    this.tiltX = spring(); this.tiltY = spring();
    this.springs = [this.amount, this.memory, this.posX, this.posY, this.tiltX, this.tiltY];
    this.previousAmount = this.previousMemory = -1;

    this.buildScene();
    this.setTexture(opts.texture);
    this.media = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduceMotion = this.media.matches;
    this.bindEvents();
    this.deform();
    this.resize();
    this.nudger = setInterval(() => this.nudge(), NUDGE_MS);
  }

  buildScene() {
    const { front: frontMat, back: backMat, depth } = this.materials;
    this.sheet = new THREE.Group();
    this.front = new THREE.Mesh(this.geometry, frontMat);
    this.back = new THREE.Mesh(this.geometry, backMat);
    this.front.castShadow = this.front.receiveShadow = this.back.receiveShadow = true;
    this.front.customDepthMaterial = depth;
    this.sheet.add(this.front, this.back);

    this.scene = new THREE.Scene();
    this.scene.add(this.sheet);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa4a0b0, 1.35));
    const light = new THREE.DirectionalLight(0xfffaf0, 1.8);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.6;
    light.shadow.radius = 3;
    this.scene.add(light, light.target);
    this.light = light;

    this.floorGeometry = new THREE.PlaneGeometry(1, 1);
    this.floorMaterial = new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false });
    this.floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.anchor = new THREE.Vector3(); this.world = new THREE.Vector3(); this.corner = new THREE.Vector3();
    this.va = new THREE.Vector3(); this.vb = new THREE.Vector3(); this.vc = new THREE.Vector3();
    this.weights = new THREE.Vector3(1, 0, 0);
    this.gripIndices = [Math.floor(this.mesh.count / 2), 0, 0];
    this.viewportWidth = this.viewportHeight = 1;
    this.scale = this.opts.width;
    this.frame = 0;
    this.lastTime = 0;
    this.held = false;
    this.keyboard = false;
    this.pointerId = null;
    this.inView = true;
    this.disposed = false;
  }

  // What is printed on the note: a canvas, drawn once and uploaded.
  setTexture(source) {
    if (!source) return;
    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const old = this.texture;
    this.texture = texture;
    const { front, back, depth } = this.materials;
    front.map = back.map = depth.map = texture;
    front.needsUpdate = back.needsUpdate = depth.needsUpdate = true;
    if (old) old.dispose();
    this.wake();
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
    this.materials.lighting.value = THREE.MathUtils.smoothstep(fold + memory.value, 0, 0.4);
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

  // The invisible button follows the sheet on screen, so only the paper itself
  // can be grabbed — not the empty desk around it.
  placeHitTarget() {
    const bounds = this.geometry.boundingBox;
    if (!bounds) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.corner.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
      this.corner.applyMatrix4(this.sheet.matrixWorld).project(this.camera);
      const x = ((this.corner.x + 1) * this.viewportWidth) / 2, y = ((1 - this.corner.y) * this.viewportHeight) / 2;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    this.hit.style.transform = `translate3d(${minX}px, ${minY}px, 0)`;
    this.hit.style.width = `${Math.max(24, maxX - minX)}px`;
    this.hit.style.height = `${Math.max(24, maxY - minY)}px`;
  }

  setPointer(x, y) {
    this.pointer.set((x / this.viewportWidth) * 2 - 1, 1 - (y / this.viewportHeight) * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  // ----- Opening -----
  // Progress only moves while the note is held: time held and distance tugged
  // both count. It sets the fold target; the spring does the rest.
  pull(amount) {
    if (this.state !== "holding") return;
    this.progress = clamp(this.progress + amount, 0, 1);
    this.amount.target = WAD * (1 - ease(this.progress));
    this.report();
    if (this.progress >= 1) this.open();
  }

  report() {
    this.root.style.setProperty("--progress", this.progress.toFixed(3));
    if (this.opts.onProgress) this.opts.onProgress(this.progress);
  }

  open() {
    this.release();
    this.state = "open";
    this.root.dataset.state = "open";
    this.progress = 1;
    this.amount.target = 0;
    this.memory.target = CREASE;
    this.posX.target = this.posY.target = 0;
    this.tiltX.target = this.tiltY.target = 0;
    this.hit.disabled = true;
    if (this.reduceMotion) for (const s of this.springs) advance(s, 0, 0, true);
    this.report();
    if (this.opts.onOpen) this.opts.onOpen();
    this.wake();
  }

  // Balls the note back up: the original effect, played forwards.
  crumple() {
    this.release();
    this.state = "closing";
    this.root.dataset.state = "closing";
    this.progress = 0;
    this.amount.target = WAD;
    this.memory.target = 0;
    this.report();
    this.wake();
    const settle = this.reduceMotion ? 0 : 650;
    return new Promise((resolve) => setTimeout(() => {
      this.state = "wad";
      this.root.dataset.state = "wad";
      this.hit.disabled = false;
      resolve();
    }, settle));
  }

  startHold() {
    if (this.state !== "wad") return;
    this.held = true;
    this.state = "holding";
    this.root.dataset.state = "holding";
    this.hit.dataset.held = "true";
    if (this.reduceMotion) this.pull(1);
    this.wake();
  }

  // Let go before it is open and the paper springs partly shut again.
  release() {
    if (!this.held) return;
    this.held = false;
    this.keyboard = false;
    this.hit.dataset.held = "false";
    const captured = this.pointerId;
    this.pointerId = null;
    if (captured !== null && this.hit.hasPointerCapture(captured)) this.hit.releasePointerCapture(captured);
    if (this.state === "holding") {
      this.state = "wad";
      this.root.dataset.state = "wad";
      this.progress *= SPRING_BACK;
      this.amount.target = WAD * (1 - ease(this.progress));
      this.report();
      this.posX.target = this.posY.target = 0;
      this.tiltX.target = this.tiltY.target = 0;
    }
    this.wake();
  }

  // An untouched wad rocks now and then, so it reads as something to pick up.
  nudge() {
    if (this.state !== "wad" || this.progress > 0 || this.reduceMotion || this.disposed || !this.inView || document.hidden) return;
    const kick = 4 + Math.random() * 2;
    this.tiltY.velocity += (Math.random() > 0.5 ? 1 : -1) * kick;
    this.tiltX.velocity += (Math.random() - 0.5) * kick;
    this.wake();
  }

  // ----- Loop -----
  render(time) {
    this.frame = 0;
    if (this.disposed || !this.inView || document.hidden) return;
    const elapsed = this.lastTime ? (time - this.lastTime) / 1000 : 1 / 60;
    const dt = Math.min(0.04, elapsed);
    this.lastTime = time;
    // holding counts in real time, so a slow frame rate doesn't slow the opening
    if (this.held) this.pull(Math.min(0.25, elapsed) / HOLD_SECONDS);

    const foldDuration = this.state === "closing" ? 0.55 : this.state === "open" ? 0.5 : 0.35;
    let moving = this.held;
    for (const s of this.springs) {
      const duration = s === this.amount || s === this.memory ? foldDuration : 0.42;
      moving = advance(s, dt, duration, this.reduceMotion) || moving;
    }
    this.deform();
    this.sheet.rotation.set(this.tiltX.value, this.tiltY.value, 0);
    if (this.held && !this.keyboard) this.followPointer();
    this.sheet.position.set(this.posX.value, this.posY.value, 0);
    this.sheet.updateMatrixWorld(true);
    this.placeFloor();
    this.renderer.render(this.scene, this.camera);
    this.placeHitTarget();
    if (moving) this.wake();
    else this.lastTime = 0;
  }

  // The bit of paper you grabbed stays under the pointer.
  followPointer() {
    const attribute = this.geometry.attributes.position;
    this.anchor.set(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      this.va.fromBufferAttribute(attribute, this.gripIndices[i]);
      this.anchor.addScaledVector(this.va, this.weights.getComponent(i));
    }
    this.anchor.multiplyScalar(this.scale).applyEuler(this.sheet.rotation);
    this.plane.constant = -this.anchor.z;
    this.setPointer(this.pointerX, this.pointerY);
    if (this.raycaster.ray.intersectPlane(this.plane, this.world)) {
      this.posX.value = this.posX.target = this.world.x - this.anchor.x;
      this.posY.value = this.posY.target = this.world.y - this.anchor.y;
      this.posX.velocity = this.posY.velocity = 0;
    }
  }

  placeFloor() {
    const bounds = this.geometry.boundingBox;
    if (!bounds) return;
    let backZ = Infinity;
    for (let i = 0; i < 8; i++) {
      this.corner.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
      this.corner.applyMatrix4(this.sheet.matrixWorld);
      backZ = Math.min(backZ, this.corner.z);
    }
    this.floor.position.z = backZ - this.scale * this.mesh.shortSide * 0.08;
  }

  wake() {
    if (!this.frame && !this.disposed && this.inView && !document.hidden)
      this.frame = requestAnimationFrame((t) => this.render(t));
  }

  resize() {
    const rect = this.root.getBoundingClientRect();
    const { width, height } = this.opts;
    const vw = (this.viewportWidth = Math.max(1, rect.width));
    const vh = (this.viewportHeight = Math.max(1, rect.height));
    this.scale = width * Math.min(1, Math.max(1, vw - 32) / width, Math.max(1, vh - 32) / height);
    this.sheet.scale.setScalar(this.scale);
    this.camera.aspect = vw / vh;
    this.camera.position.z = vh / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(vw, vh, false);
    const reach = Math.max(vw, vh);
    const angle = THREE.MathUtils.degToRad(-35);
    this.light.position.set(Math.sin(angle) * reach, Math.cos(angle) * reach, reach * 4);
    const cam = this.light.shadow.camera;
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.near = 1;
    cam.far = reach * 6;
    cam.updateProjectionMatrix();
    this.floor.scale.set(vw * 4, vh * 4, 1);
    this.wake();
  }

  // ----- Input -----
  bindEvents() {
    const on = (target, type, fn) => {
      target.addEventListener(type, fn);
      this.listeners.push(() => target.removeEventListener(type, fn));
    };
    const mine = (e) => e.pointerId === this.pointerId;
    on(this.hit, "pointerdown", (e) => this.onPointerDown(e));
    on(this.hit, "pointermove", (e) => this.onPointerMove(e));
    on(this.hit, "pointerup", (e) => { if (mine(e)) this.release(); });
    on(this.hit, "pointercancel", (e) => { if (mine(e)) this.release(); });
    on(this.hit, "lostpointercapture", (e) => { if (mine(e)) this.release(); });
    on(this.hit, "keydown", (e) => this.onKeyDown(e));
    on(this.hit, "keyup", (e) => {
      if (this.keyboard && (e.key === " " || e.key === "Enter")) { e.preventDefault(); this.release(); }
    });
    on(this.hit, "blur", () => this.release());
    on(window, "blur", () => this.release());
    on(document, "visibilitychange", () => {
      this.lastTime = 0;
      if (document.hidden) this.release();
      else this.wake();
    });
    on(this.media, "change", () => { this.reduceMotion = this.media.matches; });
    on(this.canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      this.release();
      this.root.dataset.status = "error";
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.inView = entries[0].isIntersecting;
      this.lastTime = 0;
      if (!this.inView) this.release();
      else this.wake();
    });
    this.intersectionObserver.observe(this.root);
  }

  onPointerDown(event) {
    if (this.state !== "wad" || event.button !== 0 || !event.isPrimary) return;
    const rect = this.root.getBoundingClientRect();
    this.pointerX = this.lastX = event.clientX - rect.left;
    this.pointerY = this.lastY = event.clientY - rect.top;
    this.setPointer(this.pointerX, this.pointerY);
    this.sheet.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects([this.front, this.back], false)[0];
    if (!hit || !hit.face) return;
    event.preventDefault();
    // focused for the keyboard's sake, but not outlined: the pointer is on it
    this.hit.dataset.pointer = "true";
    this.hit.focus({ preventScroll: true });
    const { face } = hit;
    this.gripIndices = [face.a, face.b, face.c];
    const attribute = this.geometry.attributes.position;
    this.va.fromBufferAttribute(attribute, face.a);
    this.vb.fromBufferAttribute(attribute, face.b);
    this.vc.fromBufferAttribute(attribute, face.c);
    THREE.Triangle.getBarycoord(this.sheet.worldToLocal(hit.point.clone()), this.va, this.vb, this.vc, this.weights);
    this.keyboard = false;
    this.pointerId = event.pointerId;
    this.lastMove = performance.now();
    this.hit.setPointerCapture(event.pointerId);
    this.startHold();
  }

  // Tugging the paper around pulls it open faster than just holding on, and
  // the faster it moves the more it tilts.
  onPointerMove(event) {
    if (!this.held || event.pointerId !== this.pointerId) return;
    const rect = this.root.getBoundingClientRect();
    const now = performance.now();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const dt = Math.max(0.008, (now - this.lastMove) / 1000);
    const dx = x - this.lastX, dy = y - this.lastY;
    this.lastX = x; this.lastY = y; this.lastMove = now;
    this.pointerX = clamp(x, 12, this.viewportWidth - 12);
    this.pointerY = clamp(y, 12, this.viewportHeight - 12);
    this.pull(Math.hypot(dx, dy) / TUG_PX);
    const maxTilt = this.reduceMotion ? 0 : THREE.MathUtils.degToRad(10);
    this.tiltX.target = clamp(dy / dt / 1800, -1, 1) * maxTilt;
    this.tiltY.target = clamp(dx / dt / 1800, -1, 1) * maxTilt;
    this.wake();
  }

  onKeyDown(event) {
    this.hit.dataset.pointer = "false";
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.repeat || this.held) return;
    this.keyboard = true;
    this.startHold();
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    clearInterval(this.nudger);
    this.listeners.forEach((off) => off());
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.geometry.dispose();
    this.floorGeometry.dispose();
    ["front", "back", "depth"].forEach((k) => this.materials[k].dispose());
    this.floorMaterial.dispose();
    this.grain.dispose();
    if (this.texture) this.texture.dispose();
    this.light.shadow.dispose();
    this.renderer.dispose();
  }
}
