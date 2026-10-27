// paper.js — a crumpled note, lying on the desk among everything else.
//
// A port of React Bits' Paper Crumple (reactbits.dev/micro/paper-crumple,
// MIT) out of React and into plain three.js, so the home page can keep running
// without a build step. The paper solver in createPaperPath is theirs, kept as
// written: it relaxes a triangulated sheet into a wad once, records the frames,
// and every crumple afterwards just scrubs through them.
//
// The original draws its own little scene. Here the sheet is just a mesh, so
// it sits in the desk's scene: lit by the same candle, throwing its shadow on
// the chart, picked up and read in front of the camera. Where it goes is up to
// stage.js; this only knows how crumpled it is.
//
//   const note = new PaperNote({ texture, seed, size });
//   scene.add(note.object);
//   note.fold(amount, crease)  → 0 flat … 1 balled tight; crease is the relief
//                                 left in a sheet that has been opened
//   note.update(dt)            → true while it is still moving
//   note.setTexture(canvas)    → swaps what is printed on it
//   note.dispose()

import * as THREE from "three";

export const WAD = 0.94;     // how tightly a fresh note is balled up (0 flat, 1 tightest)
export const CREASE = 0.16;  // relief left in the open sheet

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
  constructor(options) {
    const opts = this.opts = {
      width: 360, height: 460, seed: 7, detail: 64, foldCount: 6, foldSharpness: 0.6, wrinkleDepth: 0.65,
      paperColor: "#f3eee4", size: 2.4, anisotropy: 8, ...options
    };
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

    this.amount = spring(WAD);
    this.memory = spring(0);
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
