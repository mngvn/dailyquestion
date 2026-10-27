// flame.js — the candle flame and everything that rises off it.
//
// The flame is a shader on a card that always faces the camera: a teardrop
// with a blue root, a dark pocket round the wick, a white-hot core and a tip
// torn about by two octaves of noise climbing through it. Its heart runs past
// white, and three soft glow cards behind it make the halo a bloom pass would
// (for a fraction of the cost). Embers spit off the tip and climb, cooling
// from white through orange to a dull red. Dust motes drift in the room and
// only show where the candle reaches them — Particles from React Bits, in the
// dark.
//
// In light mode the same flame burns black: the colours turn to ink and soot,
// the embers to ash, and the glow to a halo of shadow.

import * as THREE from "three";

const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
    return v;
  }
`;

const CARD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLAME_FRAG = /* glsl */ `
  uniform float uTime, uFlick, uLean, uLit, uDark, uStretch;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec2 uv = vUv;
    float t = uTime;
    float h = uv.y / uStretch;
    float n1 = fbm(vec2(uv.x * 2.4, uv.y * 3.0 - t * 2.6));
    float n2 = fbm(vec2(uv.x * 5.5 + 11.0, uv.y * 6.5 - t * 4.4));
    // the flame bends with the draught, and the higher it goes the more it is torn
    float bend = uLean * h * h * 0.5 + (n1 - 0.5) * 0.2 * h * h + sin(t * 2.3 + uv.y * 4.0) * 0.018 * h;
    float x = uv.x - 0.5 - bend;
    float s = clamp((h - 0.04) / 0.88, 0.0, 1.0);
    // teardrop: a round belly low down tapering to a long tip
    float prof = sin(3.14159 * pow(s, 0.5));
    float w = 0.22 * prof * (0.9 + 0.16 * n2);
    float d = abs(x) / max(w, 0.001);
    float inside = step(0.001, s) * (1.0 - smoothstep(0.88, 1.0, s));
    float body = smoothstep(1.0, 0.25, d) * inside;
    float core = smoothstep(0.7, 0.0, d) * smoothstep(0.0, 0.14, s) * smoothstep(0.8, 0.28, s);
    float tip = smoothstep(0.3, 1.0, s);
    float blue = smoothstep(0.2, 0.0, s) * smoothstep(0.35, 1.0, d);
    float pocket = smoothstep(0.14, 0.0, s) * smoothstep(0.45, 0.0, d);
    float haze = exp(-pow(abs(x) / (w + 0.08), 2.0) * 2.2) * smoothstep(0.0, 0.25, s) * (1.0 - s) * inside;

    if (uDark > 0.5) {
      // a black flame: an ink-dark heart with a violet rim, soot at the tip
      float rim = smoothstep(0.3, 1.0, d);
      vec3 ink = mix(vec3(0.015, 0.0, 0.03), vec3(0.3, 0.11, 0.55), rim * 0.75 + blue * 0.6);
      float a = clamp(body * 1.5 * (1.0 - 0.55 * tip * smoothstep(0.4, 1.0, d)) + haze * 0.45, 0.0, 1.0);
      gl_FragColor = vec4(ink, a * uLit);
      return;
    }
    vec3 col = mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.2, 0.035), tip);
    col = mix(col, vec3(1.0, 0.92, 0.7), core);
    col = mix(col, vec3(0.22, 0.4, 1.0), blue * 0.85);
    float glow = body * (1.2 + 3.0 * core) * (1.0 - 0.55 * tip) * (1.0 - 0.4 * pocket);
    vec3 outc = col * glow + vec3(1.0, 0.42, 0.1) * haze * 0.35;
    gl_FragColor = vec4(outc * uLit * uFlick, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform float uLit, uFlick, uDark, uPower;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    vec2 q = vec2(p.x, p.y * 0.85);
    float g = exp(-dot(q, q) * uPower) * smoothstep(1.0, 0.55, r);
    if (uDark > 0.5) { gl_FragColor = vec4(0.05, 0.02, 0.09, g * 0.42 * uLit); return; }
    gl_FragColor = vec4(uColor * g * uLit * uFlick, 1.0);
  }
`;

const EMBER_VERT = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  attribute float aSeed;
  uniform float uScale;
  varying float vLife;
  varying float vSeed;
  void main() {
    vLife = aLife;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aLife >= 1.0 ? 0.0 : aSize * uScale / -mv.z * (1.0 - aLife * 0.55);
  }
`;

const EMBER_FRAG = /* glsl */ `
  uniform float uDark;
  varying float vLife;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c));
    a *= a;
    float twinkle = 0.7 + 0.3 * sin(vSeed * 40.0 + vLife * 70.0);
    float fade = 1.0 - smoothstep(0.65, 1.0, vLife);
    if (uDark > 0.5) { gl_FragColor = vec4(0.07, 0.05, 0.09, a * fade * 0.85); return; }
    vec3 hot = vec3(1.0, 0.86, 0.55) * 7.0, warm = vec3(1.0, 0.42, 0.08) * 3.6, cool = vec3(0.75, 0.1, 0.02) * 1.4;
    vec3 col = vLife < 0.25 ? mix(hot, warm, vLife / 0.25) : mix(warm, cool, (vLife - 0.25) / 0.75);
    gl_FragColor = vec4(col * a * fade * twinkle, 1.0);
  }
`;

const DUST_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uScale, uFlick, uLit, uRadius;
  uniform vec3 uFlame;
  varying float vBright;
  void main() {
    vec3 p = position;
    float s = aSeed * 31.0;
    // slow brownian wander and a lazy rise, wrapped back down to the desk
    p.x += sin(uTime * 0.11 + s) * 0.6 + sin(uTime * 0.37 + s * 1.7) * 0.18;
    p.z += cos(uTime * 0.09 + s * 1.3) * 0.6 + sin(uTime * 0.31 + s * 0.6) * 0.18;
    p.y = 0.25 + mod(p.y + uTime * (0.04 + aSeed * 0.05), 4.6);
    vec3 world = (modelMatrix * vec4(p, 1.0)).xyz;
    float d = distance(world, uFlame);
    vBright = uLit * uFlick * clamp(2.2 / (d * d + 0.6), 0.0, 1.0) * smoothstep(uRadius, uRadius * 0.6, d);
    vBright *= 0.55 + 0.45 * sin(uTime * (1.0 + aSeed * 2.0) + s);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.02 + aSeed * 0.025) * uScale / -mv.z;
  }
`;

const DUST_FRAG = /* glsl */ `
  varying float vBright;
  void main() {
    float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * a * vBright * 1.6, 1.0);
  }
`;

export class Flame {
  constructor({ reduceMotion = false } = {}) {
    this.reduce = reduceMotion;
    this.group = new THREE.Group();
    this.lit = 1;
    this.dark = false;
    this.uniforms = {
      uTime: { value: Math.random() * 100 },
      uFlick: { value: 1 },
      uLean: { value: 0 },
      uLit: { value: 1 },
      uDark: { value: 0 },
      uStretch: { value: 1 }
    };

    const card = new THREE.PlaneGeometry(1, 1);
    card.translate(0, 0.5, 0);
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: CARD_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.flame = new THREE.Mesh(card, this.flameMat);
    this.flame.scale.set(0.46, 1.02, 1);
    this.flame.renderOrder = 12;
    this.flame.frustumCulled = false;

    const glow = (color, power, size, y) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uLit: this.uniforms.uLit, uFlick: this.uniforms.uFlick, uDark: this.uniforms.uDark,
          uPower: { value: power }, uColor: { value: new THREE.Color(...color) }
        },
        vertexShader: CARD_VERT, fragmentShader: GLOW_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      m.position.y = y;
      m.renderOrder = 11;
      return m;
    };
    this.glows = [
      glow([1.15, 0.48, 0.13], 4.6, 1.0, 0.34),
      glow([0.34, 0.13, 0.03], 3.4, 1.9, 0.36),
      glow([0.14, 0.05, 0.012], 3.0, 3.6, 0.38)
    ];
    this.group.add(this.flame, ...this.glows);

    // ----- Embers -----
    this.max = 160;
    this.embers = [];
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max).fill(1);
    this.size = new Float32Array(this.max);
    this.seed = new Float32Array(this.max);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(this.seed, 1));
    this.emberUniforms = { uScale: { value: 600 }, uDark: this.uniforms.uDark };
    this.emberMat = new THREE.ShaderMaterial({
      uniforms: this.emberUniforms, vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.points = new THREE.Points(geometry, this.emberMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 13;
    for (let i = 0; i < this.max; i++) {
      this.embers.push({ i, alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s: Math.random() });
      this.seed[i] = Math.random();
    }
    this.spawnClock = 0;
    this.rate = 2.4;          // embers a second when nothing is going on
    this.boost = 0;           // extra, decaying, after a puff or a hover
    this.anchor = new THREE.Vector3();
  }

  // Embers live in world space so they trail off when the flame leans.
  attachEmbers(scene) {
    scene.add(this.points);
  }

  setDark(dark) {
    this.dark = dark;
    this.uniforms.uDark.value = dark ? 1 : 0;
    // the black flame keeps only the wide halo of shadow round it
    this.glows[0].visible = this.glows[1].visible = !dark;
    const blend = dark ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [this.flameMat, this.emberMat, ...this.glows.map((g) => g.material)]) {
      m.blending = blend;
      m.needsUpdate = true;
    }
  }

  setScale(px) {
    this.emberUniforms.uScale.value = px;
  }

  // A shower of sparks off the tip.
  burst(count, spread = 1) {
    for (let k = 0; k < count; k++) this.spawn(spread);
  }

  spawn(spread = 1) {
    const e = this.embers.find((x) => !x.alive);
    if (!e) return;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.06;
    e.alive = true;
    e.x = this.anchor.x + Math.cos(a) * r;
    e.y = this.anchor.y + 0.35 + Math.random() * 0.4;
    e.z = this.anchor.z + Math.sin(a) * r;
    e.vx = (Math.random() - 0.5) * 0.5 * spread + this.uniforms.uLean.value * 0.6;
    e.vy = 0.7 + Math.random() * 1.1;
    e.vz = (Math.random() - 0.5) * 0.5 * spread;
    e.age = 0;
    e.life = 1.1 + Math.random() * 1.8;
    e.s = Math.random();
    this.size[e.i] = 0.035 + Math.random() * 0.06;
  }

  // flick ≈ 1 ± a little, lit 0..1, lean −1..1 (from the pointer's draught)
  update(dt, t, camera, { flick, lit, lean, roar = 0 }) {
    const u = this.uniforms;
    u.uTime.value += this.reduce ? dt * 0.25 : dt;
    u.uFlick.value = this.reduce ? 1 : flick;
    u.uLit.value = lit;
    u.uLean.value = lean;
    u.uStretch.value = 0.9 + (flick - 1) * 1.2 + (1 - lit) * 0.6 - roar * 0.12;
    this.group.getWorldPosition(this.anchor);
    // the cards face the camera
    this.flame.quaternion.copy(camera.quaternion);
    for (const g of this.glows) g.quaternion.copy(camera.quaternion);
    const sx = 0.46 * (0.92 + flick * 0.08) * (1 + roar * 0.12), sy = 1.02 * (0.55 + 0.45 * lit) * (0.94 + flick * 0.06) * (1 + roar * 0.22);
    this.flame.scale.set(sx * (0.4 + 0.6 * lit) * (this.dark ? 1.3 : 1), sy, 1);

    // embers
    if (!this.reduce && lit > 0.5) {
      this.boost *= Math.pow(0.25, dt);
      this.spawnClock += dt * (this.rate + this.boost);
      while (this.spawnClock > 1) { this.spawnClock -= 1; this.spawn(); }
    }
    let any = false;
    for (const e of this.embers) {
      if (!e.alive) { this.life[e.i] = 1; continue; }
      e.age += dt;
      const k = e.age / e.life;
      if (k >= 1) { e.alive = false; this.life[e.i] = 1; continue; }
      any = true;
      // buoyant, wandering, slowing as it cools
      e.vx += Math.sin(t * 3.1 + e.s * 40) * 1.6 * dt;
      e.vz += Math.cos(t * 2.7 + e.s * 31) * 1.6 * dt;
      e.vy += (0.35 - e.vy * 0.6) * dt;
      e.vx *= Math.pow(0.6, dt);
      e.vz *= Math.pow(0.6, dt);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
      this.positions[e.i * 3] = e.x;
      this.positions[e.i * 3 + 1] = e.y;
      this.positions[e.i * 3 + 2] = e.z;
      this.life[e.i] = k;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    return any;
  }
}

export class Dust {
  constructor(count = 320, radius = 7) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * 4.6;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    this.uniforms = {
      uTime: { value: 0 }, uScale: { value: 600 }, uFlick: { value: 1 }, uLit: { value: 1 },
      uRadius: { value: radius }, uFlame: { value: new THREE.Vector3() }
    };
    this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  update(dt, flame, flick, lit, reduce) {
    if (!reduce) this.uniforms.uTime.value += dt;
    this.uniforms.uFlick.value = flick;
    this.uniforms.uLit.value = lit;
    this.uniforms.uFlame.value.copy(flame);
  }
}

// Layered sines at unrelated rates read as a living flame; now and then it
// gutters for a moment.
export function flicker(t, state) {
  if (Math.random() < 0.004) state.gutter = 1;
  state.gutter = (state.gutter || 0) * 0.94;
  return 1 + 0.045 * Math.sin(t * 7.1 + 1.3) + 0.03 * Math.sin(t * 12.7 + 4.1) +
    0.02 * Math.sin(t * 23.3 + 2.2) - state.gutter * 0.12;
}
