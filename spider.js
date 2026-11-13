// spider.js — the spider: an orb-weaver, forever going about its web.
//
// It walks where it likes, as if the web were strung flat and still, and
// silk.js says where that place is now, blown about as it is. Each of its
// eight feet holds a length of the spiral; when the body has moved on far
// enough a foot lets go and takes a new hold further along, four at a time,
// so it never has fewer than four on the web. It hangs its weight on what it
// holds, and the web gives under it.
//
// It wanders, stops, goes back to the hub to sit head-down; runs to see what
// has just hit the web; and wraps up any fly that has been read. Put the
// pointer on it and it stops and lifts its front legs — click, and it shows
// what it keeps (orb.js).
//
// In the hunt it does none of that: it goes where it is driven (`manual`),
// at a run, and never off the edge of the web.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const rand = (a, b) => a + Math.random() * (b - a);
const turnTo = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// The legs, front to back, one side; mirrored for the other. In body
// lengths, x forward: where it joins the body, where the foot likes to be,
// and how long it is.
const LEGS = [
  { root: [0.27, 0.07], foot: [1.16, 0.46], len: 1.5, raise: [0.9, 0.78] },
  { root: [0.21, 0.11], foot: [0.66, 1.02], len: 1.36, raise: [0.42, 1.08] },
  { root: [0.14, 0.12], foot: [-0.12, 0.84], len: 0.96 },
  { root: [0.07, 0.1], foot: [-0.92, 0.62], len: 1.4 }
];

const SKINS = {
  dark: {
    leg: "#c98a3a", legDark: "#2b1507", legLit: "rgba(255, 226, 170, 0.75)", hair: "rgba(255, 220, 170, 0.5)",
    abdomen: ["#f0bd6a", "#c27a2a", "#6e3a12", "#2c1405"], folium: "rgba(58, 24, 6, 0.6)", mark: "#fff6dc",
    head: ["#b9793a", "#6b3a16", "#2a1306"], eye: "#0b0704", eyeLit: "rgba(210, 235, 255, 0.95)",
    shade: "rgba(0, 2, 10, 0.5)", rim: "rgba(200, 220, 255, 0.55)"
  },
  light: {
    leg: "#b8742a", legDark: "#2a1608", legLit: "rgba(255, 240, 200, 0.8)", hair: "rgba(70, 40, 14, 0.5)",
    abdomen: ["#f6cf86", "#c98232", "#70401a", "#2e1808"], folium: "rgba(60, 28, 8, 0.6)", mark: "#fffaea",
    head: ["#b47a40", "#683a18", "#2c1608"], eye: "#0b0704", eyeLit: "rgba(255, 255, 255, 0.95)",
    shade: "rgba(20, 30, 20, 0.4)", rim: "rgba(255, 244, 200, 0.7)"
  }
};

export class Spider {
  constructor(web, eye, k) {
    this.web = web; this.eye = eye;
    this.S = 50 * clamp(k, 0.74, 1.3);         // how long the body is
    this.p = { x: web.hub.x, y: web.hub.y };   // where it is, on the web at rest
    this.h = Math.PI / 2;                      // which way it faces: head down, at the hub
    this.speed = 0;
    this.turned = 0;
    this.state = "sit";
    this.wait = 1.2;
    this.goal = null;
    this.prey = null;
    this.held = 0;          // 0 to 1: stopped, front legs up (the pointer is on it)
    this.reared = 0;        // 0 to 1: further up still (the menu is open)
    this.hold = false; this.rear = false;
    this.manual = null;     // the hunt: { x, y }, which way it is being driven
    this.snap = 0;          // just caught something: a jab of the front legs
    this.at = { x: 0, y: 0, s: 1 };            // where it is on the page
    this.body = { x: 0, y: 0, z: 0 };
    this.legs = [];
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      const L = LEGS[i];
      this.legs.push({
        i, side, L, group: (i + (side > 0 ? 1 : 0)) % 2,
        grip: { a: 0, b: 0, u: 0 }, rx: 0, ry: 0, x: 0, y: 0, fromX: 0, fromY: 0, swing: 1, dur: 0.14, planted: false,
        seed: Math.random() * TAU
      });
    }
    this.hairs = Array.from({ length: 46 }, () => ({ a: Math.random() * TAU, l: rand(0.03, 0.075), o: rand(0.9, 1.02) }));
    this.plantAll();
  }

  // where a foot would like to be, on the web at rest
  ideal(leg, out, lead) {
    const c = Math.cos(this.h), s = Math.sin(this.h), S = this.S;
    const fx = leg.L.foot[0] * S + lead, fy = leg.L.foot[1] * S * leg.side;
    out.x = this.p.x + c * fx - s * fy; out.y = this.p.y + s * fx + c * fy;
    return out;
  }
  take(leg, p) {
    this.web.grip(p.x, p.y, leg.grip);
    const a = this.web.restOf(leg.grip.a, tA), ax = a.x, ay = a.y, b = this.web.restOf(leg.grip.b, tB);
    leg.rx = lerp(ax, b.x, leg.grip.u); leg.ry = lerp(ay, b.y, leg.grip.u);
  }
  plantAll() {
    for (const leg of this.legs) { this.take(leg, this.ideal(leg, tC, 0)); leg.swing = 1; leg.planted = false; }
  }

  // Something has hit the web over there.
  notice(fly) {
    if (this.manual || this.state === "wrap" || this.hold || this.rear) return;
    this.prey = fly; this.state = "alert"; this.wait = rand(0.35, 0.7); this.goal = null;
  }
  // A fly has been read and is the spider's now: go and wrap it, if it has
  // nothing better to do.
  call(fly) {
    if (this.manual || this.hold || this.rear || !["sit", "roam", "alert"].includes(this.state)) return;
    this.prey = fly; this.state = "fetch"; this.goal = null; this.look = null;
  }
  // Taken over, for the hunt — or let go again.
  drive(on) {
    this.manual = on ? { x: 0, y: 0 } : null;
    this.prey = null; this.goal = null; this.look = null;
    this.hold = false; this.rear = false;
    this.state = "sit"; this.wait = on ? 0 : rand(0.8, 1.6);
  }
  // The web was plucked at a place: look round at it.
  pluck(x, y) {
    if (this.manual || (this.state !== "sit" && this.state !== "roam")) return;
    this.look = Math.atan2(y - this.p.y, x - this.p.x); this.state = "sit"; this.wait = Math.max(this.wait, rand(0.6, 1.1));
  }

  // ----- What it does -----
  update(dt, t, flies) {
    const { web, S } = this;
    this.held += ((this.hold || this.rear ? 1 : 0) - this.held) * Math.min(1, dt * 9);
    this.reared += ((this.rear ? 1 : 0) - this.reared) * Math.min(1, dt * 7);
    const stopped = this.hold || this.rear;
    let want = 0, pace = 0, turnRate = 4.5;
    this.snap = Math.max(0, this.snap - dt);
    const m = this.manual, driven = m ? Math.min(1, Math.hypot(m.x, m.y)) : 0;
    if (m) {
      if (driven > 0.05) {
        want = turnTo(this.h, Math.atan2(m.y, m.x));
        pace = 330 * (S / 50) * driven; turnRate = 16;
      }
    } else if (!stopped) {
      if (this.state === "sit") {
        if (this.look != null) want = this.look;
        this.wait -= dt;
        if (this.wait <= 0) {
          this.look = null;
          const spent = flies.next(this.p);
          if (spent) { this.prey = spent; this.state = "fetch"; }
          else {
            // somewhere else on the web; now and then, home to the hub
            if (Math.random() < 0.22) this.goal = { x: web.hub.x, y: web.hub.y, home: true };
            else {
              const a = Math.random() * TAU, far = web.reach(a) * 0.9;
              const r = rand(S * 0.9, far);
              this.goal = { x: web.hub.x + Math.cos(a) * r, y: web.hub.y + Math.sin(a) * r };
            }
            this.state = "roam";
          }
        }
      } else if (this.state === "alert") {
        const q = this.preyAt();
        if (q) this.look = Math.atan2(q.y - this.p.y, q.x - this.p.x);
        this.wait -= dt;
        if (this.wait <= 0) { this.look = null; this.state = q ? "hunt" : "sit"; }
      }
      if (this.state === "roam" || this.state === "hunt" || this.state === "fetch") {
        const q = this.state === "roam" ? this.goal : this.preyAt();
        if (!q) { this.state = "sit"; this.wait = 0.4; }
        else {
          const dx = q.x - this.p.x, dy = q.y - this.p.y, d = Math.hypot(dx, dy);
          const near = this.state === "roam" ? S * 0.12 : S * 1.12;
          if (d < near) {
            if (this.state === "roam") {
              this.state = "sit"; this.wait = q.home ? rand(1.6, 3.6) : rand(0.3, 1.5);
              if (q.home) this.look = Math.PI / 2;
            } else if (this.state === "hunt") { this.state = "feel"; this.wait = rand(1.1, 1.8); }
            else { this.state = "wrap"; this.wait = 3.4; this.prey.wrapBegin(); }
          } else {
            this.look = Math.atan2(dy, dx);
            pace = (this.state === "roam" ? 58 : 190) * (S / 50) * clamp(d / (S * 0.8), 0.25, 1);
          }
        }
      }
      if (this.state === "feel" || this.state === "wrap") {
        const q = this.preyAt();
        if (!q) { this.state = "sit"; this.wait = 0.3; }
        else {
          this.look = Math.atan2(q.y - this.p.y, q.x - this.p.x);
          this.wait -= dt;
          if (this.state === "wrap") this.prey.wrapTo(1 - this.wait / 3.4);
          else if (Math.random() < dt * 5) this.prey.prod();
          if (this.wait <= 0) {
            if (this.state === "wrap") this.prey.wrapEnd();
            this.prey = null; this.look = null; this.state = "sit"; this.wait = rand(0.3, 0.9);
          }
        }
      }
      if (this.look != null) want = turnTo(this.h, this.look);
      // turn first; only walk once it is nearly facing the way it is going
      if (Math.abs(want) > 0.5) pace *= 0.18;
      if (this.state === "hunt") turnRate = 9;
    }
    const turn = clamp(want, -turnRate * dt, turnRate * dt);
    this.h += turn;
    this.turned += (turn / Math.max(dt, 1e-3) - this.turned) * Math.min(1, dt * 6);
    this.speed += (pace - this.speed) * Math.min(1, dt * (pace > this.speed ? (m ? 14 : 5) : 10));
    if (driven > 0.05) {
      // driven: it goes the way it is sent at once, and its body comes round
      const d = Math.hypot(m.x, m.y);
      this.p.x += m.x / d * this.speed * dt;
      this.p.y += m.y / d * this.speed * dt;
    } else {
      this.p.x += Math.cos(this.h) * this.speed * dt;
      this.p.y += Math.sin(this.h) * this.speed * dt;
    }
    if (m) {
      // never off the edge of the web
      const dx = this.p.x - web.hub.x, dy = this.p.y - web.hub.y, rho = Math.hypot(dx, dy);
      const far = web.reach(Math.atan2(dy, dx)) * 0.98;
      if (rho > far) { this.p.x = web.hub.x + dx / rho * far; this.p.y = web.hub.y + dy / rho * far; }
    }

    // ----- feet -----
    const lead = this.speed * 0.11;
    const busy = [0, 0];
    for (const leg of this.legs) if (leg.swing < 1) busy[leg.group]++;
    for (const leg of this.legs) {
      const free = this.freeFoot(leg);
      if (free) { leg.planted = false; continue; }
      if (leg.swing < 1) { leg.swing = Math.min(1, leg.swing + dt / leg.dur); continue; }
      const want = this.ideal(leg, tC, lead);
      const err = Math.hypot(want.x - leg.rx, want.y - leg.ry);
      const limit = S * (this.speed > 4 || Math.abs(this.turned) > 0.4 ? 0.3 : 0.16);
      if (!leg.planted || (err > limit && (!busy[1 - leg.group] || err > S * 0.62))) {
        leg.fromX = leg.x; leg.fromY = leg.y;
        if (leg.planted) { leg.swing = 0; busy[leg.group]++; }
        leg.dur = this.speed > 240 ? 0.05 : this.speed > 100 ? 0.075 : 0.13;
        this.take(leg, want);
        leg.planted = true;
        web.kick(leg.grip.a, rand(-14, 14), rand(-14, 14), rand(-30, 30));
      }
      // its weight, on what it holds
      web.load(leg.grip.a, 0, 150 * (1 - leg.grip.u), 0);
      web.load(leg.grip.b, 0, 150 * leg.grip.u, 0);
    }
    // an idle foot shifts its hold now and then
    if (this.speed < 2 && !stopped && Math.random() < dt * 0.9) {
      const leg = this.legs[Math.floor(Math.random() * 8)];
      if (leg.swing >= 1 && leg.planted) {
        const p = this.ideal(leg, tC, 0);
        p.x += rand(-0.12, 0.12) * S; p.y += rand(-0.12, 0.12) * S;
        leg.fromX = leg.x; leg.fromY = leg.y; leg.swing = 0; leg.dur = 0.2;
        this.take(leg, p);
      }
    }
    this.t = t;
  }

  preyAt() {
    const f = this.prey;
    if (!f || f.gone || f.node < 0) return null;
    return this.web.restOf(f.node, tD);
  }
  // A leg held off the web: the front pair when the pointer is on it, the
  // second pair too when it rears, and the front pair when handling a fly.
  freeFoot(leg) {
    if (leg.i === 0 && (this.held > 0.02 || this.snap > 0 || this.state === "feel" || this.state === "wrap")) return true;
    if (leg.i === 1 && this.reared > 0.02) return true;
    return false;
  }

  // ----- Drawing -----
  draw(g, P, t) {
    const { web, eye, S } = this;
    const K = P === "light" ? SKINS.light : SKINS.dark;
    const b = web.place(this.p.x, this.p.y, this.body);
    const stride = this.speed > 2 ? Math.sin(t * 22) * 0.012 * S : 0;
    const bz = b.z + S * 0.16 + this.reared * S * 0.2;
    const bx = this.at.x = eye.x(b.x, bz), by = this.at.y = eye.y(b.y, bz) + stride;
    const sc = this.at.s = eye.s(bz) * (1 + 0.05 * this.reared);
    const c = Math.cos(this.h), s = Math.sin(this.h), U = S * sc;
    const out = (x, y) => [bx + (c * x - s * y) * U, by + (s * x + c * y) * U];

    // where each foot is on the page
    for (const leg of this.legs) {
      let tx, ty;
      if (this.freeFoot(leg)) {
        const r = leg.L.raise, handling = this.snap > 0 || this.state === "feel" || this.state === "wrap";
        let fx = r[0], fy = r[1] * leg.side;
        if (handling && leg.i === 0) {
          // working at the fly in front of it
          const w = Math.sin(t * (this.state === "feel" ? 9 : 17) + leg.side * 1.4);
          fx = 1.0 + 0.1 * w; fy = (0.16 + 0.09 * w) * leg.side;
        } else {
          const up = leg.i === 0 ? this.held : this.reared;
          const wave = Math.sin(t * 5.2 + leg.seed) * 0.09 + Math.sin(t * 2.3 + leg.side) * 0.06;
          fx = lerp(leg.L.foot[0], r[0] + wave * 0.6, up);
          fy = lerp(leg.L.foot[1], r[1] + wave + 0.14 * this.reared, up) * leg.side;
        }
        [tx, ty] = out(fx, fy);
        leg.x = tx; leg.y = ty; leg.lift = 1;
        continue;
      }
      const { a, b: bb, u } = leg.grip;
      const wx = lerp(web.x[a], web.x[bb], u), wy = lerp(web.y[a], web.y[bb], u), wz = lerp(web.z[a], web.z[bb], u);
      tx = eye.x(wx, wz); ty = eye.y(wy, wz);
      if (leg.swing < 1) {
        const e = smooth(leg.swing);
        leg.x = lerp(leg.fromX, tx, e); leg.y = lerp(leg.fromY, ty, e) - Math.sin(e * Math.PI) * S * 0.06;
        leg.lift = Math.sin(e * Math.PI);
      } else { leg.x = tx; leg.y = ty; leg.lift = 0; }
    }

    g.save();
    g.lineCap = "round"; g.lineJoin = "round";
    // its shadow on the air behind, to lift it off the web
    const sh = g.createRadialGradient(bx + U * 0.1, by + U * 0.16, 0, bx + U * 0.1, by + U * 0.16, U * 0.95);
    sh.addColorStop(0, K.shade); sh.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sh;
    g.beginPath(); g.arc(bx + U * 0.1, by + U * 0.16, U * 0.95, 0, TAU); g.fill();

    // legs, back pair first
    for (let q = this.legs.length - 1; q >= 0; q--) this.drawLeg(g, K, this.legs[q], out, U);

    // the abdomen swings a little wide of the turn, and breathes
    const lag = clamp(-this.turned * 0.05, -0.3, 0.3) + Math.sin(t * 1.7) * 0.012;
    g.translate(bx, by);
    g.rotate(this.h);
    g.scale(U, U);
    this.drawAbdomen(g, K, lag, t);
    this.drawHead(g, K, t);
    g.restore();
  }

  drawLeg(g, K, leg, out, U) {
    const L = leg.L;
    const [rx, ry] = out(L.root[0], L.root[1] * leg.side);
    const l1 = L.len * 0.43 * U, l2 = L.len * 0.57 * U;
    let dx = leg.x - rx, dy = leg.y - ry, d = Math.hypot(dx, dy) || 1;
    const max = (l1 + l2) * 0.995;
    if (d > max) { dx *= max / d; dy *= max / d; d = max; }
    const fx = rx + dx, fy = ry + dy;
    // the knee, out to the side the leg is on
    const along = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    let nx = -dy / d, ny = dx / d;
    const [ox, oy] = out(0, leg.side);
    const [cx, cy] = out(0, 0);
    if (nx * (ox - cx) + ny * (oy - cy) < 0) { nx = -nx; ny = -ny; }
    // front legs bow forwards a little as well
    const kx = rx + dx / d * along + nx * off, ky = ry + dy / d * along + ny * off;
    // the shin is two lengths, with a slight crook between
    const mx = lerp(kx, fx, 0.52) + nx * l2 * 0.07, my = lerp(ky, fy, 0.52) + ny * l2 * 0.07;
    const w = U * (leg.i === 2 ? 0.052 : 0.062);

    const seg = (x0, y0, x1, y1, w0) => {
      g.lineWidth = w0;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    };
    // pale, with a dark ring at the far end of every length
    g.strokeStyle = K.leg;
    seg(rx, ry, kx, ky, w); seg(kx, ky, mx, my, w * 0.78); seg(mx, my, fx, fy, w * 0.5);
    g.strokeStyle = K.legDark;
    seg(lerp(rx, kx, 0.62), lerp(ry, ky, 0.62), kx, ky, w * 1.04);
    seg(rx, ry, lerp(rx, kx, 0.14), lerp(ry, ky, 0.14), w * 1.04);
    seg(lerp(kx, mx, 0.6), lerp(ky, my, 0.6), mx, my, w * 0.82);
    seg(lerp(mx, fx, 0.62), lerp(my, fy, 0.62), fx, fy, w * 0.5);
    // the tip tapers to nothing
    g.lineWidth = w * 0.26;
    g.beginPath(); g.moveTo(lerp(mx, fx, 0.8), lerp(my, fy, 0.8)); g.lineTo(fx + (fx - mx) * 0.08, fy + (fy - my) * 0.08); g.stroke();
    // lit along the top
    g.strokeStyle = K.legLit; g.lineWidth = Math.max(0.6, w * 0.2);
    const hx = -0.22 * w, hy = -0.22 * w;
    g.beginPath(); g.moveTo(rx + hx, ry + hy); g.lineTo(kx + hx, ky + hy); g.lineTo(mx + hx, my + hy); g.stroke();
    // bristles
    g.strokeStyle = K.hair; g.lineWidth = Math.max(0.5, U * 0.008);
    g.beginPath();
    for (let q = 0; q < 7; q++) {
      const u = (q + 0.5) / 7, on = q < 3;
      const px = on ? lerp(rx, kx, 0.3 + u * 1.6) : lerp(kx, fx, (u - 0.43) * 1.5), py = on ? lerp(ry, ky, 0.3 + u * 1.6) : lerp(ky, fy, (u - 0.43) * 1.5);
      const sgn = q % 2 ? 1 : -1, hl = U * 0.05;
      g.moveTo(px, py); g.lineTo(px + nx * hl * sgn + dx / d * hl * 0.5, py + ny * hl * sgn + dy / d * hl * 0.5);
    }
    g.stroke();
    // knee
    g.fillStyle = K.legDark;
    g.beginPath(); g.arc(kx, ky, w * 0.56, 0, TAU); g.fill();
  }

  // drawn in body lengths, facing +x
  drawAbdomen(g, K, lag, t) {
    g.save();
    g.translate(-0.02, 0);
    g.rotate(lag);
    const breathe = 1 + 0.012 * Math.sin(t * 2.1);
    g.scale(breathe, breathe);
    const cx = -0.34, rx = 0.36, ry = 0.275;
    // an egg, broadest a third of the way back from the waist
    const shape = () => {
      g.beginPath();
      g.moveTo(cx + rx, 0);
      g.bezierCurveTo(cx + rx, -ry * 0.75, cx + rx * 0.55, -ry * 1.06, cx + rx * 0.05, -ry * 1.02);
      g.bezierCurveTo(cx - rx * 0.6, -ry * 0.96, cx - rx * 1.02, -ry * 0.5, cx - rx * 1.04, 0);
      g.bezierCurveTo(cx - rx * 1.02, ry * 0.5, cx - rx * 0.6, ry * 0.96, cx + rx * 0.05, ry * 1.02);
      g.bezierCurveTo(cx + rx * 0.55, ry * 1.06, cx + rx, ry * 0.75, cx + rx, 0);
      g.closePath();
    };
    // spinnerets
    g.fillStyle = K.abdomen[3];
    g.beginPath(); g.ellipse(cx - rx * 1.03, 0, 0.04, 0.035, 0, 0, TAU); g.fill();
    // fuzz round the edge
    g.strokeStyle = K.hair; g.lineWidth = 0.008;
    g.beginPath();
    for (const h of this.hairs) {
      const ex = cx + Math.cos(h.a) * rx * h.o, ey = Math.sin(h.a) * ry * h.o;
      g.moveTo(ex, ey); g.lineTo(ex + Math.cos(h.a) * h.l, ey + Math.sin(h.a) * h.l);
    }
    g.stroke();
    const fill = g.createRadialGradient(cx + 0.05, -0.08, 0.02, cx, 0, rx * 1.05);
    fill.addColorStop(0, K.abdomen[0]); fill.addColorStop(0.45, K.abdomen[1]); fill.addColorStop(0.85, K.abdomen[2]); fill.addColorStop(1, K.abdomen[3]);
    g.fillStyle = fill;
    shape(); g.fill();
    g.save();
    shape(); g.clip();
    // the folium: a dark, scalloped leaf down the back
    g.fillStyle = K.folium;
    g.beginPath();
    g.moveTo(cx + rx * 0.82, 0);
    const lobes = 5;
    for (let q = 0; q <= lobes; q++) {
      const u = q / lobes, x = cx + rx * (0.82 - 1.75 * u), w = ry * (0.5 + 0.22 * Math.sin(u * Math.PI)) * (1 - 0.6 * u);
      g.quadraticCurveTo(x + rx * 0.2, -w * 1.35, x, -w * 0.72);
    }
    for (let q = lobes; q >= 0; q--) {
      const u = q / lobes, x = cx + rx * (0.82 - 1.75 * u), w = ry * (0.5 + 0.22 * Math.sin(u * Math.PI)) * (1 - 0.6 * u);
      g.quadraticCurveTo(x - rx * 0.02, w * 1.35, x + rx * 0.14, w * 0.72);
    }
    g.closePath(); g.fill();
    // the cross: pale dashes down the middle and across
    g.fillStyle = K.mark;
    const dash = (x, y, w, h, a) => { g.beginPath(); g.ellipse(x, y, w, h, a || 0, 0, TAU); g.fill(); };
    dash(cx + rx * 0.62, 0, 0.05, 0.02);
    dash(cx + rx * 0.34, 0, 0.045, 0.024);
    dash(cx + rx * 0.06, 0, 0.04, 0.02);
    dash(cx - rx * 0.2, 0, 0.03, 0.016);
    dash(cx - rx * 0.42, 0, 0.022, 0.012);
    for (const sd of [-1, 1]) {
      dash(cx + rx * 0.34, sd * ry * 0.3, 0.02, 0.034, 0.2 * sd);
      dash(cx + rx * 0.3, sd * ry * 0.56, 0.016, 0.026, 0.3 * sd);
      for (let q = 0; q < 5; q++) dash(cx + rx * (0.05 - q * 0.19), sd * ry * (0.52 - q * 0.075), 0.011, 0.011);
      for (let q = 0; q < 4; q++) dash(cx + rx * (0.6 - q * 0.3), sd * ry * (0.8 - q * 0.02), 0.008, 0.008);
    }
    // the sheen on it, and the edge turned to the light
    const lit = g.createRadialGradient(cx + 0.1, -0.13, 0, cx + 0.1, -0.13, 0.26);
    lit.addColorStop(0, "rgba(255, 250, 235, 0.42)"); lit.addColorStop(1, "rgba(255, 250, 235, 0)");
    g.fillStyle = lit; g.fillRect(cx - rx * 1.2, -ry * 1.2, rx * 2.4, ry * 2.4);
    g.restore();
    g.strokeStyle = K.rim; g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(cx + rx * 0.9, -ry * 0.55);
    g.bezierCurveTo(cx + rx * 0.5, -ry * 1.08, cx - rx * 0.3, -ry * 1.04, cx - rx * 0.78, -ry * 0.62);
    g.stroke();
    g.restore();
  }

  drawHead(g, K, t) {
    const cx = 0.17, rx = 0.2, ry = 0.158;
    // pedipalps
    g.strokeStyle = K.leg; g.lineWidth = 0.04;
    const feel = Math.sin(t * 7) * 0.02 * (this.speed > 2 || this.state === "feel" || this.state === "wrap" ? 1 : 0.25);
    for (const sd of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + rx * 0.7, sd * 0.06);
      g.quadraticCurveTo(cx + rx * 1.25, sd * (0.1 + feel), cx + rx * 1.42, sd * (0.035 + feel)); g.stroke();
    }
    g.fillStyle = K.legDark;
    for (const sd of [-1, 1]) { g.beginPath(); g.arc(cx + rx * 1.42, sd * (0.035 + feel), 0.024, 0, TAU); g.fill(); }
    const fill = g.createRadialGradient(cx + 0.03, -0.05, 0.01, cx, 0, rx * 1.05);
    fill.addColorStop(0, K.head[0]); fill.addColorStop(0.6, K.head[1]); fill.addColorStop(1, K.head[2]);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(cx + rx, 0);
    g.bezierCurveTo(cx + rx, -ry * 0.62, cx + rx * 0.5, -ry * 1.02, cx - rx * 0.1, -ry);
    g.bezierCurveTo(cx - rx * 0.7, -ry * 0.96, cx - rx, -ry * 0.5, cx - rx, 0);
    g.bezierCurveTo(cx - rx, ry * 0.5, cx - rx * 0.7, ry * 0.96, cx - rx * 0.1, ry);
    g.bezierCurveTo(cx + rx * 0.5, ry * 1.02, cx + rx, ry * 0.62, cx + rx, 0);
    g.fill();
    // the groove down the middle, and the lines out from it
    g.strokeStyle = K.head[2]; g.lineWidth = 0.012;
    g.beginPath(); g.moveTo(cx - rx * 0.55, 0); g.lineTo(cx + rx * 0.1, 0);
    for (const sd of [-1, 1]) for (let q = 0; q < 3; q++) {
      g.moveTo(cx - rx * 0.2, 0); g.lineTo(cx - rx * (0.55 - q * 0.42), sd * ry * 0.7);
    }
    g.stroke();
    g.strokeStyle = K.rim; g.lineWidth = 0.012;
    g.beginPath(); g.moveTo(cx + rx * 0.85, -ry * 0.5); g.quadraticCurveTo(cx + rx * 0.2, -ry * 1.1, cx - rx * 0.6, -ry * 0.78); g.stroke();
    // eight eyes: four in a square, and a pair out at each side
    const eyes = [[0.86, 0.045, 0.02], [0.86, -0.045, 0.02], [0.72, 0.055, 0.017], [0.72, -0.055, 0.017], [0.74, 0.115, 0.013], [0.74, -0.115, 0.013], [0.67, 0.128, 0.012], [0.67, -0.128, 0.012]];
    for (const [ex, ey, er] of eyes) {
      g.fillStyle = K.eye;
      g.beginPath(); g.arc(cx + rx * ex, ey, er, 0, TAU); g.fill();
      g.fillStyle = K.eyeLit;
      g.globalAlpha = 0.55 + 0.45 * this.held;
      g.beginPath(); g.arc(cx + rx * ex + er * 0.3, ey - er * 0.3, er * 0.42, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
  }
}

const tA = { x: 0, y: 0 }, tB = { x: 0, y: 0 }, tC = { x: 0, y: 0 }, tD = { x: 0, y: 0 };
