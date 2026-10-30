// stage.js — the chart room, in three dimensions.
//
// One WebGL scene: a walnut desk and its sea chart, a candle in a brass
// chamberstick, a compass and an inkwell, and today's five notes (paper.js)
// crumpled on the chart in the candle's light. The candle is the light. Its
// flame (flame.js) flickers, leans when the pointer sweeps past and throws the
// shadows across the desk; blow it out and the room goes black but for the
// match the pointer carries. In light mode the room is in daylight and the
// flame burns black, pooling darkness round itself.
//
// The camera stands still. Hold a note and it lifts off the chart and opens in
// front of you; put it down and it goes through the shredder (shredder.js),
// then flutters back down from above onto its place on the chart, open,
// creases and all.
//
// It is built to stay light: one pass straight to the screen, shadows drawn
// again only when something on the desk moves, the paper crumpled in workers.
// And it is made ready out of sight: every shader is compiled and every note
// printed and uploaded before the room is shown, so once it can be seen
// nothing in it stalls.
//
// start(room) builds it and resolves to { note(spec), show(), puff(strength),
// dispose() }, or to null when there is no WebGL to be had. note(spec)
// resolves once that note is ready; show() is for when the room comes into
// view, and lets the notes fall.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as Props from "./room-props.js";
import { Flame, Dust, flicker } from "./flame.js";
import { makePaperNote, WAD, CREASE } from "./paper.js";
import { WORLD } from "./world.js";
import { shred } from "./shredder.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

const HOLD_SECONDS = 1.2;    // holding still opens a note in about this long
const TUG_PX = 2200;         // dragging this far opens it on its own
const SPRING_BACK = 0.88;    // letting go early keeps this much of the progress
const RELIGHT_MS = 2800;     // how long the candle stays out
const CHART_Y = 0.06;        // the chart's surface, where the notes rest
// Where the flame sits on screen, as a share of the room's height down from
// the top. The loading flame in home.css is in the same place, so when the
// room fades in the one flame becomes the other.
const FLAME_AT = { wide: 0.35, tall: 0.34 };
const FLAME_MID = 0.36;      // the middle of the flame, above the wick

// Where everything lies: `wide` for landscape rooms, `tall` for phones.
// Positions are [x, z, turn] on the desk. The notes are placed in the order
// desk.js hands them over: two behind, either side of the candle, then three
// in front, the last in the middle.
const LAYOUTS = {
  wide: {
    desk: { w: 26, d: 14, z: 0.6 },
    chart: { x: 0, z: 0.3, w: 11.4, d: 7.6, turn: 0.012 },
    candle: [0, -1.65],
    notes: [[-3.45, -1.55, 0.1], [3.45, -1.55, -0.08], [-2.9, 1.9, -0.05], [2.9, 1.9, 0.07], [0, 2.05, 0.03]],
    compass: [6.6, 3.1, 0.4], inkwell: [-6.5, 2.4, 0],
    bounds: { x: 7.6, back: -3.9, front: 4.6, top: 2.7 },
    elevation: 0.95, fov: 30, noteSize: 2.5
  },
  tall: {
    desk: { w: 14, d: 22, z: 0.8 },
    chart: { x: 0, z: 0.5, w: 7.8, d: 10.8, turn: 0.01 },
    candle: [0, -3.7],
    notes: [[-2.55, -2.85, 0.08], [2.55, -2.85, -0.06], [-1.45, 0.55, -0.04], [1.45, 0.55, 0.05], [0, 3.75, 0.03]],
    compass: [2.85, 5.3, 0.3], inkwell: [-2.8, 5.1, 0],
    bounds: { x: 4.3, back: -5.2, front: 6.2, top: 2.7 },
    elevation: 1.06, fov: 32, noteSize: 2.0
  }
};

// A critically damped spring, the same one paper.js uses.
const spring = (value = 0) => ({ value, target: value, velocity: 0 });
function advance(s, dt, duration, instant) {
  if (instant || duration <= 0) { s.value = s.target; s.velocity = 0; return false; }
  const omega = 8 / Math.max(0.06, duration);
  const offset = s.value - s.target;
  const term = s.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  s.value = s.target + (offset + term * dt) * decay;
  s.velocity = (s.velocity - omega * term * dt) * decay;
  if (Math.abs(s.value - s.target) < 0.0005 && Math.abs(s.velocity) < 0.002) { s.value = s.target; s.velocity = 0; return false; }
  return true;
}

export async function start(room) {
  let renderer;
  const canvas = document.createElement("canvas");
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false });
  } catch (e) {
    return null;
  }
  const stage = new Stage(room, renderer, canvas);
  try {
    await stage.build();
  } catch (error) {
    stage.dispose();
    throw error;
  }
  return stage.api;
}

class Stage {
  constructor(room, renderer, canvas) {
    this.room = room;
    this.renderer = renderer;
    this.canvas = canvas;
    this.heading = room.querySelector(".room-date");
    this.light = document.body.classList.contains("light");
    this.layoutName = null;
    this.t = 0;
    this.lit = 1;              // the candle: 1 burning, 0 out
    this.litTarget = 1;
    this.flare = 0;
    this.roar = 0;
    this.flickState = {};
    this.flick = 1;
    this.lean = 0;
    this.leanVel = 0;
    this.notes = [];
    this.hits = [];
    this.owners = new Map();
    this.pointer = { x: 0, y: 0, vx: 0, t: 0, inside: false, ndc: new THREE.Vector2(), desk: new THREE.Vector3(), onDesk: false };
    this.shadowsDirty = true;
    this.visible = true;
    this.frame = 0;
    this.last = 0;
    this.v = new THREE.Vector3();
    this.shown = false;
    this.api = {
      note: (spec) => this.addNote(spec),
      show: () => this.show(),
      fontsArrived: () => this.fontsArrived(),
      puff: (s) => this.puff(s),
      dispose: () => this.dispose()
    };
  }

  // ----- Building -----
  async build() {
    const { renderer, room } = this;
    const el = this.el = document.createElement("div");
    el.className = "stage";
    this.canvas.className = "stage-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.overlay = document.createElement("div");
    this.overlay.className = "stage-overlay";
    this.tip = document.createElement("div");
    this.tip.className = "note-tip";
    this.tip.setAttribute("aria-hidden", "true");
    this.live = document.createElement("p");
    this.live.className = "sr-only";
    this.live.setAttribute("aria-live", "polite");
    this.overlay.append(this.tip, this.live);
    el.append(this.canvas, this.overlay);
    room.prepend(el);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // shadows are redrawn only when something on the desk has moved
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 300);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // ----- Light -----
    this.candleLight = new THREE.PointLight(0xffa456, 7, 0, 1.05);
    this.candleLight.castShadow = true;
    this.candleLight.shadow.mapSize.set(coarse ? 512 : 1024, coarse ? 512 : 1024);
    this.candleLight.shadow.camera.near = 0.1;
    this.candleLight.shadow.camera.far = 40;
    this.candleLight.shadow.bias = -0.002;
    this.candleLight.shadow.normalBias = 0.02;
    this.candleLight.shadow.radius = 3;
    this.matchLight = new THREE.PointLight(0xffb070, 0, 0, 2);
    this.hemi = new THREE.HemisphereLight(0x3a2a20, 0x0a0604, 0.35);
    this.moon = new THREE.DirectionalLight(0x8090b8, 0.16);
    this.moon.position.set(-10, 8, -12);
    this.sun = new THREE.DirectionalLight(0xfff0da, 2.2);
    this.sun.position.set(-9, 15, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.radius = 4;
    scene.add(this.candleLight, this.matchLight, this.hemi, this.moon, this.sun, this.sun.target);

    // ----- The room and the things in it -----
    const M = this.M = Props.makeMaterials();
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 30), M.wall);
    scene.add(this.wall);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), M.floor);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -6;
    scene.add(this.floor);

    this.candle = Props.makeCandle(M);
    this.candle.root.scale.setScalar(1.25);
    scene.add(this.candle.root);
    this.flame = new Flame({ reduceMotion });
    this.candle.flameAnchor.add(this.flame.group);
    this.flame.attachEmbers(scene);
    this.dust = new Dust(coarse ? 140 : 260, 7.5);
    scene.add(this.dust.points);
    // in daylight the flame gives off darkness: a pool of it on the desk,
    // multiplied into whatever is under it
    this.shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: Props.tex(pool()), transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.MultiplyBlending, premultipliedAlpha: true
    }));
    this.shade.rotation.x = -Math.PI / 2;
    this.shade.renderOrder = 1;
    scene.add(this.shade);
    this.compass = Props.makeCompass(M);
    this.inkwell = Props.makeInkwell(M);
    scene.add(this.compass.root, this.inkwell.root);
    this.addHits(this.candle, "candle");

    // Compile every shader before the first frame — where the browser can,
    // off to one side, so the page doesn't freeze while it happens — then
    // draw once, still out of sight: if a shader won't compile here, the flat
    // notes are still there to fall back on.
    let broken = false;
    renderer.debug.onShaderError = () => { broken = true; };
    this.applyTheme();
    this.resize();
    this.step(1 / 60);
    await renderer.compileAsync(scene, this.camera);
    if (this.disposed) throw new Error("the room was taken down while it was being built");
    this.draw();
    if (broken) throw new Error("a shader failed to compile");
    renderer.debug.onShaderError = null;

    this.bindEvents();
    this.el.dataset.ready = "true";
    this.wake();
  }

  // The room comes into view: the notes, ready and waiting above the desk,
  // fall into place, and before long the candle smokes.
  show() {
    if (this.shown) return;
    this.shown = true;
    this.shownAt = this.t;
    this.wake();
    setTimeout(() => this.puff(1), 1400);
    this.scheduleWisps();
  }

  // The web fonts came after the room was built: the chart's lettering is
  // drawn again in them, and the room fitted again round the date.
  fontsArrived() {
    const L = this.layout, material = this.chart.material, old = material.map;
    material.map = Props.tex(Props.chartCanvas(WORLD, L.chart.w / L.chart.d), { aniso: 16 });
    old.dispose();
    this.renderer.initTexture(material.map);
    this.W = 0;
    this.resize();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.el) this.el.remove();
    this.renderer.dispose();
  }

  addHits(owner, kind) {
    owner.kind = kind;
    for (const m of owner.hits) {
      this.owners.set(m, owner);
      this.hits.push(m);
    }
  }

  // ----- Layout -----
  resize() {
    const rect = this.el.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width)), H = Math.max(1, Math.round(rect.height));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    const name = W / H < 0.95 ? "tall" : "wide";
    if (name !== this.layoutName) this.applyLayout(name);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.fit();
    const scale = H * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.flame.setScale(scale);
    this.dust.uniforms.uScale.value = scale;
    for (const n of this.notes) n.place();
    this.shadowsDirty = true;
    this.wake();
  }

  applyLayout(name) {
    const L = this.layout = LAYOUTS[name];
    this.layoutName = name;
    this.el.dataset.layout = name;
    const { scene, M } = this;
    if (this.desk) { scene.remove(this.desk); this.desk.traverse((o) => o.geometry && o.geometry.dispose()); }
    if (this.chart) { scene.remove(this.chart); this.chart.geometry.dispose(); this.chart.material.map.dispose(); }
    this.desk = Props.makeDesk(M, L.desk.w, L.desk.d);
    this.desk.position.z = L.desk.z;
    scene.add(this.desk);
    this.chart = Props.makeChart(M, Props.tex(Props.chartCanvas(WORLD, L.chart.w / L.chart.d), { aniso: 16 }), L.chart.w, L.chart.d);
    this.chart.position.set(L.chart.x, 0, L.chart.z);
    this.chart.rotation.y = L.chart.turn;
    scene.add(this.chart);
    this.wall.position.set(0, 8, L.desk.z - L.desk.d / 2 - 1.5);
    this.camera.fov = L.fov;
    const place = (obj, [x, z, turn]) => { obj.position.set(x, 0, z); obj.rotation.y = turn || 0; };
    place(this.candle.root, L.candle);
    place(this.compass.root, L.compass);
    place(this.inkwell.root, L.inkwell);
    this.dust.points.position.set(L.candle[0], 0, L.candle[1]);
    this.shade.position.set(L.candle[0], 0.09, L.candle[1]);
    this.shadeSize = name === "tall" ? 8 : 11;
    for (const n of this.notes) n.relayout();
    // the flame's light stays put: the shadows only move when the desk does
    this.candle.root.updateMatrixWorld(true);
    this.flame.group.localToWorld(this.candleLight.position.set(0, 0.85, 0));
  }

  // The camera looks down on the desk from the front. It is pulled back until
  // everything fits below the date with the flame at its spot (FLAME_AT),
  // then the picture is shifted (a lens shift, not a turn) to put it there,
  // with the desk centred across the room.
  fit() {
    const { camera, layout: L, W, H } = this;
    const below = this.heading ? this.heading.getBoundingClientRect().bottom - this.el.getBoundingClientRect().top : 0;
    const box = { left: 8, right: W - 8, top: clamp(below + 8, 0, H * 0.3), bottom: H - 8 };
    const b = L.bounds;
    const pts = [];
    for (const x of [-b.x, b.x]) for (const z of [b.back, b.front]) for (const y of [0, b.top]) pts.push(new THREE.Vector3(x, y, z));
    const target = new THREE.Vector3(0, 0, (b.back + b.front) / 2);
    const dir = new THREE.Vector3(0, Math.sin(L.elevation), Math.cos(L.elevation));
    const flame = this.candle.flameAnchor.localToWorld(new THREE.Vector3(0, FLAME_MID, 0));
    const flameY = H * FLAME_AT[this.layoutName];
    camera.clearViewOffset();
    const measure = (d) => {
      camera.position.copy(target).addScaledVector(dir, d);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        const s = this.v.copy(p).project(camera);
        const px = (s.x + 1) / 2 * W, py = (1 - s.y) / 2 * H;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      // how far down the picture has to move to put the flame at its spot
      const shift = flameY - (1 - this.v.copy(flame).project(camera).y) / 2 * H;
      return { x0, x1, y0, y1, shift };
    };
    const fits = (m) => m.x1 - m.x0 <= box.right - box.left && m.y0 + m.shift >= box.top && m.y1 + m.shift <= box.bottom;
    let lo = 5, hi = 200;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(measure(mid))) hi = mid; else lo = mid;
    }
    const m = measure(hi);
    camera.setViewOffset(W, H, (m.x0 + m.x1) / 2 - (box.left + box.right) / 2, -m.shift, W, H);
    camera.updateProjectionMatrix();
    this.box = box;
  }

  // How high above a spot on the desk something has to be to start out of
  // sight, above the top of the room.
  aboveScreen(x, z) {
    for (let y = 2; y < 40; y += 0.5) if (this.toScreen(this.v.set(x, y, z)).y < -this.H * 0.25) return y;
    return 40;
  }

  toScreen(world) {
    const s = this.v.copy(world).project(this.camera);
    return { x: (s.x + 1) / 2 * this.W, y: (1 - s.y) / 2 * this.H };
  }

  // A point in front of the camera: screen pixel (px, py), `depth` units away.
  cameraPoint(px, py, depth, out) {
    out.set((px / this.W) * 2 - 1, -(py / this.H) * 2 + 1, 0.5).applyMatrix4(this.camera.projectionMatrixInverse);
    out.multiplyScalar(-depth / out.z);
    return out.applyMatrix4(this.camera.matrixWorld);
  }

  // ----- Theme -----
  applyTheme() {
    const light = this.light = document.body.classList.contains("light");
    const { scene, renderer, M } = this;
    scene.background = new THREE.Color(light ? 0xe9dcc6 : 0x050302);
    scene.environmentIntensity = light ? 0.75 : 0.1;
    M.wall.color.set(light ? 0xe6d6bc : 0x2b2019);
    M.floor.color.set(light ? 0xb8a58a : 0x150d08);
    this.hemi.color.set(light ? 0xfff4e6 : 0x3a2a20);
    this.hemi.groundColor.set(light ? 0x9a8a72 : 0x0a0604);
    this.hemi.intensity = light ? 0.95 : 0.35;
    this.sun.visible = light;
    this.moon.visible = !light;
    this.candleLight.castShadow = !light;
    this.candleLight.color.set(light ? 0xffe8c8 : 0xffa456);
    renderer.toneMappingExposure = light ? 0.95 : 1.2;
    this.dust.points.visible = !light && (this.quality || 0) < 2;
    this.shade.visible = light;
    this.flame.setDark(light);
    this.candle.wax.emissiveIntensity = light ? 0 : 0.55;
    for (const n of this.notes) n.applyTheme();
    // switching between light and dark, the candle flares as it turns
    if (this.themed && !reduceMotion) {
      this.flare = 1;
      this.flame.burst(18, 1.8);
    }
    this.themed = true;
    this.shadowsDirty = true;
    this.wake();
  }

  // ----- Pointer -----
  bindEvents() {
    const { canvas } = this;
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", () => this.onUp(null));
    canvas.addEventListener("lostpointercapture", () => { if (this.grabbed) this.grabbed.release(); });
    canvas.addEventListener("pointerleave", () => { this.pointer.inside = false; this.setHover(null); });
    window.addEventListener("pointermove", (e) => this.onMove(e), { passive: true });
    new ResizeObserver(() => this.resize()).observe(this.el);
    new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
      if (this.visible) this.wake();
    }).observe(this.el);
    document.addEventListener("visibilitychange", () => this.wake());
    new MutationObserver(() => {
      if (document.body.classList.contains("light") !== this.light) this.applyTheme();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") this.putDownAll(); });
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onMove(e) {
    const p = this.pointer;
    const { x, y } = this.local(e);
    const now = performance.now();
    const dt = Math.max(0.008, (now - p.t) / 1000);
    p.vx = p.t ? (x - p.x) / dt : 0;
    p.x = x; p.y = y; p.t = now;
    p.inside = e.target === this.canvas;
    // a fast pass close to the flame shoves it over
    if (this.flameScreen) {
      const near = Math.hypot(x - this.flameScreen.x, y - this.flameScreen.y);
      if (near < 240) this.leanVel += clamp(p.vx / 1600, -1, 1) * (1 - near / 240) * 60;
    }
    if (this.grabbed) this.grabbed.drag(e, x, y);
    this.needPick = true;
    this.wake();
  }

  pick(x, y) {
    const p = this.pointer;
    p.ndc.set((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1);
    const ray = this.raycaster || (this.raycaster = new THREE.Raycaster());
    ray.setFromCamera(p.ndc, this.camera);
    // where the pointer meets the desk, for the match and the compass
    const plane = this.deskPlane || (this.deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    p.onDesk = !!ray.ray.intersectPlane(plane, p.desk);
    const hit = ray.intersectObjects(this.hits, false)[0];
    return hit ? this.owners.get(hit.object) || null : null;
  }

  setHover(owner) {
    if (this.hovered === owner) return;
    if (this.hovered) this.hovered.hovered = false;
    this.hovered = owner;
    if (owner) owner.hovered = true;
    const kind = owner && owner.kind;
    this.canvas.style.cursor = !owner ? "" : kind === "note" ? (owner.state === "wad" || owner.state === "laid" ? "grab" : "") : "pointer";
    this.showTip(kind === "note" ? owner : null);
  }

  // A small label over a note: what it is, and what to do with it.
  showTip(note) {
    const tip = this.tip;
    if (!note || (note.state !== "wad" && note.state !== "laid")) {
      tip.dataset.show = "false";
      return;
    }
    tip.replaceChildren();
    const title = document.createElement("span");
    title.className = "note-tip-title";
    title.textContent = note.spec.title;
    const how = document.createElement("span");
    how.className = "note-tip-how";
    how.textContent = note.state === "wad" ? "hold to unfold" : "click to pick up";
    tip.append(title, how);
    tip.style.left = `${note.top.x}px`;
    tip.style.top = `${note.top.y}px`;
    tip.dataset.show = "true";
  }

  onDown(e) {
    if (e.button !== 0 || !e.isPrimary) return;
    const { x, y } = this.local(e);
    const owner = this.pick(x, y);
    this.down = { x, y, owner };
    if (owner && owner.kind === "note") {
      e.preventDefault();
      if (owner.grab(e, x, y)) {
        this.grabbed = owner;
        this.canvas.setPointerCapture(e.pointerId);
        this.canvas.style.cursor = "grabbing";
        this.showTip(null);
      }
    }
    this.wake();
  }

  onUp(e) {
    const d = this.down;
    this.down = null;
    if (this.grabbed) {
      const g = this.grabbed;
      this.grabbed = null;
      g.release();
      this.canvas.style.cursor = "";
      return;
    }
    if (!d || !e) return;
    const { x, y } = this.local(e);
    if (Math.hypot(x - d.x, y - d.y) > 10) return;
    if (d.owner && d.owner.kind === "candle") this.blowOut();
    else if (!d.owner) this.putDownAll();
  }

  // ----- The candle -----
  puff(strength = 1) {
    if (this.lit < 0.5) return;
    this.flame.burst(Math.round(4 + strength * 8), 1 + strength * 0.4);
    this.flame.boost += strength * 6;
    this.wake();
    if (typeof Wisps === "undefined" || !this.flameScreen) return;
    const r = this.canvas.getBoundingClientRect();
    const s = this.flameScreen;
    Wisps.puff(r.left + s.x + window.scrollX, r.top + s.y + window.scrollY - 10,
      { count: Math.round(1 + strength * 2), power: 0.8 + strength * 0.4, long: strength >= 1, alpha: 0.32 });
  }

  blowOut() {
    if (this.litTarget === 0) return;
    this.puff(2.2);
    this.flame.burst(30, 2.6);
    this.litTarget = 0;
    this.candle.ember.material.opacity = 1;
    setTimeout(() => {
      this.litTarget = 1;
      this.flare = 1;
      this.wake();
    }, RELIGHT_MS);
    this.wake();
  }

  // Every so often, a wisp of smoke goes up.
  scheduleWisps() {
    setTimeout(() => {
      if (this.disposed) return;
      if (this.visible && !document.hidden) this.puff(Math.random() < 0.35 ? 1 : 0.5);
      this.scheduleWisps();
    }, 5000 + Math.random() * 4000);
  }

  // ----- Notes -----
  addNote(spec) {
    const rig = new NoteRig(this, spec, this.notes.length);
    this.notes.push(rig);
    return rig.ready;
  }

  putDownAll(except) {
    for (const n of this.notes) if (n !== except) n.putDown();
  }

  announce(text) {
    this.live.textContent = "";
    requestAnimationFrame(() => { this.live.textContent = text; });
  }

  // ----- The loop -----
  wake() {
    if (!this.frame && !this.disposed && this.visible && !document.hidden) this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  // The room runs at the display's own rate for as long as it can be seen,
  // so the flame never stutters; it stops while the tab is hidden or the room
  // is scrolled away.
  tick(now) {
    this.frame = 0;
    if (this.disposed || !this.visible || document.hidden) { this.last = 0; return; }
    this.frame = requestAnimationFrame((t) => this.tick(t));
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.step(dt);
    this.draw();
    // judged once it is in view and has settled, not while it is being made
    if (this.shown && this.t - this.shownAt > 2 && this.t - this.shownAt < 14) this.watchSpeed(dt);
  }

  draw() {
    this.renderer.shadowMap.needsUpdate = this.shadowsDirty;
    this.shadowsDirty = false;
    this.renderer.render(this.scene, this.camera);
  }

  step(dt) {
    const t = (this.t += dt);
    const { candle, flame } = this;

    // the flame: flicker, lean, and whether it is lit
    this.flick = reduceMotion ? 1 : flicker(t, this.flickState);
    // the lean is kept in degrees and handed to the shader as a fraction
    const idleLean = Math.sin(t * 1.3) * 3 + Math.sin(t * 2.9) * 1.5;
    this.leanVel += (idleLean - this.lean) * 40 * dt;
    this.leanVel *= Math.pow(0.02, dt);
    this.lean = clamp(this.lean + this.leanVel * dt, -28, 28);
    const rate = this.litTarget < this.lit ? 7 : 1.6;
    this.lit = clamp(this.lit + (this.litTarget - this.lit) * (1 - Math.exp(-rate * dt)), 0, 1);
    this.flare = Math.max(0, this.flare - dt * 1.6);
    const lit = this.lit * (1 + Math.sin(this.flare * Math.PI) * 0.6);
    // the flame reaches up when the pointer is over the candle
    this.roar += ((candle.hovered ? 1 : 0) - this.roar) * (1 - Math.exp(-5 * dt));
    if (candle.hovered && !reduceMotion) flame.boost = Math.max(flame.boost, 5);
    flame.update(dt, t, this.camera, { flick: this.flick, lit, lean: this.lean / 28, roar: this.roar });
    this.candleLight.intensity = this.light ? -6 * this.lit * this.flick : 7 * this.flick * lit;
    candle.wax.emissiveIntensity = this.light ? 0 : 0.55 * this.flick * this.lit;
    candle.ember.material.opacity = Math.max(0, candle.ember.material.opacity - dt * 0.35);
    this.dust.update(dt, this.candleLight.position, this.flick, this.lit, reduceMotion);
    if (this.light) this.shade.scale.setScalar(this.shadeSize * (0.55 + 0.45 * this.lit) * (1 + (this.flick - 1) * 0.9));
    this.shade.visible = this.light && this.lit > 0.05;

    // the flame on screen, for the smoke and the draught
    this.flameScreen = this.toScreen(flame.group.localToWorld(this.v.set(0, 0.55, 0)));

    // what the pointer is over
    const p = this.pointer;
    if (this.needPick && p.inside && !this.grabbed) {
      this.needPick = false;
      this.setHover(this.pick(p.x, p.y));
    }
    // with the candle out, the pointer carries a match
    const wantMatch = !this.light && this.lit < 0.5 && p.inside && p.onDesk ? 10 : 0;
    this.matchLight.intensity += (wantMatch - this.matchLight.intensity) * (1 - Math.exp(-6 * dt));
    if (p.onDesk) this.matchLight.position.set(p.desk.x, 1.5, p.desk.z + 0.4);

    // the compass needle hunts for the pointer
    this.compass.point(p.onDesk && p.inside ? p.desk : this.v.set(Math.sin(t * 0.3) * 20, 0, -20));
    this.compass.update(dt, t);

    for (const n of this.notes) if (n.update(dt, t)) this.shadowsDirty = true;
  }

  // If the machine can't keep up, give up sharpness first, then the dust,
  // then more sharpness — never anything that would mean compiling shaders
  // again, which would freeze the room while it happened.
  // localStorage "daily.quality" = "high" keeps everything.
  watchSpeed(dt) {
    if (this.pinned === undefined) {
      try { this.pinned = localStorage.getItem("daily.quality") === "high"; } catch (e) { this.pinned = false; }
    }
    if (this.pinned) return;
    this.slow = (this.slow || 0) * 0.97 + (dt > 0.034 ? 1 : 0) * 0.03;
    this.speedFrames = (this.speedFrames || 0) + 1;
    if (this.speedFrames < 90 || this.slow < 0.6 || (this.quality || 0) >= 3) return;
    this.speedFrames = 0;
    this.slow = 0;
    this.quality = (this.quality || 0) + 1;
    const r = this.renderer;
    if (this.quality === 1) {
      r.setPixelRatio(1);
    } else if (this.quality === 2) {
      this.dust.points.visible = false;
    } else {
      r.setPixelRatio(0.75);
    }
    this.W = 0;
    this.resize();
  }
}

// ----- A note, on the desk and in the hand -----
// wad → holding → open (held up to read) → shredding → laid (open on the
// chart, after falling back into place from above) → open …
// Once a note has been opened it stays open: desk.js remembers it for the
// rest of the visit, and it comes back laid open on the chart.
class NoteRig {
  constructor(stage, spec, index) {
    this.stage = stage;
    this.spec = spec;
    this.index = index;
    this.kind = "note";
    this.hits = [];
    this.state = spec.opened ? "laid" : "wad";
    this.progress = spec.opened ? 1 : 0;
    this.lift = spring(0);
    this.hoverLift = spring(0);
    this.tiltX = spring(); this.tiltY = spring();
    // they arrive one after another, wads dropped from a height and opened
    // notes let fall flat
    this.drop = { y: reduceMotion ? 0 : spec.opened ? 0.6 : 3.2 + index * 0.35, v: 0 };
    this.held = false;
    this.keyboard = false;
    this.nudgeAt = 3 + Math.random() * 4;
    this.qDesk = new THREE.Quaternion();
    this.qRead = new THREE.Quaternion();
    this.pDesk = new THREE.Vector3();
    this.pRead = new THREE.Vector3();
    this.wobble = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.tmp = new THREE.Vector3();
    this.top = { x: 0, y: 0 };
    this.buildDom();
    this.ready = makePaperNote({
      texture: spec.texture, seed: spec.seed, paperColor: spec.color, open: spec.opened,
      size: stage.layout.noteSize, anisotropy: Math.min(8, stage.renderer.capabilities.getMaxAnisotropy())
    }).then(async (paper) => {
      // its print is uploaded and its shaders compiled before it is on the
      // desk, so its arrival doesn't stutter
      stage.renderer.initTexture(paper.texture);
      stage.renderer.initTexture(paper.grain);
      await stage.renderer.compileAsync(paper.object, stage.camera, stage.scene);
      if (stage.disposed) return;
      this.paper = paper;
      this.hits = paper.hits;
      stage.addHits(this, "note");
      stage.scene.add(paper.object);
      this.relayout();
      this.applyTheme();
      this.hit.hidden = false;
      stage.wake();
    });
  }

  // A button over the note for the keyboard, and the buttons that appear
  // under it when it is held up.
  buildDom() {
    const { spec, stage } = this;
    const hit = this.hit = document.createElement("button");
    hit.type = "button";
    hit.className = "note-hit";
    hit.hidden = true;
    hit.setAttribute("aria-label", `${spec.label}. Press and hold Space or Enter to unfold it.`);
    hit.addEventListener("keydown", (e) => this.onKeyDown(e));
    hit.addEventListener("keyup", (e) => {
      if (this.keyboard && (e.key === " " || e.key === "Enter")) { e.preventDefault(); this.release(); }
    });
    hit.addEventListener("focus", () => stage.showTip(this));
    hit.addEventListener("blur", () => { stage.showTip(null); if (this.keyboard) this.release(); });

    const bar = this.bar = document.createElement("div");
    bar.className = "note-bar";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-ghost";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => spec.copy(copy));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn btn-solid";
    down.textContent = "Put it down";
    down.addEventListener("click", () => { this.putDown(); hit.focus({ preventScroll: true }); });
    bar.append(copy, down);
    stage.overlay.append(hit, bar);
  }

  relayout() {
    if (!this.paper) return;
    const L = this.stage.layout;
    const [x, z, turn] = L.notes[this.index] || [0, 0, 0];
    this.spot = { x, z, turn };
    this.paper.sheet.scale.setScalar(L.noteSize);
    this.qDesk.setFromEuler(new THREE.Euler(0, turn, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    this.posed = true;
    this.place();
  }

  applyTheme() {
    if (!this.paper) return;
    const tint = this.stage.light ? new THREE.Color(1, 1, 1) : new THREE.Color(1.0, 0.95, 0.86);
    this.paper.setPrint(this.paper.print.target, tint);
  }

  // Where things go on screen: the reading pose, the buttons under it, the
  // keyboard's button over the note on the desk, and the tip above it. The
  // camera never moves, so this is only worked out again on a resize.
  place() {
    const st = this.stage;
    if (!this.paper || !st.box) return;
    // held up to be read: as large as the room allows with the buttons still
    // fitting underneath, a little toward its own side of the desk
    const wide = st.W > st.H * 1.1;
    const top = wide ? st.box.top : 12;
    const bottom = Math.max(top + 160, st.H - 66);
    const avail = bottom - top;
    const h = Math.min(avail * (wide ? 0.96 : 0.92), st.W * 0.9 * this.paper.aspect);
    const side = Math.abs(this.spot.x) < 0.5 ? 0 : Math.sign(this.spot.x);
    const px = st.W / 2 + (wide ? side * Math.min(st.W * 0.14, 220) : 0);
    const py = top + avail / 2;
    const depth = this.paper.size * this.paper.aspect * st.H / (2 * Math.tan(THREE.MathUtils.degToRad(st.camera.fov / 2)) * h);
    st.cameraPoint(px, py, depth, this.pRead);
    this.qRead.copy(st.camera.quaternion);
    // where it is on screen, for the shredder to take it from
    const w = h / this.paper.aspect;
    this.readRect = { x: px - w / 2, y: py - h / 2, w, h };
    this.bar.style.left = `${px}px`;
    this.bar.style.top = `${py + h / 2 + 12}px`;
    // the note's footprint on the desk
    const half = this.paper.size / 2, deep = half * this.paper.aspect;
    const reach = this.state === "laid" ? [half, deep] : [half * 0.45, half * 0.45];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const s = st.toScreen(this.tmp.set(this.spot.x + dx * reach[0], CHART_Y, this.spot.z + dz * reach[1]));
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }
    Object.assign(this.hit.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    this.top = { x: (x0 + x1) / 2, y: y0 - 6 };
  }

  // ----- Input -----
  grab(e, x, y) {
    this.lastX = x; this.lastY = y; this.lastMove = performance.now();
    if (this.state === "laid") { this.pickUp(); return false; }
    if (this.state !== "wad") return false;
    this.begin(false);
    return true;
  }

  begin(keyboard) {
    this.stage.putDownAll(this);
    this.held = true;
    this.keyboard = keyboard;
    this.state = "holding";
    if (reduceMotion) this.pull(1);
    this.stage.wake();
  }

  drag(e, x, y) {
    if (!this.held) return;
    const now = performance.now();
    const dt = Math.max(0.008, (now - this.lastMove) / 1000);
    const dx = x - this.lastX, dy = y - this.lastY;
    this.lastX = x; this.lastY = y; this.lastMove = now;
    this.pull(Math.hypot(dx, dy) / TUG_PX);
    const maxTilt = reduceMotion ? 0 : 0.3;
    this.tiltX.target = clamp(dy / dt / 1800, -1, 1) * maxTilt;
    this.tiltY.target = clamp(dx / dt / 1800, -1, 1) * maxTilt;
  }

  release() {
    if (!this.held) return;
    this.held = false;
    this.keyboard = false;
    if (this.state === "holding") {
      this.state = "wad";
      this.progress *= SPRING_BACK;
    }
    this.tiltX.target = this.tiltY.target = 0;
  }

  onKeyDown(e) {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (e.repeat || this.held || !this.paper) return;
    if (this.state === "laid") this.pickUp();
    else if (this.state === "open") this.putDown();
    else if (this.state === "wad") this.begin(true);
  }

  pull(amount) {
    if (this.state !== "holding") return;
    this.progress = clamp(this.progress + amount, 0, 1);
    if (this.progress >= 1) this.open();
  }

  // ----- Moves -----
  // Opened for the first time: it stays open from now on.
  open() {
    const byKey = this.keyboard;
    this.held = false;
    this.keyboard = false;
    this.progress = 1;
    this.show();
    this.stage.puff(1);
    if (this.spec.onOpen) this.spec.onOpen();
    // opened from the keyboard, the next thing to reach is what to do with it
    if (byKey) setTimeout(() => this.bar.querySelector("button").focus({ preventScroll: true }), 50);
  }

  pickUp() {
    this.stage.putDownAll(this);
    this.show();
  }

  show() {
    this.state = "open";
    this.bar.dataset.show = "true";
    this.stage.showTip(null);
    this.stage.el.dataset.reading = "true";
    this.stage.announce(this.spec.text);
    this.stage.wake();
  }

  // Put down, it goes through the shredder; once it has gone through, it
  // falls back onto the desk from above. With reduced motion it is simply
  // laid down.
  putDown() {
    if (this.state !== "open") return;
    this.bar.dataset.show = "false";
    this.stage.el.dataset.reading = "false";
    if (reduceMotion || !this.readRect) {
      this.state = "laid";
      this.place();
      this.stage.wake();
      return;
    }
    this.state = "shredding";
    this.paper.object.visible = false;
    const canvas = document.createElement("canvas");
    canvas.className = "shred-canvas";
    canvas.setAttribute("aria-hidden", "true");
    this.stage.overlay.append(canvas);
    shred(canvas, { from: this.readRect, print: this.spec.texture, light: this.stage.light, onFed: () => this.fallIn() })
      .then(() => canvas.remove());
    this.stage.wake();
  }

  // Back from above the top of the room, open, fluttering down to its place.
  fallIn() {
    if (this.stage.disposed) return;
    this.state = "laid";
    this.lift.value = this.lift.target = this.lift.velocity = 0;
    this.drop.y = this.stage.aboveScreen(this.spot.x, this.spot.z);
    this.drop.v = 0;
    this.fluttering = true;
    this.paper.object.visible = true;
    this.place();
    this.stage.wake();
  }

  // ----- Frame -----
  update(dt, t) {
    const { paper } = this;
    if (!paper) return false;
    const instant = reduceMotion;
    if (this.held) this.pull(Math.min(0.25, dt) / HOLD_SECONDS);
    // how crumpled, and where between the desk and the hand
    let fold = WAD * (1 - smooth(this.progress)), crease = 0, lift = 0, print = 0;
    if (this.state === "holding") lift = 0.32 * smooth(this.progress);
    else if (this.state === "open") { fold = 0; crease = CREASE; lift = 1; print = 0.85; }
    else if (this.state === "laid" || this.state === "shredding") { fold = 0; crease = CREASE; }
    paper.fold(fold, crease);
    paper.setPrint(print);
    let moving = paper.update(dt, { foldSeconds: this.state === "holding" || this.state === "wad" ? 0.35 : 0.5, instant });
    this.lift.target = lift;
    moving = advance(this.lift, dt, 0.55, instant) || moving;

    // the wad lifts when hovered and rocks now and then to invite a grab
    this.hoverLift.target = this.hovered && (this.state === "wad" || this.state === "laid") ? 1 : 0;
    moving = advance(this.hoverLift, dt, 0.25, instant) || moving;
    if (this.state === "wad" && !this.hovered && !reduceMotion && t > this.nudgeAt) {
      this.nudgeAt = t + 5 + Math.random() * 4;
      if (this.progress === 0) {
        this.tiltY.velocity += (Math.random() > 0.5 ? 1 : -1) * 3;
        this.tiltX.velocity += (Math.random() - 0.5) * 3;
      }
    }
    // a sheet falling back in rocks and sways on the air until it lands
    const d = this.drop;
    if (this.fluttering) {
      const sway = clamp(d.y / 2.5, 0, 1);
      this.tiltX.target = Math.sin(t * 2.7 + this.index) * 0.35 * sway;
      this.tiltY.target = Math.sin(t * 1.9 + this.index * 2) * 0.5 * sway;
    }
    // a held wad trembles as it is worked open
    if (this.state === "holding" && !reduceMotion) this.tiltX.target += (Math.sin(t * 23) * 0.04 - this.tiltX.target) * 0.2;
    moving = advance(this.tiltX, dt, 0.42, instant) || moving;
    moving = advance(this.tiltY, dt, 0.42, instant) || moving;

    // dropped onto the desk once the room is in view: a wad bounces, an open
    // sheet just settles, and one falling back in drifts down on the air
    if (this.stage.shown && (d.y > 0 || d.v !== 0)) {
      if (this.fluttering) d.v = Math.max(d.v - 9 * dt, -3.6);
      else d.v -= (this.state === "laid" ? 6 : 22) * dt;
      d.y += d.v * dt;
      if (d.y <= 0) {
        d.y = 0;
        d.v = this.state === "wad" && Math.abs(d.v) > 1.2 ? -d.v * 0.32 : 0;
        if (this.fluttering) {
          this.fluttering = false;
          this.tiltX.target = this.tiltY.target = 0;
        }
      }
      moving = true;
    }

    // Nothing moved since the last pose: leave it where it is (and its shadow
    // with it). A change of state counts as moving even when it is instant.
    const sig = `${this.state}|${this.progress.toFixed(3)}|${this.hovered ? 1 : 0}`;
    if (sig !== this.sig) { this.sig = sig; this.posed = true; }
    if (!moving && !this.posed) return false;
    this.posed = moving;
    const k = smooth(clamp(this.lift.value, 0, 1));
    const rest = paper.restHeight() + CHART_Y;
    const drift = this.fluttering ? Math.sin(t * 1.6 + this.index) * 0.5 * clamp(d.y / 2.5, 0, 1) : 0;
    this.pDesk.set(this.spot.x + drift, rest + this.hoverLift.value * 0.14 + d.y, this.spot.z);
    const obj = paper.object;
    obj.position.lerpVectors(this.pDesk, this.pRead, k);
    obj.position.y += this.state === "holding" ? 0.9 * smooth(this.progress) : Math.sin(Math.PI * k) * 1.2;
    obj.quaternion.slerpQuaternions(this.qDesk, this.qRead, k);
    this.wobble.setFromEuler(this.euler.set(this.tiltX.value + this.hoverLift.value * 0.06, this.tiltY.value, 0));
    obj.quaternion.multiply(this.wobble);
    return true;
  }
}

// The pool of darkness round the black flame: deep violet in the middle,
// white (which multiplies to nothing) at the edge.
function pool() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 256, 256);
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgb(70, 48, 92)");
  grad.addColorStop(0.3, "rgb(128, 108, 148)");
  grad.addColorStop(0.62, "rgb(205, 196, 214)");
  grad.addColorStop(1, "#fff");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return c;
}
