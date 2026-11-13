// silk.js — the web itself: how it is strung, how it moves, how it is drawn.
//
// A round orb web, seen square on. A frame of six threads goes round it, and
// from each corner a long guy line runs off to one of the plants round the
// edge of the page (scene.js says where they are, and they sway). Inside the
// frame the radials run out from the hub like spokes; a tight spiral makes
// the hub, a bare ring is left round it, and then the sticky capture spiral
// winds out to the frame — one thread, round and round, beaded with glue.
//
// Every crossing is a particle and every length of thread between two of them
// a cable that pulls but never pushes, so the whole thing is free to sway in
// the wind, shiver when something hits it, and sag under what it holds.
//
// Silk shines where the light catches it: a soft band of brightness lies
// across the web and drifts slowly over it, with a fringe of colour along its
// edges. It is worked out from where a thread is, never from how it happens
// to be blowing, so nothing on the web flickers.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// mulberry32, as in deck.js: the web is strung the same way all day.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const STEP = 1 / 120;            // the physics runs at this, whatever the screen does
const ITER = 4;
const HUB_RINGS = 4;
const RADIAL = 0, SPIRAL = 1, HUB = 2, FRAME = 3, GUY = 4, LOOSE = 5;
const TENSE = [0.955, 1.012, 0.975, 0.955, 0.95, 1];
const STIFF = [0.9, 0.4, 0.6, 0.95, 0.95, 1];
const LEVELS = 8;

// The eye: square on to the web. What stands off its plane is a touch bigger
// or smaller, and shifts a hair with the pointer; no more than that.
export class Eye {
  constructor() { this.cx = 0; this.cy = 0; this.F = 2600; this.kx = 0; this.ky = 0; }
  x(x, z) { return this.cx + (x - this.cx) * (1 + z / this.F) + z * this.kx; }
  y(y, z) { return this.cy + (y - this.cy) * (1 + z / this.F) + z * this.ky; }
  s(z) { return 1 + z / this.F; }
}

export class Web {
  // hub: where the middle is. R0: how far out the spiral goes. anchors: where
  // the guy lines are tied, in order round the hub. k: how big everything is
  // drawn, 1 on an ordinary screen.
  build({ hub, R0, anchors, seed, k }) {
    const rnd = rng(seed);
    this.hub = hub;
    this.R0 = R0;
    this.k = k;
    const N = this.N = Math.round(clamp(13 + 13 * k, 18, 28));

    // the spokes, none of them quite evenly spaced
    const th = this.th = new Float32Array(N);
    const th0 = rnd() * TAU;
    for (let j = 0; j < N; j++) th[j] = th0 + (j + (rnd() - 0.5) * 0.5) * TAU / N;

    // the frame: a corner on the way to each anchor
    const corners = anchors.map((a) => {
      const d = Math.hypot(a.x - hub.x, a.y - hub.y) || 1;
      const c = Math.min(R0 * 1.3, d * 0.94) / d;
      return { x: hub.x + (a.x - hub.x) * c, y: hub.y + (a.y - hub.y) * c };
    });
    const K = corners.length;
    const frameAt = (a) => {
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = Infinity;
      for (let c = 0; c < K; c++) {
        const p = corners[c], q = corners[(c + 1) % K];
        const ex = q.x - p.x, ey = q.y - p.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((p.x - hub.x) * ey - (p.y - hub.y) * ex) / den;
        const u = ((p.x - hub.x) * dy - (p.y - hub.y) * dx) / den;
        if (t > 0 && u >= -1e-4 && u <= 1.0001 && t < best) best = t;
      }
      return best === Infinity ? 200 : best;
    };

    // how far out the capture spiral goes, each way: a circle, as near as a
    // spider makes one, and never quite to the frame
    const lump = rnd() * TAU;
    const reach = (a) => Math.min(R0 * (1 + 0.025 * Math.sin(a * 3 + lump)), frameAt(a) * 0.93);

    const gap = Math.max(6, 7.6 * k);
    let least = Infinity;
    for (let j = 0; j < N; j++) least = Math.min(least, reach(th[j]));
    const inner = 21 * k + 5.3 * k * HUB_RINGS + 13 * k;       // where the capture spiral starts
    const C = Math.round(clamp((least - inner) / gap, 8, 34));
    const I = this.I = HUB_RINGS + C;

    // radius of ring i on spoke j, at rest
    const R = this.R = new Float32Array(I * N);
    for (let j = 0; j < N; j++) {
      const out = reach(th[j]);
      for (let i = 0; i < I; i++) {
        if (i < HUB_RINGS) {
          R[i * N + j] = (5 + 5.3 * (i + j / N) + (rnd() - 0.5) * 1.6) * k;
        } else {
          const c = i - HUB_RINGS;
          const s = clamp((c + j / N + (rnd() - 0.5) * 0.32) / C, 0, 1);
          R[i * N + j] = inner + (out - inner) * Math.pow(s, 0.94);
        }
      }
    }

    // ----- particles -----
    const loose = [];
    const nGrid = I * N;
    const iFrame = nGrid, iCorner = iFrame + N, iAnchor = iCorner + K;
    let n = iAnchor + K;
    const strands = 0;
    const strandAt = [];
    for (let s = 0; s < strands; s++) {
      const long = s < 2;
      const len = long ? 5 + Math.floor(rnd() * 4) : 3 + Math.floor(rnd() * 3);
      const at = long
        ? iFrame + Math.floor(rnd() * N)
        : (HUB_RINGS + 1 + Math.floor(rnd() * (C - 2))) * N + Math.floor(rnd() * N);
      strandAt.push({ at, len, first: n, seg: (long ? 13 : 7) * k * (0.8 + rnd() * 0.5) });
      n += len;
    }
    this.n = n;
    this.iFrame = iFrame; this.iCorner = iCorner; this.iAnchor = iAnchor; this.K = K;
    const x = this.x = new Float32Array(n), y = this.y = new Float32Array(n), z = this.z = new Float32Array(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.ax = new Float32Array(n); this.ay = new Float32Array(n); this.az = new Float32Array(n);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n);
    this.free = new Uint8Array(n).fill(1);
    this.light = new Float32Array(n).fill(1);     // how much the wind gets hold of it

    for (let i = 0; i < I; i++) for (let j = 0; j < N; j++) {
      const r = R[i * N + j];
      x[i * N + j] = hub.x + Math.cos(th[j]) * r;
      y[i * N + j] = hub.y + Math.sin(th[j]) * r;
    }
    this.F = new Float32Array(N);
    for (let j = 0; j < N; j++) {
      const f = this.F[j] = frameAt(th[j]);
      x[iFrame + j] = hub.x + Math.cos(th[j]) * f;
      y[iFrame + j] = hub.y + Math.sin(th[j]) * f;
    }
    for (let c = 0; c < K; c++) {
      x[iCorner + c] = corners[c].x; y[iCorner + c] = corners[c].y;
      x[iAnchor + c] = anchors[c].x; y[iAnchor + c] = anchors[c].y;
      this.free[iAnchor + c] = 0;
    }
    for (const s of strandAt) {
      for (let q = 0; q < s.len; q++) {
        x[s.first + q] = x[s.at] + (rnd() - 0.5) * 3;
        y[s.first + q] = y[s.at] + (q + 1) * s.seg;
        this.light[s.first + q] = 2.6;
      }
    }

    // ----- threads -----
    const A = [], B = [], T = [];
    const add = (a, b, t) => { A.push(a); B.push(b); T.push(t); return A.length - 1; };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < I - 1; i++) add(i * N + j, (i + 1) * N + j, RADIAL);
      add((I - 1) * N + j, iFrame + j, RADIAL);
    }
    this.firstSpiral = A.length;
    const torn = new Set();
    this.torn = torn;
    for (let i = 0; i < I; i++) for (let j = 0; j < N; j++) {
      const a = i * N + j;
      let b;
      if (j < N - 1) b = a + 1;
      else if (i < I - 1 && i !== HUB_RINGS - 1) b = (i + 1) * N;      // the spiral carries on round
      else continue;
      if (torn.has(a)) continue;
      add(a, b, i < HUB_RINGS ? HUB : SPIRAL);
    }
    // a few odd threads across the hub, the way a real one is botched together
    for (let q = 0; q < N; q++) {
      const i = Math.floor(rnd() * (HUB_RINGS - 1)), j = Math.floor(rnd() * N);
      add(i * N + j, (i + 1) * N + (j + 1) % N, HUB);
    }
    // the frame, round through the spoke ends and the corners in order
    const rim = [];
    for (let j = 0; j < N; j++) rim.push({ p: iFrame + j, a: th[j] });
    for (let c = 0; c < K; c++) rim.push({ p: iCorner + c, a: Math.atan2(corners[c].y - hub.y, corners[c].x - hub.x) });
    const turn = (a) => ((a - th0) % TAU + TAU) % TAU;
    rim.sort((p, q) => turn(p.a) - turn(q.a));
    for (let q = 0; q < rim.length; q++) add(rim[q].p, rim[(q + 1) % rim.length].p, FRAME);
    for (let c = 0; c < K; c++) add(iCorner + c, iAnchor + c, GUY);
    for (const s of strandAt) {
      for (let q = 0; q < s.len; q++) add(q ? s.first + q - 1 : s.at, s.first + q, LOOSE);
    }

    const m = this.m = A.length;
    this.A = Uint16Array.from(A); this.B = Uint16Array.from(B); this.T = Uint8Array.from(T);
    this.rest = new Float32Array(m);
    this.stiff = new Float32Array(m);
    this.order = new Float32Array(m);      // when each thread is spun, as the web arrives
    for (let s = 0; s < m; s++) {
      const a = A[s], b = B[s], t = T[s];
      const d = Math.hypot(x[a] - x[b], y[a] - y[b]) || 1;
      this.rest[s] = (t === LOOSE ? 1 : TENSE[t]) * d;
      this.stiff[s] = STIFF[t];
      if (t === RADIAL) this.order[s] = 0.06 + 0.3 * Math.min(1, Math.floor(a / N) / I) + 0.06 * hash(a % N);
      else if (t === SPIRAL || t === HUB) this.order[s] = 0.42 + 0.56 * (1 - a / nGrid);
      else if (t === LOOSE) this.order[s] = 0.99;
      else this.order[s] = 0.05 * hash(s);
    }
    this.px.set(x); this.py.set(y); this.pz.set(z);

    // beads of dew, here and there on the capture spiral
    this.dew = [];
    const drops = Math.round(90 * k);
    for (let q = 0; q < drops; q++) {
      const s = this.firstSpiral + Math.floor(rnd() * (m - this.firstSpiral));
      if (T[s] !== SPIRAL) continue;
      this.dew.push({ s, u: 0.15 + rnd() * 0.7, r: (0.9 + rnd() * rnd() * 2.4) * Math.max(0.8, k), tw: rnd() * TAU });
    }
    this.capture = { first: HUB_RINGS, rings: C };
    this.mid = new Float32Array(m * 2);    // where each drawn thread bows to, on the page
    this.acc = 0;
    this.energy = 0;
  }

  // Where the anchors are now (the plants sway).
  hold(anchors) {
    for (let c = 0; c < this.K; c++) {
      const i = this.iAnchor + c;
      this.x[i] = this.px[i] = anchors[c].x;
      this.y[i] = this.py[i] = anchors[c].y;
      this.z[i] = this.pz[i] = anchors[c].z || 0;
    }
  }

  // A shove, in pixels a second, to everything within r of a point.
  shove(wx, wy, r, vx, vy, vz) {
    const { x, y, px, py, pz, free, n } = this;
    for (let i = 0; i < n; i++) {
      if (!free[i]) continue;
      const d = Math.hypot(x[i] - wx, y[i] - wy);
      if (d > r) continue;
      const f = smooth(1 - d / r) * STEP;
      px[i] -= vx * f; py[i] -= vy * f; pz[i] -= vz * f;
    }
  }
  kick(i, vx, vy, vz) {
    if (!this.free[i]) return;
    this.px[i] -= vx * STEP; this.py[i] -= vy * STEP; this.pz[i] -= vz * STEP;
  }
  // A steady pull on one crossing, for this frame: the weight of what hangs there.
  load(i, fx, fy, fz) { this.ax[i] += fx; this.ay[i] += fy; this.az[i] += fz; }

  step(dt, wind, t) {
    this.acc = Math.min(this.acc + dt, STEP * 4);
    while (this.acc >= STEP) { this.acc -= STEP; this.tick(wind, t); }
    this.ax.fill(0); this.ay.fill(0); this.az.fill(0);
  }

  tick(wind, t) {
    const { x, y, z, px, py, pz, ax, ay, az, free, light, n, m, A, B, rest, stiff } = this;
    const h2 = STEP * STEP, keep = 0.988;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      if (!free[i]) continue;
      const w = wind.at(x[i], y[i], t), l = light[i];
      const vx = (x[i] - px[i]) * keep, vy = (y[i] - py[i]) * keep, vz = (z[i] - pz[i]) * keep;
      px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
      x[i] += vx + (ax[i] + w.x * l) * h2;
      y[i] += vy + (ay[i] + 26 * l + w.y * l) * h2;
      z[i] += vz + (az[i] + w.z * l) * h2;
      energy += vx * vx + vy * vy + vz * vz;
    }
    this.energy = energy / n;
    for (let it = 0; it < ITER; it++) {
      for (let s = 0; s < m; s++) {
        const a = A[s], b = B[s];
        const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= rest[s] || d < 1e-6) continue;       // a thread pulls; it never pushes
        const fa = free[a], fb = free[b];
        if (!fa && !fb) continue;
        const f = (d - rest[s]) / d * stiff[s] / (fa + fb);
        if (fa) { x[a] += dx * f; y[a] += dy * f; z[a] += dz * f; }
        if (fb) { x[b] -= dx * f; y[b] -= dy * f; z[b] -= dz * f; }
      }
    }
  }

  // ----- Finding one's way about on it -----
  // Ring i on spoke j, where j may run one past the last spoke: the spiral
  // carries on round into the next ring.
  node(i, j) {
    const { N, I } = this;
    if (j >= N) { j -= N; i = Math.min(I - 1, i + 1); }
    return clamp(i, 0, I - 1) * N + j;
  }
  // A place given at rest (as if no wind had ever blown) → which cell of the
  // web it is in: spoke j and how far round to the next (u), ring i and how
  // far out to the next (v).
  cell(rx, ry, out) {
    const { N, I, th, R, hub } = this;
    const dx = rx - hub.x, dy = ry - hub.y;
    const rho = Math.hypot(dx, dy);
    let a = ((Math.atan2(dy, dx) - th[0]) % TAU + TAU) % TAU;
    let j = N - 1;
    for (let q = 1; q < N; q++) if (a < th[q] - th[0]) { j = q - 1; break; }
    const a0 = th[j] - th[0], a1 = j === N - 1 ? TAU : th[j + 1] - th[0];
    const u = clamp((a - a0) / (a1 - a0), 0, 1);
    const rad = (i) => lerp(R[this.node(i, j)], R[this.node(i, j + 1)], u);
    let i = -1, v = 0, r0 = 0, r1 = rad(0);
    if (rho < r1) v = rho / r1;
    else {
      for (i = 0; i < I - 1; i++) {
        r0 = r1; r1 = rad(i + 1);
        if (rho < r1) break;
      }
      if (i === I - 1) { r0 = r1; r1 = lerp(this.F[j], this.F[(j + 1) % N], u); }
      v = clamp((rho - r0) / Math.max(1e-3, r1 - r0), 0, 1);
    }
    out.i = i; out.j = j; out.u = u; out.v = v; out.rho = rho;
    return out;
  }
  // …and where that place is now, with the web blown about as it is.
  place(rx, ry, out) {
    const c = this.cell(rx, ry, cellTmp);
    const { x, y, z, N, I } = this;
    const { i, j, u, v } = c;
    const mix = (arr) => {
      let p0, p1;
      if (i < 0) {
        let s = 0;
        for (let q = 0; q < N; q++) s += arr[q];
        p0 = s / N;
        p1 = lerp(arr[this.node(0, j)], arr[this.node(0, j + 1)], u);
      } else {
        p0 = lerp(arr[this.node(i, j)], arr[this.node(i, j + 1)], u);
        p1 = i === I - 1
          ? lerp(arr[this.iFrame + j], arr[this.iFrame + (j + 1) % N], u)
          : lerp(arr[this.node(i + 1, j)], arr[this.node(i + 1, j + 1)], u);
      }
      return lerp(p0, p1, v);
    };
    out.x = mix(x); out.y = mix(y); out.z = mix(z);
    return out;
  }
  // The nearest length of spiral to a place at rest: somewhere to put a foot.
  // Returns the two crossings it runs between and how far along.
  grip(rx, ry, out) {
    const c = this.cell(rx, ry, cellTmp);
    const i = clamp(c.i + (c.v > 0.5 ? 1 : 0), 0, this.I - 1);
    out.a = this.node(i, c.j); out.b = this.node(i, c.j + 1); out.u = c.u;
    return out;
  }
  // Where a crossing was strung, before any wind.
  restOf(p, out) {
    const { N, th, R, hub } = this;
    const j = p % N;
    out.x = hub.x + Math.cos(th[j]) * R[p]; out.y = hub.y + Math.sin(th[j]) * R[p];
    return out;
  }
  // How far out the spiral goes towards a given bearing.
  reach(a) {
    const c = this.cell(this.hub.x + Math.cos(a) * 1e4, this.hub.y + Math.sin(a) * 1e4, cellTmp);
    return lerp(this.R[this.node(this.I - 1, c.j)], this.R[this.node(this.I - 1, c.j + 1)], c.u);
  }

  // ----- Drawing -----
  draw(g, eye, P, t, shown, wind) {
    const { x, y, z, sx, sy, n, m, A, B, T, order, k, hub, mid } = this;
    for (let i = 0; i < n; i++) { sx[i] = eye.x(x[i], z[i]); sy[i] = eye.y(y[i], z[i]); }

    // the band of light: which way it lies across the web, and how far over
    // it has drifted
    const la = -0.75 + 0.3 * Math.sin(t * 0.045);
    const lx = Math.cos(la), ly = Math.sin(la);
    const sweep = 0.5 * Math.sin(t * 0.17) + 0.22 * Math.sin(t * 0.073 + 1.1);
    const inv = 1 / this.R0;
    const bandAt = (px, py) => {
      const pos = ((px - hub.x) * lx + (py - hub.y) * ly) * inv - sweep;
      return pos;
    };

    const struct = [], silk = [], tint = [];
    for (let l = 0; l < LEVELS; l++) { struct.push(new Path2D()); silk.push(new Path2D()); }
    for (let l = 0; l < 4; l++) tint.push(new Path2D());
    const sagX = wind.gx * 0.3;

    for (let s = 0; s < m; s++) {
      const o = order[s];
      if (o > shown) continue;
      const a = A[s], b = B[s], type = T[s];
      const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
      const flat = Math.sqrt(dx * dx + dy * dy) || 1;
      const d = Math.sqrt(flat * flat + dz * dz);
      const pos = bandAt((x[a] + x[b]) * 0.5, (y[a] + y[b]) * 0.5);
      const band = Math.exp(-pos * pos * 4.5);
      // a thread lying across the light shines more than one lying along it
      const dot = (dx * lx + dy * ly) / flat;
      const f = 0.12 + band * (0.4 + 0.48 * (1 - dot * dot));
      const level = Math.min(LEVELS - 1, Math.floor(f * LEVELS));
      // a thread still being spun is drawn only so far along
      const grown = shown >= 1 ? 1 : clamp((shown - o) / 0.035, 0, 1);
      let bx = sx[b], by = sy[b];
      if (grown < 1) { bx = lerp(sx[a], bx, grown); by = lerp(sy[a], by, grown); }
      if (type === SPIRAL || type === LOOSE) {
        // slack shows as sag: down, and a little downwind
        const slack = Math.max(0, this.rest[s] - d);
        const sag = Math.sqrt(0.375 * d * slack) + d * 0.035;
        const cx = (sx[a] + bx) / 2 + sag * 2 * sagX, cy = (sy[a] + by) / 2 + sag * 2;
        mid[s * 2] = cx; mid[s * 2 + 1] = cy;
        const p = silk[level];
        p.moveTo(sx[a], sy[a]);
        p.quadraticCurveTo(cx, cy, bx, by);
        // colour, along both edges of the band
        const off = Math.abs(pos);
        if (type === SPIRAL && off > 0.3 && off < 0.62) {
          const q = tint[Math.min(3, Math.floor((off - 0.3) / 0.08))];
          q.moveTo(sx[a], sy[a]);
          q.quadraticCurveTo(cx, cy, bx, by);
        }
      } else {
        const p = struct[level];
        p.moveTo(sx[a], sy[a]);
        p.lineTo(bx, by);
      }
    }

    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    const wide = Math.max(0.85, Math.sqrt(k));
    // the colours that fringe the bright band
    g.lineWidth = 1.5 * wide;
    for (let l = 0; l < 4; l++) { g.strokeStyle = P.fringe[l]; g.stroke(tint[l]); }
    // the silk, dimmest first
    for (let l = 0; l < LEVELS; l++) {
      const f = l / (LEVELS - 1);
      g.strokeStyle = P.silk(f);
      g.lineWidth = (0.6 + 0.45 * f) * wide;
      g.stroke(silk[l]);
      g.lineWidth = (0.9 + 0.5 * f) * wide;
      g.stroke(struct[l]);
    }
    // the glue: beads all along the capture spiral
    g.setLineDash([0.01, 4.6 * wide]);
    for (let l = 0; l < LEVELS; l++) {
      const f = l / (LEVELS - 1);
      g.strokeStyle = P.bead(f);
      g.lineWidth = (1.2 + 0.7 * f) * wide;
      g.stroke(silk[l]);
    }
    g.setLineDash([]);
    // a soft bloom over what is shining
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = P.bloom;
    g.lineWidth = 3.4 * wide;
    for (let l = LEVELS - 3; l < LEVELS; l++) { g.stroke(silk[l]); g.stroke(struct[l]); }
    g.globalCompositeOperation = "source-over";

    // dew: each drop glints, slowly, when the band of light is on it
    for (const dw of this.dew) {
      if (order[dw.s] > shown - 0.04) continue;
      const [qx, qy] = this.along(dw.s, dw.u);
      const pos = bandAt(x[A[dw.s]], y[A[dw.s]]);
      const lit = Math.exp(-pos * pos * 4.5);
      const tw = 0.5 + 0.5 * Math.sin(t * 0.9 + dw.tw);
      g.fillStyle = P.dew;
      g.beginPath(); g.arc(qx, qy + dw.r * 0.5, dw.r, 0, TAU); g.fill();
      g.fillStyle = P.dewLit;
      g.globalAlpha = 0.35 + 0.65 * lit;
      g.beginPath(); g.arc(qx - dw.r * 0.3, qy + dw.r * 0.2, dw.r * 0.42, 0, TAU); g.fill();
      const star = lit * tw * tw * tw * tw;
      if (star > 0.15 && dw.r > 1.6) {
        const r = dw.r * 2.6 * star;
        g.globalAlpha = star;
        g.fillStyle = P.glint;
        g.beginPath();
        g.moveTo(qx - r, qy); g.quadraticCurveTo(qx, qy, qx, qy - r);
        g.quadraticCurveTo(qx, qy, qx + r, qy); g.quadraticCurveTo(qx, qy, qx, qy + r);
        g.quadraticCurveTo(qx, qy, qx - r, qy);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }

  // A point part-way along a drawn thread, on the page.
  along(s, u) {
    const a = this.A[s], b = this.B[s], { sx, sy, mid } = this;
    const w = 1 - u;
    return [
      w * w * sx[a] + 2 * w * u * mid[s * 2] + u * u * sx[b],
      w * w * sy[a] + 2 * w * u * mid[s * 2 + 1] + u * u * sy[b]
    ];
  }
}

const cellTmp = { i: 0, j: 0, u: 0, v: 0, rho: 0 };
export { HUB_RINGS };
