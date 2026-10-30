// shredder.js — a note put down goes through the shredder.
//
// After React Bits' Shredder (reactbits.dev/micro/shredder, MIT), drawn on a
// canvas laid over the room. A slit opens right under the note where it is
// held up to be read; the note is pulled down through it with a first tug,
// and what comes out below is cut into thin, straight slices. Each one hangs
// from the slit until its top end is through, then drops straight down under
// gravity until it is off the bottom of the screen.
//
//   shred(canvas, { from, print, light, onFed }) → Promise, resolved once the
//   last slice has fallen away; onFed is called as soon as the whole sheet
//   has gone through the slit, while its slices are still falling.
//   `from` is where the note is on screen, { x, y, w, h } in canvas pixels;
//   `print` is the note's printed canvas.

const SLIT = 6;            // the slit runs this far past the paper either side
const TUG = 2.4;           // the first pull is this much faster…
const TUG_DECAY = 0.14;    // …easing off over about this long
const OPEN_S = 0.18;       // the slit opening before the feed starts
const SLICE_PX = 3;        // about how wide each slice is cut
const GRAVITY = 1500;      // px/s², for a slice once it is free

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

  // the slit, right under the note where it is held
  const { x: left, w, h } = from;
  const lip = from.y + h;                         // the slit's top edge
  const slitH = 5;
  const exit = lip + slitH;
  const ts = print.width / w;                     // print pixels per screen pixel
  const speed = Math.max(420, h / 1.1);           // feeding, after the first tug
  const slitColor = light ? "#3f3a33" : "#120d09";

  const sheet = { y: from.y, v: 0, age: 0, fed: false };
  const n = Math.max(12, Math.round(w / SLICE_PX));
  const sw = w / n;
  // each slice falls a little differently, so they part as they drop
  const slices = Array.from({ length: n }, (_, i) => ({
    x: left + i * sw, free: false, y: 0, v: 0, pull: GRAVITY * (0.8 + Math.random() * 0.4)
  }));

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
      // last of every slice has come out of it
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // what is still above the slit
      const jitter = feeding && !sheet.fed ? Math.sin(t * 150) * 0.5 : 0;
      if (sheet.y < lip) {
        const visible = lip - sheet.y;
        ctx.drawImage(print, 0, 0, print.width, print.height * visible / h, left + jitter, sheet.y, w, visible);
      }

      // what has come out underneath: slices hanging from the slit, then
      // falling straight down once their top end is through
      const top = sheet.y - exit;
      for (let i = slices.length - 1; i >= 0; i--) {
        const sl = slices[i];
        let y0 = exit, len = h, v0 = 0;
        if (!sl.free) {
          if (top + h <= 0) continue;
          if (top >= 0) {
            sl.free = true;
            sl.y = exit + top;
            sl.v = sheet.v;
          } else {
            len = top + h;
            v0 = h - len;
          }
        }
        if (sl.free) {
          sl.v += sl.pull * dt;
          sl.y += sl.v * dt;
          if (sl.y > H + 4) { slices.splice(i, 1); continue; }
          y0 = sl.y;
        }
        const shown = Math.min(len, H + 4 - y0);
        if (shown <= 0) continue;
        ctx.drawImage(print, (sl.x - left) * ts, v0 * ts, sw * ts, shown * ts, sl.x + jitter, y0, Math.max(1, sw - 0.6), shown);
      }

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
