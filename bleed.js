// bleed.js — the page arriving: it opens round the candle and bleeds outward,
// like ink soaking into paper.
//
// A veil the colour of the room covers the page from the very first paint
// (home.css draws it, with a pinhole round the loading flame, before any
// script runs). This takes it over at once. While the desk is being made
// ready behind it, the opening keeps spreading round the flame, quickly at
// first and then slower, like ink finding its way into the paper; when
// desk.js says the desk is ready (Bleed.reveal()), it runs out past the
// edges and fades. Its edge is ragged and feathered, with a faint tide line
// where the stain is still spreading.
//
// It is drawn in a worker where the browser allows it (an OffscreenCanvas),
// so it keeps moving even while the page is busy building the desk; anywhere
// else it is drawn here, between frames. With reduced motion there is no veil.

(function () {
  "use strict";

  const veil = document.getElementById("bleed");
  const flame = document.querySelector(".room-loading-flame");
  const GIVE_UP_MS = 25000;   // if the page never says it's ready, open it anyway

  if (!veil || !veil.getContext || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (veil) veil.remove();
    window.Bleed = Object.freeze({ reveal() {} });
    return;
  }

  // Where it opens from: the loading flame, which sits where the desk's
  // candle will be.
  function where() {
    const width = veil.clientWidth, height = veil.clientHeight;
    const r = flame && flame.getBoundingClientRect();
    return {
      width, height,
      cx: r && r.width ? r.left + r.width / 2 : width / 2,
      cy: r && r.height ? r.top + r.height / 2 : height / 2
    };
  }

  function colours() {
    const style = getComputedStyle(veil);
    return {
      veil: style.getPropertyValue("--veil").trim() || "#050302",
      tide: style.getPropertyValue("--tide").trim() || "rgb(255, 170, 90)"
    };
  }

  let worker = null, send = null, revealed = false;

  function settle(message) {
    if (message.type === "drawn") {
      veil.style.background = "none";    // the pinhole home.css drew is drawn by the painter now
    } else if (message.type === "done") {
      veil.remove();
      if (worker) worker.terminate();
    }
  }

  const init = Object.assign({ type: "init" }, where(), colours());
  try {
    if (!("transferControlToOffscreen" in veil) || typeof Worker !== "function") throw new Error("no offscreen canvas");
    const source = `const receive = (${painter})(self); self.onmessage = (e) => receive(e.data);`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    worker = new Worker(url);
    const offscreen = veil.transferControlToOffscreen();
    worker.onmessage = (e) => { URL.revokeObjectURL(url); settle(e.data); };
    // a worker that can't draw has the canvas, so there is nothing to fall back to
    worker.onerror = () => { veil.remove(); worker.terminate(); };
    worker.postMessage(Object.assign(init, { canvas: offscreen }), [offscreen]);
    send = (message) => worker.postMessage(message);
  } catch (error) {
    if (worker) worker.terminate();
    worker = null;
    try {
      const receive = painter({ postMessage: settle });
      receive(Object.assign(init, { canvas: veil }));
      send = receive;
    } catch (e) {
      veil.remove();
      send = () => {};
    }
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    send({ type: "reveal" });
  }

  window.addEventListener("resize", () => send(Object.assign({ type: "size" }, where())));
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    send(Object.assign({ type: "colours" }, colours()));
  });
  setTimeout(reveal, GIVE_UP_MS);

  window.Bleed = Object.freeze({ reveal });

  // ----- The painter -----
  // Everything the veil does, in one function that runs either in the worker
  // or on this page. It becomes the worker's source through toString(), so it
  // has to stand on its own. Messages in: init, size, colours, reveal.
  // Messages out: drawn (the first frame is up), done (fully open).
  function painter(host) {
    const SCALE = 2;          // CSS pixels per canvas pixel; the upscale softens the edge
    const START = 34;         // the pinhole home.css draws, in CSS pixels
    const REVEAL_MS = 1900;   // from wherever it has got to, out past the edges
    const TAU = Math.PI * 2;
    const later = typeof requestAnimationFrame === "function"
      ? (f) => requestAnimationFrame(f)
      : (f) => setTimeout(() => f(performance.now()), 16);

    // The edge, feathered over the outer eighth of the radius: rings from the
    // rim inward, each clearing an even share more, so it fades in a ramp.
    const RINGS = 12, FEATHER_WIDTH = 0.12;
    const FEATHER = Array.from({ length: RINGS }, (_, i) => [1 - FEATHER_WIDTH * i / (RINGS - 1), 1 / (RINGS - i)]);

    // The ragged edge: slow lobes round the rim with finer ripples on top, and
    // fingers where the ink has run further along the grain. Different on
    // every visit, and drifting a little as it spreads.
    const waves = [2, 3, 4, 6, 9, 13, 19, 27, 38, 53, 71].map((k) => ({
      k, a: (0.05 + Math.random() * 0.04) * Math.pow(k / 2, -0.9),
      phase: Math.random() * TAU, drift: (Math.random() - 0.5) * 0.5
    }));
    const fingers = Array.from({ length: 22 }, () => ({
      at: Math.random() * TAU, width: 0.04 + Math.random() * 0.07, reach: 0.015 + Math.random() * 0.045
    }));
    const POINTS = 240;
    const rim = new Float32Array(POINTS);
    shape(0);
    // how much of the radius is clear all the way round, with room for the drift
    const CLEAR = (Math.min(...rim) - 0.04) * (1 - FEATHER_WIDTH);

    let canvas = null, g = null, width = 1, height = 1, cx = 0, cy = 0, colours = null;
    let begun = 0, revealAt = 0, from = 0, drawn = false, done = false;

    function shape(t) {
      for (let i = 0; i < POINTS; i++) {
        const a = (i / POINTS) * TAU;
        let r = 1;
        for (const w of waves) r += w.a * Math.sin(w.k * a + w.phase + w.drift * t);
        for (const f of fingers) {
          let d = Math.abs(a - f.at);
          if (d > Math.PI) d = TAU - d;
          r += f.reach * Math.exp(-(d / f.width) * (d / f.width));
        }
        rim[i] = r;
      }
    }

    function trace(radius) {
      g.beginPath();
      for (let i = 0; i < POINTS; i++) {
        const a = (i / POINTS) * TAU, r = radius * rim[i];
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
    }

    // How far open, from 0 (the pinhole) to 1 (past every corner). While it
    // waits it spreads quickly at first, then ever more slowly, but never
    // stops; once revealed it eases out the rest of the way.
    function waiting(now) {
      const t = (now - begun) / 1000;
      return 0.3 * (1 - Math.exp(-t / 1.8)) + 0.14 * (1 - Math.exp(-t / 12));
    }

    function frame(now) {
      if (done) return;
      let open = waiting(now), fade = 0, u = 0;
      if (revealAt) {
        u = Math.min(1, (now - revealAt) / REVEAL_MS);
        open = from + (1 - from) * (1 - Math.cos(Math.PI * u)) / 2;
        const f = Math.max(0, (u - 0.7) / 0.3);
        fade = f * f * (3 - 2 * f);
      }
      draw(now / 1000, open, 1 - fade);
      if (u >= 1) {
        done = true;
        g.clearRect(0, 0, width, height);
        host.postMessage({ type: "done" });
        return;
      }
      later(frame);
    }

    function draw(t, open, alpha) {
      // wide enough at the end that even the deepest notch in the rim is
      // past the farthest corner
      const far = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
      const start = START / SCALE / CLEAR;
      const end = far / CLEAR + 4;
      const radius = start + (end - start) * open;
      shape(t);

      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, width, height);
      g.globalAlpha = alpha;
      g.fillStyle = colours.veil;
      g.fillRect(0, 0, width, height);
      g.globalCompositeOperation = "destination-out";
      for (const [ring, clear] of FEATHER) {
        trace(radius * ring);
        g.globalAlpha = clear;
        g.fill();
      }
      // the tide line, where the stain is still spreading
      g.globalCompositeOperation = "source-over";
      g.strokeStyle = colours.tide;
      trace(radius * 0.99);
      g.globalAlpha = 0.05 * alpha;
      g.lineWidth = 8;
      g.stroke();
      g.globalAlpha = 0.1 * alpha;
      g.lineWidth = 1.4;
      g.stroke();
      g.globalAlpha = 1;

      if (!drawn) {
        drawn = true;
        host.postMessage({ type: "drawn" });
      }
    }

    function size(m) {
      width = Math.max(1, Math.ceil(m.width / SCALE));
      height = Math.max(1, Math.ceil(m.height / SCALE));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      cx = m.cx / SCALE;
      cy = m.cy / SCALE;
    }

    return function receive(m) {
      if (m.type === "init") {
        canvas = m.canvas;
        g = canvas.getContext("2d");
        colours = { veil: m.veil, tide: m.tide };
        size(m);
        begun = performance.now();
        later(frame);
      } else if (!canvas) {
        return;
      } else if (m.type === "size") {
        size(m);
      } else if (m.type === "colours") {
        colours = { veil: m.veil, tide: m.tide };
      } else if (m.type === "reveal" && !revealAt) {
        const now = performance.now();
        from = waiting(now);
        revealAt = now;
      }
    };
  }
})();
