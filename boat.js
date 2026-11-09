// boat.js — where the desk ends up: a rowboat, alone on the open sea, with a
// hole in its bottom and a sailor with a bucket.
//
// stage.js brings this in when the candle's flame is clicked and the desk
// goes over. The room floods, and we come up for air beside the boat. Water
// spouts in through the hole the whole time and the boat sits lower and lower
// in the sea; rub the pointer back and forth over the sailor (or press Space)
// and they bail, a bucketful at a time. Leave them to it and the boat swamps
// and goes under, and a button brings it back up to try again.
//
// The deeper the boat sits, the harder the sea pushes in through the hole —
// so a boat let go fills faster and faster — and the leak slowly worsens the
// longer it stays afloat.
//
// It isn't a quiet sea. Sharks circle the boat, more of them the longer it
// lasts and closer the lower it sits, and now and then one leaps clear of the
// water. Every so often a big wave rolls in, heaves the boat up and slops
// water in over the bow. A lantern hangs off the stern.
//
// All of it is drawn on one 2D canvas from a handful of shapes; nothing is
// loaded. start({ onCovered }) brings it in; onCovered is called once the
// flood hides the room behind it, so the room can stop.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

const BEST_KEY = "daily.boat.best";
const FLOOD_S = 1.3, UNDER_S = 0.5, SURFACE_S = 1.4;   // the room flooding, and coming up
const BAIL_RATE = 1.5;        // most bucketfuls a second, however fast the rubbing
const RUB_PER_BAIL = 0.9;     // how far to rub, in boat lengths, for one bucketful
const BUCKET = 0.07;          // a bucketful, as a share of what swamps the boat
const LEAK = 0.024;           // what comes in a second through the hole of an empty boat
const LEAK_DEEP = 0.036;      // and how much more once it is sitting low, full
const WORSEN_S = 150;         // the leak is twice as bad after this long afloat
const GRACE_S = 1.5;          // no water comes in while the boat is first bobbing up
const WAVE_FIRST = 22;        // seconds afloat before the first big wave
const WAVE_EVERY = [30, 45];  // and between the ones after
const WAVE_SLOSH = 0.12;      // what a big wave slops into the boat
const SHARKS_AT = [0, 20, 45]; // seconds afloat at which each shark turns up
const LEAP_EVERY = [14, 26];  // seconds between sharks leaping

// The boat is drawn in its own frame, one unit to its length, bow to the
// right, y down. `wl` is where in that frame the sea's surface comes to.
const WL_EMPTY = 0.0, WL_FULL = -0.1, WL_GONE = -0.64, WL_BOTTOM = -1.7;
const SAILOR_X = 0.05;        // where the sailor sits
const SAILOR_HIP = -0.075;    // and how high, in the boat
const SAILOR_SCALE = 1.2;     // drawn this much bigger than the poses are worked out
const LEAVE_S = 1.0;          // closing in on the sun (or moon) on the way back to the desk
const HOLE = { x: 0.2, y: 0.06 };

const PALETTES = {
  dark: {
    sky: ["#02040b", "#0a1530", "#1f3459"], stars: true,
    orb: "#f4ecd6", orbGlow: ["rgba(200, 215, 255, 0.14)", "rgba(200, 215, 255, 0)"],
    far: ["#132a4c", "#0d2142"], sea: ["#0f2747", "#04101f"],
    front: ["rgba(8, 26, 54, 0.5)", "rgba(2, 8, 20, 0.93)"],
    foam: "rgba(200, 222, 255, 0.5)", glint: "rgba(235, 240, 255, 0.85)", line: "rgba(160, 190, 240, 0.12)",
    drop: "rgba(175, 210, 255, 0.95)", inside: "rgba(40, 84, 140, 0.92)", insideTop: "rgba(150, 190, 240, 0.75)",
    hull: ["#5c3620", "#2c180b"], strake: "rgba(0, 0, 0, 0.32)", rail: "#7d4f2c", railLit: "rgba(200, 215, 255, 0.28)",
    interior: "#1d0f07", seat: "#6a4225", oar: "#8a6440",
    coat: "#d29d22", coatDark: "#8d6612", skin: "#d9ae88", ink: "#140f0b", cheek: "rgba(220, 90, 70, 0.3)",
    bucket: "#8e9aa6", bucketDark: "#56616c", rings: "rgba(200, 222, 255, 0.45)", scrapShade: 0.62,
    flood: ["#1e4678", "#040e20"],
    cloud: { body: "#1c2947", shade: "#0e162b", rim: "rgba(185, 205, 245, 0.5)", rimClear: "rgba(185, 205, 245, 0)", shadeClear: "rgba(14, 22, 43, 0)", alpha: 0.62 },
    bands: ["#16314f", "#13304f", "#11294a"], crest: "rgba(165, 195, 245, 0.22)", haze: "rgba(70, 100, 150, 0.25)",
    streak: "rgba(140, 180, 240, 0.07)", waveFace: ["rgba(120, 170, 235, 0.3)", "rgba(60, 110, 180, 0)"],
    shark: "#2b3644", sharkLit: "#56677a", belly: "#b9c3cf", sharkDeep: "rgba(2, 8, 20, 0.5)",
    stripe: "#74291f", name: "#e3d6b8", brass: "#b08a3c", rivet: "rgba(0, 0, 0, 0.45)", rope: "#9c8358",
    lantern: 0.34, gulls: false,
    seaMid: "#0a1d38", lit: "rgba(90, 140, 210, 0.3)", litClear: "rgba(90, 140, 210, 0)", ripple: "rgba(150, 190, 245, 0.42)", rippleDark: "rgba(0, 8, 24, 0.35)",
    sparkle: "rgba(235, 242, 255, 0.95)", shadow: "rgba(0, 4, 12, 0.45)", orbRing: "rgba(220, 230, 255, 0.5)",
    coatLit: "#ecbf48", coatLine: "#5e430b", skinLit: "#ebc6a1", skinDark: "#b08260", skinLine: "rgba(80, 42, 20, 0.55)",
    beard: "#7a6858", beardLit: "rgba(225, 210, 190, 0.45)", beardDark: "#45382d", mouth: "#3a1a14", nose: "#d48d77",
    iris: "#3d6b8f", sweat: "rgba(190, 225, 255, 0.9)", toggle: "#e2d4b6", jumper: "#2c4566"
  },
  light: {
    sky: ["#7fa3c2", "#bccfd9", "#ece3cf"], stars: false,
    orb: "#fffaea", orbGlow: ["rgba(255, 250, 230, 0.55)", "rgba(255, 250, 230, 0)"],
    far: ["#6f94ae", "#5b84a2"], sea: ["#4b7899", "#1f4566"],
    front: ["rgba(44, 96, 136, 0.45)", "rgba(16, 46, 76, 0.9)"],
    foam: "rgba(255, 255, 255, 0.8)", glint: "rgba(255, 255, 255, 0.95)", line: "rgba(255, 255, 255, 0.22)",
    drop: "rgba(225, 243, 255, 0.98)", inside: "rgba(66, 128, 178, 0.9)", insideTop: "rgba(210, 236, 252, 0.85)",
    hull: ["#8d5632", "#552f18"], strake: "rgba(0, 0, 0, 0.24)", rail: "#b27848", railLit: "rgba(255, 245, 225, 0.35)",
    interior: "#3a2214", seat: "#9a6740", oar: "#b08654",
    coat: "#f0bb2e", coatDark: "#b0801a", skin: "#f0c9a0", ink: "#241a10", cheek: "rgba(230, 100, 80, 0.35)",
    bucket: "#a9b4bf", bucketDark: "#6b7682", rings: "rgba(255, 255, 255, 0.6)", scrapShade: 1,
    flood: ["#4678a0", "#143454"],
    cloud: { body: "#ffffff", shade: "#dbe4ec", rim: "rgba(255, 255, 255, 0.95)", rimClear: "rgba(255, 255, 255, 0)", shadeClear: "rgba(219, 228, 236, 0)", alpha: 0.92 },
    bands: ["#7598b1", "#6b90ab", "#6489a6"], crest: "rgba(255, 255, 255, 0.32)", haze: "rgba(235, 228, 212, 0.35)",
    streak: "rgba(220, 240, 255, 0.08)", waveFace: ["rgba(215, 240, 255, 0.4)", "rgba(120, 180, 220, 0)"],
    shark: "#4a5866", sharkLit: "#7d8d9c", belly: "#e6ebf0", sharkDeep: "rgba(10, 40, 70, 0.4)",
    stripe: "#b23d2d", name: "#f7efdc", brass: "#c9a24c", rivet: "rgba(0, 0, 0, 0.35)", rope: "#c2a670",
    lantern: 0.12, gulls: true,
    seaMid: "#33607f", lit: "rgba(175, 220, 245, 0.38)", litClear: "rgba(175, 220, 245, 0)", ripple: "rgba(255, 255, 255, 0.5)", rippleDark: "rgba(16, 52, 84, 0.28)",
    sparkle: "rgba(255, 255, 255, 1)", shadow: "rgba(10, 34, 58, 0.4)", orbRing: "rgba(255, 246, 220, 0.85)",
    coatLit: "#ffd45e", coatLine: "#80590e", skinLit: "#fcdcbd", skinDark: "#d09e78", skinLine: "rgba(110, 58, 28, 0.5)",
    beard: "#8b7765", beardLit: "rgba(248, 238, 222, 0.5)", beardDark: "#57473a", mouth: "#4a2018", nose: "#e89d86",
    iris: "#3f7aa6", sweat: "rgba(205, 238, 255, 0.95)", toggle: "#f3e6ca", jumper: "#33557c"
  }
};

// The bail, as poses through one bucketful: [at, bucket x, bucket y, bucket
// turn, how far the sailor leans in]. The sailor faces the stern (left);
// they reach down into the boat, scoop, lift it and fling it out over the
// side.
const POSES = [
  [0.0, -0.08, -0.17, 0.0, 0.0],
  [0.22, -0.13, -0.065, 0.35, 0.55],
  [0.4, -0.105, -0.075, -0.25, 0.48],
  [0.6, -0.1, -0.29, 0.05, -0.05],
  [0.76, -0.25, -0.28, -1.0, 0.25],
  [0.86, -0.29, -0.25, -2.1, 0.32],
  [1.0, -0.08, -0.17, 0.0, 0.0]
];
const POUR_AT = 0.84;

export function start(options) {
  return new Sea(options || {});
}

class Sea {
  constructor({ onCovered = () => {} }) {
    this.onCovered = onCovered;
    this.instant = reduceMotion;
    this.buildDom();
    this.palette();
    this.resize();
    this.t = 0;
    this.phase = this.instant ? "afloat" : "flood";
    this.phaseT = 0;
    this.water = 0;
    this.wl = this.instant ? WL_EMPTY : -0.9;
    this.wlV = 0;
    this.sinkV = 0;
    this.tilt = 0;
    this.grace = GRACE_S;
    this.bail = 0;
    this.push = 0;
    this.bails = 0;
    this.lastBail = 0;
    this.afloat = 0;
    this.best = loadBest();
    this.drops = [];      // flung from the bucket, in the sea's frame
    this.jet = [];        // spouting through the hole, in the boat's frame
    this.rings = [];
    this.bubbles = [];
    this.floaters = [];   // the hat and the bucket, once the boat has gone
    this.blinkAt = 2;
    this.stars = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random() * 0.55, r: rand(0.4, 1.3), s: Math.random() * TAU }));
    const colors = ["#a9c9ef", "#f4adc2", "#f4cf6a", "#a5dcb3", "#c9b4ee"];
    // the notes, or what is left of them, drifting off
    this.scraps = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random(), d: i < 5 ? rand(0.2, 0.85) : 1, size: rand(0.6, 1.2), color: colors[i % colors.length],
      drift: rand(-0.004, 0.004), turn: rand(-0.5, 0.5), seed: Math.random() * TAU
    }));
    // the sky: clouds drifting over, gulls by day, a falling star now and then
    // by night
    this.clouds = Array.from({ length: 6 }, (_, i) => {
      const y = rand(0.12, 0.78);
      return { x: rand(-0.25, 1.1), y, scale: rand(0.75, 1.2) * (1.25 - 0.6 * y), speed: rand(0.004, 0.011), seed: 17 + i * 31 };
    });
    this.gulls = Array.from({ length: 3 }, () => ({ x: Math.random(), y: rand(0.1, 0.3), s: rand(0.7, 1.2), speed: rand(0.012, 0.03), phase: rand(0, TAU) }));
    this.meteor = null;
    this.meteorAt = rand(4, 9);
    // the sharks, the big wave, and a shark's leap
    this.sharks = [];
    this.leap = null;
    this.leapAt = rand(...LEAP_EVERY);
    this.wave = null;
    this.waveAt = WAVE_FIRST;
    this.alertUntil = 0;
    this.flicker = 1;
    this.orbHot = 0;
    this.orbHover = false;
    this.leaving = null;
    this.stats = { bails: 0, waves: 0, leaps: 0 };
    this.last = 0;
    this.frame = requestAnimationFrame((now) => this.tick(now));
    if (this.instant) {
      requestAnimationFrame(() => { this.el.dataset.in = "true"; });
      setTimeout(() => this.onCovered(), 450);
      this.showHud();
    }
  }

  // ----- The page -----
  buildDom() {
    const el = this.el = document.createElement("section");
    el.className = "boat";
    el.setAttribute("aria-label", "Adrift: a leaking rowboat");
    el.dataset.instant = this.instant ? "true" : "false";
    const canvas = this.canvas = document.createElement("canvas");
    canvas.className = "boat-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "A small rowboat on the open sea, water spouting up through a hole in its bottom, and a sailor in it with a bucket.");
    canvas.tabIndex = 0;
    this.g = canvas.getContext("2d");

    const hud = this.hud = document.createElement("p");
    hud.className = "boat-hud";
    hud.setAttribute("aria-hidden", "true");
    const alert = this.alert = document.createElement("p");
    alert.className = "boat-alert";
    alert.setAttribute("aria-hidden", "true");
    const hint = this.hint = document.createElement("p");
    hint.className = "boat-hint";
    hint.textContent = "Rub back and forth over the sailor to help them bail";

    // Gone under: a page from the ship's log, with a sketch of what is left
    // floating and how the voyage went.
    const sunk = this.sunk = document.createElement("div");
    sunk.className = "boat-sunk";
    sunk.hidden = true;
    sunk.setAttribute("role", "dialog");
    sunk.setAttribute("aria-labelledby", "boatSunkTitle");
    sunk.innerHTML = `
      <svg class="boat-sunk-art" viewBox="0 0 240 70" aria-hidden="true">
        <path class="boat-sunk-sea" d="M0 44 Q 15 38 30 44 T 60 44 T 90 44 T 120 44 T 150 44 T 180 44 T 210 44 T 240 44 V70 H0 Z"/>
        <path class="boat-sunk-swell" d="M0 44 Q 15 38 30 44 T 60 44 T 90 44 T 120 44 T 150 44 T 180 44 T 210 44 T 240 44"/>
        <g class="boat-sunk-hat"><path d="M-15 4 A 15 15 0 0 1 15 4 Z"/><path d="M-21 5 Q 0 1 22 5 Q 27 8 28 13 Q 12 8 -21 9 Z"/></g>
        <g class="boat-sunk-bucket"><path d="M-8 -9 L 8 -9 L 6 7 L -6 7 Z"/><path class="boat-sunk-wire" d="M-8 -9 Q 0 -20 8 -9"/></g>
        <g class="boat-sunk-fin"><path d="M-10 4 Q -2 -12 10 -20 Q 6 -8 10 4 Z"/><path class="boat-sunk-wake" d="M10 4 Q 24 2 36 0 M10 5 Q 24 7 36 9"/></g>
        <g class="boat-sunk-bubbles"><circle cx="122" cy="56" r="2.5"/><circle cx="128" cy="62" r="1.8"/><circle cx="117" cy="64" r="1.4"/></g>
      </svg>
      <p class="boat-sunk-kicker"></p>
      <h2 id="boatSunkTitle">The boat went under.</h2>
      <p class="boat-sunk-line"></p>
      <dl class="boat-log"></dl>
      <div class="boat-sunk-row"></div>`;
    this.sunkKicker = sunk.querySelector(".boat-sunk-kicker");
    this.sunkTime = sunk.querySelector(".boat-sunk-line");
    this.sunkLog = sunk.querySelector(".boat-log");
    const row = sunk.querySelector(".boat-sunk-row");
    const reset = this.resetBtn = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn-solid";
    reset.textContent = "Reset";
    reset.addEventListener("click", () => this.reset());
    const back = document.createElement("a");
    back.className = "btn btn-ghost";
    back.href = "index.html";
    back.textContent = "Back to the desk";
    back.addEventListener("click", (e) => { e.preventDefault(); this.leave(); });
    row.append(reset, back);

    // The way back to the desk at any time: the sun (or the moon) in the sky,
    // with a label when the pointer is on it — and, for the keyboard, a
    // button that shows itself when it has focus, or Escape.
    const tip = this.tip = document.createElement("p");
    tip.className = "boat-orb-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.textContent = "back to the desk";
    const home = document.createElement("button");
    home.type = "button";
    home.className = "boat-home btn btn-ghost";
    home.textContent = "Back to the desk";
    home.addEventListener("click", () => this.leave());

    this.live = document.createElement("p");
    this.live.className = "sr-only";
    this.live.setAttribute("aria-live", "polite");
    const how = document.createElement("p");
    how.className = "sr-only";
    how.textContent = "Rub the pointer over the sailor, or press Space, to bail water out of the boat before it sinks. Click the sun or the moon, or press Escape, to go back to the desk.";
    el.append(home, canvas, hud, alert, hint, tip, sunk, how, this.live);
    document.body.append(el);
    document.body.classList.add("at-sea");

    this.pointer = null;
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerdown", (e) => {
      const p = this.local(e);
      if (this.onOrb(p)) { this.leave(); return; }
      this.pointer = p;
      this.onMove(e);
    });
    canvas.addEventListener("pointerleave", () => { this.pointer = null; this.orbHover = false; this.tip.dataset.show = "false"; this.canvas.style.cursor = ""; });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { this.leave(); return; }
      if (e.key !== " " || this.phase !== "afloat" || e.target.closest("button, a")) return;
      e.preventDefault();
      if (!e.repeat) this.rub(0.4);
    });
    window.addEventListener("resize", () => this.resize());
    new MutationObserver(() => this.palette()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !this.frame) { this.last = 0; this.frame = requestAnimationFrame((now) => this.tick(now)); }
    });
  }

  palette() {
    this.P = PALETTES[document.body.classList.contains("light") ? "light" : "dark"];
  }

  resize() {
    const W = this.W = window.innerWidth, H = this.H = window.innerHeight;
    // the sea is soft-edged and always moving; it doesn't need every pixel
    const dpr = this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.L = Math.max(160, Math.min(W * 0.74, H * 0.72, 640));
    this.seaBase = H * (W < H ? 0.64 : 0.62);
    this.horizonGap = H * 0.22;
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Rubbing over the sailor is what makes them bail: so far rubbed, so many
  // bucketfuls, no faster than they could really manage.
  onMove(e) {
    if (this.leaving != null) return;
    const p = this.local(e);
    const was = this.pointer;
    this.pointer = p;
    const s = this.sailorAt;
    const over = s && this.phase === "afloat" && Math.hypot(p.x - s.x, p.y - s.y) < this.L * 0.21;
    this.orbHover = !over && this.onOrb(p);
    this.tip.dataset.show = this.orbHover ? "true" : "false";
    this.canvas.style.cursor = over ? "grab" : this.orbHover ? "pointer" : "";
    if (!over || !was) return;
    const dist = Math.hypot(p.x - was.x, p.y - was.y);
    if (dist < 120) this.rub(dist / (this.L * RUB_PER_BAIL));
  }

  // Is this point on the sun (or moon)? A little generous, for fingers.
  onOrb(p) {
    const o = this.orbAt;
    return !!o && this.phase !== "flood" && this.phase !== "under" && Math.hypot(p.x - o.x, p.y - o.y) < Math.max(o.r * 1.7, 26);
  }

  // Back to the desk: the sea closes in on the sun, as the desk opens round
  // its candle, and the desk is loaded again.
  leave() {
    if (this.leaving != null) return;
    this.leaving = 0;
    this.el.dataset.leaving = "true";
    this.tip.dataset.show = "false";
    this.canvas.style.cursor = "";
    this.live.textContent = "Back to the desk.";
    if (reduceMotion || this.phase === "flood" || this.phase === "under") window.location.assign("index.html");
  }

  rub(amount) {
    this.push = Math.min(0.75, this.push + amount);
  }

  showHud() {
    this.hud.dataset.show = "true";
    this.hint.dataset.show = "true";
  }

  reset() {
    this.sunk.hidden = true;
    this.phase = "afloat";
    this.water = 0;
    this.wl = Math.min(this.wl, -0.9);
    this.wlV = 0;
    this.sinkV = 0;
    this.grace = GRACE_S;
    this.bail = 0;
    this.push = 0;
    this.afloat = 0;
    this.floaters = [];
    this.bubbles = [];
    this.jet = [];
    this.wave = null;
    this.waveAt = WAVE_FIRST;
    this.stats = { bails: 0, waves: 0, leaps: 0 };
    this.hud.dataset.show = "true";
    this.canvas.focus({ preventScroll: true });
    this.live.textContent = "The boat bobs back up, empty — for now.";
  }

  // ----- The sea -----
  surf(x, calm = false) {
    const { L, t } = this;
    const A = Math.min(L * 0.035, this.H * 0.03) * (reduceMotion ? 0.4 : 1);
    let y = this.seaNow + A * (
      0.55 * Math.sin(x * TAU / (L * 2.2) - t * 0.9) +
      0.3 * Math.sin(x * TAU / (L * 1.1) + t * 0.62 + 1.7) +
      0.15 * Math.sin(x * TAU / (L * 0.42) - t * 1.7 + 0.4));
    // the big wave, its front (to the left, the way it goes) steeper than
    // its back
    const wv = this.wave;
    if (wv && wv.A > 0 && !calm) {
      const u = (x - wv.c) / wv.w;
      y -= wv.A * Math.exp(-u * u * (u < 0 ? 3.2 : 0.9));
    }
    return y;
  }

  // How far out a shark circles, and where it is: round the boat on a ring
  // that runs behind it (higher up the screen, smaller) and in front of it.
  sharkRing(s) {
    return this.L * (0.62 + 0.38 * s.ring) * (s.close ?? 1);
  }

  sharkAt(s) {
    const { L, boat } = this;
    const x = boat.x + Math.cos(s.a) * this.sharkRing(s) * 1.15;
    const z = Math.sin(s.a), zo = z * L * 0.17;
    return { x, y: this.surf(x) + zo, z, zo, scale: (1 + 0.22 * z) * s.size, facing: -Math.sin(s.a) * s.dir >= 0 ? 1 : -1 };
  }

  sendWave() {
    const { L, W } = this;
    const w = L * 0.55;
    this.wave = { c: W + w * 1.4, w, max: L * (reduceMotion ? 0.12 : 0.26), v: -(W + w * 3.6) / 5, age: 0, A: 0, hit: false };
    this.waveAt = this.afloat + rand(...WAVE_EVERY);
    this.say("A big wave is rolling in!");
  }

  say(text) {
    this.alert.textContent = text;
    this.alert.dataset.show = "true";
    this.alertUntil = this.t + 2.8;
    this.live.textContent = text;
  }

  // water thrown up: a burst of spray, and a ring where it hit
  splash(at, n, dir = 0, zo = 0) {
    const { L } = this;
    for (let i = 0; i < n; i++) {
      this.drops.push({
        x: at.x + rand(-0.04, 0.04) * L, y: at.y, zo, spray: true, r: rand(0.004, 0.01) * L,
        vx: (dir * rand(0.1, 0.6) + rand(-0.3, 0.3)) * L, vy: -rand(0.35, 1.0) * L
      });
    }
    this.rings.push({ x: at.x, y: this.surf(at.x) + zo, age: 0, size: L * 0.08 });
  }

  // where the boat is: riding the swell, its waterline on the sea
  pose() {
    const { L, W, t } = this;
    // a little left of centre, for the oar sticking out past the bow
    const x = W / 2 - L * 0.08 + Math.sin(t * 0.11) * L * 0.03;
    const ys = this.surf(x - 0.38 * L), yb = this.surf(x + 0.38 * L), ym = this.surf(x);
    const angle = Math.atan2(yb - ys, 0.76 * L) * 0.85 + this.tilt;
    const y = (ys + yb + 2 * ym) / 4 - this.wl * L;
    return { x, y, angle, cos: Math.cos(angle), sin: Math.sin(angle) };
  }

  // a point in the boat's frame, in the sea's
  toSea(b, lx, ly) {
    const { L } = this;
    return { x: b.x + (lx * b.cos - ly * b.sin) * L, y: b.y + (lx * b.sin + ly * b.cos) * L };
  }

  // ----- The loop -----
  tick(now) {
    this.frame = 0;
    if (document.hidden) return;
    this.frame = requestAnimationFrame((n) => this.tick(n));
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.step(dt);
    this.draw();
  }

  step(dt) {
    this.t += dt;
    this.phaseT += dt;
    const { L } = this;
    // the flood, and coming up
    if (this.phase === "flood" && this.phaseT > FLOOD_S) { this.phase = "under"; this.phaseT = 0; this.onCovered(); }
    if (this.phase === "under" && this.phaseT > UNDER_S) { this.phase = "surface"; this.phaseT = 0; }
    if (this.phase === "surface" && this.phaseT > SURFACE_S) { this.phase = "afloat"; this.phaseT = 0; this.showHud(); }
    const coming = this.phase === "surface" ? smooth(clamp(this.phaseT / SURFACE_S, 0, 1)) : 1;
    this.seaNow = lerp(-this.H * 0.06, this.seaBase, 1 - Math.pow(1 - coming, 2.4));
    this.flicker = 0.86 + 0.09 * Math.sin(this.t * 13.1) + 0.05 * Math.sin(this.t * 31.7);
    if (this.leaving != null && (this.leaving += dt) > LEAVE_S && !this.gone) {
      this.gone = true;
      window.location.assign("index.html");
    }
    if (this.alertUntil && this.t > this.alertUntil) { this.alert.dataset.show = "false"; this.alertUntil = 0; }

    // the big wave: it rolls in from the right, under the boat and away
    if (this.phase === "afloat" && !this.wave && this.afloat > this.waveAt) this.sendWave();
    const wv = this.wave;
    if (wv) {
      wv.age += dt;
      wv.c += wv.v * dt;
      wv.A = wv.max * smooth(clamp(wv.age / 1.1, 0, 1)) * smooth(clamp((wv.c + wv.w * 2.2) / (wv.w * 1.6), 0, 1));
      if (wv.c < -wv.w * 2.2) this.wave = null;
    }

    // water in through the hole, harder the lower the boat sits, and out
    // again by the bucketful
    if (this.phase === "afloat") {
      this.grace -= dt;
      if (this.grace <= 0) {
        this.afloat += dt;
        const leak = (LEAK + LEAK_DEEP * this.water) * (1 + this.afloat / WORSEN_S);
        this.water = Math.min(1, this.water + leak * dt);
      }
      const step = Math.min(this.push, BAIL_RATE * dt);
      this.push -= step;
      if (step > 0) this.lastBail = this.t;
      const before = this.bail;
      this.bail += step;
      if (Math.floor(this.bail - POUR_AT) > Math.floor(before - POUR_AT)) this.pour();
      // left alone for a while with water rising, the hint comes back
      if (this.bails >= 3 && this.water > 0.45 && this.t - this.lastBail > 6) this.hint.dataset.show = "true";
      if (this.water >= 1) this.swamp();
    }

    // how low it sits: a spring, so it bobs when it is emptied or pops up
    let target = lerp(WL_EMPTY, WL_FULL, this.water);
    if (this.phase === "swamping" || this.phase === "sunk") {
      this.sinkV += 0.045 * dt;
      this.sinkTo = Math.max(WL_BOTTOM, (this.sinkTo ?? WL_FULL) - this.sinkV * dt);
      target = this.sinkTo;
      this.tilt += (-0.2 - this.tilt) * (1 - Math.exp(-0.8 * dt));
      if (this.phase === "swamping" && this.wl < WL_GONE) this.goneUnder();
    } else {
      this.tilt += (0 - this.tilt) * (1 - Math.exp(-3 * dt));
    }
    this.wlV += ((target - this.wl) * 26 - this.wlV * 5.5) * dt;
    this.wl += this.wlV * dt;

    const b = this.boat = this.pose();
    const chest = sailorPoint(SAILOR_X - 0.05, -0.2);
    this.sailorAt = this.toSea(b, chest.x, chest.y);

    // the big wave breaking over the bow slops water in, and throws spray off
    // its crest the whole way
    if (wv && !wv.hit && wv.c < b.x + L * 0.3) {
      wv.hit = true;
      if (this.phase === "afloat" && wv.A > wv.max * 0.5) {
        this.water = Math.min(1, this.water + WAVE_SLOSH);
        this.stats.waves += 1;
        this.tilt += 0.1;
        this.splash(this.toSea(b, 0.42, -0.2), 46, -1);
      }
    }
    if (wv && wv.A > wv.max * 0.6 && !reduceMotion) {
      for (let i = 0; i < 2; i++) {
        const x = wv.c - wv.w * 0.1 + rand(-0.15, 0.15) * wv.w;
        this.drops.push({ x, y: this.surf(x) - 2, vx: wv.v * 0.35 + rand(-40, 40), vy: -rand(0.15, 0.45) * L, r: rand(0.003, 0.007) * L, spray: true });
      }
    }

    // sharks: turning up one by one, circling, and closing in as the boat
    // sits lower
    if (this.phase === "afloat" && this.grace <= 0) {
      const want = SHARKS_AT.filter((at) => this.afloat >= at).length;
      while (this.sharks.length < want) {
        this.sharks.push({ a: rand(0, TAU), dir: Math.random() < 0.5 ? -1 : 1, ring: rand(0.7, 1), speed: rand(0.3, 0.42), seed: rand(0, TAU), size: rand(0.9, 1.1), up: 0 });
      }
    }
    const close = this.phase === "swamping" || this.phase === "sunk" ? 0.45 : 1 - 0.3 * this.water;
    for (const s of this.sharks) {
      s.up = Math.min(1, s.up + dt * 0.5);
      s.close = (s.close ?? close) + (close - (s.close ?? close)) * (1 - Math.exp(-0.6 * dt));
      if (!s.leaping) s.a += s.dir * s.speed * (reduceMotion ? 0.5 : 1) * dt;
    }
    // and now and then one leaps clear, behind the boat
    if (this.phase === "afloat" && !this.leap && this.t > this.leapAt && !reduceMotion) {
      const s = this.sharks.find((x) => Math.sin(x.a) < -0.4 && Math.abs(Math.cos(x.a)) < 0.7 && x.up >= 1);
      if (s) {
        const at = this.sharkAt(s);
        this.leap = { s, x0: at.x, zo: at.zo, dir: at.facing, k: 0, D: L * 0.7, H: L * 0.21, size: L * 0.36 * at.scale };
        s.leaping = true;
        this.stats.leaps += 1;
        this.splash(at, 18, at.facing, at.zo);
      } else this.leapAt = this.t + 1;
    }
    if (this.leap) {
      const lp = this.leap;
      lp.k += dt / 1.25;
      if (lp.k >= 1) {
        const x = lp.x0 + lp.dir * lp.D, s = lp.s;
        this.splash({ x, y: this.surf(x) + lp.zo }, 26, lp.dir, lp.zo);
        // back to circling, from where it came down
        s.dir = lp.dir;
        s.a = -Math.acos(clamp((x - b.x) / (this.sharkRing(s) * 1.15), -1, 1));
        s.leaping = false;
        this.leap = null;
        this.leapAt = this.t + rand(...LEAP_EVERY);
      }
    }

    // the sky
    for (const c of this.clouds) c.x = c.x > 1.25 ? -0.4 : c.x + c.speed * dt;
    for (const gl of this.gulls) gl.x = (gl.x + gl.speed * dt) % 1.2;
    if (this.P.stars && !this.meteor && this.t > this.meteorAt && !reduceMotion) {
      this.meteor = { x: rand(0.1, 0.6), y: rand(0.04, 0.25), vx: rand(0.35, 0.55), vy: rand(0.1, 0.2), age: 0 };
    }
    if (this.meteor && (this.meteor.age += dt) > 0.9) { this.meteor = null; this.meteorAt = this.t + rand(6, 14); }

    // the spout: from the hole, up past the gunwale and back down inside
    const afloatish = this.phase === "afloat" || this.phase === "surface";
    this.spout = 0;
    if (afloatish && this.wl > -0.25) {
      // the deeper the hole is under the sea, the higher it spouts
      const depth = HOLE.y - this.wl;
      this.spout = Math.min(0.42, 0.27 + 1.2 * Math.max(0, depth - 0.06)) * (1 + 0.05 * Math.sin(this.t * 9) + 0.03 * Math.sin(this.t * 23));
      this.spoutClock = (this.spoutClock || 0) + dt * (reduceMotion ? 20 : 70);
      while (this.spoutClock > 1) {
        this.spoutClock -= 1;
        this.jet.push({ x: HOLE.x + rand(-0.008, 0.008), y: HOLE.y - this.spout, vx: rand(-0.16, 0.16), vy: rand(-0.3, 0.02), r: rand(0.004, 0.009) });
      }
    }
    for (const d of this.jet) { d.vy += 3 * dt; d.x += d.vx * dt; d.y += d.vy * dt; }
    this.jet = this.jet.filter((d) => !(d.vy > 0 && d.y > -0.08));

    // what was flung overboard, falling into the sea
    for (const d of this.drops) {
      d.vy += L * 2.6 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.vy > 0 && d.y > this.surf(d.x) + (d.zo || 0)) {
        d.dead = true;
        if (!d.spray) {
          if (Math.random() < 0.35) this.rings.push({ x: d.x, y: this.surf(d.x), age: 0, size: rand(0.03, 0.07) * L });
          if (Math.random() < 0.3) this.drops.push({ x: d.x, y: d.y - 2, vx: rand(-0.15, 0.15) * L, vy: -rand(0.25, 0.5) * L, r: d.r * 0.7, spray: true });
        }
      }
    }
    this.drops = this.drops.filter((d) => !d.dead);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 0.9);

    // bubbles from the boat once it has gone, and from the flood
    if ((this.phase === "swamping" || this.phase === "sunk") && this.wl < -0.2 && this.wl > -1.4 && Math.random() < dt * 22) {
      const at = this.toSea(b, rand(-0.4, 0.4), rand(-0.3, 0.05));
      if (at.y > this.surf(at.x) + 4) this.bubbles.push({ x: at.x, y: at.y, r: rand(0.006, 0.02) * L, vy: -rand(0.25, 0.5) * L, seed: Math.random() * TAU });
    }
    for (const u of this.bubbles) {
      u.y += u.vy * dt;
      u.x += Math.sin(this.t * 6 + u.seed) * 12 * dt;
      if (this.phase === "afloat" || this.phase === "swamping" || this.phase === "sunk") {
        if (u.y < this.surf(u.x)) { u.dead = true; if (Math.random() < 0.5) this.rings.push({ x: u.x, y: this.surf(u.x), age: 0, size: u.r * 2 }); }
      } else if (u.y < -20) u.dead = true;
    }
    this.bubbles = this.bubbles.filter((u) => !u.dead);

    // the hat and the bucket, left floating
    for (const f of this.floaters) {
      const s = this.surf(f.x) - f.ride * L;
      f.vy += (f.y < s ? L * 2 : -(f.y - s) * 30 - f.vy * 4) * dt;
      f.y += f.vy * dt;
      f.x += f.vx * dt;
      f.vx *= Math.exp(-0.4 * dt);
      const slope = Math.atan2(this.surf(f.x + 10) - this.surf(f.x - 10), 20);
      f.turn += (slope + f.lean - f.turn) * (1 - Math.exp(-3 * dt));
    }

    for (const s of this.scraps) s.x = (s.x + s.drift * dt + 1.2) % 1.2;
    if (this.t > this.blinkAt) this.blinkAt = this.t + rand(2, 5);
    this.updateHud();
  }

  // A bucketful over the side.
  pour() {
    const amount = Math.min(this.water, BUCKET);
    this.water -= amount;
    this.bails += 1;
    this.stats.bails += 1;
    if (this.bails === 3) this.hint.dataset.show = "false";
    const b = this.boat;
    const p = posed(POUR_AT);
    const lip = sailorPoint(SAILOR_X + p.x + 0.03 * Math.sin(p.turn), p.y - 0.03 * Math.cos(p.turn));
    const mouth = this.toSea(b, lip.x, lip.y);
    const n = Math.round(8 + 22 * (amount / BUCKET));
    for (let i = 0; i < n; i++) {
      const dir = { x: -rand(0.55, 1.05), y: -rand(0.1, 0.5) };
      this.drops.push({
        x: mouth.x + rand(-4, 4), y: mouth.y + rand(-4, 4),
        vx: (dir.x * b.cos - dir.y * b.sin) * this.L, vy: (dir.x * b.sin + dir.y * b.cos) * this.L,
        r: rand(0.005, 0.012) * this.L
      });
    }
  }

  // Full to the gunwale: the sea comes in over it and down it goes.
  swamp() {
    this.phase = "swamping";
    this.phaseT = 0;
    this.sinkV = 0.012;
    this.sinkTo = this.wl;
    this.push = 0;
    this.hint.dataset.show = "false";
    // the bucket is let go
    const b = this.boat;
    const held = sailorPoint(SAILOR_X - 0.08, -0.17);
    const at = this.toSea(b, held.x, held.y);
    this.floaters.push({ kind: "bucket", x: at.x, y: at.y, vx: -this.L * 0.18, vy: 0, turn: 0, lean: 0.5, ride: 0.012 });
    this.live.textContent = "The boat has swamped, and it is going down.";
  }

  goneUnder() {
    this.phase = "sunk";
    this.phaseT = 0;
    const best = Math.max(this.best, this.afloat);
    const record = this.afloat > this.best + 0.5 && this.best > 0;
    this.best = best;
    saveBest(best);
    this.hud.dataset.show = "false";
    this.sunkTime.textContent = record ? `Kept afloat for ${clock(this.afloat)} — your longest yet.` : `Kept afloat for ${clock(this.afloat)}.`;
    const day = (window.Daily && window.Daily.shortDate) || new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    this.sunkKicker.textContent = `Ship's log · ${day}`;
    const lines = [
      ["Time afloat", clock(this.afloat)],
      ["Longest afloat", clock(this.best)],
      ["Bucketfuls bailed", String(this.stats.bails)],
      ["Big waves weathered", String(this.stats.waves)],
      ["Sharks circling", String(this.sharks.length)],
      ["Sharks seen leaping", String(this.stats.leaps)]
    ];
    this.sunkLog.replaceChildren(...lines.map(([name, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = name;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }));
    setTimeout(() => {
      if (this.phase !== "sunk") return;
      this.sunk.hidden = false;
      this.resetBtn.focus({ preventScroll: true });
      this.live.textContent = `The boat went under after ${clock(this.afloat)}. Press Reset to try again.`;
    }, 900);
  }

  updateHud() {
    if (this.phase !== "afloat") return;
    const text = `afloat ${clock(this.afloat)}${this.best > 0 ? `  ·  longest ${clock(this.best)}` : ""}`;
    if (text !== this.hudText) this.hud.textContent = this.hudText = text;
  }

  // ----- Drawing -----
  draw() {
    const { g, dpr, W, H } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.phase === "flood") return this.drawFlood(clamp(this.phaseT / FLOOD_S, 0, 1));
    if (this.phase === "under") return this.drawUnder(1);
    this.drawScene();
    if (this.leaving != null && this.orbAt) {
      // closing in on the sun, its edge glowing like the candle's light
      const o = this.orbAt, k = smooth(clamp(this.leaving / LEAVE_S, 0, 1));
      const far = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y));
      const r = far * Math.pow(1 - k, 1.6);
      g.fillStyle = document.body.classList.contains("light") ? "#e9dcc6" : "#050302";
      g.beginPath();
      g.rect(0, 0, W, H);
      if (r > 0.5) g.arc(o.x, o.y, r, 0, TAU, true);
      g.fill("evenodd");
      if (r > 0.5) {
        g.strokeStyle = "rgba(255, 170, 90, 0.55)";
        g.lineWidth = 3;
        g.beginPath(); g.arc(o.x, o.y, r, 0, TAU); g.stroke();
      }
    }
    if (this.phase === "surface") {
      // the last of the water running off the eyes
      const k = clamp(this.phaseT / SURFACE_S, 0, 1);
      g.fillStyle = this.P.flood[1];
      g.globalAlpha = Math.pow(1 - k, 3) * 0.8;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  // The room fills: the water rises up the screen over it.
  drawFlood(k) {
    const { g, W, H, t, P } = this;
    const level = lerp(H + 40, -70, k * k * (1.6 - 0.6 * k));
    const top = (x) => level + Math.sin(x * 0.011 + t * 5) * 16 + Math.sin(x * 0.029 - t * 7.5) * 7;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 12; x += 12) g.lineTo(x, top(x));
    g.lineTo(W, H);
    g.closePath();
    const grad = g.createLinearGradient(0, level - 20, 0, H);
    grad.addColorStop(0, P.flood[0]);
    grad.addColorStop(1, P.flood[1]);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = P.foam;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= W + 12; x += 12) (x ? g.lineTo(x, top(x)) : g.moveTo(x, top(x)));
    g.stroke();
    // air caught in it, tumbling up
    if (Math.random() < 0.9) this.bubbles.push({ x: Math.random() * W, y: H + 10, r: rand(2, 9), vy: -rand(200, 520), seed: Math.random() * TAU });
    this.drawBubbles((u) => u.y > top(u.x));
  }

  drawUnder() {
    const { g, W, H, t, P } = this;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, P.flood[0]);
    grad.addColorStop(1, P.flood[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // light coming down through it
    g.fillStyle = "rgba(255, 255, 255, 0.05)";
    for (let i = 0; i < 6; i++) {
      const x = (i / 6 + Math.sin(t * 0.7 + i) * 0.03) * W;
      g.beginPath();
      g.moveTo(x - 20, 0); g.lineTo(x + 30, 0); g.lineTo(x + 140, H); g.lineTo(x + 60, H);
      g.fill();
    }
    if (Math.random() < 0.8) this.bubbles.push({ x: Math.random() * W, y: H + 10, r: rand(2, 9), vy: -rand(200, 520), seed: Math.random() * TAU });
    this.drawBubbles(() => true);
  }

  drawScene() {
    const { g, W, H, P, t, L } = this;
    const horizon = this.seaNow - this.horizonGap;
    const dy = this.seaNow - this.seaBase;

    // the sky, and the moon (or a pale sun)
    const sky = g.createLinearGradient(0, horizon - H * 0.6, 0, horizon);
    sky.addColorStop(0, P.sky[0]);
    sky.addColorStop(0.6, P.sky[1]);
    sky.addColorStop(1, P.sky[2]);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, Math.max(0, horizon + 2));
    if (P.stars) {
      for (const s of this.stars) {
        const y = s.y * H + dy;
        if (y > horizon) continue;
        g.globalAlpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.s * 7));
        g.fillStyle = "#e8eeff";
        g.fillRect(s.x * W, y, s.r, s.r);
      }
      g.globalAlpha = 1;
    }
    if (P.stars && this.meteor) {
      // a falling star
      const m = this.meteor, k = m.age / 0.9;
      const x = (m.x + m.vx * m.age) * W, y = (m.y + m.vy * m.age) * H + dy;
      const tail = g.createLinearGradient(x, y, x - m.vx * W * 0.25, y - m.vy * H * 0.25);
      tail.addColorStop(0, `rgba(240, 245, 255, ${0.9 * Math.sin(Math.PI * k)})`);
      tail.addColorStop(1, "rgba(240, 245, 255, 0)");
      g.strokeStyle = tail;
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - m.vx * W * 0.25, y - m.vy * H * 0.25); g.stroke();
    }
    const orb = { x: W * 0.76, y: this.seaBase * 0.3 + dy, r: Math.max(14, Math.min(W, H) * 0.035) };
    // the clouds pass behind the sun (and the moon): it is the way home, and
    // is never hidden
    this.drawClouds(horizon);
    const glow = g.createRadialGradient(orb.x, orb.y, orb.r * 0.5, orb.x, orb.y, orb.r * 7);
    glow.addColorStop(0, P.orbGlow[0]);
    glow.addColorStop(1, P.orbGlow[1]);
    g.fillStyle = glow;
    g.fillRect(orb.x - orb.r * 7, orb.y - orb.r * 7, orb.r * 14, orb.r * 14);
    this.orbAt = orb;
    if (this.orbHover) {
      this.tip.style.left = `${orb.x}px`;
      this.tip.style.top = `${orb.y + orb.r * 1.7 + 6}px`;
    }
    this.drawOrb(orb);
    // a faint ring round it, breathing, that brightens under the pointer:
    // it is the way back to the desk
    this.orbHot += ((this.orbHover ? 1 : 0) - this.orbHot) * 0.18;
    g.strokeStyle = P.orbRing;
    g.lineWidth = 1.5 + this.orbHot;
    g.globalAlpha = 0.18 + 0.12 * Math.sin(t * 1.6) + 0.6 * this.orbHot;
    g.beginPath(); g.arc(orb.x, orb.y, orb.r * (1.35 + 0.06 * Math.sin(t * 1.6) + 0.15 * this.orbHot), 0, TAU); g.stroke();
    g.globalAlpha = 1;
    if (P.gulls) {
      // gulls, wheeling far off
      g.strokeStyle = "rgba(48, 58, 70, 0.7)";
      g.lineWidth = 1.5;
      g.lineCap = "round";
      for (const gl of this.gulls) {
        const x = gl.x * W * 1.2 - W * 0.1, y = gl.y * H + dy + Math.sin(t * 0.8 + gl.phase) * 6;
        const w = 9 * gl.s, f = Math.sin(t * 6 + gl.phase);
        g.beginPath();
        g.moveTo(x - w, y - f * w * 0.35);
        g.quadraticCurveTo(x - w * 0.45, y - w * 0.5 - f * w * 0.2, x, y);
        g.quadraticCurveTo(x + w * 0.45, y - w * 0.5 - f * w * 0.2, x + w, y - f * w * 0.35);
        g.stroke();
      }
    }

    // the far sea, out to the horizon, with lines of swell coming in
    const far = g.createLinearGradient(0, horizon, 0, this.seaNow);
    far.addColorStop(0, P.far[0]);
    far.addColorStop(1, P.far[1]);
    g.fillStyle = far;
    g.fillRect(0, horizon, W, H - horizon);
    const haze = g.createLinearGradient(0, horizon - 24, 0, horizon + 18);
    haze.addColorStop(0, "rgba(0, 0, 0, 0)");
    haze.addColorStop(0.55, P.haze);
    haze.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = haze;
    g.fillRect(0, horizon - 24, W, 42);
    // rows of swell, one behind another, each catching the light on its crest
    [0.14, 0.36, 0.64].forEach((f, j) => {
      const y0 = horizon + (this.seaNow - horizon) * f, amp = 1.5 + 5 * f, len = 70 + 190 * f;
      const line = [];
      for (let x = -16; x <= W + 16; x += 16) {
        line.push(x, y0 + Math.sin(x / len * TAU + t * (0.25 + 0.4 * f) + j * 2) * amp + Math.sin(x / (len * 0.43) * TAU - t * 0.6 + j) * amp * 0.35);
      }
      g.beginPath();
      g.moveTo(-16, H);
      for (let i = 0; i < line.length; i += 2) g.lineTo(line[i], line[i + 1]);
      g.lineTo(W + 16, H);
      g.closePath();
      g.fillStyle = P.bands[j];
      g.fill();
      g.strokeStyle = P.crest;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < line.length; i += 2) i ? g.lineTo(line[i], line[i + 1]) : g.moveTo(line[i], line[i + 1]);
      g.stroke();
    });
    g.strokeStyle = P.line;
    g.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const k = i / 7, y = horizon + (this.seaNow - horizon) * k * k + 3;
      g.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const yy = y + Math.sin(x * 0.02 / (0.3 + k) + t * (0.4 + k) + i) * (1 + 3 * k);
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    }
    // the light's path across the water
    g.fillStyle = P.glint;
    for (let i = 0; i < 40; i++) {
      const k = i / 40, y = horizon + (H - horizon) * k * k + 2;
      const w = (4 + 46 * k) * (0.3 + 0.7 * Math.abs(Math.sin(t * 0.9 + i * 2.3)));
      const x = orb.x + Math.sin(i * 12.9898 + t * 0.35) * (6 + 70 * k) - w / 2;
      g.globalAlpha = 0.4 * (1 - k * 0.5) * Math.pow(Math.abs(Math.sin(t * 1.3 + i * 4.1)), 2);
      g.fillRect(x, y, w, 1 + 1.5 * k);
    }
    g.globalAlpha = 1;
    // the notes, far out, drifting
    for (const s of this.scraps) if (s.d < 1) this.drawScrap(s, horizon);

    // the sea itself, behind the boat
    const surface = () => {
      g.beginPath();
      g.moveTo(-10, H + 10);
      for (let x = -10; x <= W + 10; x += 8) g.lineTo(x, this.surf(x));
      g.lineTo(W + 10, H + 10);
      g.closePath();
    };
    surface();
    const sea = g.createLinearGradient(0, this.seaNow - L * 0.05, 0, H);
    sea.addColorStop(0, P.sea[0]);
    sea.addColorStop(0.4, P.seaMid);
    sea.addColorStop(1, P.sea[1]);
    g.fillStyle = sea;
    g.fill();
    // the boat's shadow on the water beneath it
    if (this.wl > -0.5) {
      const bx = this.boat.x, by = this.surf(bx) + L * 0.035;
      g.save();
      g.translate(bx, by);
      g.scale(1, 0.14);
      const shade = g.createRadialGradient(0, 0, 0, 0, 0, L * 0.62);
      shade.addColorStop(0, P.shadow);
      shade.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = shade;
      g.beginPath(); g.arc(0, 0, L * 0.62, 0, TAU); g.fill();
      g.restore();
    }

    // the sharks on the far side of the boat, and one leaping
    this.drawSharks(false);

    this.drawBoat();

    // flung water, each drop catching the light, and where it lands
    g.fillStyle = P.drop;
    for (const d of this.drops) { g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill(); }
    g.fillStyle = "rgba(255, 255, 255, 0.85)";
    for (const d of this.drops) {
      if (d.r < 2.2) continue;
      g.beginPath(); g.arc(d.x - d.r * 0.32, d.y - d.r * 0.32, d.r * 0.32, 0, TAU); g.fill();
    }
    g.strokeStyle = P.rings;
    for (const r of this.rings) {
      const k = r.age / 0.9;
      g.globalAlpha = 1 - k;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(r.x, r.y + 2, r.size * (0.4 + k), r.size * (0.4 + k) * 0.22, 0, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;

    // the water in front: over the hull below the waterline, and over the
    // whole of the boat once it has gone down
    surface();
    const front = g.createLinearGradient(0, this.seaNow, 0, this.seaNow + L * 0.9);
    front.addColorStop(0, P.front[0]);
    front.addColorStop(1, P.front[1]);
    g.fillStyle = front;
    g.fill();
    // the top of the water, lit from above where it is thin
    g.beginPath();
    for (let x = -10, first = true; x <= W + 10; x += 8, first = false) first ? g.moveTo(x, this.surf(x)) : g.lineTo(x, this.surf(x));
    for (let x = W + 10; x >= -10; x -= 8) g.lineTo(x, this.surf(x) + L * 0.08);
    g.closePath();
    const band = g.createLinearGradient(0, this.seaNow - L * 0.05, 0, this.seaNow + L * 0.09);
    band.addColorStop(0, P.lit);
    band.addColorStop(1, P.litClear);
    g.fillStyle = band;
    g.fill();
    // light moving about under the surface
    g.strokeStyle = P.streak;
    g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const depth = L * (0.08 + i * 0.07), mid = (t * (14 + i * 5) + i * 137) % (W + 400) - 200;
      g.beginPath();
      for (let x = mid - 160, first = true; x <= mid + 160; x += 16, first = false) {
        const y = this.surf(x) + depth + Math.sin(x * 0.02 + t + i) * 4;
        first ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    this.drawRipples();
    this.drawSparkles();
    // the edge of the water, brightest along the crests
    g.strokeStyle = P.foam;
    g.lineCap = "butt";
    g.lineWidth = 1.5;
    g.globalAlpha = 0.45;
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 8) (x > -10 ? g.lineTo(x, this.surf(x)) : g.moveTo(x, this.surf(x)));
    g.stroke();
    g.lineWidth = 2.2;
    g.globalAlpha = 0.75;
    g.beginPath();
    for (let x = -10, on = false; x <= W + 10; x += 6) {
      const y = this.surf(x), crest = this.surf(x - 30) + this.surf(x + 30) - 2 * y > 0.6;
      if (crest && !on) { g.moveTo(x, y); on = true; } else if (crest) g.lineTo(x, y); else on = false;
    }
    g.stroke();
    g.globalAlpha = 1;
    // white water on the crests, the sharper the crest the more of it
    g.fillStyle = P.foam;
    for (let x = -8; x <= W + 8; x += 6) {
      const y = this.surf(x), c = this.surf(x - 14) + this.surf(x + 14) - 2 * y;
      if (c < 0.22) continue;
      g.globalAlpha = Math.min(0.85, (c - 0.22) * 0.9);
      g.fillRect(x - 3, y - 1.5, 6 + c * 2, 2.4 + Math.min(3, c));
    }
    g.globalAlpha = 1;
    this.drawWaveCrest();
    // foam where the hull meets the water
    if (this.phase === "afloat" || this.phase === "surface") {
      g.strokeStyle = P.foam;
      g.lineWidth = 2;
      for (const lx of [-0.46, 0.41]) {
        const p = this.toSea(this.boat, lx, 0), y = this.surf(p.x);
        g.globalAlpha = 0.5 + 0.25 * Math.sin(t * 3 + lx * 9);
        g.beginPath(); g.ellipse(p.x, y + 1.5, L * 0.045, L * 0.009, 0, 0, Math.PI); g.stroke();
      }
      g.globalAlpha = 1;
    }
    // the sharks on the near side
    this.drawSharks(true);

    for (const s of this.scraps) if (s.d === 1) this.drawScrap(s, horizon);
    for (const f of this.floaters) this.drawFloater(f);
    this.drawBubbles(() => true);
    this.drawLanternLight();
  }

  // Rows of little wavelets across the near water, bigger and further apart
  // the nearer they are, each with a lit top and a dark underside, drifting.
  drawRipples() {
    const { g, W, L, P, t } = this;
    const bx = this.boat.x, hullDeep = L * (0.15 - this.wl);
    for (let j = 0; j < 9; j++) {
      const f = j / 8, depth = L * (0.035 + 0.62 * f * f), gap = 30 + 54 * f, len = 12 + 30 * f;
      const offset = t * (5 + 12 * f) * (j % 2 ? 1 : -0.7) + j * 37;
      const first = Math.floor((offset - gap) / gap);
      // three strengths, so they don't all look alike
      const light = [new Path2D(), new Path2D(), new Path2D()], dark = new Path2D();
      for (let k = first; ; k++) {
        const x0 = k * gap - offset;
        if (x0 > W + gap) break;
        const x = x0 + (hash(k * 7 + j * 13) - 0.5) * gap * 0.9;
        const y = this.surf(x) + depth + (hash(k * 3 + j * 29) - 0.5) * gap * 0.45;
        if (Math.abs(x - bx) < L * 0.5 && y < this.surf(x) + hullDeep) continue;
        const l = len * (0.45 + 1.1 * hash(k + j * 11)), lift = l * (0.08 + 0.08 * hash(k * 5 + j));
        const p = light[Math.floor(hash(k * 13 + j * 7) * 3)];
        p.moveTo(x - l / 2, y); p.bezierCurveTo(x - l * 0.2, y - lift, x + l * 0.15, y - lift, x + l / 2, y + lift * 0.2);
        dark.moveTo(x - l * 0.4, y + 1.8); dark.quadraticCurveTo(x, y + 1.8 + lift * 0.5, x + l * 0.45, y + 1.6);
      }
      g.lineCap = "round";
      g.lineWidth = 1 + 0.8 * f;
      g.globalAlpha = 0.7 - 0.35 * f;
      g.strokeStyle = P.rippleDark;
      g.stroke(dark);
      g.strokeStyle = P.ripple;
      light.forEach((p, i) => { g.globalAlpha = (0.35 + 0.3 * i) * (1 - 0.45 * f); g.stroke(p); });
    }
    g.globalAlpha = 1;
  }

  // Glints of the sun or moon on the wavelets under it, twinkling.
  drawSparkles() {
    const { g, W, L, P, t } = this;
    const o = this.orbAt;
    if (!o) return;
    g.fillStyle = P.sparkle;
    for (let i = 0; i < 18; i++) {
      const a = Math.pow(Math.max(0, Math.sin(t * (1.6 + hash(i) * 1.4) + i * 2.1)), 8);
      if (a < 0.05) continue;
      const d = hash(i + 40), x = o.x + (hash(i + 90) - 0.5) * W * (0.08 + 0.3 * d);
      const y = this.surf(x) + L * (0.01 + 0.5 * d * d), r = (1.5 + 4.5 * d) * a;
      g.globalAlpha = a;
      g.beginPath();
      g.moveTo(x - r, y); g.quadraticCurveTo(x, y, x, y - r * 0.6); g.quadraticCurveTo(x, y, x + r, y);
      g.quadraticCurveTo(x, y, x, y + r * 0.6); g.quadraticCurveTo(x, y, x - r, y);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  // The moon, with its seas, or a pale sun; drawn once and kept.
  drawOrb(orb) {
    const { g, P } = this;
    const key = `${P.stars}|${Math.round(orb.r)}`;
    if (this.orbKey !== key) {
      this.orbKey = key;
      const size = Math.ceil(orb.r * 2) + 2, m = size / 2, r = orb.r;
      const c = document.createElement("canvas");
      c.width = c.height = size * 2;
      const o = c.getContext("2d");
      o.scale(2, 2);
      o.beginPath(); o.arc(m, m, r, 0, TAU);
      o.fillStyle = P.orb;
      o.fill();
      o.save();
      o.clip();
      if (P.stars) {
        const R = rng(5);
        o.fillStyle = "rgba(120, 125, 150, 0.22)";
        for (let i = 0; i < 9; i++) { o.beginPath(); o.arc(m + (R() - 0.5) * r * 1.3, m + (R() - 0.5) * r * 1.3, r * (0.12 + R() * 0.25), 0, TAU); o.fill(); }
        const shade = o.createRadialGradient(m - r * 0.35, m - r * 0.35, r * 0.2, m, m, r * 1.05);
        shade.addColorStop(0, "rgba(255, 255, 255, 0.15)");
        shade.addColorStop(1, "rgba(60, 60, 90, 0.35)");
        o.fillStyle = shade;
        o.fillRect(0, 0, size, size);
      } else {
        const hot = o.createRadialGradient(m, m, 0, m, m, r);
        hot.addColorStop(0, "#ffffff");
        hot.addColorStop(1, "#ffe9b8");
        o.fillStyle = hot;
        o.fillRect(0, 0, size, size);
      }
      o.restore();
      this.orbImg = c;
      this.orbSize = size;
    }
    g.drawImage(this.orbImg, orb.x - this.orbSize / 2, orb.y - this.orbSize / 2, this.orbSize, this.orbSize);
  }

  // Clouds, each drawn once onto its own canvas and slid across the sky.
  drawClouds(horizon) {
    const { g, W, P } = this;
    const key = `${P.stars}|${W}`;
    if (this.cloudKey !== key) {
      this.cloudKey = key;
      this.cloudImgs = this.clouds.map((c) => {
        const w = Math.round(W * 0.26 * c.scale);
        return cloudCanvas(w, Math.round(w * 0.42), P, c.seed);
      });
    }
    g.globalAlpha = P.cloud.alpha;
    this.clouds.forEach((c, i) => {
      const img = this.cloudImgs[i];
      g.drawImage(img, c.x * W, horizon * c.y - img.height * 0.55);
    });
    g.globalAlpha = 1;
  }

  // The big wave's crest: thick white water along it, a lip curling over its
  // front, and foam streaming down its face.
  drawWaveCrest() {
    const wv = this.wave;
    if (!wv || wv.A < 2) return;
    const { g, P, t } = this;
    const k = wv.A / wv.max;
    // its face, lighter where the light comes through the top of it
    const x0 = wv.c - wv.w * 1.1, x1 = wv.c + wv.w * 2;
    g.beginPath();
    for (let x = x0, first = true; x <= x1; x += 8, first = false) first ? g.moveTo(x, this.surf(x)) : g.lineTo(x, this.surf(x));
    for (let x = x1; x >= x0; x -= 8) g.lineTo(x, this.surf(x, true) + 2);
    g.closePath();
    const top = this.seaNow - wv.A;
    const face = g.createLinearGradient(0, top, 0, this.seaNow + 4);
    face.addColorStop(0, P.waveFace[0]);
    face.addColorStop(1, P.waveFace[1]);
    g.fillStyle = face;
    g.globalAlpha = k;
    g.fill();
    g.strokeStyle = P.foam;
    g.lineCap = "round";
    g.lineWidth = 2 + 4 * k;
    g.globalAlpha = 0.85 * k;
    g.beginPath();
    for (let x = wv.c - wv.w * 0.45, first = true; x <= wv.c + wv.w * 0.35; x += 6, first = false) {
      first ? g.moveTo(x, this.surf(x) + 1) : g.lineTo(x, this.surf(x) + 1);
    }
    g.stroke();
    // the lip, breaking forward
    const tip = wv.c - wv.w * 0.05, front = wv.c - wv.w * 0.42;
    g.lineWidth = 3 + 3 * k;
    g.beginPath();
    g.moveTo(tip, this.surf(tip));
    g.quadraticCurveTo(lerp(tip, front, 0.6), this.surf(tip) - wv.A * 0.12, front, this.surf(front) - wv.A * 0.02);
    g.stroke();
    // and foam tumbling down its face
    g.fillStyle = P.foam;
    for (let i = 0; i < 26; i++) {
      const u = ((i * 0.618 + t * 0.4) % 1);
      const x = wv.c - wv.w * (0.05 + 0.5 * u);
      const y = this.surf(x) + 3 + ((i * 7.3) % 1) * wv.A * 0.25 * (1 - u);
      g.globalAlpha = 0.6 * k * (1 - u);
      g.beginPath(); g.arc(x, y, 1.2 + 2.5 * (1 - u), 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
  }

  // The sharks on one side of the boat: a fin cutting the water and the
  // shadow of the rest of it under the surface.
  drawSharks(front) {
    for (const s of this.sharks) {
      if (s.leaping || s.up <= 0) continue;
      const at = this.sharkAt(s);
      if ((at.z >= 0) === front) this.drawFin(at, s);
    }
    if (!front && this.leap) this.drawLeap();
  }

  drawFin(at, s) {
    const { g, L, P, t } = this;
    const size = L * 0.06 * at.scale, f = at.facing;
    const rise = s.up * (0.88 + 0.12 * Math.sin(t * 1.7 + s.seed));
    g.save();
    g.translate(at.x, at.y);
    g.fillStyle = P.sharkDeep;
    g.beginPath(); g.ellipse(-f * size * 0.5, size * 0.55, size * 2.1, size * 0.32, 0, 0, TAU); g.fill();
    // its wake, opening out behind it
    g.strokeStyle = P.foam;
    g.lineWidth = 1.2;
    g.globalAlpha = 0.65 * s.up;
    g.beginPath();
    g.moveTo(f * size * 0.6, 0);
    g.quadraticCurveTo(-f * size * 1.2, -size * 0.04, -f * size * 2.8, -size * 0.16);
    g.moveTo(f * size * 0.6, 1);
    g.quadraticCurveTo(-f * size * 1.2, size * 0.12, -f * size * 2.8, size * 0.3);
    g.stroke();
    g.globalAlpha = 1;
    // the fin, only what is out of the water
    g.beginPath(); g.rect(-size * 3, -size * 2, size * 6, size * 2); g.clip();
    g.save();
    g.scale(f * size, size);
    g.translate(0, (1 - rise) * 1.1);
    finPath(g);
    g.fillStyle = P.shark;
    g.fill();
    g.strokeStyle = P.sharkLit;
    g.lineWidth = 0.07;
    g.beginPath(); g.moveTo(0.6, 0.02); g.quadraticCurveTo(0.4, -0.7, -0.3, -1.06); g.stroke();
    g.restore();
    g.fillStyle = P.foam;
    g.beginPath(); g.ellipse(f * size * 0.45, 0, size * 0.4, size * 0.09, 0, 0, TAU); g.fill();
    g.restore();
  }

  // A shark clear of the water, nose up then down, behind the boat.
  drawLeap() {
    const { g, P } = this;
    const lp = this.leap;
    const x = lp.x0 + lp.dir * lp.D * lp.k;
    const y = this.surf(x) + lp.zo - lp.H * Math.sin(Math.PI * lp.k) + lp.size * 0.06;
    const angle = Math.atan2(-lp.H * Math.PI * Math.cos(Math.PI * lp.k), lp.D);
    const draw = () => {
      g.save();
      g.translate(x, y);
      g.scale(lp.dir, 1);
      g.rotate(angle);
      g.scale(lp.size, lp.size);
      drawShark(g, P);
      g.restore();
    };
    // what is still under the water shows dimly through it
    g.globalAlpha = 0.28;
    draw();
    g.globalAlpha = 1;
    g.save();
    g.beginPath();
    const x0 = x - lp.size * 0.7, x1 = x + lp.size * 0.7;
    g.moveTo(x0, -10);
    g.lineTo(x1, -10);
    for (let xx = x1; xx >= x0; xx -= 6) g.lineTo(xx, this.surf(xx) + lp.zo);
    g.closePath();
    g.clip();
    draw();
    g.restore();
  }

  // The lantern's glow over everything near it, and its light on the water.
  drawLanternLight() {
    const { g, L, P } = this;
    if (this.phase === "flood" || this.phase === "under") return;
    const at = this.toSea(this.boat, -0.405, -0.285);
    if (at.y > this.surf(at.x)) return;
    const k = this.flicker;
    g.globalCompositeOperation = "lighter";
    const glow = g.createRadialGradient(at.x, at.y, 0, at.x, at.y, L * 0.34);
    glow.addColorStop(0, `rgba(255, 170, 80, ${P.lantern * k})`);
    glow.addColorStop(0.35, `rgba(255, 140, 60, ${P.lantern * 0.35 * k})`);
    glow.addColorStop(1, "rgba(255, 120, 40, 0)");
    g.fillStyle = glow;
    g.fillRect(at.x - L * 0.34, at.y - L * 0.34, L * 0.68, L * 0.68);
    g.fillStyle = `rgba(255, 175, 90, ${P.lantern * 1.6 * k})`;
    for (let i = 0; i < 7; i++) {
      const y = this.surf(at.x) + 4 + i * 6, w = L * (0.05 - i * 0.006) * (0.6 + 0.4 * Math.sin(this.t * 3 + i * 2));
      g.fillRect(at.x - w / 2 + Math.sin(this.t * 1.7 + i) * 4, y, w, 1.5);
    }
    g.globalCompositeOperation = "source-over";
  }

  drawBubbles(keep) {
    const { g } = this;
    g.strokeStyle = this.P.rings;
    g.lineWidth = 1.2;
    for (const u of this.bubbles) {
      if (!keep(u)) { u.dead = true; continue; }
      g.beginPath(); g.arc(u.x, u.y, u.r, 0, TAU); g.stroke();
    }
    this.bubbles = this.bubbles.filter((u) => !u.dead && u.y > -20);
  }

  // A scrap of one of the notes, out on the water.
  drawScrap(s, horizon) {
    const { g, W, L, t } = this;
    const x = s.x * W - W * 0.1;
    if (s.d === 1 && Math.abs(x - this.boat.x) < L * 0.6) return;
    const y = s.d === 1 ? this.surf(x) - 1 : horizon + (this.seaNow - horizon) * s.d * s.d + Math.sin(t * 1.2 + s.seed) * 2 * s.d;
    const size = (s.d === 1 ? L * 0.05 : 4 + 22 * s.d * s.d) * s.size;
    g.save();
    g.translate(x, y);
    g.rotate(s.turn * 0.2 + Math.sin(t * 0.9 + s.seed) * 0.08);
    g.globalAlpha = this.P.scrapShade;
    g.fillStyle = s.color;
    g.beginPath();
    g.ellipse(0, 0, size, size * 0.28, 0, 0, TAU);
    g.fill();
    g.restore();
    g.globalAlpha = 1;
  }

  // ----- The boat -----
  drawBoat() {
    const { g, L, P, t } = this;
    const b = this.boat;
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.angle);
    g.scale(L, L);
    g.lineJoin = "round";
    g.lineCap = "round";

    // inside it, seen over the near side: the far gunwale, the seats, the
    // oar shipped along it
    g.fillStyle = P.interior;
    interior(g);
    g.fill();
    g.fillStyle = P.seat;
    for (const x of [SAILOR_X, 0.31, -0.33]) {
      g.beginPath();
      g.moveTo(x - 0.026, nearG(x - 0.026) + 0.004);
      g.lineTo(x + 0.026, nearG(x + 0.026) + 0.004);
      g.lineTo(x + 0.046, farG(x + 0.046) + 0.012);
      g.lineTo(x - 0.006, farG(x - 0.006) + 0.012);
      g.closePath();
      g.fill();
    }
    // a coil of rope up in the bow
    g.strokeStyle = P.rope;
    g.lineWidth = 0.005;
    for (const r of [0.03, 0.022, 0.014]) { g.beginPath(); g.ellipse(0.3, -0.182, r, r * 0.33, -0.12, 0, TAU); g.stroke(); }
    g.strokeStyle = P.oar;
    g.lineWidth = 0.011;
    g.beginPath(); g.moveTo(-0.36, -0.155); g.lineTo(0.62, -0.245); g.stroke();
    g.fillStyle = P.oar;
    g.beginPath(); g.ellipse(0.66, -0.249, 0.06, 0.016, -0.09, 0, TAU); g.fill();

    // the water in it, lying level whatever the boat does
    const full = this.phase === "swamping" || this.phase === "sunk" ? 1 : this.water;
    if (full > 0.005) {
      g.save();
      interior(g);
      g.clip();
      const level = lerp(-0.098, -0.178, Math.pow(full, 0.85));
      g.translate(0, level);
      g.rotate(-b.angle);
      g.fillStyle = P.inside;
      g.fillRect(-1, 0, 2, 1);
      g.strokeStyle = P.insideTop;
      g.lineWidth = 0.003;
      g.globalAlpha = 0.5;
      g.beginPath();
      for (let x = -0.6; x <= 0.6; x += 0.04) { g.moveTo(x, 0.012); g.quadraticCurveTo(x + 0.01, 0.009 + Math.sin(t * 3 + x * 40) * 0.002, x + 0.02, 0.012); }
      g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = 0.006;
      g.beginPath();
      for (let x = -0.6; x <= 0.6; x += 0.03) {
        const y = Math.sin(x * 30 + t * 4) * 0.003 + Math.sin(x * 13 - t * 2.6) * 0.002;
        x > -0.6 ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.restore();
    }

    // the spout through the hole: a column of water, breaking up at the top
    // and falling back in
    if (this.spout > 0) {
      const top = HOLE.y - this.spout, sway = Math.sin(t * 7) * 0.006;
      const column = (dx, width, color, alpha) => {
        g.strokeStyle = color;
        g.globalAlpha = alpha;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(HOLE.x + dx, HOLE.y);
        g.quadraticCurveTo(HOLE.x - sway + dx, (HOLE.y + top) / 2, HOLE.x + sway + dx * 0.5, top + 0.012);
        g.stroke();
      };
      g.lineCap = "round";
      column(0, 0.026, P.drop, 0.28);
      column(0, 0.012, P.drop, 0.9);
      column(-0.003, 0.004, "#ffffff", 0.75);
      // mist off the top
      g.fillStyle = P.drop;
      for (let i = 0; i < 5; i++) {
        const k = (t * 1.3 + i / 5) % 1;
        g.globalAlpha = 0.22 * (1 - k);
        g.beginPath(); g.arc(HOLE.x + Math.sin(i * 2.4) * 0.02 * k, top - 0.01 - k * 0.025, 0.008 + k * 0.014, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = P.drop;
    for (const d of this.jet) { g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill(); }

    this.drawSailor();

    // the near side of the hull
    hull(g);
    const wood = g.createLinearGradient(0, -0.2, 0, 0.12);
    wood.addColorStop(0, P.hull[0]);
    wood.addColorStop(1, P.hull[1]);
    g.fillStyle = wood;
    g.fill();
    g.save();
    hull(g);
    g.clip();
    // the grain of the planks
    g.strokeStyle = "rgba(255, 230, 190, 0.05)";
    g.lineWidth = 0.002;
    for (let i = 0; i < 10; i++) {
      const off = 0.02 + i * 0.019;
      g.beginPath();
      g.moveTo(-0.6, -0.13 + off);
      g.quadraticCurveTo(0.05 + Math.sin(i * 3.7) * 0.1, -0.1 + off + Math.sin(i) * 0.004, 0.62, -0.21 + off * 0.75);
      g.stroke();
    }
    // the seams between them, and the rivets along each
    g.strokeStyle = P.strake;
    g.lineWidth = 0.004;
    for (const off of [0.045, 0.09, 0.135, 0.18]) {
      g.beginPath();
      g.moveTo(-0.6, -0.135 + off);
      g.quadraticCurveTo(0.05, -0.105 + off, 0.62, -0.215 + off * 0.75);
      g.stroke();
    }
    g.fillStyle = P.rivet;
    for (const off of [0.045, 0.09, 0.135]) {
      for (let u = 0.04; u < 1; u += 0.055) {
        const x = quad(-0.6, 0.05, 0.62, u), y = quad(-0.135 + off, -0.105 + off, -0.215 + off * 0.75, u);
        g.beginPath(); g.arc(x, y - 0.007, 0.0028, 0, TAU); g.fill();
      }
    }
    // a painted band under the rail
    g.fillStyle = P.stripe;
    g.beginPath();
    gunwale(g, -0.006);
    for (let x = 0.5; x >= -0.47; x -= 0.02) g.lineTo(x, nearG(x) + 0.03);
    g.closePath();
    g.fill();
    // darker toward the ends, where the hull turns away
    const ends = g.createLinearGradient(-0.48, 0, 0.5, 0);
    ends.addColorStop(0, "rgba(0, 0, 0, 0.35)");
    ends.addColorStop(0.18, "rgba(0, 0, 0, 0)");
    ends.addColorStop(0.8, "rgba(0, 0, 0, 0)");
    ends.addColorStop(1, "rgba(0, 0, 0, 0.3)");
    g.fillStyle = ends;
    g.fillRect(-0.6, -0.4, 1.3, 0.6);
    // the hole the sea is coming in at
    g.fillStyle = P.ink;
    g.beginPath(); g.ellipse(HOLE.x, 0.085, 0.014, 0.009, 0.2, 0, TAU); g.fill();
    g.strokeStyle = P.ink;
    g.lineWidth = 0.003;
    for (const a of [0.3, 1.9, 3.4, 4.6]) {
      g.beginPath();
      g.moveTo(HOLE.x + Math.cos(a) * 0.012, 0.085 + Math.sin(a) * 0.008);
      g.lineTo(HOLE.x + Math.cos(a + 0.2) * 0.03, 0.085 + Math.sin(a + 0.2) * 0.02);
      g.stroke();
    }
    g.restore();
    // the rail along the top, and the stem
    g.strokeStyle = P.rail;
    g.lineWidth = 0.016;
    g.beginPath(); gunwale(g); g.stroke();
    g.strokeStyle = P.railLit;
    g.lineWidth = 0.005;
    g.beginPath(); gunwale(g, 0.007); g.stroke();
    g.strokeStyle = P.hull[1];
    g.lineWidth = 0.012;
    g.beginPath(); g.moveTo(0.5, -0.2); g.bezierCurveTo(0.47, -0.08, 0.4, 0.05, 0.28, 0.09); g.stroke();
    g.beginPath(); g.moveTo(-0.47, -0.135); g.lineTo(-0.45, 0.04); g.stroke();
    // her name, on the bow
    g.save();
    g.translate(0.27, -0.112);
    g.rotate(-0.13);
    g.scale(1 / L, 1 / L);
    g.font = `${Math.max(7, Math.round(L * 0.024))}px "IM Fell English SC", Georgia, serif`;
    g.textAlign = "center";
    g.fillStyle = P.name;
    g.globalAlpha = 0.85;
    g.fillText("Daily", 0, 0);
    g.restore();
    // oarlocks on the rail
    g.strokeStyle = P.brass;
    g.lineWidth = 0.005;
    for (const x of [-0.14, 0.2]) {
      const y = nearG(x) - 0.008;
      g.beginPath(); g.moveTo(x - 0.012, y - 0.016); g.quadraticCurveTo(x, y + 0.006, x + 0.012, y - 0.016); g.stroke();
    }
    // the lantern on its post at the stern, hanging straight whatever the boat does
    g.strokeStyle = P.hull[1];
    g.lineWidth = 0.009;
    g.beginPath(); g.moveTo(-0.448, -0.13); g.lineTo(-0.448, -0.335); g.lineTo(-0.4, -0.335); g.stroke();
    g.save();
    g.translate(-0.405, -0.335);
    g.rotate(-b.angle + Math.sin(t * 1.9) * 0.07);
    drawLantern(g, P, this.flicker);
    g.restore();
    g.restore();
  }

  // The sailor: an old fisherman in a yellow oilskin and sou'wester, sat
  // facing the stern. The poses are worked out at one size and the whole of
  // him drawn a little bigger about the hip (SAILOR_SCALE).
  drawSailor() {
    const { g, P, t } = this;
    const swamped = this.phase === "swamping" || this.phase === "sunk";
    const pose = swamped ? null : posed(this.bail % 1);
    const working = this.t - this.lastBail < 0.5;
    const lean = swamped ? -0.1 + Math.sin(t * 9) * 0.05 : pose.lean;
    const worry = swamped ? 1 : clamp(this.water * 1.25 - 0.1, 0, 1);
    const breathe = Math.sin(t * (working ? 6 : 2.2)) * (working ? 0.004 : 0.003);
    const hip = { x: SAILOR_X, y: SAILOR_HIP };
    g.save();
    g.translate(hip.x, hip.y);
    g.scale(SAILOR_SCALE, SAILOR_SCALE);
    g.translate(-hip.x, -hip.y);
    // the body turns about the hip, leaning in to the work
    const rot = -lean * 0.9;
    const c = Math.cos(rot), s = Math.sin(rot);
    const body = (x, y) => ({ x: hip.x + x * c - y * s, y: hip.y + x * s + y * c });
    const shoulder = body(-0.004, -0.118 + breathe);
    const far = body(0.022, -0.114 + breathe);

    // where the hands are
    let hands, bucket = null;
    if (swamped) {
      const wave = Math.sin(t * 11) * 0.025;
      hands = [{ x: shoulder.x - 0.05 + wave, y: shoulder.y - 0.1 }, { x: far.x + 0.04 - wave, y: far.y - 0.11 }];
    } else {
      const cb = Math.cos(pose.turn), sb = Math.sin(pose.turn);
      const rim = (x, y) => ({ x: SAILOR_X + pose.x + x * cb - y * sb, y: pose.y + x * sb + y * cb });
      hands = [rim(-0.03, -0.028), rim(0.03, -0.028)];
      bucket = { ...pose, x: pose.x + SAILOR_X };
    }

    // the far arm, behind everything
    this.arm(far, hands[1], true);

    g.save();
    g.translate(hip.x, hip.y);
    g.rotate(rot);
    drawTorso(g, P, breathe);
    // the head bows to the work, jerks up in alarm, and now and then he
    // glances back over his shoulder at the leak
    const glance = !swamped && !working && Math.sin(t * 0.37 + 1) > 0.85;
    const tilt = swamped ? -0.22 + Math.sin(t * 7) * 0.05 : working ? 0.1 : glance ? -0.06 : 0;
    g.save();
    g.translate(-0.004, -0.15 + breathe);
    g.rotate(tilt);
    g.translate(-0.002, -0.026);
    drawHead(g, P, { worry, swamped, panting: working, blink: this.blinkAt - t < 0.12, look: glance ? 1 : -1, t });
    // the sou'wester, until the sea takes it
    const hatGone = this.floaters.some((f) => f.kind === "hat");
    if (!hatGone) {
      g.translate(0, -0.017);
      drawHat(g, P);
    }
    g.restore();
    g.restore();
    if (!hatGone && swamped) {
      // where the hat is, in the boat: once that is under the water, it floats off
      const hx = -0.006, hy = -0.206;
      const lx = hip.x + (hx * c - hy * s) * SAILOR_SCALE, ly = hip.y + (hx * s + hy * c) * SAILOR_SCALE;
      const at = this.toSea(this.boat, lx, ly);
      if (at.y > this.surf(at.x)) this.floaters.push({ kind: "hat", x: at.x, y: at.y, vx: this.L * 0.12, vy: 0, turn: rot, lean: -0.15, ride: 0.02 });
    }

    // the bucket, and the near arm over it
    if (bucket) this.drawBucket(bucket.x, bucket.y, bucket.turn, bucket.full);
    this.arm(shoulder, hands[0], false);
    g.restore();
  }

  // An arm in its oilskin sleeve, bent at the elbow, thick at the shoulder
  // and narrowing to the cuff, and a weathered hand gripping.
  arm(from, to, far) {
    const { g, P } = this;
    const a = 0.076, b = 0.076;
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.min(Math.hypot(dx, dy), a + b - 0.001);
    const base = Math.atan2(dy, dx);
    const bend = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const elbow = { x: from.x + Math.cos(base - bend) * a, y: from.y + Math.sin(base - bend) * a };
    const at = (k) => ({ x: lerp(elbow.x, to.x, k), y: lerp(elbow.y, to.y, k) });
    const wrist = at(0.8);
    g.lineCap = "round";
    g.lineJoin = "round";
    const sleeve = (w1, w2, color) => {
      g.strokeStyle = color;
      g.lineWidth = w1;
      g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(elbow.x, elbow.y); g.stroke();
      g.lineWidth = w2;
      g.beginPath(); g.moveTo(elbow.x, elbow.y); g.lineTo(wrist.x, wrist.y); g.stroke();
    };
    sleeve(0.031, 0.025, P.coatLine);
    sleeve(0.025, 0.019, far ? P.coatDark : P.coat);
    if (!far) {
      // the shine along the top of the sleeve
      const nx = -(elbow.y - from.y), ny = elbow.x - from.x, n = Math.hypot(nx, ny) || 1;
      const sx = (nx / n) * 0.006 * (ny < 0 ? 1 : -1), sy = (ny / n) * 0.006 * (ny < 0 ? 1 : -1);
      g.strokeStyle = "rgba(255, 255, 255, 0.28)";
      g.lineWidth = 0.004;
      g.beginPath(); g.moveTo(from.x + sx, from.y + sy); g.lineTo(lerp(from.x, elbow.x, 0.85) + sx, lerp(from.y, elbow.y, 0.85) + sy); g.stroke();
    }
    // the crease at the elbow, and the cuff
    g.strokeStyle = P.coatLine;
    g.lineWidth = 0.002;
    g.beginPath(); g.arc(elbow.x, elbow.y, 0.008, base - bend + 1.8, base - bend + 2.8); g.stroke();
    const c0 = at(0.74), c1 = at(0.86);
    g.strokeStyle = far ? P.coatLine : P.coatDark;
    g.lineWidth = 0.022;
    g.beginPath(); g.moveTo(c0.x, c0.y); g.lineTo(c1.x, c1.y); g.stroke();
    // the hand, along the line of the forearm, and its thumb
    g.save();
    g.translate(to.x, to.y);
    g.rotate(Math.atan2(to.y - elbow.y, to.x - elbow.x));
    g.fillStyle = far ? P.skinDark : P.skin;
    g.strokeStyle = P.skinLine;
    g.lineWidth = 0.0018;
    g.beginPath(); g.ellipse(0.002, 0, 0.012, 0.0095, 0, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(-0.003, -0.008, 0.0065, 0.0036, -0.6, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(0.008, -0.004); g.lineTo(0.011, -0.001); g.moveTo(0.008, 0.002); g.lineTo(0.011, 0.005); g.stroke();
    g.restore();
  }

  drawBucket(x, y, turn, full) {
    const { g, P } = this;
    g.save();
    g.translate(x, y);
    g.rotate(turn);
    drawBucketShape(g, P, full);
    g.restore();
  }

  drawFloater(f) {
    const { g, L, P } = this;
    g.save();
    g.translate(f.x, f.y);
    g.rotate(f.turn);
    g.scale(L * SAILOR_SCALE, L * SAILOR_SCALE);
    g.lineJoin = "round";
    if (f.kind === "hat") drawHat(g, P);
    else drawBucketShape(g, P, false);
    g.restore();
  }
}

// ----- Shapes, in the boat's frame -----
// The near gunwale and the far one: the far one sits higher, as it is seen
// over the near side, and the two meet at the bow.
function nearG(x) {
  const u = clamp((x + 0.47) / 0.97, 0, 1);
  return (1 - u) * (1 - u) * -0.135 + 2 * (1 - u) * u * -0.105 + u * u * -0.2;
}
function farG(x) {
  const u = clamp((x + 0.47) / 0.97, 0, 1);
  return nearG(x) - 0.062 * Math.sin(Math.PI * Math.pow(u, 0.8)) * (1 - 0.25 * u) - 0.03 * (1 - u) * (1 - u);
}

function interior(g) {
  g.beginPath();
  g.moveTo(-0.47, nearG(-0.47));
  for (let x = -0.47; x <= 0.5; x += 0.02) g.lineTo(x, farG(x));
  g.lineTo(0.5, -0.2);
  for (let x = 0.5; x >= -0.47; x -= 0.02) g.lineTo(x, nearG(x));
  g.closePath();
}

function gunwale(g, lift = 0) {
  g.moveTo(-0.47, nearG(-0.47) - lift);
  for (let x = -0.45; x < 0.5; x += 0.02) g.lineTo(x, nearG(x) - lift);
  g.lineTo(0.5, -0.2 - lift);
}

function hull(g) {
  g.beginPath();
  gunwale(g);
  g.bezierCurveTo(0.47, -0.08, 0.4, 0.05, 0.28, 0.09);
  g.quadraticCurveTo(0, 0.118, -0.3, 0.095);
  g.quadraticCurveTo(-0.42, 0.085, -0.45, 0.04);
  g.closePath();
}

// The sou'wester: a stitched crown with a shine on it, a band, and a brim
// long at the back to keep the rain off the neck.
function drawHat(g, P) {
  g.lineJoin = "round";
  g.beginPath();
  g.arc(0.002, -0.012, 0.039, Math.PI * 1.02, Math.PI * 1.98);
  g.closePath();
  const crown = g.createLinearGradient(-0.035, -0.05, 0.04, -0.01);
  crown.addColorStop(0, P.coatLit);
  crown.addColorStop(0.5, P.coat);
  crown.addColorStop(1, P.coatDark);
  g.fillStyle = crown;
  g.fill();
  g.strokeStyle = P.coatLine;
  g.lineWidth = 0.003;
  g.stroke();
  g.strokeStyle = P.coatDark;
  g.lineWidth = 0.0018;
  g.beginPath();
  g.moveTo(0.004, -0.051); g.quadraticCurveTo(-0.014, -0.036, -0.02, -0.014);
  g.moveTo(0.004, -0.051); g.quadraticCurveTo(0.022, -0.036, 0.026, -0.014);
  g.stroke();
  g.strokeStyle = "rgba(255, 255, 255, 0.38)";
  g.lineWidth = 0.004;
  g.beginPath(); g.arc(0.002, -0.012, 0.031, Math.PI * 1.2, Math.PI * 1.45); g.stroke();
  g.fillStyle = P.coatDark;
  g.fillRect(-0.036, -0.019, 0.076, 0.006);
  // the brim, and its darker underside
  g.beginPath();
  g.moveTo(-0.054, -0.014);
  g.quadraticCurveTo(0, -0.024, 0.05, -0.014);
  g.quadraticCurveTo(0.068, -0.006, 0.074, 0.014);
  g.quadraticCurveTo(0.042, 0.004, -0.054, -0.006);
  g.closePath();
  g.fillStyle = P.coat;
  g.fill();
  g.strokeStyle = P.coatLine;
  g.lineWidth = 0.0025;
  g.stroke();
  g.beginPath();
  g.moveTo(-0.054, -0.006);
  g.quadraticCurveTo(0.042, 0.004, 0.074, 0.014);
  g.quadraticCurveTo(0.04, 0.01, -0.05, -0.001);
  g.closePath();
  g.fillStyle = P.coatDark;
  g.fill();
  g.setLineDash([0.004, 0.003]);
  g.strokeStyle = P.coatDark;
  g.lineWidth = 0.0012;
  g.beginPath(); g.moveTo(-0.048, -0.0125); g.quadraticCurveTo(0, -0.02, 0.048, -0.0115); g.stroke();
  g.setLineDash([]);
}

// The body in its oilskin, in the torso's own frame (the hip at 0, 0, up is
// -y, facing -x): shaded and shining, creased where it bunches, toggled down
// the front, with the collar turned up and a jumper showing at the neck.
function drawTorso(g, P, b) {
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(-0.044, 0.012);
  g.bezierCurveTo(-0.048, -0.04, -0.046, -0.09, -0.036, -0.112 + b);
  g.bezierCurveTo(-0.028, -0.132 + b, -0.01, -0.142 + b, 0.008, -0.142 + b);
  g.bezierCurveTo(0.03, -0.142 + b, 0.044, -0.126 + b, 0.046, -0.1 + b);
  g.bezierCurveTo(0.05, -0.06, 0.05, -0.02, 0.048, 0.012);
  g.closePath();
  const coat = g.createLinearGradient(-0.046, -0.1, 0.05, -0.04);
  coat.addColorStop(0, P.coatLit);
  coat.addColorStop(0.45, P.coat);
  coat.addColorStop(1, P.coatDark);
  g.fillStyle = coat;
  g.fill();
  g.strokeStyle = P.coatLine;
  g.lineWidth = 0.003;
  g.stroke();
  g.strokeStyle = "rgba(255, 255, 255, 0.3)";
  g.lineWidth = 0.006;
  g.beginPath(); g.moveTo(-0.032, -0.11 + b); g.quadraticCurveTo(-0.041, -0.07, -0.037, -0.02); g.stroke();
  g.strokeStyle = P.coatDark;
  g.lineWidth = 0.0022;
  for (const [x0, y0, cx, cy, x1, y1] of [[-0.012, -0.05, 0.004, -0.052, 0.02, -0.036], [-0.006, -0.02, 0.01, -0.025, 0.028, -0.012], [0.018, -0.1, 0.031, -0.092, 0.037, -0.074]]) {
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
  }
  g.strokeStyle = P.coatLine;
  g.lineWidth = 0.0025;
  g.beginPath(); g.moveTo(-0.024, -0.13 + b); g.quadraticCurveTo(-0.03, -0.06, -0.028, 0.01); g.stroke();
  for (const y of [-0.04, -0.07, -0.1]) {
    g.fillStyle = P.toggle;
    g.beginPath(); g.ellipse(-0.031, y, 0.0058, 0.0023, 0.3, 0, TAU); g.fill();
    g.strokeStyle = P.coatLine;
    g.lineWidth = 0.0012;
    g.beginPath(); g.moveTo(-0.035, y + 0.001); g.lineTo(-0.022, y + 0.003); g.stroke();
  }
  g.fillStyle = P.jumper;
  g.beginPath(); g.ellipse(0, -0.142 + b, 0.017, 0.007, 0, 0, TAU); g.fill();
  g.beginPath();
  g.moveTo(-0.026, -0.124 + b);
  g.quadraticCurveTo(-0.024, -0.146 + b, -0.008, -0.152 + b);
  g.lineTo(-0.004, -0.136 + b);
  g.quadraticCurveTo(-0.014, -0.13 + b, -0.026, -0.124 + b);
  g.moveTo(0.026, -0.132 + b);
  g.quadraticCurveTo(0.024, -0.15 + b, 0.008, -0.153 + b);
  g.lineTo(0.006, -0.138 + b);
  g.closePath();
  g.fillStyle = P.coat;
  g.fill();
  g.strokeStyle = P.coatLine;
  g.lineWidth = 0.0022;
  g.stroke();
}

// The head, centred on 0, 0 and facing -x: a weathered face with a big
// wind-reddened nose, a grizzled beard and moustache, a bushy brow that lifts
// with worry, and a mouth that hangs open when he is out of breath.
function drawHead(g, P, o) {
  const { worry, swamped, panting, blink, look, t } = o;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.fillStyle = P.skin;
  g.beginPath(); g.ellipse(0.016, 0.004, 0.008, 0.01, 0, 0, TAU); g.fill();
  g.beginPath();
  g.moveTo(-0.03, -0.022);
  g.bezierCurveTo(-0.02, -0.04, 0.02, -0.042, 0.034, -0.02);
  g.bezierCurveTo(0.042, 0, 0.036, 0.024, 0.018, 0.036);
  g.lineTo(-0.012, 0.042);
  g.bezierCurveTo(-0.03, 0.04, -0.036, 0.02, -0.037, 0.006);
  g.bezierCurveTo(-0.038, -0.006, -0.036, -0.016, -0.03, -0.022);
  g.closePath();
  const skin = g.createRadialGradient(-0.018, -0.01, 0.004, 0, 0, 0.05);
  skin.addColorStop(0, P.skinLit);
  skin.addColorStop(0.6, P.skin);
  skin.addColorStop(1, P.skinDark);
  g.fillStyle = skin;
  g.fill();
  g.strokeStyle = P.skinLine;
  g.lineWidth = 0.0025;
  g.stroke();
  // the ear
  g.fillStyle = P.skin;
  g.beginPath(); g.ellipse(0.017, 0.004, 0.0075, 0.0095, 0.2, 0, TAU); g.fill(); g.stroke();
  g.beginPath(); g.arc(0.017, 0.004, 0.0045, -1.3, 1.7); g.stroke();
  // the chin strap, running down under the beard
  g.strokeStyle = P.coatLine;
  g.lineWidth = 0.0025;
  g.beginPath(); g.moveTo(0.026, -0.026); g.quadraticCurveTo(0.024, 0.01, 0.012, 0.04); g.stroke();
  // a raw cheek
  g.fillStyle = P.cheek;
  g.beginPath(); g.ellipse(-0.02, 0.008, 0.011, 0.0075, 0, 0, TAU); g.fill();
  // the beard
  g.beginPath();
  g.moveTo(0.012, -0.006);
  g.bezierCurveTo(0.021, 0.012, 0.017, 0.034, 0.004, 0.048);
  g.bezierCurveTo(-0.008, 0.061, -0.027, 0.058, -0.037, 0.044);
  g.bezierCurveTo(-0.043, 0.034, -0.042, 0.022, -0.038, 0.014);
  g.bezierCurveTo(-0.03, 0.02, -0.02, 0.018, -0.012, 0.012);
  g.bezierCurveTo(-0.004, 0.006, 0.004, -0.002, 0.012, -0.006);
  g.closePath();
  g.fillStyle = P.beard;
  g.fill();
  g.lineWidth = 0.0016;
  for (let i = 0; i < 10; i++) {
    const u = i / 9, x = lerp(0.011, -0.035, u), y = lerp(0.008, 0.026, u) + Math.sin(u * Math.PI) * 0.012;
    const len = 0.012 + Math.sin(u * Math.PI) * 0.012;
    g.strokeStyle = i % 2 ? P.beardDark : P.beardLit;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - 0.002, y + len * 0.6, x + Math.sin(i * 2.3) * 0.003, y + len); g.stroke();
  }
  // the mouth: set and turned down with worry, open when panting or calling out
  g.fillStyle = P.mouth;
  if (swamped || panting) {
    const open = swamped ? 0.007 + 0.002 * Math.sin(t * 12) : 0.0035 + 0.0015 * Math.sin(t * 10);
    g.beginPath(); g.ellipse(-0.03, 0.031, 0.0055, open, 0, 0, TAU); g.fill();
  } else {
    g.strokeStyle = P.mouth;
    g.lineWidth = 0.003;
    g.beginPath(); g.moveTo(-0.036, 0.03); g.quadraticCurveTo(-0.03, 0.027 + worry * 0.007, -0.023, 0.031); g.stroke();
  }
  // the moustache over it
  g.fillStyle = P.beard;
  g.beginPath(); g.ellipse(-0.032, 0.021, 0.0135, 0.0058, -0.15, 0, TAU); g.fill();
  g.strokeStyle = P.beardDark;
  g.lineWidth = 0.0014;
  g.beginPath();
  for (const x of [-0.04, -0.034, -0.028, -0.022]) { g.moveTo(x, 0.018); g.lineTo(x - 0.002, 0.025); }
  g.stroke();
  // the nose
  g.fillStyle = P.nose;
  g.strokeStyle = P.skinLine;
  g.lineWidth = 0.002;
  g.beginPath(); g.ellipse(-0.04, 0.006, 0.0115, 0.0098, -0.2, 0, TAU); g.fill(); g.stroke();
  g.beginPath(); g.arc(-0.037, 0.01, 0.004, 0.5, 2.4); g.stroke();
  g.fillStyle = "rgba(255, 255, 255, 0.4)";
  g.beginPath(); g.arc(-0.044, 0.002, 0.0026, 0, TAU); g.fill();
  // the eye: wide when he is frightened, glancing back now and then
  const ex = -0.021, ey = -0.008;
  if (blink) {
    g.strokeStyle = P.skinLine;
    g.lineWidth = 0.0025;
    g.beginPath(); g.moveTo(ex - 0.007, ey); g.quadraticCurveTo(ex, ey + 0.003, ex + 0.007, ey); g.stroke();
  } else {
    const wide = swamped ? 1.35 : 1 + worry * 0.15;
    g.fillStyle = "#f7f3ea";
    g.beginPath(); g.ellipse(ex, ey, 0.0072, 0.0056 * wide, 0, 0, TAU); g.fill();
    const px = ex - 0.0005 + look * 0.0024;
    g.fillStyle = P.iris;
    g.beginPath(); g.arc(px, ey + 0.0004, 0.0036, 0, TAU); g.fill();
    g.fillStyle = "#0d0a08";
    g.beginPath(); g.arc(px, ey + 0.0004, 0.0019, 0, TAU); g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(px - 0.0012, ey - 0.0012, 0.0011, 0, TAU); g.fill();
    g.strokeStyle = P.skinLine;
    g.lineWidth = 0.0024;
    g.beginPath(); g.ellipse(ex, ey, 0.0076, 0.006 * wide, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.strokeStyle = "rgba(90, 50, 30, 0.28)";
    g.lineWidth = 0.0015;
    g.beginPath(); g.arc(ex, ey + 0.004, 0.0065, 0.35, 2.75); g.stroke();
  }
  // crow's feet, and the brow
  g.strokeStyle = "rgba(100, 55, 30, 0.3)";
  g.lineWidth = 0.0013;
  g.beginPath(); g.moveTo(ex + 0.009, ey - 0.002); g.lineTo(ex + 0.014, ey - 0.004); g.moveTo(ex + 0.009, ey + 0.002); g.lineTo(ex + 0.014, ey + 0.004); g.stroke();
  g.strokeStyle = P.beardDark;
  g.lineWidth = 0.005;
  g.beginPath(); g.moveTo(ex - 0.009, ey - 0.011 - worry * 0.006); g.quadraticCurveTo(ex, ey - 0.016 - worry * 0.002, ex + 0.009, ey - 0.012 + worry * 0.002); g.stroke();
  if (worry > 0.35) {
    g.strokeStyle = `rgba(110, 60, 35, ${0.4 * (worry - 0.35) / 0.65})`;
    g.lineWidth = 0.0016;
    g.beginPath();
    g.moveTo(-0.027, -0.027); g.quadraticCurveTo(-0.018, -0.03, -0.008, -0.028);
    g.moveTo(-0.025, -0.032); g.quadraticCurveTo(-0.017, -0.035, -0.009, -0.033);
    g.stroke();
  }
  // sweat, flicked off the brow
  if (worry > 0.45 && !swamped) {
    const k = (t * 0.9) % 1, x = -0.032 - k * 0.014, y = -0.026 + k * 0.03;
    g.globalAlpha = 1 - k;
    g.fillStyle = P.sweat;
    g.beginPath(); g.moveTo(x, y - 0.006); g.quadraticCurveTo(x + 0.004, y, x, y + 0.002); g.quadraticCurveTo(x - 0.004, y, x, y - 0.006); g.fill();
    g.globalAlpha = 1;
  }
}

// A tin pail: shaded round its side, ribbed, its open top showing — and the
// water in it when it is full — with its wire handle.
function drawBucketShape(g, P, full) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = P.bucketDark;
  g.lineWidth = 0.0035;
  g.beginPath(); g.moveTo(-0.031, -0.028); g.quadraticCurveTo(0, -0.076, 0.031, -0.028); g.stroke();
  g.beginPath();
  g.moveTo(-0.033, -0.028); g.lineTo(0.033, -0.028); g.lineTo(0.025, 0.032);
  g.quadraticCurveTo(0, 0.037, -0.025, 0.032);
  g.closePath();
  const side = g.createLinearGradient(-0.033, 0, 0.033, 0);
  side.addColorStop(0, P.bucketDark);
  side.addColorStop(0.25, "#dfe6ec");
  side.addColorStop(0.5, P.bucket);
  side.addColorStop(1, P.bucketDark);
  g.fillStyle = side;
  g.fill();
  g.strokeStyle = P.bucketDark;
  g.lineWidth = 0.0025;
  g.stroke();
  g.beginPath();
  g.moveTo(-0.031, -0.012); g.quadraticCurveTo(0, -0.008, 0.031, -0.012);
  g.moveTo(-0.027, 0.018); g.quadraticCurveTo(0, 0.022, 0.027, 0.018);
  g.stroke();
  // the open top
  g.fillStyle = full ? P.inside : "#3a4048";
  g.beginPath(); g.ellipse(0, -0.028, 0.033, 0.0075, 0, 0, TAU); g.fill();
  if (full) {
    g.strokeStyle = P.insideTop;
    g.lineWidth = 0.0018;
    g.beginPath(); g.ellipse(-0.006, -0.0285, 0.016, 0.0028, 0, Math.PI, TAU); g.stroke();
  }
  g.strokeStyle = "#e9eef2";
  g.lineWidth = 0.0028;
  g.beginPath(); g.ellipse(0, -0.028, 0.033, 0.0075, 0, 0, TAU); g.stroke();
  g.fillStyle = P.bucketDark;
  for (const x of [-0.032, 0.032]) { g.beginPath(); g.arc(x, -0.026, 0.0028, 0, TAU); g.fill(); }
}

// A point worked out in the sailor's poses, where it is drawn: he is drawn
// bigger about his hip.
function sailorPoint(x, y) {
  return { x: SAILOR_X + (x - SAILOR_X) * SAILOR_SCALE, y: SAILOR_HIP + (y - SAILOR_HIP) * SAILOR_SCALE };
}

function quad(a, b, c, u) {
  return (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c;
}

// A lantern hanging from (0, 0): its cap, a glass with a flame in it, brass
// bars and a base.
function drawLantern(g, P, flicker) {
  g.strokeStyle = P.brass;
  g.lineWidth = 0.003;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 0.012); g.stroke();
  g.fillStyle = P.brass;
  g.beginPath(); g.moveTo(-0.008, 0.012); g.lineTo(0.008, 0.012); g.lineTo(0.019, 0.024); g.lineTo(-0.019, 0.024); g.closePath(); g.fill();
  g.fillStyle = `rgba(255, 196, 110, ${0.55 + 0.35 * flicker})`;
  g.fillRect(-0.015, 0.024, 0.03, 0.04);
  g.fillStyle = "#fff4cf";
  g.beginPath();
  g.moveTo(0, 0.034 - 0.006 * flicker);
  g.quadraticCurveTo(0.007, 0.05, 0, 0.056);
  g.quadraticCurveTo(-0.007, 0.05, 0, 0.034 - 0.006 * flicker);
  g.fill();
  g.strokeStyle = P.brass;
  g.lineWidth = 0.003;
  g.beginPath();
  for (const x of [-0.015, 0, 0.015]) { g.moveTo(x, 0.024); g.lineTo(x, 0.064); }
  g.stroke();
  g.fillStyle = P.brass;
  g.fillRect(-0.019, 0.064, 0.038, 0.007);
}

// The fin, one unit tall, its leading edge facing +x and its base on y = 0.
function finPath(g) {
  g.beginPath();
  g.moveTo(0.62, 0.05);
  g.quadraticCurveTo(0.4, -0.7, -0.32, -1.08);
  g.quadraticCurveTo(-0.2, -0.45, -0.6, 0.05);
  g.closePath();
}

// A whole shark, one unit long, nose at +x: grey above, pale beneath, with a
// grin of small white teeth.
function drawShark(g, P) {
  g.fillStyle = P.shark;
  // tail, dorsal fin and pectoral fin
  g.beginPath();
  g.moveTo(-0.36, -0.02); g.quadraticCurveTo(-0.46, -0.12, -0.56, -0.22); g.quadraticCurveTo(-0.5, -0.06, -0.47, 0);
  g.quadraticCurveTo(-0.5, 0.07, -0.54, 0.13); g.quadraticCurveTo(-0.44, 0.08, -0.36, 0.03);
  g.closePath(); g.fill();
  g.beginPath(); g.moveTo(0.06, -0.1); g.quadraticCurveTo(-0.02, -0.2, -0.1, -0.28); g.quadraticCurveTo(-0.08, -0.17, -0.13, -0.08); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(0.16, 0.06); g.quadraticCurveTo(0.08, 0.15, 0, 0.2); g.quadraticCurveTo(0.06, 0.1, 0.05, 0.06); g.closePath(); g.fill();
  const body = () => {
    g.beginPath();
    g.moveTo(0.5, 0);
    g.bezierCurveTo(0.46, -0.08, 0.25, -0.12, 0.02, -0.115);
    g.bezierCurveTo(-0.18, -0.105, -0.3, -0.05, -0.38, -0.02);
    g.lineTo(-0.38, 0.03);
    g.bezierCurveTo(-0.28, 0.06, -0.1, 0.1, 0.12, 0.095);
    g.bezierCurveTo(0.32, 0.09, 0.46, 0.06, 0.5, 0);
    g.closePath();
  };
  body(); g.fill();
  g.save();
  body(); g.clip();
  g.fillStyle = P.belly;
  g.beginPath(); g.ellipse(0.1, 0.1, 0.42, 0.07, -0.02, 0, TAU); g.fill();
  g.strokeStyle = P.sharkLit;
  g.lineWidth = 0.012;
  g.beginPath(); g.moveTo(0.46, -0.05); g.bezierCurveTo(0.3, -0.11, 0, -0.12, -0.3, -0.05); g.stroke();
  g.restore();
  g.strokeStyle = "rgba(0, 0, 0, 0.35)";
  g.lineWidth = 0.008;
  for (const x of [0.22, 0.25, 0.28]) { g.beginPath(); g.moveTo(x, -0.04); g.quadraticCurveTo(x - 0.012, 0, x, 0.04); g.stroke(); }
  g.fillStyle = "#0b0d10";
  g.beginPath(); g.arc(0.38, -0.03, 0.013, 0, TAU); g.fill();
  g.fillStyle = "rgba(255, 255, 255, 0.8)";
  g.beginPath(); g.arc(0.384, -0.034, 0.004, 0, TAU); g.fill();
  g.strokeStyle = "#1a1012";
  g.beginPath(); g.moveTo(0.47, 0.035); g.quadraticCurveTo(0.42, 0.06, 0.35, 0.05); g.stroke();
  g.fillStyle = "#ffffff";
  for (let i = 0; i < 4; i++) {
    const x = 0.455 - i * 0.026, y = 0.042 + i * 0.004;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 0.008, y + 0.016); g.lineTo(x - 0.016, y + 0.002); g.closePath(); g.fill();
  }
}

// A cloud: overlapping puffs on a flat base, shaded beneath and lit along the
// top.
function cloudCanvas(w, h, P, seed) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext("2d");
  const r = rng(seed), n = 6 + Math.floor(r() * 4), puffs = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const pr = h * (0.2 + 0.18 * r()) * (1 - Math.abs(u - 0.5) * 0.9);
    puffs.push([w * (0.14 + 0.72 * u) + (r() - 0.5) * w * 0.05, h * 0.66 - pr * (0.3 + 0.5 * r()), pr]);
  }
  const blob = (dy) => {
    g.beginPath();
    for (const [x, y, pr] of puffs) { g.moveTo(x + pr, y + dy); g.arc(x, y + dy, pr, 0, TAU); }
    g.ellipse(w / 2, h * 0.74 + dy, w * 0.4, h * 0.12, 0, 0, TAU);
    g.fill();
  };
  g.fillStyle = P.cloud.shade;
  blob(h * 0.06);
  g.fillStyle = P.cloud.body;
  blob(0);
  g.globalCompositeOperation = "source-atop";
  const rim = g.createLinearGradient(0, 0, 0, h * 0.7);
  rim.addColorStop(0, P.cloud.rim);
  rim.addColorStop(1, P.cloud.rimClear);
  g.fillStyle = rim;
  g.fillRect(0, 0, w, h);
  const under = g.createLinearGradient(0, h * 0.68, 0, h);
  under.addColorStop(0, P.cloud.shadeClear);
  under.addColorStop(1, P.cloud.shade);
  g.fillStyle = under;
  g.fillRect(0, 0, w, h);
  return c;
}

// A steady pseudo-random number in 0..1 for a whole number: the same one
// every frame, so what it places stays put.
function hash(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The bail at a point through it, eased from pose to pose.
function posed(p) {
  let i = 0;
  while (i < POSES.length - 2 && p > POSES[i + 1][0]) i++;
  const a = POSES[i], b = POSES[i + 1];
  const k = smooth(clamp((p - a[0]) / (b[0] - a[0]), 0, 1));
  return {
    x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), turn: lerp(a[3], b[3], k), lean: lerp(a[4], b[4], k),
    full: p > 0.38 && p < POUR_AT
  };
}

function clock(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, String(Math.round(v * 10) / 10)); } catch (e) { /* ignore */ }
}
