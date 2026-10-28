// shredder.js — a note put down goes through the shredder.
//
// A port of React Bits' Shredder (reactbits.dev/micro/shredder, MIT), out of
// React and its list of cards and into a single sheet on a canvas laid over
// the room. A slit opens right under the note where it is held up to be
// read; the note is pulled down through it with a first tug, and what comes
// out below is cut into strips that hang, then come free, curl, splay and
// drop under gravity until they are off the bottom of the screen. The strips
// are drawn the way the original draws them: sliver by sliver along a
// curling, fluttering path, each sliver a slice of the note's own print.
//
//   shred(canvas, { from, print, light, onFed }) → Promise, resolved once the
//   last strip has fallen away; onFed is called as soon as the whole sheet
//   has gone through the slit, while its strips are still falling.
//   `from` is where the note is on screen, { x, y, w, h } in canvas pixels;
//   `print` is the note's printed canvas.

const SLIT = 6;            // the slit runs this far past the paper either side
const SLIVER = 2;          // length of each drawn slice of a strip
const TUG = 2.4;           // the first pull is this much faster…
const TUG_DECAY = 0.14;    // …easing off over about this long
const OPEN_S = 0.18;       // the slit opening before the feed starts
const STRIP_PX = 11;       // about how wide each strip is cut
const GRAVITY = 1500;      // px/s², for a strip once it is free
const TEAR_PX = 160;       // a strip is fully torn loose this far below the slit

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (from, to, dt, tau) => from + (to - from) * (1 - Math.exp(-dt / tau));
const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
const pick = (lo, hi) => lo + Math.random() * (hi - lo);
const side = () => (Math.random() < 0.5 ? -1 : 1);
const DEG = Math.PI / 180;

// The path a strip takes: from its top, slice after slice, each turned a
// little more by the strip's curl and its wave, and fluttering once torn.
function shape(st, len, time, tear) {
  const pts = st.pts;
  pts.length = 0;
  let x = st.ax, y = st.ay;
  const steps = Math.ceil(len / SLIVER);
  const swing = (3 + 9 * st.rA) * tear;
  const pace = time * (1.6 + st.rA * 2.2) + st.rA * 6.2832;
  for (let j = 0; j <= steps; j++) {
    const d = Math.min(j * SLIVER, len);
    const a = st.th + st.curl * d + st.amp * Math.sin(d * st.freq + st.wave);
    const flutter = swing * Math.sin(d * 0.045 + pace);
    pts.push(x + flutter * Math.cos(a), y - flutter * Math.sin(a), a);
    const h = Math.min(SLIVER, len - d);
    x += Math.sin(a) * h;
    y += Math.cos(a) * h;
  }
}

export function shred(canvas, { from, print, light, onFed }) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.ceil(W * dpr);
  canvas.height = Math.ceil(H * dpr);

  // the slit, right under the note where it is held
  const { x: left, w, h } = from;
  const lip = from.y + h;                         // the slit's top edge
  const slitH = 5;
  const exit = lip + slitH;
  const ts = print.width / w;                     // print pixels per screen pixel
  const speed = Math.max(420, h / 1.1);           // feeding, after the first tug
  const slitColor = light ? "#3f3a33" : "#120d09";

  const sheet = { y: from.y, v: 0, age: 0, fed: false };
  const n = Math.max(6, Math.round(w / STRIP_PX));
  const sw = w / n;
  const strips = Array.from({ length: n }, (_, i) => ({
    x: i * sw, w: sw, phase: "attached",
    curl: side() * pick(0.35, 0.9) * DEG, amp: pick(1.5, 4) * DEG,
    freq: (Math.PI * 2) / pick(34, 60), wave: pick(0, Math.PI * 2),
    rA: Math.random(), rB: Math.random(),
    terminal: 0, splay: 0, core: 1, rest: 0, th: 0, ax: 0, ay: 0, vx: 0, vy: 0, pts: []
  }));

  // one slice of a strip at a time, each turned along its path; nothing
  // below the bottom of the screen is drawn
  function paintStrip(st, len) {
    const pts = st.pts, wc = st.w * st.core, half = wc / 2;
    const sx = (st.x + (st.w - wc) / 2) * ts;
    const v0 = h - len;
    for (let j = 0; j + 3 < pts.length; j += 3) {
      const d = (j / 3) * SLIVER;
      const sh = Math.min(SLIVER, len - d);
      if (sh <= 0 || pts[j + 1] + exit > H + 4) break;
      const ca = Math.cos(pts[j + 2]), sa = Math.sin(pts[j + 2]);
      ctx.setTransform(dpr * ca, -dpr * sa, dpr * sa, dpr * ca, dpr * pts[j], dpr * (pts[j + 1] + exit));
      ctx.drawImage(print, sx, (v0 + d) * ts, wc * ts, sh * ts, -half, 0, wc, sh + 0.4);
    }
  }

  function drawSlit(open, t, pulling) {
    const jx = pulling ? Math.sin(t * 140) * 0.5 : 0, jy = pulling ? Math.cos(t * 97) * 0.35 : 0;
    const full = w + SLIT * 2, width = full * open;
    ctx.setTransform(dpr, 0, 0, dpr, dpr * (left + w / 2 - width / 2 + jx), dpr * (lip + jy));
    ctx.globalAlpha = smooth(open * 2);
    ctx.fillStyle = slitColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, slitH, slitH / 2);
    ctx.fill();
    // a lit lip along the top edge
    ctx.fillStyle = light ? "rgba(255,255,255,0.5)" : "rgba(255,200,140,0.22)";
    ctx.fillRect(slitH / 2, 0, Math.max(0, width - slitH), 1);
    ctx.globalAlpha = 1;
  }

  return new Promise((resolve) => {
    let last = performance.now(), t = 0, slitOpen = 0;
    const frame = (now) => {
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      t += dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // the sheet is fed down through the slit, and keeps going until the
      // last of every strip has come out of it
      const feeding = t > OPEN_S;
      if (feeding) {
        sheet.age += dt;
        sheet.v = speed * (1 + (TUG - 1) * Math.exp(-sheet.age / TUG_DECAY));
        sheet.y += sheet.v * dt;
        if (!sheet.fed && sheet.y >= lip) {
          sheet.fed = true;
          if (onFed) onFed();
        }
      }
      slitOpen = sheet.fed ? Math.max(0, slitOpen - dt * 3) : Math.min(1, slitOpen + dt / OPEN_S);

      // what is still above the slit
      if (sheet.y < lip) {
        const jitter = feeding ? Math.sin(t * 150) * 0.5 : 0;
        const visible = lip - sheet.y;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(print, 0, 0, print.width, print.height * visible / h, left + jitter, sheet.y, w, visible);
      }

      // what has come out underneath, in strips
      for (let i = strips.length - 1; i >= 0; i--) {
        const st = strips[i];
        let len = h;
        if (st.phase === "attached") {
          const top = sheet.y - exit;
          const hang = top + h;
          if (hang <= 0) continue;
          st.ax = left + st.x + st.w / 2;
          st.th = Math.sin(t * 6 + st.wave) * 0.03 * smooth(hang / 40);
          if (top >= 0) {
            st.phase = "free";
            st.ay = top;
            st.vy = sheet.v;
            st.vx = pick(-20, 20);
            st.terminal = 520 + st.rA * 360;
            st.splay = (st.rA - 0.5) * 320;
            st.rest = side() * pick(0.15, 0.6);
          } else {
            st.ay = 0;
            len = hang;
          }
        }
        if (st.phase === "free") {
          // torn loose, it curls and splays as it drops, and gravity takes it
          const tear = Math.pow(clamp(st.ay / TEAR_PX, 0, 1), 1.2);
          const breath = 0.9 + 0.1 * Math.sin(t * (1 + st.rB * 2) + st.rA * 6.2832);
          st.vy = Math.min(st.vy + GRAVITY * dt, st.terminal * breath);
          st.vx = ease(st.vx, st.splay * tear + (st.ax - (left + w / 2)) * 0.25, dt, 0.4);
          st.ax += st.vx * dt;
          st.ay += st.vy * dt;
          st.th = ease(st.th, st.rest, dt, 0.5);
          st.core = 1 - smooth(tear / 0.85) * (0.6 - st.rA * 0.16);
          if (st.ay + exit > H + 8) { strips.splice(i, 1); continue; }
          shape(st, h, t, tear);
        } else {
          st.core = 1;
          shape(st, len, t, 0);
        }
        paintStrip(st, len);
      }

      if (slitOpen > 0) drawSlit(slitOpen, t, feeding && !sheet.fed);
      if (strips.length || slitOpen > 0 || !sheet.fed) requestAnimationFrame(frame);
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}
