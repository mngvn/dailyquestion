// interactions.js — ambient, cursor-reactive polish for the home page:
// a light that trails the pointer, a gentle parallax on the background,
// subtle 3D tilt + spotlight on the cards, and water-ripple feedback on
// clicks. Purely decorative and layered on top of app.js — it never blocks
// or alters the existing click/modal behaviour. Fully disabled when the
// user prefers reduced motion.

(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  const rippleLayer = document.getElementById("rippleLayer");
  const glow = document.querySelector(".pointer-glow");
  const bg = document.querySelector(".bg");

  // ---------------------------------------------------------------- ripples
  // A burst of expanding water rings from the click point (behind the cards).
  function waterRipple(x, y) {
    if (!rippleLayer) return;
    const rings = 3;
    for (let i = 0; i < rings; i++) {
      const ring = document.createElement("span");
      ring.className = "water-ripple" + (i % 2 ? " alt" : "");
      ring.style.left = x + "px";
      ring.style.top = y + "px";
      ring.style.animationDelay = i * 0.14 + "s";
      rippleLayer.appendChild(ring);
      ring.addEventListener("animationend", () => ring.remove());
    }
  }

  // A tactile ripple that fills the clicked control from the touch point.
  function tapRipple(el, x, y) {
    const r = el.getBoundingClientRect();
    const size = Math.hypot(r.width, r.height) * 2;
    const ripple = document.createElement("span");
    ripple.className = "tap-ripple";
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = x - r.left + "px";
    ripple.style.top = y - r.top + "px";
    el.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  }

  const TAP_SEL =
    ".card, .ghost-btn, .pz-btn, .pz-new, .choice, .vault-item, .streak-pill, .modal-close";

  if (!reduce) {
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== undefined && e.button !== 0) return; // primary only
        waterRipple(e.clientX, e.clientY);
        const host = e.target.closest && e.target.closest(TAP_SEL);
        if (host) tapRipple(host, e.clientX, e.clientY);
      },
      true
    );
  }

  // ------------------------------------------------- pointer glow + parallax
  if (!reduce && finePointer) {
    let gx = window.innerWidth / 2;
    let gy = window.innerHeight / 2;
    let cgx = gx;
    let cgy = gy; // eased glow position
    let bx = 0;
    let by = 0;
    let cbx = 0;
    let cby = 0; // eased background offset

    window.addEventListener("pointermove", (e) => {
      document.body.classList.add("pointer-active");
      gx = e.clientX;
      gy = e.clientY;
      const nx = (e.clientX / window.innerWidth) * 2 - 1; // -1..1
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      bx = nx * 24;
      by = ny * 24;
    });

    document.addEventListener("pointerleave", () => {
      document.body.classList.remove("pointer-active");
    });

    (function frame() {
      cgx += (gx - cgx) * 0.14;
      cgy += (gy - cgy) * 0.14;
      cbx += (bx - cbx) * 0.06;
      cby += (by - cby) * 0.06;
      if (glow) glow.style.transform = `translate3d(${cgx}px, ${cgy}px, 0)`;
      if (bg) bg.style.transform = `translate3d(${cbx}px, ${cby}px, 0)`;
      requestAnimationFrame(frame);
    })();
  }

  // --------------------------------------------------- card tilt + spotlight
  if (!reduce && finePointer) {
    const MAX_TILT = 9;
    const ease = "box-shadow 0.4s ease, border-color 0.4s ease";
    const settle = "transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), " + ease;
    const track = "transform 0.08s ease-out, " + ease;

    // Wait for the entrance animation to finish so we don't fight it.
    setTimeout(() => {
      document.querySelectorAll(".card").forEach((card) => {
        card.addEventListener("pointermove", (e) => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width; // 0..1
          const py = (e.clientY - r.top) / r.height;
          const rotX = (py - 0.5) * -2 * MAX_TILT;
          const rotY = (px - 0.5) * 2 * MAX_TILT;
          card.style.transition = track;
          card.style.transform =
            `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-8px)`;
          card.style.setProperty("--spot-x", px * 100 + "%");
          card.style.setProperty("--spot-y", py * 100 + "%");
        });

        card.addEventListener("pointerleave", () => {
          card.style.transition = settle;
          card.style.transform = "";
          card.style.removeProperty("--spot-x");
          card.style.removeProperty("--spot-y");
        });
      });
    }, 950);
  }

  // -------------------------------------------------- neon streak field
  // Thin glowing streaks shoot across the black, scatter away from the
  // cursor, and throw faint lines toward it. (Streaks, not dots/bubbles.)
  const fx = document.getElementById("fxCanvas");
  if (fx && !reduce) {
    const fctx = fx.getContext("2d");
    const COLORS = ["#a64dff", "#19e3ff", "#ff2e97", "#b6ff5a"];
    let w = 0, h = 0, dpr = 1;

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr);
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener("resize", size);

    const MIN_SP = 0.7, MAX_SP = 3.2;
    const count = Math.max(28, Math.min(64, Math.floor((w * h) / 30000)));
    const ps = [];
    function seed(p) {
      const a = Math.random() * 6.2832, sp = MIN_SP + Math.random() * 1.3;
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.r = 1 + Math.random() * 1.8;
      p.c = COLORS[(Math.random() * COLORS.length) | 0];
      return p;
    }
    for (let i = 0; i < count; i++) ps.push(seed({}));

    let mx = -9999, my = -9999;
    window.addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; });
    window.addEventListener("pointerout", () => { mx = -9999; my = -9999; });

    const MOUSE = 220;
    function tickFx() {
      fctx.clearRect(0, 0, w, h);
      fctx.globalCompositeOperation = "lighter";
      fctx.lineCap = "round";

      for (const p of ps) {
        // scatter from the cursor + a faint line reaching toward it
        const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
        if (d < MOUSE && d > 0.01) {
          const f = (1 - d / MOUSE) * 0.5;
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
          fctx.strokeStyle = "rgba(25,227,255," + (0.16 * (1 - d / MOUSE)) + ")";
          fctx.lineWidth = 1;
          fctx.beginPath(); fctx.moveTo(p.x, p.y); fctx.lineTo(mx, my); fctx.stroke();
        }
        p.vx += (Math.random() - 0.5) * 0.05;
        p.vy += (Math.random() - 0.5) * 0.05;

        // keep speed inside a band so they always read as streaks
        let sp = Math.hypot(p.vx, p.vy);
        if (sp < MIN_SP) { p.vx = p.vx / (sp || 1) * MIN_SP; p.vy = p.vy / (sp || 1) * MIN_SP; sp = MIN_SP; }
        else if (sp > MAX_SP) { p.vx = p.vx / sp * MAX_SP; p.vy = p.vy / sp * MAX_SP; sp = MAX_SP; }

        p.x += p.vx; p.y += p.vy;
        if (p.x < -60) p.x = w + 60; else if (p.x > w + 60) p.x = -60;
        if (p.y < -60) p.y = h + 60; else if (p.y > h + 60) p.y = -60;

        // draw the streak: a glow pass + a bright core, trailing behind motion
        const ux = p.vx / sp, uy = p.vy / sp;
        const len = 26 + sp * 26;
        const tx = p.x - ux * len, ty = p.y - uy * len;
        fctx.strokeStyle = p.c;
        fctx.globalAlpha = 0.18; fctx.lineWidth = p.r * 3.2;
        fctx.beginPath(); fctx.moveTo(tx, ty); fctx.lineTo(p.x, p.y); fctx.stroke();
        fctx.globalAlpha = 0.95; fctx.lineWidth = Math.max(1, p.r);
        fctx.beginPath(); fctx.moveTo(tx, ty); fctx.lineTo(p.x, p.y); fctx.stroke();
      }
      fctx.globalAlpha = 1;
      requestAnimationFrame(tickFx);
    }
    requestAnimationFrame(tickFx);
  }
})();
