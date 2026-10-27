// stage.js — the chart room, in three dimensions.
//
// One WebGL scene holds the whole desk: the walnut top, the sea chart curling
// at its corners, the candle in its chamberstick, and everything that opens a
// section (room-props.js). The candle is the light. Its flame (flame.js) is a
// point light that flickers, leans when the pointer sweeps past and throws
// every prop's shadow across the desk; blow it out and the room goes black
// but for the match the pointer carries. In light mode the room is in
// daylight and the flame burns black, pooling darkness round itself.
//
// The two crumpled notes are paper.js meshes lying on the chart in the same
// light. Hold one and it lifts off the desk and opens in front of you; put it
// down and it lies flat on the chart, creases and all; crumple it and it drops
// back with a bounce.
//
// The labels are real DOM laid into the scene with CSS 3D transforms — the
// prop buttons app.js builds become parchment tags pinned to the desk, and the
// brass plaque is screwed to its front edge — so they stay clickable,
// focusable and readable by screen readers.
//
// start(room) builds it all and resolves to the API desk.js and app.js use,
// or to null when there is no WebGL to be had.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as Props from "./room-props.js";
import { Flame, Dust, HazeShader, flicker } from "./flame.js";
import { PaperNote, WAD, CREASE } from "./paper.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

const HOLD_SECONDS = 1.6;    // holding still opens a note in about this long
const TUG_PX = 2600;         // dragging this far opens it on its own
const SPRING_BACK = 0.88;    // letting go early keeps this much of the progress
const RELIGHT_MS = 2800;     // how long the candle stays out
const CHART_Y = 0.06;        // the chart's surface, where the notes rest

// Where everything stands. `wide` for landscape rooms, `tall` for phones.
// Positions are [x, z, turn] on the desk; tags are the parchment labels.
const LAYOUTS = {
  wide: {
    desk: { w: 28, d: 13.4, z: 0.3 },
    chart: { x: 0, z: 0.45, w: 10.8, d: 7.2, turn: 0.012 },
    candle: [0, -2.2, 0.4],
    notes: { fact: [-2.45, 0.95, 0.1], history: [2.45, 0.95, -0.07] },
    props: {
      artwork: [-6.6, -2.0, 0.42], puzzle: [-6.6, 2.5, -0.2], locate: [6.6, -1.9, 0],
      trivia: [6.4, 2.6, 0.55], movies: [-1.9, 5.2, 0.08], compass: [4.75, 5.25, 0.4], inkwell: [-4.95, 5.0, 0],
      nameplate: [1.55, 6.0, 0]
    },
    tags: {
      artwork: [-6.6, 0.2, 0.05], puzzle: [-6.5, 4.95, -0.04], locate: [6.6, 0.45, -0.05],
      trivia: [6.7, 4.75, 0.05], movies: [-2.0, 6.4, 0]
    },
    bounds: { x: 8.1, back: -4.0, front: 7.0, top: 3.5, bottom: -0.2 },
    elevation: 0.9, fov: 30, noteSize: 2.8, tagScale: 0.0122, labelZ: 1.75
  },
  tall: {
    desk: { w: 15, d: 21.5, z: 0.6 },
    chart: { x: 0, z: -0.9, w: 7.6, d: 8.6, turn: 0.01 },
    candle: [0, -3.8, 0.4],
    notes: { fact: [-1.8, -0.55, 0.08], history: [1.8, -0.55, -0.06] },
    props: {
      artwork: [-3.1, -6.6, 0.25], puzzle: [-2.7, 5.2, -0.15], locate: [3.2, -6.3, 0],
      trivia: [2.8, 5.0, 0.75], movies: [-1.6, 8.3, 0.05], compass: [3.4, 8.3, 0.3], inkwell: [-3.9, 9.7, 0],
      nameplate: [1.1, 10.3, 0]
    },
    tags: {
      artwork: [-3.1, -4.55, 0.04], puzzle: [-2.7, 7.0, -0.03], locate: [3.2, -4.45, -0.04],
      trivia: [2.9, 6.65, 0.04], movies: [-1.6, 9.45, 0]
    },
    bounds: { x: 4.7, back: -8.0, front: 11.3, top: 3.6, bottom: -0.2 },
    elevation: 1.02, fov: 32, noteSize: 2.2, tagScale: 0.0158, labelZ: 1.5
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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
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
    this.daily = window.Daily || {};
    this.hero = room.querySelector(".hero");
    this.light = document.body.classList.contains("light");
    this.layoutName = null;
    this.layout = null;
    this.t = 0;
    this.lit = 1;              // the candle: 1 burning, 0 out
    this.litTarget = 1;
    this.flickState = {};
    this.flick = 1;
    this.lean = 0;
    this.leanVel = 0;
    this.notes = [];
    this.tags = {};
    this.hitOwners = new Map();
    this.hits = [];
    this.pointer = { x: -1, y: -1, inside: false, vx: 0, t: 0, ndc: new THREE.Vector2(), desk: new THREE.Vector3(0, 0, 3), onDesk: false };
    this.parallax = { x: spring(), y: spring() };
    this.busy = false;
    this.idle = 0;
    this.visible = true;
    this.frame = 0;
    this.last = 0;
    this.v = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.api = {
      note: (el, opts) => this.addNote(el, opts),
      open: (id) => this.openProp(id),
      close: (id) => this.closeProp(id),
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
    this.css = new CSS3DRenderer();
    this.css.domElement.className = "stage-css";
    this.overlay = document.createElement("div");
    this.overlay.className = "stage-overlay";
    el.append(this.canvas, this.css.domElement, this.overlay);
    room.prepend(el);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = this.scene = new THREE.Scene();
    this.cssScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 300);
    this.target = new THREE.Vector3();
    this.distance = 30;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: coarse ? 2 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 1.15);
    this.composer.addPass(this.bloom);
    this.haze = new ShaderPass(HazeShader);
    this.composer.addPass(this.haze);
    this.composer.addPass(new OutputPass());

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
    this.sun = new THREE.DirectionalLight(0xfff0da, 2.6);
    this.sun.position.set(-9, 15, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.radius = 4;
    scene.add(this.candleLight, this.matchLight, this.hemi, this.moon, this.sun, this.sun.target);

    // ----- The room and the things in it -----
    const M = this.M = Props.makeMaterials();
    const world = typeof WORLD !== "undefined" ? WORLD.d : "";
    await fontsReady();
    this.chartMap = Props.tex(Props.chartCanvas(world), { aniso: 16 });

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
    this.dust = new Dust(coarse ? 160 : 320, 7.5);
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

    const day = this.daily.dayOfYear || 1;
    this.props = {
      artwork: Props.makeFrame(M),
      puzzle: Props.makeBook(M, day),
      locate: Props.makeGlobe(M, world),
      trivia: Props.makeBottle(M),
      movies: Props.makeSpyglass(M),
      compass: Props.makeCompass(M),
      inkwell: Props.makeInkwell(M),
      nameplate: Props.makeNameplate(M, 4.5)
    };
    for (const [id, p] of Object.entries(this.props)) {
      p.id = id;
      scene.add(p.root);
    }
    this.registerHits(this.candle, "candle");
    for (const p of Object.values(this.props)) if (IDS_OPEN.includes(p.id)) this.registerHits(p, "prop");
    this.loadArtwork();

    // Draw once before taking over any of the page: if a shader won't
    // compile here, the flat desk is still intact to fall back on.
    let broken = false;
    renderer.debug.onShaderError = () => { broken = true; };
    this.applyTheme();
    this.resize();
    this.step(1 / 60);
    this.composer.render(1 / 60);
    if (broken) throw new Error("a shader failed to compile");
    renderer.debug.onShaderError = null;

    this.adoptDom();
    this.applyLayout(this.layoutName, true);
    this.bindEvents();
    this.resize();
    this.el.dataset.ready = "true";
    this.wake();
    this.scheduleWisps();
    setTimeout(() => this.puff(1), 1600);
  }

  // Every so often, a wisp of smoke goes up.
  scheduleWisps() {
    setTimeout(() => {
      if (this.disposed) return;
      if (this.visible && !document.hidden) this.puff(Math.random() < 0.35 ? 1 : 0.5);
      this.scheduleWisps();
    }, 5000 + Math.random() * 4000);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.el) this.el.remove();
    this.renderer.dispose();
  }

  registerHits(owner, kind) {
    owner.kind = kind;
    for (const m of owner.hits) {
      this.hitOwners.set(m, owner);
      this.hits.push(m);
    }
  }

  unregisterHits(owner) {
    this.hits = this.hits.filter((m) => {
      if (this.hitOwners.get(m) !== owner) return true;
      this.hitOwners.delete(m);
      return false;
    });
  }

  // The painting: the generated study at once, the photograph if it comes.
  loadArtwork() {
    const frame = this.props.artwork;
    const art = this.daily.artwork;
    if (!art || typeof Artwork === "undefined") return;
    const toTexture = (img, w, h) => {
      const scale = Math.min(1, 1024 / Math.max(w, h));
      const [cw, ch] = [Math.round(w * scale), Math.round(h * scale)];
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      c.getContext("2d").drawImage(img, 0, 0, cw, ch);
      const t = Props.tex(c);
      frame.setArt(t, cw / ch);
      this.refreshHits(frame);
    };
    try {
      const svg = Artwork.render(art);
      const box = svg.viewBox && svg.viewBox.baseVal;
      const w = (box && box.width) || 400, h = (box && box.height) || 300;
      svg.setAttribute("width", w * 2);
      svg.setAttribute("height", h * 2);
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const img = new Image();
      img.onload = () => { if (!frame.photo) toTexture(img, w * 2, h * 2); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    } catch (e) { /* the frame keeps its dark canvas */ }
    if (this.daily.artPhoto) {
      this.daily.artPhoto().then((src) => {
        if (!src) return;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.referrerPolicy = "no-referrer";
        img.onload = () => { frame.photo = true; toTexture(img, img.naturalWidth, img.naturalHeight); };
        img.src = src;
      });
    }
  }

  refreshHits(p) {
    this.unregisterHits(p);
    this.registerHits(p, "prop");
  }

  // ----- The DOM that lives in the scene -----
  adoptDom() {
    // the parchment tags: app.js's buttons, pinned to the desk
    for (const id of IDS_OPEN) {
      const btn = document.querySelector(`.prop[data-section="${id}"]`);
      if (!btn) continue;
      btn.classList.add("stage-tag");
      const obj = new CSS3DObject(btn);
      this.cssScene.add(obj);
      this.tags[id] = { obj, btn };
      const p = this.props[id];
      p.button = btn;
      const on = () => { p.tagHover = true; };
      const off = () => { p.tagHover = false; };
      btn.addEventListener("pointerenter", on);
      btn.addEventListener("pointerleave", off);
      btn.addEventListener("focus", on);
      btn.addEventListener("blur", off);
    }
    // the plaque on the front of the desk
    const plaque = document.querySelector(".plaque");
    if (plaque) {
      plaque.classList.add("stage-plaque");
      this.plaque = new CSS3DObject(plaque);
      this.cssScene.add(this.plaque);
    }
    // a button over the candle, for the keyboard
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stage-hit stage-candle";
    btn.setAttribute("aria-label", "A candle. Press to blow it out.");
    btn.addEventListener("click", () => this.blowOut());
    this.candleHit = new CSS3DObject(btn);
    this.candleHit.element.style.pointerEvents = "none";
    this.cssScene.add(this.candleHit);
    // sparks off anything clicked (React Bits' ClickSpark)
    this.sparks = window.Bits && Bits.clickSpark ? Bits.clickSpark(this.overlay) : null;
  }

  // ----- Layout -----
  resize() {
    const rect = this.el.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width)), H = Math.max(1, Math.round(rect.height));
    this.W = W; this.H = H;
    const name = W / H < 0.95 ? "tall" : "wide";
    if (name !== this.layoutName) this.applyLayout(name);
    this.renderer.setSize(W, H, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(W, H);
    this.css.setSize(W, H);
    this.camera.aspect = W / H;
    this.fit();
    const pr = this.renderer.getPixelRatio();
    const scale = H * pr / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.flame.setScale(scale);
    this.dust.uniforms.uScale.value = scale;
    this.haze.uniforms.uAspect.value = W / H;
    this.measureView();
    this.wake();
  }

  // How much of the stage is on screen, for sizing a note held up to read.
  measureView() {
    const top = this.el.getBoundingClientRect().top;
    const bottom = Math.min(this.H, window.innerHeight - top);
    if (bottom === this.viewBottom) return;
    this.viewBottom = bottom;
    for (const n of this.notes) n.placeActions();
  }

  applyLayout(name) {
    const L = this.layout = LAYOUTS[name];
    this.layoutName = name;
    this.el.dataset.layout = name;
    const { scene, M } = this;
    if (this.deskMesh) { scene.remove(this.deskMesh); this.deskMesh.traverse((o) => o.geometry && o.geometry.dispose()); }
    if (this.chart) { scene.remove(this.chart); this.chart.geometry.dispose(); }
    this.deskMesh = Props.makeDesk(M, L.desk.w, L.desk.d);
    this.deskMesh.position.z = L.desk.z;
    scene.add(this.deskMesh);
    this.front = L.desk.z + L.desk.d / 2;
    this.chart = Props.makeChart(M, this.chartMap, L.chart.w, L.chart.d);
    this.chart.position.set(L.chart.x, 0, L.chart.z);
    this.chart.rotation.y = L.chart.turn;
    scene.add(this.chart);
    this.wall.position.set(0, 8, L.desk.z - L.desk.d / 2 - 1.5);
    this.camera.fov = L.fov;

    const place = (obj, [x, z, turn]) => { obj.position.set(x, 0, z); obj.rotation.y = turn || 0; };
    place(this.candle.root, L.candle);
    for (const [id, p] of Object.entries(this.props)) place(p.root, L.props[id]);
    for (const [id, tag] of Object.entries(this.tags)) {
      const [x, z, turn] = L.tags[id];
      tag.obj.position.set(x, 0.02, z);
      tag.obj.rotation.set(-Math.PI / 2, 0, turn);
      tag.obj.scale.setScalar(L.tagScale);
    }
    if (this.plaque) {
      const n = this.props.nameplate, f = n.face;
      this.plaque.position.set(n.root.position.x, f.y, n.root.position.z + f.z);
      this.plaque.rotation.set(-(Math.PI / 2 - f.tilt), 0, 0);
      this.plaque.scale.setScalar(0.0098);
    }
    if (this.candleHit) {
      this.candleHit.position.set(L.candle[0], 0.4, L.candle[1]);
      this.candleHit.rotation.x = -Math.PI / 2;
      this.candleHit.scale.setScalar(0.01);
    }
    this.dust.points.position.set(L.candle[0], 0, L.candle[1]);
    this.shade.position.set(L.candle[0], 0.09, L.candle[1]);
    this.shadeSize = name === "tall" ? 8 : 11;
    for (const n of this.notes) n.relayout();
  }

  // The camera looks down on the desk from the front. It is pulled back until
  // everything fits below the heading, then the picture is shifted (a lens
  // shift, not a turn) so the desk sits centred in the space left for it.
  fit() {
    const { camera, layout: L, W, H } = this;
    const heroBottom = this.hero ? this.hero.getBoundingClientRect().bottom - this.el.getBoundingClientRect().top : 0;
    const top = clamp(heroBottom + 4, 0, H * 0.45), bottom = H - 6;
    const box = { left: 8, right: W - 8, top, bottom };
    const b = L.bounds;
    const pts = [];
    for (const x of [-b.x, b.x]) for (const z of [b.back, b.front]) for (const y of [0, b.top]) pts.push(new THREE.Vector3(x, y, z));
    pts.push(new THREE.Vector3(-b.x, b.bottom, b.front), new THREE.Vector3(b.x, b.bottom, b.front));
    this.target.set(0, 0, (b.back + b.front) / 2);
    this.dir = new THREE.Vector3(0, Math.sin(L.elevation), Math.cos(L.elevation));
    camera.clearViewOffset();
    const measure = (d) => {
      camera.position.copy(this.target).addScaledVector(this.dir, d);
      camera.lookAt(this.target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        const s = this.v.copy(p).project(camera);
        const px = (s.x + 1) / 2 * W, py = (1 - s.y) / 2 * H;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      return { x0, x1, y0, y1 };
    };
    let lo = 5, hi = 200;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const m = measure(mid);
      const fits = m.x1 - m.x0 <= box.right - box.left && m.y1 - m.y0 <= box.bottom - box.top;
      if (fits) hi = mid; else lo = mid;
    }
    this.distance = hi;
    const m = measure(hi);
    this.shift = { x: (m.x0 + m.x1) / 2 - (box.left + box.right) / 2, y: (m.y0 + m.y1) / 2 - (box.top + box.bottom) / 2 };
    camera.setViewOffset(W, H, this.shift.x, this.shift.y, W, H);
    camera.updateProjectionMatrix();
    this.contentBox = box;
    this.placeCamera();
  }

  placeCamera() {
    const { camera } = this;
    const yaw = this.parallax.x.value * 0.05, pitch = this.parallax.y.value * 0.03;
    const e = this.layout.elevation + pitch;
    this.dir.set(Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e));
    camera.position.copy(this.target).addScaledVector(this.dir, this.distance);
    camera.lookAt(this.target);
    camera.updateMatrixWorld();
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
    this.hemi.intensity = light ? 1.15 : 0.35;
    this.sun.visible = light;
    this.moon.visible = !light;
    this.candleLight.castShadow = !light;
    this.candleLight.color.set(light ? 0xffe8c8 : 0xffa456);
    renderer.toneMappingExposure = light ? 1.0 : 1.2;
    this.bloom.strength = light ? 0 : 0.55;
    this.bloom.enabled = !light && (this.quality || 0) < 2;
    this.haze.uniforms.uVignette.value = light ? 0.25 : 0.55;
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
    this.wake();
  }

  // ----- Pointer -----
  bindEvents() {
    const { canvas } = this;
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", (e) => this.onUp(e, true));
    canvas.addEventListener("lostpointercapture", (e) => { if (this.grabbed && this.grabbed.pointerId === e.pointerId) this.grabbed.release(); });
    canvas.addEventListener("pointerleave", () => { this.pointer.inside = false; this.setHover(null); });
    window.addEventListener("pointermove", (e) => this.onMove(e), { passive: true });
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("scroll", () => this.measureView(), { passive: true });
    new ResizeObserver(() => this.resize()).observe(this.el);
    new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
      if (this.visible) this.wake();
    }).observe(this.el);
    document.addEventListener("visibilitychange", () => this.wake());
    new MutationObserver(() => {
      if (document.body.classList.contains("light") !== this.light) this.applyTheme();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.body.classList.contains("modal-open")) this.putDownAll();
    });
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
  }

  onMove(e) {
    const p = this.pointer;
    const { x, y, inside } = this.local(e);
    const now = performance.now();
    const dt = Math.max(0.008, (now - p.t) / 1000);
    p.vx = p.t ? (x - p.x) / dt : 0;
    p.x = x; p.y = y; p.t = now;
    p.inside = inside && e.target === this.canvas;
    p.over = inside;
    p.ndc.set((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1);
    if (!reduceMotion && e.pointerType === "mouse") {
      this.parallax.x.target = clamp(p.ndc.x, -1, 1);
      this.parallax.y.target = clamp(p.ndc.y, -1, 1);
    }
    // a fast pass close to the flame shoves it over
    const tip = this.flameScreen;
    if (tip) {
      const near = Math.hypot(x - tip.x, y - tip.y);
      const reach = 240;
      if (near < reach) this.leanVel += clamp(p.vx / 1600, -1, 1) * (1 - near / reach) * 60;
    }
    if (this.grabbed) this.grabbed.drag(e, x, y);
    this.needPick = true;
    this.idle = 0;
    this.wake();
  }

  pick(x, y) {
    this.pointer.ndc.set((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1);
    const ray = this.raycaster || (this.raycaster = new THREE.Raycaster());
    ray.setFromCamera(this.pointer.ndc, this.camera);
    // where the pointer meets the desk, for the match and the compass
    const plane = this.deskPlane || (this.deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
    this.pointer.onDesk = !!ray.ray.intersectPlane(plane, this.pointer.desk);
    const hit = ray.intersectObjects(this.hits, false)[0];
    return hit ? this.hitOwners.get(hit.object) || null : null;
  }

  setHover(owner) {
    if (this.hovered === owner) return;
    if (this.hovered) this.hovered.hovered = false;
    this.hovered = owner;
    if (owner) owner.hovered = true;
    const kind = owner && owner.kind;
    this.canvas.style.cursor = !owner ? "" : kind === "note" ? (owner.state === "wad" || owner.state === "laid" ? "grab" : "") : "pointer";
    for (const [id, tag] of Object.entries(this.tags)) tag.btn.classList.toggle("is-hot", owner === this.props[id]);
  }

  onDown(e) {
    if (e.button !== 0 || !e.isPrimary || this.busy) return;
    const { x, y } = this.local(e);
    const owner = this.pick(x, y);
    this.down = { x, y, owner, id: e.pointerId };
    if (owner && owner.kind === "note") {
      e.preventDefault();
      if (owner.grab(e, x, y)) {
        this.grabbed = owner;
        this.canvas.setPointerCapture(e.pointerId);
        this.canvas.style.cursor = "grabbing";
      }
    }
    this.wake();
  }

  onUp(e, cancelled) {
    const d = this.down;
    this.down = null;
    if (this.grabbed) {
      const g = this.grabbed;
      this.grabbed = null;
      g.release();
      this.canvas.style.cursor = "";
      return;
    }
    if (!d || cancelled) return;
    const { x, y } = this.local(e);
    if (Math.hypot(x - d.x, y - d.y) > 10) return;
    const owner = d.owner;
    if (owner && owner.kind === "prop" && owner.button) {
      if (this.sparks) this.sparks.fire(x, y);
      owner.button.click();
    } else if (owner && owner.kind === "candle") {
      if (this.sparks) this.sparks.fire(x, y, { color: "#ffb35c", count: 12 });
      this.blowOut();
    } else if (!owner || owner.kind !== "note") {
      this.putDownAll();
    }
  }

  // ----- The candle -----
  puff(strength = 1) {
    if (this.lit < 0.5) return;
    this.flame.burst(Math.round(4 + strength * 8), 1 + strength * 0.4);
    this.flame.boost += strength * 6;
    if (typeof Wisps === "undefined" || !this.flameScreen) return;
    const r = this.canvas.getBoundingClientRect();
    const s = this.flameScreen;
    Wisps.puff(r.left + s.x + window.scrollX, r.top + s.y + window.scrollY - 10,
      { count: Math.round(1 + strength * 2), power: 0.8 + strength * 0.4, long: strength >= 1, alpha: 0.32 });
    this.wake();
  }

  blowOut() {
    if (this.litTarget === 0) return;
    this.puff(2.2);
    this.flame.burst(30, 2.6);
    this.litTarget = 0;
    this.candle.ember.material.opacity = 1;
    this.candleHit.element.setAttribute("aria-pressed", "true");
    setTimeout(() => {
      this.litTarget = 1;
      this.flare = 1;
      this.candleHit.element.setAttribute("aria-pressed", "false");
      this.wake();
    }, RELIGHT_MS);
    this.wake();
  }

  // ----- Notes -----
  addNote(el, opts) {
    const rig = new NoteRig(this, el, opts);
    this.notes.push(rig);
    this.registerHits(rig, "note");
    this.wake();
    return rig.adapter;
  }

  putDownAll(except) {
    for (const n of this.notes) if (n !== except) n.putDown();
  }

  // ----- Sections -----
  // The object plays its gesture, and the page is told where on screen it
  // happened, so the section can open out of it.
  async openProp(id) {
    const p = this.props[id];
    if (!p) return null;
    this.putDownAll();
    // scrolled away, there is nothing to see and no frames to play it in
    if (!this.visible || document.hidden) {
      p.open();
      return null;
    }
    this.busy = true;
    this.el.dataset.opening = id;
    if (this.sparks) {
      const r = this.rectOf(p);
      this.sparks.fire(r.x + r.w / 2 - this.canvas.getBoundingClientRect().left, r.y + r.h / 2 - this.canvas.getBoundingClientRect().top, { count: 10 });
    }
    if (id === "trivia" && !reduceMotion) setTimeout(() => this.puff(0.6), 200);
    this.wake();
    await p.open();
    this.busy = false;
    return this.originOf(id);
  }

  closeProp(id) {
    const p = this.props[id];
    delete this.el.dataset.opening;
    if (!p) return;
    p.close();
    this.wake();
  }

  // Where on the page a prop is, as a rect in viewport pixels. The spyglass
  // hands back a small box round its eyepiece, which the lens opens from.
  originOf(id) {
    const p = this.props[id];
    const r = this.canvas.getBoundingClientRect();
    if (id === "movies" && p.eyepiece) {
      const s = this.toScreen(p.eyepiece());
      return { x: r.left + s.x - 20, y: r.top + s.y - 20, w: 40, h: 40 };
    }
    return this.rectOf(p);
  }

  rectOf(p) {
    const r = this.canvas.getBoundingClientRect();
    const box = new THREE.Box3().setFromObject(p.root);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const s = this.toScreen(this.v);
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }
    return { x: r.left + x0, y: r.top + y0, w: x1 - x0, h: y1 - y0 };
  }

  toScreen(world) {
    const s = this.v2.copy(world).project(this.camera);
    return { x: (s.x + 1) / 2 * this.W, y: (1 - s.y) / 2 * this.H };
  }

  // A point in front of the camera: screen pixel (px, py), `depth` units away.
  cameraPoint(px, py, depth, out) {
    out.set((px / this.W) * 2 - 1, -(py / this.H) * 2 + 1, 0.5).applyMatrix4(this.camera.projectionMatrixInverse);
    out.multiplyScalar(-depth / out.z);
    return out.applyMatrix4(this.camera.matrixWorld);
  }

  // ----- The loop -----
  wake() {
    this.idle = 0;
    if (!this.frame && !this.disposed && this.visible && !document.hidden) this.frame = requestAnimationFrame((t) => this.renderFrame(t));
  }

  // While something is moving the room runs at full rate; after a while with
  // nothing going on it ticks over at about 30fps — the flame still dances.
  renderFrame(now) {
    this.frame = 0;
    if (!this.visible || document.hidden) { this.last = 0; return; }
    this.frame = requestAnimationFrame((t) => this.renderFrame(t));
    // under an open dialog the room is only glimpsed through the blur
    const behind = document.body.classList.contains("modal-open") && !this.busy;
    if (this.last && ((behind && now - this.last < 66) || (this.idle > 8 && now - this.last < 30))) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.idle += dt;
    this.step(dt);
    this.composer.render(dt);
    this.css.render(this.cssScene, this.camera);
    if (!behind && this.idle < 8) this.watchSpeed(dt);
  }

  // If the machine can't keep up, give up sharpness first, then the glow and
  // the shimmer, then the shadows. localStorage "daily.quality" = "high"
  // keeps everything on regardless.
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
      r.setPixelRatio(Math.max(1, r.getPixelRatio() * 0.7));
    } else if (this.quality === 2) {
      this.bloom.enabled = false;
      this.haze.enabled = false;
      this.dust.points.visible = false;
    } else {
      r.setPixelRatio(1);
      r.shadowMap.enabled = false;
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
    this.resize();
  }

  step(dt) {
    const t = (this.t += dt);
    const { camera, candle, flame } = this;

    // the camera drifts a little with the pointer
    advance(this.parallax.x, dt, 1.2, reduceMotion);
    advance(this.parallax.y, dt, 1.2, reduceMotion);
    this.placeCamera();

    // the flame: flicker, lean, and whether it is lit
    this.flick = reduceMotion ? 1 : flicker(t, this.flickState);
    // the lean is kept in degrees, as on the flat desk, and handed to the
    // shader as a fraction of the most it can bend
    const idleLean = Math.sin(t * 1.3) * 3 + Math.sin(t * 2.9) * 1.5;
    this.leanVel += (idleLean - this.lean) * 40 * dt;
    this.leanVel *= Math.pow(0.02, dt);
    this.lean = clamp(this.lean + this.leanVel * dt, -28, 28);
    const toward = this.litTarget;
    const rate = toward < this.lit ? 7 : 1.6;
    this.lit = clamp(this.lit + (toward - this.lit) * (1 - Math.exp(-rate * dt)), 0, 1);
    if (this.flare) { this.flare = Math.max(0, this.flare - dt * 1.6); }
    const flare = this.flare ? Math.sin(this.flare * Math.PI) * 0.6 : 0;
    const lit = this.lit * (1 + flare);
    // the flame reaches up when the pointer is near it
    this.roar = (this.roar || 0) + ((this.candle.hovered ? 1 : 0) - (this.roar || 0)) * (1 - Math.exp(-5 * dt));
    if (this.candle.hovered && !reduceMotion) flame.boost = Math.max(flame.boost, 5);
    flame.update(dt, t, camera, { flick: this.flick, lit, lean: this.lean / 28, roar: this.roar });
    const flamePos = this.v.set(0, 0.85, 0);
    flame.group.localToWorld(flamePos);
    const jitter = reduceMotion ? 0 : 0.02;
    this.candleLight.position.set(flamePos.x + Math.sin(t * 9.1) * jitter + this.lean / 28 * 0.12, flamePos.y + Math.sin(t * 13.7) * jitter, flamePos.z + Math.cos(t * 7.3) * jitter);
    this.candleLight.intensity = this.light ? -6 * this.lit * this.flick : 7 * this.flick * lit;
    this.shade.visible = this.light && this.lit > 0.05;
    this.shade.scale.setScalar(this.shadeSize * (0.55 + 0.45 * this.lit) * (1 + (this.flick - 1) * 0.9));
    candle.wax.emissiveIntensity = this.light ? 0 : 0.55 * this.flick * this.lit;
    candle.ember.material.opacity = Math.max(0, candle.ember.material.opacity - dt * 0.35);
    this.dust.update(dt, this.candleLight.position, this.flick, this.lit, reduceMotion);

    // the flame, on screen, for the smoke, the shimmer and the draught
    const tip = this.v2.set(0, 0.55, 0);
    flame.group.localToWorld(tip);
    const s = this.toScreen(tip);
    this.flameScreen = s;
    const above = this.v.set(0, 1.55, 0);
    flame.group.localToWorld(above);
    const s2 = this.toScreen(above);
    const unit = Math.max(4, Math.hypot(s2.x - s.x, s2.y - s.y));
    const hz = this.haze.uniforms;
    hz.uTime.value = t;
    hz.uFlame.value.set(s.x / this.W, 1 - s.y / this.H);
    hz.uSize.value.set(unit * 0.32 / this.W, unit * 1.9 / this.H);
    hz.uStrength.value = this.lit * (reduceMotion ? 0 : 1);
    hz.uSeed.value = reduceMotion ? 0 : (t * 17.13) % 100;

    // what the pointer is over
    const p = this.pointer;
    if (this.needPick && p.inside && !this.grabbed) {
      this.needPick = false;
      this.setHover(this.pick(p.x, p.y));
    } else if (!p.inside && !this.grabbed) {
      this.setHover(null);
    }
    // the match the pointer carries, brighter when the candle is out
    const wantMatch = !this.light && p.over && p.onDesk ? (this.lit < 0.5 ? 10 : 4) : 0;
    this.matchLight.intensity += (wantMatch - this.matchLight.intensity) * (1 - Math.exp(-6 * dt));
    if (p.onDesk) this.matchLight.position.set(p.desk.x, 1.5, p.desk.z + 0.4);

    // the compass needle hunts for the pointer
    const c = this.props.compass;
    if (p.onDesk && p.over) c.point(p.desk);
    else c.point(this.v.set(Math.sin(t * 0.3) * 20, 0, -20));

    for (const prop of Object.values(this.props)) prop.update(dt, t, reduceMotion);
    for (const n of this.notes) n.update(dt, t);
    this.updateTags(t);
  }

  // The tags and the plaque are lit by the candle too: dimmer the further
  // they are from it, and hidden while a note is held up to be read.
  updateTags(t) {
    if (t - (this.tagClock || 0) < 0.1) return;
    this.tagClock = t;
    const reading = this.notes.some((n) => n.state === "open" || n.state === "holding" || n.state === "closing");
    this.el.dataset.reading = reading ? "true" : "false";
    const flame = this.candleLight.position;
    for (const [id, tag] of Object.entries(this.tags)) {
      const d = Math.hypot(tag.obj.position.x - flame.x, tag.obj.position.z - flame.z);
      const level = this.light ? 1 : clamp((1.25 - d / 13) * (0.35 + 0.65 * this.lit) + this.matchNear(tag.obj.position), 0.28, 1);
      tag.btn.style.setProperty("--lit", level.toFixed(2));
    }
    if (this.plaque) {
      const level = this.light ? 1 : clamp(0.55 * (0.4 + 0.6 * this.lit) + this.matchNear(this.plaque.position) * 1.2, 0.3, 1);
      this.plaque.element.style.setProperty("--lit", level.toFixed(2));
    }
  }

  matchNear(pos) {
    const p = this.pointer;
    if (!p.onDesk || !p.over || this.light) return 0;
    const d = Math.hypot(pos.x - p.desk.x, pos.z - p.desk.z);
    return clamp(1 - d / 3.2, 0, 1) * 0.6;
  }
}

const IDS_OPEN = ["artwork", "puzzle", "locate", "trivia", "movies"];

// ----- A note, on the desk and in the hand -----
// wad → holding → open (held up to read) → laid (flat on the chart) → open …
// and from anywhere, closing: balled up, then dropped back on the desk.
class NoteRig {
  constructor(stage, el, opts) {
    this.stage = stage;
    this.el = el;
    this.opts = opts;
    this.id = el.id === "historyNote" ? "history" : "fact";
    this.side = this.id === "history" ? 1 : -1;
    this.paper = new PaperNote({
      texture: opts.texture, seed: opts.seed, size: stage.layout.noteSize,
      anisotropy: Math.min(8, stage.renderer.capabilities.getMaxAnisotropy())
    });
    this.hits = this.paper.hits;
    stage.scene.add(this.paper.object);
    this.state = "wad";
    this.progress = 0;
    this.lift = spring(0);
    this.hoverLift = spring(0);
    this.tiltX = spring(); this.tiltY = spring();
    this.drop = { y: reduceMotion ? 0 : 5 + Math.random(), v: 0 };
    this.held = false;
    this.keyboard = false;
    this.pointerId = null;
    this.nudgeAt = 3 + Math.random() * 3;
    this.qDesk = new THREE.Quaternion();
    this.qRead = new THREE.Quaternion();
    this.pDesk = new THREE.Vector3();
    this.pRead = new THREE.Vector3();
    this.adoptDom();
    this.relayout();
    this.applyTheme();
    this.adapter = {
      crumple: () => this.crumple(),
      setTexture: (canvas) => this.paper.setTexture(canvas),
      focus: () => this.hit.focus({ preventScroll: true })
    };
  }

  // The kicker and the hint are written on the chart in front of the note;
  // the buttons appear under it when it is held up.
  adoptDom() {
    const { el, stage } = this;
    const label = this.label = document.createElement("div");
    label.className = "note-label";
    const head = el.querySelector(".note-head"), hint = el.querySelector(".note-hint");
    if (head) label.append(head);
    if (hint) label.append(hint);
    this.labelObj = new CSS3DObject(label);
    this.labelObj.element.style.pointerEvents = "none";
    stage.cssScene.add(this.labelObj);

    const hit = this.hit = document.createElement("button");
    hit.type = "button";
    hit.className = "stage-hit paper-hit";
    hit.setAttribute("aria-label", `${this.opts.label}. Press and hold to unfold it — Space or Enter works too.`);
    hit.addEventListener("keydown", (e) => this.onKeyDown(e));
    hit.addEventListener("keyup", (e) => {
      if (this.keyboard && (e.key === " " || e.key === "Enter")) { e.preventDefault(); this.release(); }
    });
    hit.addEventListener("blur", () => { if (this.keyboard) this.release(); });
    this.hitObj = new CSS3DObject(hit);
    this.hitObj.element.style.pointerEvents = "none";
    stage.cssScene.add(this.hitObj);

    const bar = this.bar = document.createElement("div");
    bar.className = "note-bar";
    const actions = el.querySelector(".note-actions");
    if (actions) {
      bar.append(actions);
      const down = actions.querySelector("[data-action=down]");
      if (down) down.addEventListener("click", () => { this.putDown(); this.hit.focus({ preventScroll: true }); });
    }
    stage.overlay.append(bar);
    // the flat desk is hidden, and a live region inside it would never speak
    const live = el.querySelector(".note-live");
    if (live) stage.overlay.append(live);
    // mirror the note's state onto the pieces that left it
    const mirror = () => { label.dataset.state = el.dataset.state; };
    new MutationObserver(mirror).observe(el, { attributes: true, attributeFilter: ["data-state", "style"] });
    mirror();
    el.classList.add("note-adopted");
  }

  relayout() {
    const L = this.stage.layout;
    const [x, z, turn] = L.notes[this.id];
    this.spot = { x, z, turn };
    this.paper.sheet.scale.setScalar(L.noteSize);
    this.qDesk.setFromEuler(new THREE.Euler(0, turn, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    this.labelObj.position.set(x, 0.05, z + L.labelZ);
    this.labelObj.rotation.set(-Math.PI / 2, 0, turn * 0.5);
    this.labelObj.scale.setScalar(this.stage.layoutName === "tall" ? 0.0125 : L.tagScale * 0.95);
    this.hitObj.position.set(x, 0.05, z);
    this.hitObj.rotation.set(-Math.PI / 2, 0, 0);
    this.hitObj.scale.setScalar(0.012);
    this.placeActions();
  }

  applyTheme() {
    this.tint = this.stage.light ? new THREE.Color(1, 1, 1) : new THREE.Color(1.0, 0.9, 0.76);
    this.paper.setPrint(this.paper.print.target, this.tint);
  }

  // Held up to be read: a little toward its own side, as large as the part of
  // the room on screen allows with the buttons still fitting underneath. On a
  // phone it is held right up, over the heading.
  readPose() {
    const st = this.stage;
    const wide = st.W > st.H * 1.1;
    const top = wide ? st.contentBox.top + 4 : 12;
    const bottom = Math.max(top + 160, Math.min(st.H, st.viewBottom || st.H) - 66);
    const avail = bottom - top;
    const h = Math.min(avail * (wide ? 0.96 : 0.92), st.W * 0.9 * this.paper.aspect);
    const px = st.W / 2 + (wide ? this.side * Math.min(st.W * 0.14, 220) : 0);
    const py = top + avail / 2;
    const sheetH = this.paper.size * this.paper.aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(st.camera.fov / 2));
    const depth = sheetH * st.H / (2 * tanHalf * h);
    st.cameraPoint(px, py, depth, this.pRead);
    this.qRead.copy(st.camera.quaternion);
    this.readRect = { x: px, y: py, h, w: h / this.paper.aspect };
  }

  placeActions() {
    if (!this.stage.contentBox) return;
    this.readPose();
    const r = this.readRect;
    this.bar.style.left = `${r.x}px`;
    this.bar.style.top = `${r.y + r.h / 2 + 12}px`;
  }

  // ----- Input -----
  grab(e, x, y) {
    this.pointerId = e.pointerId;
    this.lastX = x; this.lastY = y; this.lastMove = performance.now();
    if (this.state === "laid") { this.pickUp(); return false; }
    if (this.state !== "wad") return false;
    this.stage.putDownAll(this);
    this.held = true;
    this.keyboard = false;
    this.state = "holding";
    if (reduceMotion) this.pull(1);
    return true;
  }

  drag(e, x, y) {
    if (!this.held || e.pointerId !== this.pointerId) return;
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
    this.pointerId = null;
    if (this.state === "holding") {
      this.state = "wad";
      this.progress *= SPRING_BACK;
      this.report();
    }
    this.tiltX.target = this.tiltY.target = 0;
  }

  onKeyDown(e) {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (e.repeat || this.held) return;
    if (this.state === "laid") { this.pickUp(); return; }
    if (this.state === "open") { this.putDown(); return; }
    if (this.state !== "wad") return;
    this.stage.putDownAll(this);
    this.held = true;
    this.keyboard = true;
    this.state = "holding";
    if (reduceMotion) this.pull(1);
    this.stage.wake();
  }

  pull(amount) {
    if (this.state !== "holding") return;
    this.progress = clamp(this.progress + amount, 0, 1);
    this.report();
    if (this.progress >= 1) this.open();
  }

  report() {
    this.el.style.setProperty("--progress", this.progress.toFixed(3));
    this.label.style.setProperty("--progress", this.progress.toFixed(3));
    if (this.opts.onProgress) this.opts.onProgress(this.progress);
  }

  // ----- Moves -----
  open() {
    const byKey = this.keyboard;
    this.held = false;
    this.keyboard = false;
    this.state = "open";
    this.progress = 1;
    this.report();
    this.bar.dataset.show = "true";
    if (this.opts.onOpen) this.opts.onOpen();
    // opened from the keyboard, the next thing to reach is what to do with it
    if (byKey) {
      const first = this.bar.querySelector("button:not([hidden])");
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
    }
    this.stage.wake();
  }

  pickUp() {
    this.stage.putDownAll(this);
    this.state = "open";
    this.bar.dataset.show = "true";
    this.stage.wake();
  }

  putDown() {
    if (this.state !== "open") return;
    this.state = "laid";
    this.bar.dataset.show = "false";
    this.stage.wake();
  }

  // Ball it up in the hand, then drop it on the desk where it was.
  crumple() {
    this.held = false;
    this.bar.dataset.show = "false";
    const wasUp = this.lift.value > 0.3;
    this.state = "closing";
    this.progress = 0;
    this.report();
    this.stage.wake();
    const settle = reduceMotion ? 0 : wasUp ? 1150 : 650;
    return new Promise((resolve) => setTimeout(() => {
      this.state = "wad";
      resolve();
    }, settle));
  }

  // ----- Frame -----
  update(dt, t) {
    const { paper } = this;
    const instant = reduceMotion;
    // how crumpled, and where between the desk and the hand
    let fold = WAD * (1 - smooth(this.progress)), crease = 0, lift = 0, print = 0;
    if (this.held) this.pull(Math.min(0.25, dt) / HOLD_SECONDS);
    switch (this.state) {
      case "holding": lift = 0.32 * smooth(this.progress); break;
      case "open": fold = 0; crease = CREASE; lift = 1; print = 0.85; break;
      case "laid": fold = 0; crease = CREASE; lift = 0; print = 0; break;
      case "closing": {
        fold = WAD;
        lift = paper.folded > WAD * 0.8 ? 0 : this.lift.target;
        break;
      }
    }
    paper.fold(fold, crease);
    paper.setPrint(print);
    let moving = paper.update(dt, { foldSeconds: this.state === "closing" ? 0.5 : this.state === "open" || this.state === "laid" ? 0.5 : 0.35, instant });
    const wasUp = this.lift.value;
    this.lift.target = lift;
    moving = advance(this.lift, dt, this.state === "open" ? 0.55 : 0.5, instant) || moving;
    if (wasUp > 0.05 && this.lift.value <= 0.05 && this.lift.target === 0 && paper.folded > 0.5 && !instant) this.drop.v = Math.max(this.drop.v, 2.2);

    // the wad lifts when hovered and rocks now and then to invite a grab
    this.hoverLift.target = this.hovered && (this.state === "wad" || this.state === "laid") ? 1 : 0;
    moving = advance(this.hoverLift, dt, 0.25, instant) || moving;
    if (this.state === "wad" && !this.hovered && !reduceMotion && t > this.nudgeAt) {
      this.nudgeAt = t + 4 + Math.random() * 2;
      if (this.progress === 0) {
        this.tiltY.velocity += (Math.random() > 0.5 ? 1 : -1) * 3;
        this.tiltX.velocity += (Math.random() - 0.5) * 3;
      }
    }
    if (this.state === "holding" && !reduceMotion) {
      // a held wad trembles as it is worked open
      this.tiltX.target += (Math.sin(t * 23) * 0.04 - this.tiltX.target) * 0.2;
    }
    moving = advance(this.tiltX, dt, 0.42, instant) || moving;
    moving = advance(this.tiltY, dt, 0.42, instant) || moving;

    // a dropped note bounces
    const d = this.drop;
    if (d.y > 0 || d.v !== 0) {
      d.v -= 22 * dt;
      d.y += d.v * dt;
      if (d.y <= 0) {
        d.y = 0;
        d.v = Math.abs(d.v) > 1.2 ? -d.v * 0.32 : 0;
      }
      moving = true;
    }

    // pose
    const k = smooth(clamp(this.lift.value, 0, 1));
    const rest = paper.restHeight() + CHART_Y;
    this.pDesk.set(this.spot.x, rest + this.hoverLift.value * 0.14 + d.y, this.spot.z);
    this.readPose();
    const obj = paper.object;
    obj.position.lerpVectors(this.pDesk, this.pRead, k);
    obj.position.y += Math.sin(Math.PI * k) * 1.2 * (this.state === "holding" ? 0 : 1) + (this.state === "holding" ? 0.9 * smooth(this.progress) : 0);
    obj.quaternion.slerpQuaternions(this.qDesk, this.qRead, k);
    const wob = this.wobble || (this.wobble = new THREE.Quaternion());
    wob.setFromEuler(new THREE.Euler(this.tiltX.value + this.hoverLift.value * 0.06, this.tiltY.value, 0));
    obj.quaternion.multiply(wob);
    return moving;
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

// The canvas textures want the web fonts, or they print in the fallback face.
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wanted = ['30px "IM Fell English SC"', 'italic 15px "IM Fell English"'];
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  return Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f))), timeout]).catch(() => {});
}
