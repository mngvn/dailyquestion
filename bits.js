// bits.js — small React Bits pieces (reactbits.dev, MIT), ported out of React
// so the page can keep running without a build step.
//
//   Bits.clickSpark(container) → { fire(x, y, opts) }   ClickSpark
//   Bits.decrypt(node, text)                            DecryptedText
//   Bits.stagger(container)                             AnimatedContent, per child
//   Bits.tilt(node) → teardown                          TiltedCard
//   Bits.glare(node)                                    GlareHover
//   Bits.counter(node, value, suffix)                   Counter
//   Bits.animatedList(list, scroller)                   AnimatedList
//
// ShinyText is CSS only: add class "shiny-text" (see room.css).
// Everything here steps aside for prefers-reduced-motion.

const Bits = (function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ----- ClickSpark -----
  // Lines that burst outward from a click and shorten as they fly. The canvas
  // covers the container and lets every click through.
  function clickSpark(container, defaults) {
    const opts = Object.assign({ color: "#ffcf7a", size: 14, radius: 34, count: 9, duration: 480 }, defaults);
    const canvas = document.createElement("canvas");
    canvas.className = "bits-sparks";
    canvas.setAttribute("aria-hidden", "true");
    container.append(canvas);
    const ctx = canvas.getContext("2d");
    let sparks = [], frame = 0, dpr = 1;
    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(container.clientWidth * dpr);
      canvas.height = Math.round(container.clientHeight * dpr);
    };
    new ResizeObserver(fit).observe(container);
    fit();
    const easeOut = (t) => t * (2 - t);
    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparks = sparks.filter((s) => {
        const k = (now - s.start) / s.duration;
        if (k >= 1) return false;
        const e = easeOut(k);
        const d = e * s.radius, len = s.size * (1 - e);
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 1 - k * 0.6;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(s.angle) * d, s.y + Math.sin(s.angle) * d);
        ctx.lineTo(s.x + Math.cos(s.angle) * (d + len), s.y + Math.sin(s.angle) * (d + len));
        ctx.stroke();
        return true;
      });
      ctx.globalAlpha = 1;
      frame = sparks.length ? requestAnimationFrame(draw) : 0;
    }
    function fire(x, y, o) {
      if (reduce) return;
      const c = Object.assign({}, opts, o);
      const now = performance.now();
      const turn = Math.random() * Math.PI;
      for (let i = 0; i < c.count; i++) {
        sparks.push({
          x, y, start: now, angle: turn + (2 * Math.PI * i) / c.count,
          color: c.color, size: c.size * (0.7 + Math.random() * 0.6), radius: c.radius * (0.8 + Math.random() * 0.4),
          duration: c.duration
        });
      }
      if (!frame) frame = requestAnimationFrame(draw);
    }
    return { fire };
  }

  // ----- DecryptedText -----
  // The letters arrive scrambled and settle one at a time, left to right. The
  // real text sits beside them for screen readers.
  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz§†‡¶*";
  function decrypt(node, text, o) {
    const opts = Object.assign({ speed: 38, perStep: 1 }, o);
    if (node._decrypt) clearInterval(node._decrypt);
    if (reduce) { node.textContent = text; return; }
    const real = document.createElement("span");
    real.className = "sr-only";
    real.textContent = text;
    const shown = document.createElement("span");
    shown.className = "bits-decrypt";
    shown.setAttribute("aria-hidden", "true");
    node.replaceChildren(real, shown);
    let revealed = 0;
    const tick = () => {
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        out += i < revealed || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      shown.textContent = out;
      if (revealed >= text.length) {
        clearInterval(node._decrypt);
        node._decrypt = null;
        node.textContent = text;
        return;
      }
      revealed += opts.perStep;
    };
    tick();
    node._decrypt = setInterval(tick, opts.speed);
  }

  // ----- AnimatedContent -----
  // Each child rises into place a beat after the one before.
  function stagger(container) {
    if (reduce) return;
    Array.from(container.children).forEach((child, i) => child.style.setProperty("--i", i));
    container.classList.remove("bits-stagger");
    void container.offsetWidth;
    container.classList.add("bits-stagger");
  }

  // ----- TiltedCard -----
  // The card leans toward the pointer and a sheen follows it.
  function tilt(node, o) {
    const opts = Object.assign({ max: 5 }, o);
    if (reduce || !window.matchMedia("(hover: hover)").matches) return () => {};
    let rx = 0, ry = 0, tx = 0, ty = 0, frame = 0, alive = true;
    node.classList.add("bits-tilt");
    const step = () => {
      frame = 0;
      rx += (tx - rx) * 0.12;
      ry += (ty - ry) * 0.12;
      node.style.transform = `perspective(1200px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (alive && (Math.abs(tx - rx) > 0.01 || Math.abs(ty - ry) > 0.01)) frame = requestAnimationFrame(step);
    };
    const move = (e) => {
      const r = node.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      const inside = Math.abs(px) < 0.6 && Math.abs(py) < 0.6;
      tx = inside ? -py * opts.max * 2 : 0;
      ty = inside ? px * opts.max * 2 : 0;
      node.style.setProperty("--sheen-x", `${((px + 0.5) * 100).toFixed(1)}%`);
      node.style.setProperty("--sheen-y", `${((py + 0.5) * 100).toFixed(1)}%`);
      if (!frame) frame = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      alive = false;
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
      node.classList.remove("bits-tilt");
      node.style.transform = "";
    };
  }

  // ----- GlareHover -----
  // A band of light sweeps across on hover. The sweep is CSS; this only
  // marks the element.
  function glare(node) {
    node.classList.add("bits-glare");
    return node;
  }

  // ----- Counter -----
  // Each digit is a wheel of 0–9 that turns to its value, like the counters
  // on a ship's log.
  function counter(node, value, suffix) {
    const text = String(value) + (suffix || "");
    if (node.dataset.counter === text) return;
    const first = node.dataset.counter === undefined;
    node.dataset.counter = text;
    let wheels = node._wheels;
    if (!wheels || wheels.length !== text.length || !node.contains(wheels.root)) {
      const root = document.createElement("span");
      root.className = "bits-counter";
      root.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "sr-only";
      wheels = Array.from(text, (ch) => {
        if (!/\d/.test(ch)) {
          const c = document.createElement("span");
          c.className = "bits-counter-char";
          c.textContent = ch;
          root.append(c);
          return { ch, strip: null };
        }
        const wheel = document.createElement("span");
        wheel.className = "bits-wheel";
        const strip = document.createElement("span");
        strip.className = "bits-strip";
        for (let d = 0; d <= 9; d++) {
          const n = document.createElement("span");
          n.textContent = d;
          strip.append(n);
        }
        wheel.append(strip);
        root.append(wheel);
        return { ch, strip };
      });
      wheels.root = root;
      wheels.label = label;
      node.replaceChildren(label, root);
      node._wheels = wheels;
    }
    wheels.label.textContent = text;
    const set = () => Array.from(text).forEach((ch, i) => {
      const w = wheels[i];
      if (!w.strip) return;
      w.strip.style.transitionDelay = `${(text.length - i) * 60}ms`;
      w.strip.style.transform = `translateY(${-Number(ch) * 10}%)`;
    });
    if (first && !reduce) {
      wheels.forEach((w) => { if (w.strip) w.strip.style.transform = "translateY(0)"; });
      requestAnimationFrame(() => requestAnimationFrame(set));
    } else {
      set();
    }
  }

  // ----- AnimatedList -----
  // Items scale in as they scroll into view; the arrow keys walk the list.
  function animatedList(list, scroller) {
    const items = Array.from(list.children);
    list.classList.add("bits-list");
    if (!reduce && "IntersectionObserver" in window) {
      const seen = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("is-in");
          seen.unobserve(e.target);
        });
      }, { root: scroller || null, threshold: 0.3 });
      items.forEach((item, i) => {
        item.style.setProperty("--i", i % 8);
        seen.observe(item);
      });
    } else {
      items.forEach((item) => item.classList.add("is-in"));
    }
    let selected = -1;
    const select = (i) => {
      if (items[selected]) items[selected].classList.remove("is-selected");
      selected = i;
      if (items[i]) {
        items[i].classList.add("is-selected");
        items[i].scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      }
    };
    items.forEach((item, i) => {
      item.tabIndex = 0;
      item.addEventListener("pointerenter", () => select(i));
      item.addEventListener("focus", () => select(i));
    });
    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const next = Math.max(0, Math.min(items.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
      items[next].focus();
    });
  }

  return { clickSpark, decrypt, stagger, tilt, glare, counter, animatedList };
})();
