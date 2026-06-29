// events.js — ambient "events" that take over the screen for a few seconds.
// Three are fleshed out, and each one reacts to whatever is on screen — most
// importantly, if a section modal is open it becomes the star of the event:
//   • train  — a locomotive roars through; if a modal is open the train plows
//              it off-screen and it slides back once the train has passed.
//   • storm  — sky darkens, rain + lightning, a tornado descends. With no
//              modal it sucks the page panels away; with a modal open it sucks
//              the modal up into the funnel and drops it back when it leaves.
//   • quake  — the screen shakes and fractures. An open modal cracks apart,
//              rattles, sheds dust, then settles.
//
// Triggered manually from the floating buttons by the theme toggle.
// window.DailyEvents.trigger(name) is exposed for a future random scheduler.
// Disabled entirely under prefers-reduced-motion.

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

  // ------------------------------------------------------------- small helpers
  function isLight() { return document.body.classList.contains("light"); }

  // The open modal panel, or null. When present, events focus on it.
  function openModal() {
    if (!document.body.classList.contains("modal-open")) return null;
    return document.getElementById("modal");
  }

  // The page panels an event manipulates when no modal is open.
  function pagePanels() {
    return [...document.querySelectorAll(".topbar, .grid > .card, .vault, .footer")];
  }

  // Snapshot / restore inline styles so we can put things back exactly.
  function snap(el) {
    return { el, t: el.style.transform, tr: el.style.transition, o: el.style.opacity, z: el.style.zIndex };
  }
  function unsnap(s, transition) {
    s.el.style.transition = transition || "";
    s.el.style.transform = s.t || "";
    s.el.style.opacity = s.o || "";
    s.el.style.zIndex = s.z || "";
  }
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, r };
  }

  function caption(text) {
    const el = document.createElement("div");
    el.className = "ev-caption";
    el.textContent = text;
    layer.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => el.remove(), 2700);
  }

  // Drive a canvas timeline for `durationMs`. `frame(t, dt, total)` runs each
  // rAF with seconds elapsed, delta seconds, and total seconds.
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

  // A one-shot scheduler tied to the animation clock: `at(seconds, fn)` fires
  // `fn` once when the timeline first passes `seconds`.
  function timeline() {
    const marks = [];
    return {
      at(t, fn) { marks.push({ t, fn, done: false }); return this; },
      tick(tt) { for (const m of marks) if (!m.done && tt >= m.t) { m.done = true; m.fn(); } },
    };
  }

  // ============================================================ TRAIN
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

    // Modal choreography: tremble → get plowed off-screen → slide back.
    const modal = openModal();
    let modalSnap = null;
    const tl = timeline();
    if (modal) {
      modalSnap = snap(modal);
      modal.style.zIndex = "200"; // ride above the rolling stock
      tl.at(1.5, () => {
        modal.style.transition = "transform 0.5s ease";
        modal.style.transform = "translateX(10px) rotate(-1deg)";
      });
      tl.at(2.0, () => { // the train reaches center and slams it leftward
        modal.style.transition = "transform 0.85s cubic-bezier(.5,0,.85,.3), opacity 0.85s ease-in";
        modal.style.transform = "translateX(-130vw) rotate(-200deg) scale(0.65)";
        modal.style.opacity = "0.15";
      });
      tl.at(4.1, () => { // train gone — it rolls back in
        modal.style.transition = "transform 0.9s cubic-bezier(.16,1,.3,1), opacity 0.6s ease";
        modal.style.transform = "";
        modal.style.opacity = "";
      });
    }

    const smoke = [];
    const cx = W * 0.5, cy = H * 0.45;

    return animate(4900, (tt, dt, total) => {
      tl.tick(tt);

      // chimney puffs, tracking the train's real position
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
      // every puff gets swept into a slow vortex across the screen
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
      if (modalSnap) setTimeout(() => unsnap(modalSnap), 1000);
    });
  }

  // ============================================================ STORM/TORNADO
  function storm() {
    caption("⛈️  STORM INCOMING");

    const sky = document.createElement("div"); sky.className = "ev-sky";
    const flash = document.createElement("div"); flash.className = "ev-flash";
    const tor = document.createElement("div"); tor.className = "ev-tornado";
    tor.innerHTML = '<div class="swirl"></div>';
    layer.append(sky, flash, tor);
    requestAnimationFrame(() => sky.classList.add("on"));

    function lightning() {
      flash.style.setProperty("--fx", (15 + Math.random() * 70) + "%");
      flash.classList.remove("zap"); void flash.offsetWidth; flash.classList.add("zap");
    }

    const modal = openModal();
    const tl = timeline();
    tl.at(0.7, () => tor.classList.add("on"));
    [1.0, 2.4, 4.0, 5.6].forEach((t) => tl.at(t, lightning));

    let panelSnaps = [];
    let modalSnap = null;

    if (modal) {
      // The funnel devours the modal, then spits it back.
      modalSnap = snap(modal);
      modal.style.zIndex = "200";
      tl.at(1.4, () => {
        modal.style.transition = "transform 0.6s ease";
        modal.style.transform = "translateY(-6px) rotate(1deg)";
      });
      tl.at(2.6, () => { // suck up into the funnel
        const m = centerOf(modal);
        const f = centerOf(tor);
        const dx = f.x - m.x;
        modal.style.transition = "transform 1.25s cubic-bezier(.6,0,.9,.35), opacity 1.25s ease-in";
        modal.style.transform = `translate(${dx}px, -70vh) rotate(760deg) scale(0.04)`;
        modal.style.opacity = "0";
      });
      tl.at(6.6, () => { // tornado leaving — drop it back from above
        modal.style.transition = "none";
        modal.style.transform = "translateY(-80vh) rotate(0) scale(1)";
        modal.style.opacity = "1";
        void modal.offsetWidth; // commit before the bounce
        modal.style.transition = "transform 0.95s cubic-bezier(.18,1.2,.4,1)";
        modal.style.transform = "";
      });
    } else {
      // No modal: pull the whole page into the funnel, one panel at a time.
      const targets = pagePanels();
      panelSnaps = targets.map(snap);
      targets.forEach((el, i) => tl.at(2.0 + i * 0.14, () => {
        const m = centerOf(el);
        const f = centerOf(tor);
        const dx = f.x - m.x, dy = (f.y - m.y) - m.h * 0.18;
        el.style.transition = "transform 1.1s cubic-bezier(.6,0,.9,.4), opacity 1.1s ease-in";
        el.style.transform = `translate(${dx}px, ${dy}px) rotate(720deg) scale(0.04)`;
        el.style.opacity = "0";
      }));
      tl.at(6.8, () => targets.forEach((el, i) => {
        const s = panelSnaps[i];
        el.style.transition = "transform 0.9s cubic-bezier(.16,1,.3,1), opacity 0.7s ease";
        el.style.transform = s.t || "";
        el.style.opacity = s.o || "";
      }));
    }

    const rain = [];
    for (let i = 0; i < 280; i++) rain.push({ x: Math.random() * W, y: Math.random() * H, l: 12 + Math.random() * 16, s: 9 + Math.random() * 8 });
    const debris = [];
    const debrisColors = ["#7c6a55", "#9aa3b5", "#5a4636", "#c9b48f"];

    return animate(8200, (tt, dt, total) => {
      tl.tick(tt);
      const fadeIn = Math.min(1, tt / 1.5);
      const fadeOut = tt > total - 1 ? Math.max(0, total - tt) : 1;
      const intensity = fadeIn * fadeOut;

      // rain
      ctx.strokeStyle = "rgba(175,205,255,0.5)";
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
      const f = centerOf(tor);
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
        const x = f.x + Math.cos(p.ang) * p.rad;
        const y = f.y + p.ry + Math.sin(p.ang) * p.rad * 0.3;
        ctx.globalAlpha = Math.max(0, p.life) * intensity;
        ctx.fillStyle = p.c;
        ctx.fillRect(x, y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }).then(() => {
      sky.classList.remove("on");
      setTimeout(() => { sky.remove(); flash.remove(); tor.remove(); }, 1000);
      if (modalSnap) setTimeout(() => unsnap(modalSnap), 1100);
      if (panelSnaps.length) setTimeout(() => panelSnaps.forEach((s) => { s.el.style.transition = s.tr || ""; }), 1000);
    });
  }

  // ============================================================ EARTHQUAKE
  function quake() {
    caption("💥  EARTHQUAKE!");

    const tint = document.createElement("div"); tint.className = "ev-quake-tint";
    layer.appendChild(tint);
    requestAnimationFrame(() => tint.classList.add("on"));
    document.body.classList.add("ev-quake");

    const modal = openModal();
    // Rattle the right thing: an open modal, otherwise the page panels.
    const rattled = modal ? [modal] : pagePanels();
    rattled.forEach((el) => el.classList.add("ev-rattle"));
    if (modal) modal.classList.add("ev-rattle-hard");

    // Cracks: when a modal is open they fracture across it (and follow it as it
    // shakes); otherwise they tear across the whole screen.
    const cracks = [];
    let crackBase = null; // {x,y} where the modal sat when cracks were made

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
      cracks.push({ pts, prog: 0, speed: 0.5 + Math.random() * 0.6, w: 1 + Math.random() * 2.2 });
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
        if (modal) {
          const m = centerOf(modal);
          crackBase = { x: m.x, y: m.y };
          // a starburst of fractures emanating from the modal's middle
          const spokes = 5;
          for (let k = 0; k < spokes; k++) {
            makeCrack(m.x, m.y, (k / spokes) * Math.PI * 2 + Math.random(), m.w * 0.5 + Math.random() * 60, 2);
          }
        } else {
          for (let k = 0; k < 3; k++) {
            makeCrack(Math.random() * W, Math.random() * H, Math.random() * Math.PI * 2, 240 + Math.random() * 220, 2);
          }
        }
      }
      const fade = tt > total - 1.2 ? Math.max(0, (total - tt) / 1.2) : 1;

      // if the cracks belong to the modal, slide them with its rattle
      let ox = 0, oy = 0;
      if (modal && crackBase) {
        const m = centerOf(modal);
        ox = m.x - crackBase.x; oy = m.y - crackBase.y;
      }
      ctx.save();
      ctx.translate(ox, oy);
      ctx.lineCap = "round";
      for (const c of cracks) {
        c.prog = Math.min(1, c.prog + c.speed * dt);
        const upto = Math.floor(c.prog * (c.pts.length - 1));
        ctx.strokeStyle = `rgba(8,8,12,${0.85 * fade})`;
        ctx.lineWidth = c.w + 1.5;
        ctx.beginPath(); ctx.moveTo(c.pts[0].x, c.pts[0].y);
        for (let i = 1; i <= upto; i++) ctx.lineTo(c.pts[i].x, c.pts[i].y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(150,175,205,${0.55 * fade})`;
        ctx.lineWidth = Math.max(0.5, c.w - 0.6);
        ctx.beginPath(); ctx.moveTo(c.pts[0].x, c.pts[0].y);
        for (let i = 1; i <= upto; i++) ctx.lineTo(c.pts[i].x, c.pts[i].y);
        ctx.stroke();
      }
      ctx.restore();

      // dust — falls from the top of the screen, plus shed from a modal
      if (tt < total - 1 && Math.random() < 0.9) {
        dust.push({ x: Math.random() * W, y: -5, vy: 40 + Math.random() * 130, size: 1 + Math.random() * 2.5, life: 1 });
      }
      if (modal && tt < total - 1.5 && Math.random() < 0.7) {
        const m = centerOf(modal);
        dust.push({ x: m.x - m.w / 2 + Math.random() * m.w, y: m.y + m.h / 2 - 6, vy: 30 + Math.random() * 80, size: 1 + Math.random() * 2, life: 1 });
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
      rattled.forEach((el) => el.classList.remove("ev-rattle"));
      if (modal) modal.classList.remove("ev-rattle-hard");
      tint.classList.remove("on");
      setTimeout(() => tint.remove(), 600);
    });
  }

  // ----------------------------------------------------------------- wiring
  const RUN = { train, storm, quake };

  // Belt-and-braces cleanup so a throttled/interrupted run can't leave the
  // page in a stuck state.
  function resetArtifacts() {
    document.body.style.animation = "";
    document.body.classList.remove("ev-quake");
    document.querySelectorAll(".ev-rattle, .ev-rattle-hard")
      .forEach((el) => el.classList.remove("ev-rattle", "ev-rattle-hard"));
  }

  function trigger(name) {
    if (busy || reduce) return false;
    const fn = RUN[name];
    if (!fn) return false;
    setBusy(true);
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error("event error", err))
      .finally(() => { resetArtifacts(); setBusy(false); });
    return true;
  }

  triggers.forEach((b) => b.addEventListener("click", () => trigger(b.dataset.event)));

  // Exposed so a future scheduler can fire these at random intervals.
  window.DailyEvents = { trigger, list: Object.keys(RUN), get busy() { return busy; } };
})();
