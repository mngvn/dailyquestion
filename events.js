// events.js — random ambient "events" that take over the screen for a few
// seconds. Three are fleshed out:
//   • train  — a locomotive roars across while smoke swirls over the whole bg
//   • storm  — the sky darkens, rain + lightning, and a tornado descends and
//              sucks all the UI panels away, then drops them back
//   • quake  — the screen shakes, fractures crack across it, dust rains down
//
// For now they're triggered manually from the floating buttons near the theme
// toggle. window.DailyEvents.trigger(name) is exposed so a future scheduler can
// fire them at random. Disabled entirely under prefers-reduced-motion.

(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.getElementById("eventCanvas");
  const layer = document.getElementById("eventLayer");
  if (!canvas || !layer) return;

  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  function size() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  size();
  window.addEventListener("resize", size);

  const triggers = [...document.querySelectorAll(".ev-trigger")];
  let busy = false;
  function setBusy(b) {
    busy = b;
    triggers.forEach((t) => { t.disabled = b; });
    document.body.classList.toggle("ev-active", b);
  }

  // The panels an event can grab / rattle. Includes the open modal if any.
  function uiTargets() {
    const els = [...document.querySelectorAll(".topbar, .grid > .card, .vault, .footer")];
    if (document.body.classList.contains("modal-open")) {
      const m = document.getElementById("modal");
      if (m) els.push(m);
    }
    return els;
  }

  function caption(text) {
    const el = document.createElement("div");
    el.className = "ev-caption";
    el.textContent = text;
    layer.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => el.remove(), 2700);
  }

  // Drive a canvas timeline for `durationMs`. `frame(t, dt, total)` is called
  // each rAF with seconds elapsed, delta seconds, and total seconds.
  function animate(durationMs, frame) {
    return new Promise((resolve) => {
      canvas.classList.add("on");
      const start = performance.now();
      let prev = start;
      function step(now) {
        const t = (now - start) / 1000;
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        ctx.clearRect(0, 0, W, H);
        frame(t, dt, durationMs / 1000);
        if (now - start < durationMs) {
          requestAnimationFrame(step);
        } else {
          ctx.clearRect(0, 0, W, H);
          canvas.classList.remove("on");
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  // ------------------------------------------------------------------ TRAIN
  function train() {
    caption("🚂  WOOO — WOOOO!");

    const t = document.createElement("div");
    t.className = "ev-train";
    t.innerHTML = `
      <div class="ev-beam"></div>
      <div class="ev-loco">
        <span class="ev-window"></span>
        <span class="ev-headlight"></span>
        <span class="ev-wheel" style="left:28px"></span>
        <span class="ev-wheel" style="left:96px"></span>
        <span class="ev-wheel" style="left:210px"></span>
      </div>
      <div class="ev-coupling" style="left:282px"></div>
      <div class="ev-car c1"><span class="pane"></span>
        <span class="ev-wheel" style="left:28px"></span><span class="ev-wheel" style="left:150px"></span></div>
      <div class="ev-coupling" style="left:498px"></div>
      <div class="ev-car c2"><span class="pane"></span>
        <span class="ev-wheel" style="left:28px"></span><span class="ev-wheel" style="left:150px"></span></div>
    `;
    layer.appendChild(t);
    requestAnimationFrame(() => t.classList.add("run"));
    document.body.style.animation = "evRumble 0.32s linear infinite";

    const smoke = [];
    const cx = W * 0.5, cy = H * 0.45;

    return animate(4900, (tt, dt, total) => {
      // puff smoke out of the chimney, tracking the train's real position
      const rect = t.getBoundingClientRect();
      const stackX = rect.left + rect.width * 0.30;
      const stackY = rect.top + 18;
      if (tt < total * 0.78 && stackX > -120 && stackX < W + 120) {
        for (let i = 0; i < 4; i++) {
          smoke.push({
            x: stackX + (Math.random() * 30 - 15), y: stackY,
            vx: -0.6 + Math.random() * 0.6, vy: -1 - Math.random(),
            size: 14 + Math.random() * 22, life: 1,
            decay: 0.005 + Math.random() * 0.005,
            g: 140 + Math.random() * 80,
          });
        }
      }
      // every puff gets swept into a slow vortex over the whole screen
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i];
        const dx = p.x - cx, dy = p.y - cy;
        const r = Math.hypot(dx, dy) || 1;
        const tx = -dy / r, ty = dx / r; // tangent → swirl
        p.vx = p.vx * 0.97 + tx * 0.9 + (dx / r) * 0.12;
        p.vy = p.vy * 0.97 + ty * 0.9 + (dy / r) * 0.12 - 0.18;
        p.x += p.vx; p.y += p.vy; p.size += 0.4; p.life -= p.decay;
        if (p.life <= 0) { smoke.splice(i, 1); continue; }
        const a = Math.max(0, p.life) * 0.5;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `rgba(${p.g},${p.g},${p.g + 8},${a})`);
        grad.addColorStop(1, `rgba(${p.g},${p.g},${p.g},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
    }).then(() => {
      t.remove();
      document.body.style.animation = "";
    });
  }

  // ------------------------------------------------------------ STORM/TORNADO
  function storm() {
    caption("⛈️  STORM INCOMING");

    const sky = document.createElement("div"); sky.className = "ev-sky";
    const flash = document.createElement("div"); flash.className = "ev-flash";
    const tor = document.createElement("div"); tor.className = "ev-tornado";
    tor.innerHTML = '<div class="swirl"></div>';
    layer.append(sky, flash, tor);
    requestAnimationFrame(() => sky.classList.add("on"));

    // remember each panel so we can drop it back afterwards
    const targets = uiTargets();
    const saved = targets.map((el) => ({
      el, transform: el.style.transform, transition: el.style.transition, opacity: el.style.opacity,
    }));

    function lightning() {
      flash.style.setProperty("--fx", (15 + Math.random() * 70) + "%");
      flash.classList.remove("zap"); void flash.offsetWidth; flash.classList.add("zap");
    }
    function suck(el) {
      const r = el.getBoundingClientRect();
      const tc = tor.getBoundingClientRect();
      const dx = (tc.left + tc.width / 2) - (r.left + r.width / 2);
      const dy = (tc.top + tc.height * 0.32) - (r.top + r.height / 2);
      el.style.transition = "transform 1.1s cubic-bezier(.6,0,.9,.4), opacity 1.1s ease-in";
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(720deg) scale(0.04)`;
      el.style.opacity = "0";
    }

    // Everything below is driven off the animation clock (see the frame fn):
    // the tornado descends at 0.7s, lightning cracks at a few marks, and the
    // panels get pulled in one by one starting at 2.0s.
    let tornadoOn = false;
    let nextSucked = 0;
    const zaps = [1.0, 2.4, 4.0, 5.6];
    let zapIdx = 0;

    const rain = [];
    for (let i = 0; i < 280; i++) rain.push({ x: Math.random() * W, y: Math.random() * H, l: 12 + Math.random() * 16, s: 9 + Math.random() * 8 });
    const debris = [];
    const debrisColors = ["#7c6a55", "#9aa3b5", "#5a4636", "#c9b48f"];

    return animate(8200, (tt, dt, total) => {
      // timeline triggers, all on the rAF clock
      if (!tornadoOn && tt >= 0.7) { tornadoOn = true; tor.classList.add("on"); }
      if (zapIdx < zaps.length && tt >= zaps[zapIdx]) { lightning(); zapIdx++; }
      while (nextSucked < targets.length && tt >= 2.0 + nextSucked * 0.14) {
        suck(targets[nextSucked]); nextSucked++;
      }

      const fadeIn = Math.min(1, tt / 1.5);
      const fadeOut = tt > total - 1 ? Math.max(0, total - tt) : 1;
      const intensity = fadeIn * fadeOut;

      // rain
      ctx.strokeStyle = "rgba(175,205,255,0.45)";
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = intensity;
      ctx.beginPath();
      for (const d of rain) {
        d.y += d.s; d.x -= d.s * 0.3;
        if (d.y > H) { d.y = -12; d.x = Math.random() * W; }
        if (d.x < 0) d.x += W;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.l * 0.3, d.y + d.l);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // debris caught in the funnel
      const tc = tor.getBoundingClientRect();
      const fx = tc.left + tc.width / 2, fy = tc.top + tc.height * 0.5;
      if (tt > 0.8 && tt < total - 0.8 && Math.random() < 0.85) {
        debris.push({
          ang: Math.random() * Math.PI * 2, rad: 18 + Math.random() * 70,
          av: 3 + Math.random() * 3, ry: -(Math.random() * H * 0.4),
          size: 2 + Math.random() * 4, life: 1,
          c: debrisColors[(Math.random() * debrisColors.length) | 0],
        });
      }
      for (let i = debris.length - 1; i >= 0; i--) {
        const p = debris[i];
        p.ang += p.av * dt; p.rad += 12 * dt; p.ry += 70 * dt; p.life -= 0.012;
        if (p.life <= 0) { debris.splice(i, 1); continue; }
        const x = fx + Math.cos(p.ang) * p.rad;
        const y = fy + p.ry + Math.sin(p.ang) * p.rad * 0.3;
        ctx.globalAlpha = Math.max(0, p.life) * intensity;
        ctx.fillStyle = p.c;
        ctx.fillRect(x, y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }).then(() => {
      // drop the panels back where they came from
      saved.forEach(({ el, transform, opacity }) => {
        el.style.transition = "transform 0.9s cubic-bezier(.16,1,.3,1), opacity 0.7s ease";
        el.style.transform = transform || "";
        el.style.opacity = opacity || "";
      });
      setTimeout(() => saved.forEach(({ el, transition }) => { el.style.transition = transition || ""; }), 1000);
      sky.classList.remove("on");
      setTimeout(() => { sky.remove(); flash.remove(); tor.remove(); }, 1000);
    });
  }

  // -------------------------------------------------------------- EARTHQUAKE
  function quake() {
    caption("💥  EARTHQUAKE!");

    const tint = document.createElement("div"); tint.className = "ev-quake-tint";
    layer.appendChild(tint);
    requestAnimationFrame(() => tint.classList.add("on"));
    document.body.classList.add("ev-quake");

    const targets = uiTargets();
    targets.forEach((el) => el.classList.add("ev-rattle"));

    // fractures that crawl across the screen, with branches
    const cracks = [];
    function makeCrack(x, y, ang, len, depth) {
      const pts = [{ x, y }];
      let cxp = x, cyp = y, a = ang;
      const segs = 6 + ((Math.random() * 5) | 0);
      for (let i = 0; i < segs; i++) {
        a += (Math.random() - 0.5) * 0.8;
        const step = len / segs;
        cxp += Math.cos(a) * step; cyp += Math.sin(a) * step;
        pts.push({ x: cxp, y: cyp });
      }
      cracks.push({ pts, prog: 0, speed: 0.4 + Math.random() * 0.5, w: 1 + Math.random() * 2.2 });
      if (depth > 0 && Math.random() < 0.7) {
        const bi = 2 + ((Math.random() * (pts.length - 3)) | 0);
        makeCrack(pts[bi].x, pts[bi].y, a + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random()), len * 0.6, depth - 1);
      }
    }

    const dust = [];
    let made = false;

    return animate(6200, (tt, dt, total) => {
      if (!made && tt > 0.12) {
        made = true;
        for (let k = 0; k < 3; k++) {
          makeCrack(Math.random() * W, Math.random() * H, Math.random() * Math.PI * 2, 240 + Math.random() * 220, 2);
        }
      }
      const fade = tt > total - 1.2 ? Math.max(0, (total - tt) / 1.2) : 1;

      // grow + draw cracks (dark fissure with a faint lit edge)
      ctx.lineCap = "round";
      for (const c of cracks) {
        c.prog = Math.min(1, c.prog + c.speed * dt);
        const upto = Math.floor(c.prog * (c.pts.length - 1));
        ctx.strokeStyle = `rgba(8,8,12,${0.85 * fade})`;
        ctx.lineWidth = c.w + 1.5;
        ctx.beginPath(); ctx.moveTo(c.pts[0].x, c.pts[0].y);
        for (let i = 1; i <= upto; i++) ctx.lineTo(c.pts[i].x, c.pts[i].y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(130,155,185,${0.5 * fade})`;
        ctx.lineWidth = Math.max(0.5, c.w - 0.6);
        ctx.beginPath(); ctx.moveTo(c.pts[0].x, c.pts[0].y);
        for (let i = 1; i <= upto; i++) ctx.lineTo(c.pts[i].x, c.pts[i].y);
        ctx.stroke();
      }

      // dust shaken loose from the top
      if (tt < total - 1 && Math.random() < 0.9) {
        dust.push({ x: Math.random() * W, y: -5, vy: 40 + Math.random() * 130, size: 1 + Math.random() * 2.5, life: 1 });
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const p = dust[i];
        p.y += p.vy * dt; p.x += Math.sin(p.y * 0.05) * 0.6; p.life -= 0.01;
        if (p.y > H || p.life <= 0) { dust.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life) * 0.5 * fade;
        ctx.fillStyle = "#b9b2a4";
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }).then(() => {
      document.body.classList.remove("ev-quake");
      targets.forEach((el) => el.classList.remove("ev-rattle"));
      tint.classList.remove("on");
      setTimeout(() => tint.remove(), 600);
    });
  }

  // ----------------------------------------------------------------- wiring
  const RUN = { train, storm, quake };

  function trigger(name) {
    if (busy || reduce) return false;
    const fn = RUN[name];
    if (!fn) return false;
    setBusy(true);
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error("event error", err))
      .finally(() => setBusy(false));
    return true;
  }

  triggers.forEach((b) => b.addEventListener("click", () => trigger(b.dataset.event)));

  // Exposed so a future scheduler can fire these at random intervals.
  window.DailyEvents = { trigger, list: Object.keys(RUN), get busy() { return busy; } };
})();
