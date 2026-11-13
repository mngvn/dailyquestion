// flies.js — the flies, each with something written on it.
//
// There are always a few in the air in front of the web, going about the way
// flies do. Every so often one blunders into it: the web jumps, the fly
// sticks and buzzes itself tired. Click one that is stuck and orb.js shows
// what it was carrying — one of today's notes first, then whatever else is in
// data.js. A fly that has been read is the spider's: it comes over, wraps it
// up, and the parcel hangs there until there are too many and the oldest is
// cut loose.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const turnTo = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// Each kind of note has its colour, and the fly that carries it is that colour.
export const HUES = {
  Tech: { name: "Tech", rgb: "110, 170, 255", deep: "#1b3f96", lit: "#bcd8ff" },
  Art: { name: "Art", rgb: "255, 130, 175", deep: "#8e1f52", lit: "#ffd0e0" },
  History: { name: "History", rgb: "255, 200, 90", deep: "#8a5410", lit: "#ffe9b0" },
  Misc: { name: "Misc", rgb: "110, 225, 150", deep: "#136a43", lit: "#c8f6d6" },
  day: { name: "On this day", rgb: "190, 150, 255", deep: "#4c2a9c", lit: "#e2d4ff" }
};
// One with nothing to carry yet is just a fly.
const PLAIN = { rgb: "96, 116, 150", deep: "#1c2536", lit: "#aebcd6" };

class Fly {
  constructor(owner, x, y, z) {
    this.o = owner;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.a = rand(0, TAU);          // which way it points, on the page
    this.state = "air";
    this.way = null; this.wayT = 0;
    this.note = null; this.hue = PLAIN;
    this.node = -1;
    this.buzz = 1;                  // 0 to 1: how hard its wings are going
    this.vigour = 1;                // what struggle it has left
    this.burst = 0; this.rest = 0;
    this.read = false; this.wrap = 0; this.spin = 0;
    this.age = 0; this.fade = 1; this.gone = false;
    this.seed = rand(0, 100);
    this.sx = 0; this.sy = 0; this.sc = 1;
  }

  // ----- in the air -----
  fly(dt, t) {
    const { W, H, k } = this.o;
    const diving = this.state === "dive";
    if (diving) {
      const w = this.o.web;
      this.way = { x: w.x[this.node], y: w.y[this.node], z: w.z[this.node] };
    } else if (!this.way || (this.wayT -= dt) <= 0) {
      this.way = { x: rand(-0.05, 1.05) * W, y: rand(0.04, 0.96) * H, z: rand(90, 520) };
      this.wayT = rand(0.35, 1.3);
    }
    const dx = this.way.x - this.x, dy = this.way.y - this.y, dz = this.way.z - this.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const top = (diving ? 430 : 300) * k, pull = diving ? 5 : 3.2;
    // steer for it, with a wobble: flies never go straight anywhere
    const wob = diving ? clamp(d / 220, 0, 1) : 1;
    this.vx += (dx / d * top - this.vx) * pull * dt + Math.sin(t * 9 + this.seed) * 900 * k * wob * dt;
    this.vy += (dy / d * top - this.vy) * pull * dt + Math.cos(t * 11 + this.seed * 2) * 900 * k * wob * dt;
    this.vz += (dz / d * top - this.vz) * pull * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.a += turnTo(this.a, Math.atan2(this.vy, this.vx)) * Math.min(1, dt * 12);
    this.buzz = 1;
    if (diving && (d < 14 * k + Math.hypot(this.vx, this.vy, this.vz) * dt || this.z < this.way.z - 2)) this.hit();
  }

  hit() {
    const { web, k } = this.o;
    this.state = "stuck";
    web.shove(web.x[this.node], web.y[this.node], 120 * k, this.vx * 0.9, this.vy * 0.9, -1300);
    this.vigour = 1; this.burst = rand(1.2, 2); this.rest = 0; this.age = 0;
    this.o.caught(this);
  }
  prod() { if (this.burst <= 0) { this.burst = rand(0.25, 0.5); this.vigour = Math.max(this.vigour, 0.5); } }
  wrapBegin() { this.state = "wrapping"; this.burst = 0.8; this.vigour = 1; }
  wrapTo(p) { this.wrap = clamp(p, 0, 1); }
  wrapEnd() { this.wrap = 1; this.state = "wrapped"; this.age = 0; this.o.parcelled(this); }

  // ----- on the web -----
  held(dt, t) {
    const { web } = this.o;
    this.age += dt;
    if (this.state === "falling") {
      this.vy += 900 * dt; this.y += this.vy * dt; this.x += this.vx * dt; this.spin += dt * 5;
      this.fade -= dt * 1.2;
      if (this.fade <= 0) this.gone = true;
      return;
    }
    this.x = web.x[this.node]; this.y = web.y[this.node]; this.z = web.z[this.node];
    web.load(this.node, 0, this.state === "wrapped" ? 60 : 110, 0);
    if (this.state === "wrapped") { this.buzz = 0; return; }
    if (this.state === "wrapping") this.spin += dt * (5 + 9 * this.wrap);
    // it struggles in fits, and less each time
    if (this.burst > 0) {
      this.burst -= dt;
      const f = 0.3 + 0.7 * this.vigour;
      web.kick(this.node, rand(-1, 1) * 150 * f, rand(-1, 1) * 150 * f, rand(-1, 1) * 420 * f);
      this.buzz = Math.min(1, this.buzz + dt * 12);
      if (this.burst <= 0) {
        this.vigour = Math.max(0.12, this.vigour * 0.8);
        this.rest = this.state === "wrapping" ? rand(0.1, 0.3) : rand(1.2, 3.2) / (0.25 + this.vigour) * (this.read ? 2.2 : 1);
      }
    } else {
      this.buzz = Math.max(0, this.buzz - dt * 7);
      this.rest -= dt * (this.hover ? 3 : 1);
      if (this.rest <= 0) this.burst = rand(0.3, 0.9) * (0.4 + 0.6 * this.vigour);
    }
  }

  // ----- drawing -----
  draw(g, eye, P, t) {
    const o = this.o, U = o.size * (this.sc = eye.s(this.z));
    const sx = this.sx = eye.x(this.x, this.z), sy = this.sy = eye.y(this.y, this.z);
    const inAir = this.state === "air" || this.state === "dive";
    const jit = this.buzz * (inAir ? 0 : 1);
    g.save();
    g.globalAlpha = this.fade * (inAir ? clamp(1.25 - this.z / 900, 0.55, 1) : 1);
    g.translate(sx + Math.sin(t * 61 + this.seed) * jit * 1.1, sy + Math.cos(t * 53 + this.seed) * jit * 1.1);

    // one not yet read has a light about it, the colour of what it carries
    if (!inAir && !this.read && this.state === "stuck") {
      const beat = 0.6 + 0.4 * Math.sin(t * 2.6 + this.seed), r = U * (2.1 + 0.25 * beat) * (this.hover ? 1.25 : 1);
      const halo = g.createRadialGradient(0, 0, U * 0.2, 0, 0, r);
      halo.addColorStop(0, `rgba(${this.hue.rgb}, ${0.34 + 0.2 * beat + (this.hover ? 0.2 : 0)})`);
      halo.addColorStop(0.5, `rgba(${this.hue.rgb}, ${0.1 + 0.06 * beat})`);
      halo.addColorStop(1, `rgba(${this.hue.rgb}, 0)`);
      g.globalCompositeOperation = "lighter";
      g.fillStyle = halo;
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
      g.globalCompositeOperation = "source-over";
      // and a ring going out from it, like a thing calling
      const ring = (t * 0.55 + this.seed) % 1;
      g.strokeStyle = `rgba(${this.hue.rgb}, ${0.5 * (1 - ring)})`;
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(0, 0, U * (0.9 + 1.6 * ring), 0, TAU); g.stroke();
    }

    g.rotate(this.a + Math.PI / 2 + Math.sin(t * 47 + this.seed) * 0.12 * jit + this.spin);
    g.scale(U, U);
    if (this.wrap >= 1) this.drawParcel(g, P);
    else {
      this.drawBody(g, P, t, inAir);
      if (this.wrap > 0) { g.globalAlpha *= clamp(this.wrap * 1.3, 0, 1); this.drawParcel(g, P, this.wrap); }
    }
    g.restore();
  }

  // Drawn one body-length long, head up (−y).
  drawBody(g, P, t, inAir) {
    const hue = this.hue, dim = this.read ? 0.55 : 1;
    const light = P === "light";
    g.lineCap = "round"; g.lineJoin = "round";
    // legs: three a side, crooked
    g.strokeStyle = light ? "#15130f" : "#0a0c12"; g.lineWidth = 0.035;
    const twitch = Math.sin(t * 30 + this.seed) * 0.03 * this.buzz;
    g.beginPath();
    for (const sd of [-1, 1]) {
      const legs = inAir
        ? [[-0.12, 0.2, -0.06, 0.34], [0, 0.24, 0.08, 0.36], [0.1, 0.22, 0.22, 0.32]]
        : [[-0.16, 0.34, -0.42, 0.44], [0.0, 0.42, 0.02, 0.62], [0.12, 0.36, 0.42, 0.5]];
      for (const [y0, kx, y1, fx] of legs) {
        g.moveTo(sd * 0.1, y0);
        g.lineTo(sd * (kx + twitch), (y0 + y1) / 2 - 0.05);
        g.lineTo(sd * (fx - twitch), y1);
      }
    }
    g.stroke();
    if (!light) { g.strokeStyle = "rgba(170, 195, 240, 0.35)"; g.lineWidth = 0.012; g.stroke(); }

    // abdomen: glossy, the colour of its note
    const ab = g.createRadialGradient(-0.07, 0.16, 0.02, 0, 0.24, 0.34);
    ab.addColorStop(0, hue.lit); ab.addColorStop(0.35, `rgb(${hue.rgb})`); ab.addColorStop(1, hue.deep);
    g.globalAlpha *= dim;
    g.fillStyle = ab;
    g.beginPath(); g.ellipse(0, 0.25, 0.2, 0.29, 0, 0, TAU); g.fill();
    g.globalAlpha /= dim;
    g.strokeStyle = "rgba(0, 0, 0, 0.4)"; g.lineWidth = 0.014;
    g.beginPath();
    for (let q = 1; q < 4; q++) { g.moveTo(-0.19 + q * 0.012, 0.1 + q * 0.1); g.quadraticCurveTo(0, 0.16 + q * 0.1, 0.19 - q * 0.012, 0.1 + q * 0.1); }
    g.stroke();
    // thorax: dark, striped
    const th = g.createRadialGradient(-0.05, -0.16, 0.01, 0, -0.12, 0.24);
    th.addColorStop(0, "#5e6676"); th.addColorStop(0.5, "#272b36"); th.addColorStop(1, "#0b0d12");
    g.fillStyle = th;
    g.beginPath(); g.ellipse(0, -0.11, 0.185, 0.19, 0, 0, TAU); g.fill();
    g.strokeStyle = "rgba(190, 200, 220, 0.28)"; g.lineWidth = 0.018;
    g.beginPath(); g.moveTo(-0.06, -0.26); g.lineTo(-0.07, 0.03); g.moveTo(0.06, -0.26); g.lineTo(0.07, 0.03); g.stroke();
    // head, and the two great eyes
    g.fillStyle = "#14161c";
    g.beginPath(); g.ellipse(0, -0.34, 0.13, 0.1, 0, 0, TAU); g.fill();
    for (const sd of [-1, 1]) {
      const ey = g.createRadialGradient(sd * 0.1, -0.38, 0.005, sd * 0.085, -0.35, 0.085);
      ey.addColorStop(0, "#ff9a6a"); ey.addColorStop(0.5, "#b3331c"); ey.addColorStop(1, "#4a0e08");
      g.fillStyle = ey;
      g.beginPath(); g.ellipse(sd * 0.085, -0.35, 0.068, 0.085, sd * 0.3, 0, TAU); g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.75)";
      g.beginPath(); g.arc(sd * 0.1, -0.385, 0.014, 0, TAU); g.fill();
    }
    // lit round the edge, so it stands off the dark
    g.strokeStyle = light ? "rgba(255, 246, 215, 0.5)" : "rgba(175, 205, 255, 0.5)"; g.lineWidth = 0.016;
    g.beginPath(); g.ellipse(0, 0.25, 0.2, 0.29, 0, Math.PI * 0.95, Math.PI * 1.75); g.stroke();
    g.beginPath(); g.ellipse(0, -0.11, 0.185, 0.19, 0, Math.PI * 0.95, Math.PI * 1.7); g.stroke();

    // wings: folded back when it is still, a blur when it is not
    const b = this.buzz;
    const fold = 0.42, open = 1.25;
    const wing = (ang, alpha) => {
      for (const sd of [-1, 1]) {
        g.save();
        g.translate(sd * 0.09, -0.12);
        g.rotate(sd * ang);
        g.fillStyle = light ? `rgba(255, 255, 255, ${0.2 * alpha})` : `rgba(195, 222, 255, ${0.13 * alpha})`;
        g.strokeStyle = light ? `rgba(60, 60, 50, ${0.5 * alpha})` : `rgba(225, 240, 255, ${0.6 * alpha})`;
        g.lineWidth = 0.013;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(sd * 0.16, 0.08, sd * 0.2, 0.5, sd * 0.06, 0.68);
        g.bezierCurveTo(-sd * 0.06, 0.6, -sd * 0.05, 0.2, 0, 0);
        g.fill(); g.stroke();
        if (alpha > 0.7) {
          g.lineWidth = 0.008;
          g.beginPath();
          g.moveTo(0, 0.02); g.quadraticCurveTo(sd * 0.1, 0.3, sd * 0.07, 0.62);
          g.moveTo(0, 0.02); g.quadraticCurveTo(sd * 0.03, 0.3, sd * 0.0, 0.55);
          g.moveTo(sd * 0.055, 0.3); g.lineTo(sd * 0.13, 0.36);
          g.stroke();
        }
        g.restore();
      }
    };
    if (b < 0.08) wing(fold, 1);
    else {
      const mid = lerp(fold, open, b);
      const beat = Math.sin(t * 95 + this.seed);
      wing(mid + 0.42 * b, 0.3); wing(mid - 0.34 * b, 0.3); wing(mid + beat * 0.38 * b, 0.55);
    }
  }

  // Wrapped: a bundle of silk, wound every which way. `part` is how far the
  // winding has got.
  drawParcel(g, P, part = 1) {
    const light = P === "light";
    const sh = g.createRadialGradient(-0.06, -0.08, 0.02, 0, 0, 0.44);
    sh.addColorStop(0, "#ffffff"); sh.addColorStop(0.55, light ? "#ece6d4" : "#c9d6ee"); sh.addColorStop(1, light ? "#a8a48e" : "#6c7ea6");
    g.fillStyle = sh;
    g.beginPath(); g.ellipse(0, 0.04, 0.23 + 0.03 * part, 0.4 * (0.6 + 0.4 * part), 0, 0, TAU); g.fill();
    g.save();
    g.clip();
    g.strokeStyle = light ? "rgba(120, 112, 88, 0.55)" : "rgba(70, 90, 140, 0.6)"; g.lineWidth = 0.012;
    g.beginPath();
    const turns = Math.floor(16 * part);
    for (let q = 0; q < turns; q++) {
      const y = -0.36 + (q / 15) * 0.8, slant = (q % 3 - 1) * 0.12 + ((q * 7) % 5 - 2) * 0.03;
      g.moveTo(-0.3, y - slant); g.quadraticCurveTo(0, y + 0.05, 0.3, y + slant);
    }
    g.stroke();
    g.strokeStyle = "rgba(255, 255, 255, 0.6)"; g.lineWidth = 0.008;
    g.beginPath();
    for (let q = 0; q < turns; q += 2) {
      const y = -0.33 + (q / 15) * 0.8;
      g.moveTo(-0.3, y + 0.06); g.quadraticCurveTo(0, y - 0.02, 0.3, y - 0.05);
    }
    g.stroke();
    g.restore();
  }
}

export class Flies {
  // notes: () => the next note to give a fly, or null if there are no more.
  constructor({ web, eye, k, W, H, notes, onCaught, still }) {
    Object.assign(this, { web, eye, k, W, H, notes, onCaught, still });
    this.size = 30 * clamp(k, 0.8, 1.3);           // a fly's length on the page
    this.room = W < 640 ? 4 : 6;                   // how many unread the web will hold
    this.inAir = W < 640 ? 2 : 3;
    this.list = [];
    this.parcels = [];
    this.catchAt = 0.5;
    this.count = 0;
    if (!still) for (let i = 0; i < this.inAir; i++) this.list.push(new Fly(this, rand(0, W), rand(0, H), rand(150, 500)));
  }

  // Somewhere on the capture spiral with nothing near it.
  spot(avoid) {
    const { web } = this, { first, rings } = web.capture;
    const taken = this.list.filter((f) => f.node >= 0 && f.state !== "falling");
    let best = -1, bestD = -1;
    for (let tries = 0; tries < 14; tries++) {
      const i = first + 2 + Math.floor(Math.random() * Math.max(1, rings - 4)), j = Math.floor(Math.random() * web.N);
      const p = i * web.N + j;
      if (web.torn.has(p) || web.torn.has(p - 1)) continue;
      let near = Infinity;
      for (const f of taken) near = Math.min(near, Math.hypot(web.x[f.node] - web.x[p], web.y[f.node] - web.y[p]));
      if (avoid) near = Math.min(near, Math.hypot(avoid.x - web.x[p], avoid.y - web.y[p]) * 0.8);
      // keep clear of the corners of the page, where the words are
      if (web.y[p] > this.H * 0.86 || web.y[p] < this.H * 0.1) near *= 0.3;
      if (near > bestD) { bestD = near; best = p; }
    }
    return best;
  }

  caught(fly) {
    this.count++;
    if (this.onCaught) this.onCaught(fly);
  }
  parcelled(fly) {
    this.parcels.push(fly);
    while (this.parcels.length > 3) {
      const old = this.parcels.shift();
      old.state = "falling"; old.vy = 0; old.vx = rand(-30, 30);
    }
  }
  // The nearest fly that has been read and not yet wrapped: the spider's next job.
  next(from) {
    let best = null, bestD = Infinity;
    for (const f of this.list) {
      if (f.state !== "stuck" || !f.read || f.open) continue;
      const d = Math.hypot(this.web.x[f.node] - from.x, this.web.y[f.node] - from.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }
  get stuck() { return this.list.filter((f) => f.state === "stuck" || f.state === "wrapping"); }

  // Put a fly straight on the web, with no flying into it (for those who
  // have asked for less motion, and when the web is restrung).
  place(note, read) {
    const f = new Fly(this, 0, 0, 0);
    f.node = this.spot();
    if (f.node < 0) return null;
    f.note = note; f.hue = HUES[note.kind]; f.read = !!read;
    f.state = "stuck"; f.vigour = 0.3; f.rest = rand(1, 4); f.buzz = 0;
    this.list.push(f);
    return f;
  }

  update(dt, t, spiderAt, ready) {
    // send one into the web when there is room for it
    const unread = this.list.filter((f) => (f.state === "stuck" && !f.read) || f.state === "dive").length;
    if (ready && unread < this.room && (this.catchAt -= dt) <= 0) {
      const note = this.notes();
      const node = note ? this.spot(spiderAt) : -1;
      if (note && node >= 0) {
        if (this.still) { this.place(note); this.caught(this.list[this.list.length - 1]); }
        else {
          const air = this.list.filter((f) => f.state === "air");
          const f = air[Math.floor(Math.random() * air.length)] || this.spawn();
          f.state = "dive"; f.node = node; f.note = note; f.hue = HUES[note.kind];
        }
      }
      this.catchAt = this.count < 2 ? rand(2.2, 3.4) : rand(6, 10);
    }
    if (!this.still && this.list.filter((f) => f.state === "air").length < this.inAir && Math.random() < dt * 0.6) this.spawn();
    for (const f of this.list) {
      if (f.state === "air" || f.state === "dive") f.fly(dt, t);
      else f.held(dt, t);
    }
    this.list = this.list.filter((f) => !f.gone);
  }
  spawn() {
    const { W, H } = this, side = Math.random() < 0.5 ? -60 : W + 60;
    const f = new Fly(this, side, rand(0.1, 0.9) * H, rand(200, 500));
    this.list.push(f);
    return f;
  }

  drawHeld(g, P, t) {
    for (const f of this.list) if (f.state !== "air" && f.state !== "dive") f.draw(g, this.eye, P, t);
  }
  drawAir(g, P, t) {
    for (const f of this.list) if (f.state === "air" || f.state === "dive") f.draw(g, this.eye, P, t);
  }
}
