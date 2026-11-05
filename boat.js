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

// The boat is drawn in its own frame, one unit to its length, bow to the
// right, y down. `wl` is where in that frame the sea's surface comes to.
const WL_EMPTY = 0.0, WL_FULL = -0.1, WL_GONE = -0.64, WL_BOTTOM = -1.7;
const SAILOR_X = 0.05;        // where the sailor sits
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
    flood: ["#1e4678", "#040e20"]
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
    flood: ["#4678a0", "#143454"]
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
    const hint = this.hint = document.createElement("p");
    hint.className = "boat-hint";
    hint.textContent = "Rub back and forth over the sailor to help them bail";

    const sunk = this.sunk = document.createElement("div");
    sunk.className = "boat-sunk";
    sunk.hidden = true;
    const title = document.createElement("h2");
    title.textContent = "The boat went under.";
    this.sunkTime = document.createElement("p");
    const row = document.createElement("div");
    row.className = "boat-sunk-row";
    const reset = this.resetBtn = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn-solid";
    reset.textContent = "Reset";
    reset.addEventListener("click", () => this.reset());
    const back = document.createElement("a");
    back.className = "btn btn-ghost";
    back.href = "index.html";
    back.textContent = "Back to the desk";
    row.append(reset, back);
    sunk.append(title, this.sunkTime, row);

    this.live = document.createElement("p");
    this.live.className = "sr-only";
    this.live.setAttribute("aria-live", "polite");
    const how = document.createElement("p");
    how.className = "sr-only";
    how.textContent = "Rub the pointer over the sailor, or press Space, to bail water out of the boat before it sinks.";
    el.append(canvas, hud, hint, sunk, how, this.live);
    document.body.append(el);
    document.body.classList.add("at-sea");

    this.pointer = null;
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerdown", (e) => { this.pointer = this.local(e); this.onMove(e); });
    canvas.addEventListener("pointerleave", () => { this.pointer = null; this.canvas.style.cursor = ""; });
    window.addEventListener("keydown", (e) => {
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
    const p = this.local(e);
    const was = this.pointer;
    this.pointer = p;
    const s = this.sailorAt;
    const over = s && this.phase === "afloat" && Math.hypot(p.x - s.x, p.y - s.y) < this.L * 0.21;
    this.canvas.style.cursor = over ? "grab" : "";
    if (!over || !was) return;
    const dist = Math.hypot(p.x - was.x, p.y - was.y);
    if (dist < 120) this.rub(dist / (this.L * RUB_PER_BAIL));
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
    this.hud.dataset.show = "true";
    this.canvas.focus({ preventScroll: true });
    this.live.textContent = "The boat bobs back up, empty — for now.";
  }

  // ----- The sea -----
  surf(x) {
    const { L, t } = this;
    const A = Math.min(L * 0.035, this.H * 0.03) * (reduceMotion ? 0.4 : 1);
    return this.seaNow + A * (
      0.55 * Math.sin(x * TAU / (L * 2.2) - t * 0.9) +
      0.3 * Math.sin(x * TAU / (L * 1.1) + t * 0.62 + 1.7) +
      0.15 * Math.sin(x * TAU / (L * 0.42) - t * 1.7 + 0.4));
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
    this.sailorAt = this.toSea(b, SAILOR_X - 0.05, -0.2);

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
      if (d.vy > 0 && d.y > this.surf(d.x)) {
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
    if (this.bails === 3) this.hint.dataset.show = "false";
    const b = this.boat;
    const p = posed(POUR_AT);
    const mouth = this.toSea(b, SAILOR_X + p.x + 0.03 * Math.sin(p.turn), p.y - 0.03 * Math.cos(p.turn));
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
    const at = this.toSea(b, SAILOR_X - 0.08, -0.17);
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
    this.sunkTime.textContent = `Kept afloat for ${clock(this.afloat)}${record ? " — your longest yet." : this.best > 0 ? ` · longest ${clock(this.best)}` : ""}`;
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
    const orb = { x: W * 0.76, y: this.seaBase * 0.3 + dy, r: Math.max(14, Math.min(W, H) * 0.035) };
    const glow = g.createRadialGradient(orb.x, orb.y, orb.r * 0.5, orb.x, orb.y, orb.r * 7);
    glow.addColorStop(0, P.orbGlow[0]);
    glow.addColorStop(1, P.orbGlow[1]);
    g.fillStyle = glow;
    g.fillRect(orb.x - orb.r * 7, orb.y - orb.r * 7, orb.r * 14, orb.r * 14);
    g.fillStyle = P.orb;
    g.beginPath(); g.arc(orb.x, orb.y, orb.r, 0, TAU); g.fill();

    // the far sea, out to the horizon, with lines of swell coming in
    const far = g.createLinearGradient(0, horizon, 0, this.seaNow);
    far.addColorStop(0, P.far[0]);
    far.addColorStop(1, P.far[1]);
    g.fillStyle = far;
    g.fillRect(0, horizon, W, H - horizon);
    g.strokeStyle = P.line;
    g.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      const k = i / 9, y = horizon + (this.seaNow - horizon) * k * k;
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
    sea.addColorStop(1, P.sea[1]);
    g.fillStyle = sea;
    g.fill();

    this.drawBoat();

    // flung water, and where it lands
    g.fillStyle = P.drop;
    for (const d of this.drops) { g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill(); }
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
    g.strokeStyle = P.foam;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 8) (x > -10 ? g.lineTo(x, this.surf(x)) : g.moveTo(x, this.surf(x)));
    g.stroke();

    for (const s of this.scraps) if (s.d === 1) this.drawScrap(s, horizon);
    for (const f of this.floaters) this.drawFloater(f);
    this.drawBubbles(() => true);
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
      g.strokeStyle = P.drop;
      for (const [width, alpha] of [[0.022, 0.35], [0.01, 0.9]]) {
        g.globalAlpha = alpha;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(HOLE.x, HOLE.y);
        g.quadraticCurveTo(HOLE.x - sway, (HOLE.y + top) / 2, HOLE.x + sway, top + 0.01);
        g.stroke();
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
    g.strokeStyle = P.strake;
    g.lineWidth = 0.004;
    for (const off of [0.045, 0.09, 0.135, 0.18]) {
      g.beginPath();
      g.moveTo(-0.6, -0.135 + off);
      g.quadraticCurveTo(0.05, -0.105 + off, 0.62, -0.215 + off * 0.75);
      g.stroke();
    }
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
    g.restore();
  }

  drawSailor() {
    const { g, P, t } = this;
    const swamped = this.phase === "swamping" || this.phase === "sunk";
    const pose = swamped ? null : posed(this.bail % 1);
    const lean = swamped ? -0.1 + Math.sin(t * 9) * 0.05 : pose.lean;
    const worry = swamped ? 1 : clamp(this.water * 1.25 - 0.1, 0, 1);
    const breathe = Math.sin(t * 2.2) * 0.003;
    const hip = { x: SAILOR_X, y: -0.075 };
    // the body turns about the hip, leaning in to the work
    const rot = -lean * 0.9;
    const c = Math.cos(rot), s = Math.sin(rot);
    const body = (x, y) => ({ x: hip.x + x * c - y * s, y: hip.y + x * s + y * c });
    const shoulder = body(0.004, -0.118 + breathe);
    const far = body(0.016, -0.114 + breathe);

    // where the hands are
    let hands, bucket = null;
    if (swamped) {
      const wave = Math.sin(t * 11) * 0.025;
      hands = [{ x: shoulder.x - 0.05 + wave, y: shoulder.y - 0.1 }, { x: far.x + 0.04 - wave, y: far.y - 0.11 }];
    } else {
      bucket = pose;
      const cb = Math.cos(pose.turn), sb = Math.sin(pose.turn);
      const rim = (x, y) => ({ x: pose.x + x * cb - y * sb, y: pose.y + x * sb + y * cb });
      hands = [rim(-0.03, -0.028), rim(0.03, -0.028)];
      hands[0].x += SAILOR_X; hands[1].x += SAILOR_X;
      bucket = { ...pose, x: pose.x + SAILOR_X };
    }

    // the far arm, behind everything
    this.arm(far, hands[1], P.coatDark);

    // the body: a yellow oilskin
    g.save();
    g.translate(hip.x, hip.y);
    g.rotate(rot);
    g.fillStyle = P.coat;
    g.strokeStyle = P.coatDark;
    g.lineWidth = 0.004;
    g.beginPath();
    g.moveTo(-0.038, 0.01);
    g.lineTo(-0.036, -0.1);
    g.quadraticCurveTo(-0.03, -0.135 + breathe, 0.004, -0.137 + breathe);
    g.quadraticCurveTo(0.036, -0.134 + breathe, 0.04, -0.1);
    g.lineTo(0.044, 0.01);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath(); g.moveTo(-0.02, -0.128); g.lineTo(-0.024, 0.0); g.stroke();
    // the head
    const hx = -0.006, hy = -0.176 + breathe;
    g.fillStyle = P.skin;
    g.beginPath(); g.arc(hx, hy, 0.038, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx - 0.034, hy + 0.004, 0.009, 0, TAU); g.fill();
    g.fillStyle = P.cheek;
    g.beginPath(); g.arc(hx - 0.016, hy + 0.012, 0.008, 0, TAU); g.fill();
    // a face that worries more the fuller the boat gets
    g.fillStyle = P.ink;
    const blink = this.blinkAt - t < 0.12;
    if (blink) g.fillRect(hx - 0.026, hy - 0.006, 0.01, 0.002);
    else { g.beginPath(); g.arc(hx - 0.021, hy - 0.006, swamped ? 0.0065 : 0.0045, 0, TAU); g.fill(); }
    g.strokeStyle = P.ink;
    g.lineWidth = 0.003;
    g.beginPath();
    g.moveTo(hx - 0.031, hy - 0.016 + worry * 0.002);
    g.lineTo(hx - 0.013, hy - 0.019 - worry * 0.007);
    g.stroke();
    g.beginPath();
    if (swamped) g.ellipse(hx - 0.022, hy + 0.017, 0.006, 0.008, 0, 0, TAU);
    else {
      const m = 0.004 - worry * 0.009;
      g.moveTo(hx - 0.03, hy + 0.016);
      g.quadraticCurveTo(hx - 0.023, hy + 0.016 + m, hx - 0.014, hy + 0.017);
    }
    g.stroke();
    // the sou'wester, until the sea takes it
    if (!this.floaters.some((f) => f.kind === "hat")) {
      g.translate(hx, hy - 0.017);
      drawHat(g, P);
      g.translate(-hx, -hy + 0.017);
      if (swamped) {
        const at = this.toSea(this.boat, hip.x + (hx * c - (hy - 0.03) * s), hip.y + (hx * s + (hy - 0.03) * c));
        if (at.y > this.surf(at.x)) this.floaters.push({ kind: "hat", x: at.x, y: at.y, vx: this.L * 0.12, vy: 0, turn: rot, lean: -0.15, ride: 0.02 });
      }
    }
    g.restore();

    // the bucket, and the near arm over it
    if (bucket) this.drawBucket(bucket.x, bucket.y, bucket.turn, bucket.full);
    this.arm(shoulder, hands[0], P.coat);
  }

  // an arm in two parts, bent at the elbow, and a hand
  arm(from, to, color) {
    const { g, P } = this;
    const a = 0.076, b = 0.076;
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.min(Math.hypot(dx, dy), a + b - 0.001);
    const base = Math.atan2(dy, dx);
    const bend = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const elbow = { x: from.x + Math.cos(base - bend) * a, y: from.y + Math.sin(base - bend) * a };
    g.strokeStyle = color;
    g.lineWidth = 0.022;
    g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(elbow.x, elbow.y); g.lineTo(to.x, to.y); g.stroke();
    g.fillStyle = P.skin;
    g.beginPath(); g.arc(to.x, to.y, 0.011, 0, TAU); g.fill();
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
    g.scale(L, L);
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

function drawHat(g, P) {
  g.fillStyle = P.coat;
  g.strokeStyle = P.coatDark;
  g.lineWidth = 0.004;
  g.beginPath();
  g.arc(0.002, -0.012, 0.039, Math.PI * 1.02, Math.PI * 1.98);
  g.closePath();
  g.fill();
  g.stroke();
  // the brim, longer at the back to keep the rain off the neck
  g.beginPath();
  g.moveTo(-0.05, -0.012);
  g.quadraticCurveTo(0.0, -0.022, 0.05, -0.012);
  g.quadraticCurveTo(0.066, -0.004, 0.07, 0.012);
  g.quadraticCurveTo(0.04, 0.0, -0.05, -0.004);
  g.closePath();
  g.fill();
  g.stroke();
}

function drawBucketShape(g, P, full) {
  g.lineWidth = 0.004;
  g.strokeStyle = P.bucketDark;
  g.beginPath();
  g.moveTo(-0.03, -0.03);
  g.quadraticCurveTo(0, -0.075, 0.03, -0.03);
  g.stroke();
  g.fillStyle = P.bucket;
  g.beginPath();
  g.moveTo(-0.033, -0.03); g.lineTo(0.033, -0.03); g.lineTo(0.024, 0.032); g.lineTo(-0.024, 0.032);
  g.closePath();
  g.fill();
  g.stroke();
  g.strokeStyle = P.bucketDark;
  g.beginPath(); g.moveTo(-0.031, -0.018); g.lineTo(0.031, -0.018); g.stroke();
  if (full) {
    g.fillStyle = P.inside;
    g.beginPath(); g.ellipse(0, -0.03, 0.031, 0.006, 0, 0, TAU); g.fill();
  }
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
