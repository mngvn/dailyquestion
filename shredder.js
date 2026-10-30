// shredder.js — a note put down goes through the shredder.
//
// After React Bits' Shredder (reactbits.dev/micro/shredder, MIT), drawn on a
// canvas laid over the room. A slit opens upright at the side of the note
// where it is held up to be read — the side with more room beyond it — and
// the note is pulled sideways through it with a first tug. What comes out
// the far side is cut into thin, straight slices that fan out and sag as
// they stick out of the slit; once a slice's end is through, it is thrown on
// sideways, tipping as it goes, and gravity takes it down until it is off
// the screen.
//
//   shred(canvas, { from, print, light, onFed }) → Promise, resolved once the
//   last slice has fallen away; onFed is called as soon as the whole sheet
//   has gone through the slit, while its slices are still falling.
//   `from` is where the note is on screen, { x, y, w, h } in canvas pixels;
//   `print` is the note's printed canvas.

const SLIT = 6;            // the slit runs this far past the paper above and below
const TUG = 2.4;           // the first pull is this much faster…
const TUG_DECAY = 0.14;    // …easing off over about this long
const OPEN_S = 0.18;       // the slit opening before the feed starts
const SLICE_PX = 3;        // about how tall each slice is cut
const GRAVITY = 1500;      // px/s², for a slice once it is free
const DRAG = 1.6;          // how quickly a free slice loses its sideways throw

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

export function shred(canvas, { from, print, light, onFed }) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.ceil(W * dpr);
  canvas.height = Math.ceil(H * dpr);

  const { x: left, y: topY, w, h } = from;
  // fed toward whichever side has more room
  const dir = W - (left + w) >= left ? 1 : -1;
  const slitW = 5;
  const lip = dir > 0 ? left + w : left;          // the slit's near face
  const exit = lip + dir * slitW;                 // where the paper comes out
  const ts = print.width / w;                     // print pixels per screen pixel
  const speed = Math.max(380, w / 0.9);           // feeding, after the first tug
  const slitColor = light ? "#3f3a33" : "#120d09";

  const sheet = { x: left, v: 0, age: 0, fed: false };
  const n = Math.max(12, Math.round(h / SLICE_PX));
  const sh = h / n;
  // each slice is thrown and falls a little differently, so they scatter
  const slices = Array.from({ length: n }, (_, i) => ({
    row: i, y: topY + i * sh, free: false, x: 0, vx: 0, vy: 0,
    throwK: 0.55 + Math.random() * 0.6, pull: GRAVITY * (0.75 + Math.random() * 0.5),
    // how far it fans out from the slit: a sag downward, give or take
    tilt: 0.05 + (Math.random() - 0.5) * 0.1, angle: 0, spin: 0
  }));

  // a slice, `len` long, its near end at (x, y), turned by `angle` about
  // that end; `from` is where along the sheet it starts
  function slice(sl, from, len, x, y, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * x, dpr * (y + sh / 2));
    const start = dir > 0 ? 0 : -len;
    ctx.drawImage(print, from * ts, sl.row * sh * ts, len * ts, sh * ts, start, -sh / 2, len, Math.max(1, sh - 0.8));
  }

  function drawSlit(open, t, pulling) {
    const jx = pulling ? Math.cos(t * 97) * 0.35 : 0, jy = pulling ? Math.sin(t * 140) * 0.5 : 0;
    const full = h + SLIT * 2, height = full * open;
    const x = dir > 0 ? lip : lip - slitW;
    ctx.setTransform(dpr, 0, 0, dpr, dpr * (x + jx), dpr * (topY + h / 2 - height / 2 + jy));
    ctx.globalAlpha = smooth(open * 2);
    ctx.fillStyle = slitColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, slitW, height, slitW / 2);
    ctx.fill();
    // a lit lip along the face the paper goes into
    ctx.fillStyle = light ? "rgba(255,255,255,0.5)" : "rgba(255,200,140,0.22)";
    ctx.fillRect(dir > 0 ? 0 : slitW - 1, slitW / 2, 1, Math.max(0, height - slitW));
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

      // the sheet is fed sideways through the slit, and keeps going until
      // the last of every slice has come out of it
      const feeding = t > OPEN_S;
      if (feeding) {
        sheet.age += dt;
        sheet.v = speed * (1 + (TUG - 1) * Math.exp(-sheet.age / TUG_DECAY));
        sheet.x += dir * sheet.v * dt;
        if (!sheet.fed && (dir > 0 ? sheet.x >= lip : sheet.x + w <= lip)) {
          sheet.fed = true;
          if (onFed) onFed();
        }
      }
      slitOpen = sheet.fed ? Math.max(0, slitOpen - dt * 3) : Math.min(1, slitOpen + dt / OPEN_S);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const jitter = feeding && !sheet.fed ? Math.sin(t * 150) * 0.5 : 0;

      // what is still on the near side of the slit
      const before = dir > 0 ? lip - sheet.x : sheet.x + w - lip;
      if (before > 0) {
        const vis = Math.min(w, before), src = dir > 0 ? 0 : w - vis;
        ctx.drawImage(print, src * ts, 0, vis * ts, print.height, dir > 0 ? sheet.x : lip, topY + jitter, vis, h);
      }

      // what has come out: slices sticking out of the slit, then thrown on
      // and falling once their end is through
      const out = Math.min(w, dir > 0 ? sheet.x + w - lip : lip - sheet.x);
      const through = dir > 0 ? sheet.x >= exit : sheet.x + w <= exit;
      for (let i = slices.length - 1; i >= 0; i--) {
        const sl = slices[i];
        const fan = dir * sl.tilt * smooth(out / (w * 0.6));
        if (!sl.free && through) {
          // let go at its near end, which is where it was leaving the slit
          sl.free = true;
          sl.x = exit;
          sl.angle = fan;
          sl.vx = dir * sheet.v * sl.throwK;
          sl.vy = -40 * Math.random();
          sl.spin = dir * (0.6 + Math.random() * 1.6);
        }
        if (sl.free) {
          sl.vx *= Math.exp(-DRAG * dt);
          sl.vy += sl.pull * dt;
          sl.x += sl.vx * dt;
          sl.y += sl.vy * dt;
          sl.angle += sl.spin * dt;
          if (sl.y - w > H || sl.x - w > W || sl.x + w < 0) { slices.splice(i, 1); continue; }
          slice(sl, 0, w, sl.x, sl.y, sl.angle);
        } else if (out > 0) {
          slice(sl, dir > 0 ? w - out : 0, out, exit, sl.y + jitter, fan);
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (slitOpen > 0) drawSlit(slitOpen, t, feeding && !sheet.fed);
      if (slices.length || slitOpen > 0 || !sheet.fed) requestAnimationFrame(frame);
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}
