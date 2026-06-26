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

  // ------------------------------------------- vibrant particle constellation
  // A field of glowing dots that drift on their own, link up into a faint
  // web, and scatter away from the cursor (with lines reaching toward it).
  const fx = document.getElementById("fxCanvas");
  if (fx && !reduce) {
    const fctx = fx.getContext("2d");
    const COLORS = ["#a64dff", "#19e3ff", "#ff2e97", "#b6ff5a"];
    let w = 0, h = 0, dpr = 1;

    const sprites = {};
    function makeSprite(color) {
      const s = document.createElement("canvas");
      s.width = s.height = 64;
      const c = s.getContext("2d");
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, color);
      g.addColorStop(0.25, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.beginPath(); c.arc(32, 32, 32, 0, 7); c.fill();
      return s;
    }
    COLORS.forEach((c) => (sprites[c] = makeSprite(c)));

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr);
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener("resize", size);

    const count = Math.max(36, Math.min(92, Math.floor((w * h) / 22000)));
    const ps = [];
    for (let i = 0; i < count; i++) {
      ps.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
        r: 1.2 + Math.random() * 2.4,
        c: COLORS[i % COLORS.length]
      });
    }

    let mx = -9999, my = -9999;
    window.addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; });
    window.addEventListener("pointerout", () => { mx = -9999; my = -9999; });

    const LINK = 130, MOUSE = 210;
    function tickFx() {
      fctx.clearRect(0, 0, w, h);
      fctx.globalCompositeOperation = "lighter";

      // links between nearby particles + reaching toward the cursor
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK) {
            fctx.strokeStyle = "rgba(150,140,255," + (0.11 * (1 - d / LINK)) + ")";
            fctx.lineWidth = 1;
            fctx.beginPath(); fctx.moveTo(a.x, a.y); fctx.lineTo(b.x, b.y); fctx.stroke();
          }
        }
        const mdx = a.x - mx, mdy = a.y - my, md = Math.hypot(mdx, mdy);
        if (md < MOUSE) {
          fctx.strokeStyle = "rgba(25,227,255," + (0.22 * (1 - md / MOUSE)) + ")";
          fctx.lineWidth = 1;
          fctx.beginPath(); fctx.moveTo(a.x, a.y); fctx.lineTo(mx, my); fctx.stroke();
        }
      }

      // move + draw
      for (const p of ps) {
        const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
        if (d < MOUSE && d > 0.01) {
          const f = (1 - d / MOUSE) * 0.6;     // scatter from the cursor
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
        }
        p.vx += (Math.random() - 0.5) * 0.02;  // gentle wander
        p.vy += (Math.random() - 0.5) * 0.02;
        p.vx *= 0.99; p.vy *= 0.99;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 2) { p.vx = p.vx / sp * 2; p.vy = p.vy / sp * 2; }
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;

        const s = sprites[p.c], sz = p.r * 7;
        fctx.globalAlpha = 0.9;
        fctx.drawImage(s, p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      fctx.globalAlpha = 1;
      requestAnimationFrame(tickFx);
    }
    requestAnimationFrame(tickFx);
  }
})();
