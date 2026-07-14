// interactions.js — ambient, cursor-reactive polish for the home page:
// a light that trails the pointer, a gentle parallax on the background,
// and water-ripple feedback on clicks. Purely decorative and layered on top
// of app.js — it never blocks or alters the existing click/modal behaviour.
// Fully disabled when the user prefers reduced motion.

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
    ".ghost-btn, .pz-btn, .choice, .streak-pill, .modal-close";

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

  // (neon streaks live in trail.js — they emit from the moving cursor)
})();
