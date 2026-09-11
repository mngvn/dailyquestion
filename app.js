// app.js — Daily. Deterministic daily content, the rotatable section cube,
// modal sections, and streak tracking via localStorage.

(function () {
  "use strict";

  const STORE_KEY = "daily.stats.v1";
  const now = new Date();

  // ----- Date helpers -----
  // Local-day key (YYYY-MM-DD) so "today" matches the user's calendar.
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const mmdd = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // A stable integer that increments once per local day, used to pick content.
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayNumber = Math.floor(localMidnight.getTime() / 86400000);

  // Independent index per category so they don't all rotate in lockstep.
  const pick = (arr, salt) => arr[(((dayNumber * 2654435761 + salt) >>> 0)) % arr.length];

  // ----- Header date (animated, character by character) -----
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ord = (d) => {
    const t = d % 100;
    if (t >= 11 && t <= 13) return d + "th";
    return d + ({ 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th");
  };

  document.getElementById("weekday").textContent = weekdays[now.getDay()];

  // Each character gets its own pair of spans: the outer one floats forever on
  // a staggered wave, the inner one handles the entrance flip + the shimmer
  // that sweeps across the line. Screen readers get the plain string instead.
  const dateStr = `${months[now.getMonth()]} ${ord(now.getDate())}, ${now.getFullYear()}`;
  const dateMain = document.getElementById("dateMain");
  dateMain.textContent = "";
  dateMain.setAttribute("aria-label", dateStr);
  [...dateStr].forEach((ch, i) => {
    const outer = document.createElement("span");
    outer.className = "dchar";
    outer.style.setProperty("--ci", i);
    outer.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span");
    inner.className = "dchar-in";
    inner.textContent = ch === " " ? " " : ch;
    outer.appendChild(inner);
    dateMain.appendChild(outer);
  });

  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((localMidnight - startOfYear) / 86400000);
  document.getElementById("dayCounter").textContent = `Day ${dayOfYear} of ${now.getFullYear()}`;

  // ----- Today's content (computed once) -----
  const todaysGame = (typeof Puzzles !== "undefined") ? Puzzles.todaysGame() : null;

  // Four facts a day, one per category, each dealt off its own deck so a fact
  // is only seen again once its whole category has been used (see deck.js).
  const FACT_CATS = ["Tech", "Art", "History", "Misc"];
  const facts = FACT_CATS
    .map((cat, i) => Deck.deal(FUN_FACTS.filter((f) => f.cat === cat), 11 + i, dayNumber))
    .filter(Boolean);
  // Most of the modern pieces are still in copyright, so no photograph of them
  // can be shown and the card falls back to a generated study. Weight the daily
  // pick toward works we can actually display: six days in seven come from the
  // public-domain set, the seventh from everything else so the in-copyright
  // pieces still come round with their blurb and a link out.
  const artPhoto = ARTWORKS.filter((a) => a.pd && a.wiki);
  const artOther = ARTWORKS.filter((a) => !(a.pd && a.wiki));
  const artwork = (dayNumber % 7 === 3 && artOther.length)
    ? pick(artOther, 41)
    : pick(artPhoto.length ? artPhoto : ARTWORKS, 41);
  // Every date of the year has an entry, so there is no fallback pool to fall
  // through to — that fallback was picked by hashing the day number, which is
  // what used to repeat entries within a week or two.
  const hist = HISTORY_BY_DATE[mmdd] || null;
  const histDate = `${months[now.getMonth()]} ${ord(now.getDate())}`;

  // Trivia is a three-question run built by trivia.js; the day's questions and
  // their order are decided there so they stay identical across reloads.
  const TRIVIA_ROUNDS = (typeof Trivia !== "undefined") ? Trivia.ROUNDS : 3;

  // ----- Stats store -----
  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === "object") return s;
    } catch (e) { /* ignore */ }
    return {
      lastPlayed: null,    // dayKey of the most recent day played
      streak: 0,
      bestStreak: 0,
      daysPlayed: 0,
      triviaAnswered: 0,      // trivia questions answered, all time
      triviaCorrect: 0,
      triviaBest: 0,          // best score for a single day's run
      run: null,              // today's trivia run, shape set just below
      puzzleAnswered: 0,      // daily puzzles finished (win or lose)
      puzzleCorrect: 0,       // daily puzzles solved
      puzzleKey: null         // dayKey of the last recorded puzzle result
    };
  }
  function saveStats(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  const stats = loadStats();
  // Older saves predate puzzle and trivia-run tracking.
  stats.puzzleAnswered = stats.puzzleAnswered || 0;
  stats.puzzleCorrect = stats.puzzleCorrect || 0;
  stats.triviaBest = stats.triviaBest || 0;

  // Today's run: which question we're on, what it has scored, whether the
  // 50:50 has been spent, and the per-question results. Reset at midnight —
  // trivia.js reads and mutates this object directly.
  if (!stats.run || stats.run.key !== dayKey || !Array.isArray(stats.run.results)) {
    stats.run = { key: dayKey, i: 0, score: 0, fifty: false, results: [] };
  }
  const runDone = () => stats.run.i >= TRIVIA_ROUNDS;

  // Register a "play" for today (first interaction of the day updates the streak).
  function registerPlay() {
    if (stats.lastPlayed === dayKey) return; // already counted today

    const yesterday = dayNumber - 1;
    const lastNum = stats.lastPlayed
      ? Math.floor(new Date(stats.lastPlayed + "T00:00:00").getTime() / 86400000)
      : null;

    if (lastNum === yesterday) stats.streak += 1;
    else stats.streak = 1;

    stats.lastPlayed = dayKey;
    stats.daysPlayed += 1;
    if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
    saveStats(stats);
    renderStreak(true);
    renderFooter();
  }

  // ----- Renderers -----
  const streakNumEl = document.getElementById("streakNum");
  const flameEl = document.getElementById("flame");

  function renderStreak(animate) {
    streakNumEl.textContent = stats.streak;
    flameEl.classList.toggle("lit", stats.streak > 0);
    if (animate) {
      streakNumEl.classList.remove("flash");
      void streakNumEl.offsetWidth; // reflow to restart animation
      streakNumEl.classList.add("flash");
    }
  }

  function accuracyPct() {
    return stats.triviaAnswered
      ? Math.round((stats.triviaCorrect / stats.triviaAnswered) * 100)
      : null;
  }

  function puzzleAccuracy() {
    return stats.puzzleAnswered ? stats.puzzleCorrect / stats.puzzleAnswered : 0;
  }

  function renderFooter() {
    document.getElementById("statPlayed").textContent = stats.daysPlayed;
    document.getElementById("statBest").textContent = stats.bestStreak;
    document.getElementById("statCorrect").textContent = stats.triviaCorrect;
    const a = accuracyPct();
    document.getElementById("statAccuracy").textContent = a === null ? "—" : a + "%";
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  // ----- The cube: every section is one face -----
  // Six sections, six faces. The cube spins under the pointer (and the arrow
  // keys), and a click on a face opens that section. The puzzle, trivia and
  // Where? faces also carry a meter that fills with how you've been doing.
  // The four "equator" faces are the ones a plain sideways spin reaches, so
  // the interactive sections live there.
  const FACES = [
    { id: "puzzle",  face: "front",  c1: "#7c5cff", c2: "#b06bff", icon: "🧩", name: "Puzzle" },
    { id: "trivia",  face: "right",  c1: "#ff5c9c", c2: "#ff8a5c", icon: "🎯", name: "Trivia" },
    { id: "locate",  face: "back",   c1: "#5eead4", c2: "#0d9488", icon: "🌍", name: "Where?" },
    { id: "fact",    face: "left",   c1: "#ffd86b", c2: "#ff9a3c", icon: "💡", name: "Fun Fact" },
    { id: "artwork", face: "top",    c1: "#47e0a0", c2: "#0fb5a5", icon: "🎨", name: "Artwork" },
    { id: "history", face: "bottom", c1: "#4aa8ff", c2: "#1f5fe0", icon: "📜", name: "On This Day" }
  ];

  const LOCATE_TARGET = 1500;  // score at which the Where? meter fills completely
                               // (roughly round 10 of the endless run)

  // Cube rotations that bring a given face to the viewer. The cube transform is
  // rotateX(rx) rotateY(ry), so for the top and bottom faces ry only rolls the
  // face — it doesn't change which one is facing front.
  const FACE_HOME = {
    front:  { rx: 0,   ry: 0 },
    right:  { rx: 0,   ry: -90 },
    back:   { rx: 0,   ry: 180 },
    left:   { rx: 0,   ry: 90 },
    top:    { rx: -90, ry: 0 },
    bottom: { rx: 90,  ry: 0 }
  };

  // Faces with a meter: id -> { fill, acc }.
  const faceMeters = {};
  let triviaSubEl = null;    // per-day state line on the trivia face

  function hexRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function span(cls, text) {
    const el = document.createElement("span");
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function buildCube() {
    const cube = document.getElementById("cube");
    if (!cube) return;
    cube.innerHTML = "";

    FACES.forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cube-face";
      btn.dataset.section = f.id;
      btn.dataset.face = f.face;
      btn.setAttribute("aria-haspopup", "dialog");
      btn.style.setProperty("--c1", f.c1);
      btn.style.setProperty("--c2", f.c2);
      btn.style.setProperty("--edge", hexRgba(f.c1, 0.6));

      const icon = span("face-icon", f.icon);
      icon.setAttribute("aria-hidden", "true");
      const sub = span("face-sub");
      btn.append(icon, span("face-name", f.name), sub);

      if (f.id === "puzzle") {
        sub.textContent = todaysGame ? `Today: ${todaysGame.name} ${todaysGame.icon}` : "One draw a day";
      } else if (f.id === "trivia") {
        triviaSubEl = sub;
      } else if (f.id === "fact") {
        sub.textContent = `${facts.length} facts, ${facts.length} categories`;
      } else if (f.id === "artwork") {
        sub.textContent = artwork.artist;
      } else if (f.id === "history") {
        // Just the year — the full date is in the header and in the section.
        sub.textContent = hist ? String(hist.year) : "—";
      } else if (f.id === "locate") {
        sub.textContent = "Guess the city";
      }

      if (f.id === "puzzle" || f.id === "trivia" || f.id === "locate") {
        const meter = span("face-meter");
        const fill = span("face-meter-fill");
        meter.append(fill);
        const acc = span("face-acc");
        btn.append(meter, acc);
        faceMeters[f.id] = { fill, acc };
      }

      cube.append(btn);
    });

    const plate = document.getElementById("plateSub");
    if (plate) plate.textContent = `Day ${dayOfYear}`;
  }

  // A face's meter fills left to right in proportion to how you're doing.
  function renderFill(id, pct, caption) {
    const m = faceMeters[id];
    if (!m) return;
    m.fill.style.width = (Math.max(0, Math.min(1, pct)) * 100).toFixed(1) + "%";
    m.acc.textContent = caption;
  }

  function renderFills() {
    const pPct = puzzleAccuracy();
    renderFill("puzzle", pPct, stats.puzzleAnswered
      ? `${Math.round(pPct * 100)}% solved (${stats.puzzleCorrect}/${stats.puzzleAnswered})`
      : "No puzzles yet");

    const tPct = stats.triviaAnswered ? stats.triviaCorrect / stats.triviaAnswered : 0;
    renderFill("trivia", tPct, stats.triviaAnswered
      ? `${Math.round(tPct * 100)}% correct (${stats.triviaCorrect}/${stats.triviaAnswered})`
      : "No answers yet");

    // Where? has no accuracy either, so its meter tracks the best score,
    // topping out at LOCATE_TARGET.
    const lBest = (typeof Locate !== "undefined") ? Locate.bestScore() : 0;
    renderFill("locate", lBest / LOCATE_TARGET,
      lBest ? `Best: ${lBest} pts` : "No score yet");
  }

  // Face state that changes within the day (how far into today's run you are).
  function refreshFaces() {
    if (!triviaSubEl) return;
    const r = stats.run;
    triviaSubEl.textContent = runDone()
      ? `✓ ${r.score} pts today`
      : r.i > 0
        ? `Round ${r.i + 1} of ${TRIVIA_ROUNDS}`
        : `${TRIVIA_ROUNDS} questions · new today`;
  }

  // ----- Spinning the cube -----
  // Drag anywhere on the cube to turn it; let go and it keeps its momentum.
  // Left alone it turns slowly on its own — that idle tumble is what tells you
  // the thing can be grabbed — and it holds still while you're pointing at it
  // so a face is easy to hit. The roll button throws it like a die.
  function initCube() {
    const scene = document.getElementById("cubeScene");
    const cube = document.getElementById("cube");
    if (!scene || !cube) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const AMBIENT = reduce ? 0 : 0.13;  // idle drift, degrees per frame (~45s a turn)
    const SWAY_RATE = 0.012;            // radians per frame of the idle tilt
    const SWAY_AMP = 7 * SWAY_RATE;     // which works out as a ±7° nod
    const FRICTION = 0.93;              // momentum decay after a throw
    const EASE = 0.16;                  // how fast a turn-to-face settles
    const HOLD = 90;                    // frames of stillness after you let go
    const SLOP = 8;                     // px of movement that counts as a drag
    const SPEED = 0.42;                 // degrees of turn per px dragged
    const MAX_TILT = 90;                // straight up / straight down
    const ROLL_MS = 1500;               // how long a throw of the die takes

    let rx = FACE_HOME.front.rx - 34;   // the intro spin starts off-axis and
    let ry = FACE_HOME.front.ry - 320;  // settles onto the front face
    let vx = 0, vy = 0;                 // momentum, degrees per frame
    let goal = null;                    // { rx, ry } while turning to a face
    let roll = null;                    // the throw in flight, if there is one
    let hop = 0;                        // px the cube is off the ground mid-roll
    let hopMax = 1, lifted = false;     // peak of that arc, measured per throw
    let sway = 0;                       // phase of the idle nod
    let hold = 0;                       // frames left before the drift resumes
    let hovering = false, dragging = false;
    let dragId = null, lastX = 0, lastY = 0, moved = 0, dragged = false;

    const rollBtn = document.getElementById("rollBtn");
    const rollStatus = document.getElementById("rollStatus");

    const clampTilt = (v) => Math.max(-MAX_TILT, Math.min(MAX_TILT, v));
    // the version of `to` that's the shortest way round from `cur`
    const near = (cur, to) => to + 360 * Math.round((cur - to) / 360);
    const apply = () => {
      cube.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (!hop && !lifted) return;   // the hop only moves during a roll
      // `translate` is its own property, so the hop composes with the rotation
      // instead of fighting the transform the spin is written to.
      cube.style.translate = hop ? `0 ${hop.toFixed(1)}px` : "";
      // the shadow tightens and fades as the cube goes up, the way a thrown
      // die's does, and firms back up as it lands
      scene.style.setProperty("--lift", hopMax ? (Math.abs(hop) / hopMax).toFixed(3) : "0");
      lifted = hop !== 0;
    };

    // Which face ends up facing the viewer at a quarter-turned orientation.
    function faceAt(qrx, qry) {
      const t = ((qrx % 360) + 360) % 360;
      if (t === 270) return "top";        // tilted a quarter turn back
      if (t === 90) return "bottom";
      const y = ((qry % 360) + 360) % 360;
      return { 0: "front", 90: "left", 180: "back", 270: "right" }[y] || null;
    }

    // ----- Rolling it like a die -----
    // Pick a face up front, then tumble the cube through a few whole turns on
    // the way to that face's resting orientation, so where it lands is a real
    // landing rather than a cut. Whatever comes up on top is what opens.
    function startRoll() {
      if (roll) return;
      const pick = FACES[Math.floor(Math.random() * FACES.length)];
      const home = FACE_HOME[pick.face];
      const dir = Math.random() < 0.5 ? 1 : -1;
      const now = performance.now();

      roll = {
        t0: now,
        dur: reduce ? 1 : ROLL_MS,
        fx: rx, fy: ry,
        // whole extra turns on both axes, landing square on the chosen face
        tx: near(rx, home.rx) - (1 + Math.floor(Math.random() * 2)) * 360,
        ty: near(ry, home.ry) + dir * (2 + Math.floor(Math.random() * 2)) * 360,
        face: pick.face,
        id: pick.id,
        name: pick.name
      };
      hopMax = reduce ? 0 : scene.getBoundingClientRect().width * 0.2;
      goal = null;
      vx = vy = 0;
      scene.classList.add("rolling");
      if (rollBtn) rollBtn.disabled = true;
      if (rollStatus) rollStatus.textContent = "Rolling…";
    }

    function landRoll() {
      const r = roll;
      roll = null;
      hop = 0;
      // the tumble left whole turns piled up on both axes — fold them away, so
      // the tilt clamp and the arrow keys carry on from sensible numbers
      rx = FACE_HOME[r.face].rx;
      ry = ((ry % 360) + 360) % 360;
      apply();
      scene.classList.remove("rolling");
      if (rollBtn) {
        rollBtn.disabled = false;
        // disabling the button dropped focus to the page; take it back before
        // the section opens, so closing the section returns you to the button
        if (document.activeElement === document.body) rollBtn.focus();
      }
      if (rollStatus) rollStatus.textContent = `Landed on ${r.name}.`;
      hold = HOLD;
      const face = cube.querySelector(`.cube-face[data-face="${r.face}"]`);
      if (face) face.classList.add("landed");
      // a beat to watch it settle before the section covers it up
      setTimeout(() => {
        if (face) face.classList.remove("landed");
        openModal(r.id);
      }, reduce ? 0 : 240);
    }

    if (rollBtn) rollBtn.addEventListener("click", startRoll);

    function turnTo(face) {
      const home = FACE_HOME[face];
      if (!home) return;
      goal = {
        rx: home.rx,
        // top and bottom face the viewer at any ry, so keep the roll we have
        // (tidied to a right angle) rather than swinging it back to zero.
        ry: (face === "top" || face === "bottom")
          ? Math.round(ry / 90) * 90
          : near(ry, home.ry)
      };
      vx = vy = 0;
      hold = HOLD;
    }

    if (reduce) { rx = FACE_HOME.front.rx; ry = FACE_HOME.front.ry; }
    else goal = { rx: -16, ry: -20 };
    apply();

    (function frame(now) {
      requestAnimationFrame(frame);
      if (dragging) return;             // pointermove drives it directly

      if (roll) {
        const p = Math.min(1, (now - roll.t0) / roll.dur);
        const e = 1 - Math.pow(1 - p, 4);   // fast out of the hand, slow to settle
        rx = roll.fx + (roll.tx - roll.fx) * e;
        ry = roll.fy + (roll.ty - roll.fy) * e;
        // a couple of decaying bounces, flat again exactly as it stops turning
        hop = -hopMax * Math.abs(Math.sin(Math.PI * p * 2.6)) * Math.pow(1 - p, 1.6);
        apply();
        if (p >= 1) landRoll();
        return;
      }

      if (goal) {
        rx += (goal.rx - rx) * EASE;
        ry += (goal.ry - ry) * EASE;
        if (Math.abs(goal.rx - rx) < 0.05 && Math.abs(goal.ry - ry) < 0.05) {
          rx = goal.rx; ry = goal.ry; goal = null;
        }
      } else if (vx || vy) {
        rx = clampTilt(rx + vx);
        ry += vy;
        vx *= FRICTION; vy *= FRICTION;
        if (Math.abs(vx) < 0.015) vx = 0;
        if (Math.abs(vy) < 0.015) vy = 0;
      } else if (hold > 0) {
        hold--;
        return;                          // nothing moved — nothing to redraw
      } else if (!hovering && AMBIENT) {
        // the resting state: a slow turn with a gentle nod, so the cube reads
        // as something you can take hold of rather than a picture of a box
        ry += AMBIENT;
        sway += SWAY_RATE;
        rx = clampTilt(rx + Math.cos(sway) * SWAY_AMP);
      } else {
        return;
      }
      apply();
    })(performance.now());

    function onMove(e) {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > SLOP) dragged = true;
      ry += dx * SPEED;
      rx = clampTilt(rx - dy * SPEED);
      // the last flick of the pointer is what the cube keeps spinning on
      if (!reduce) { vy = dx * SPEED; vx = -dy * SPEED; }
      apply();
    }

    function onUp(e) {
      if (e.pointerId !== dragId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragging = false;
      dragId = null;
      hold = HOLD;
      scene.classList.remove("dragging");
      if (e.type !== "pointerup") { vx = vy = 0; dragged = false; }
    }

    scene.addEventListener("pointerdown", (e) => {
      if (e.button || roll) return;      // primary button / touch only
      dragging = true;
      dragged = false;
      dragId = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      moved = 0;
      goal = null;
      vx = vy = 0;
      scene.classList.add("dragging");
      // No pointer capture: it would retarget the click away from the face.
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    scene.addEventListener("pointerenter", () => { hovering = true; });
    scene.addEventListener("pointerleave", () => { hovering = false; });

    // Arrow keys quarter-turn the cube, matching which way a drag would take
    // it: up moves the front face up, bringing the bottom one round. Focus
    // follows the turn, so Enter always opens the face you're looking at.
    scene.addEventListener("keydown", (e) => {
      if (roll) return;
      const rxQ = Math.round(rx / 90) * 90;
      const ryQ = Math.round(ry / 90) * 90;
      let next;
      if (e.key === "ArrowLeft")       next = { rx: rxQ, ry: ryQ + 90 };
      else if (e.key === "ArrowRight") next = { rx: rxQ, ry: ryQ - 90 };
      else if (e.key === "ArrowUp")    next = { rx: clampTilt(rxQ + 90), ry: ryQ };
      else if (e.key === "ArrowDown")  next = { rx: clampTilt(rxQ - 90), ry: ryQ };
      else return;
      e.preventDefault();
      goal = next;
      vx = vy = 0;
      hold = HOLD;
      const front = cube.querySelector(`.cube-face[data-face="${faceAt(next.rx, next.ry)}"]`);
      if (front) front.focus();
    });

    cube.querySelectorAll(".cube-face[data-section]").forEach((btn) => {
      const id = btn.dataset.section;
      btn.addEventListener("click", () => {
        if (dragged) { dragged = false; return; }  // that was a spin, not a tap
        openModal(id);
      });
      // Tabbing to a face turns it to the front — a face pointing away is
      // hidden, so focus has to bring it into view.
      btn.addEventListener("focus", () => {
        if (roll) return;
        let keyed = true;
        try { keyed = btn.matches(":focus-visible"); } catch (_) { /* older browser */ }
        if (keyed) turnTo(btn.dataset.face);
      });
    });
  }

  // Puzzles report their daily result here (true = solved). Only the first
  // result of the day counts toward accuracy.
  window.DailyPuzzleResult = function (won) {
    if (stats.puzzleKey === dayKey) return;
    stats.puzzleKey = dayKey;
    stats.puzzleAnswered += 1;
    if (won) stats.puzzleCorrect += 1;
    saveStats(stats);
    registerPlay();
    renderFills();
  };

  // ----- Confetti -----
  function burstConfetti() {
    const layer = document.getElementById("confetti");
    const colors = ["#7c5cff", "#00e0c6", "#ff5c9c", "#ffd86b", "#2fe089"];
    const count = 90;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2 + Math.random() * 1.8 + "s";
      p.style.animationDelay = Math.random() * 0.3 + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      if (Math.random() > 0.5) p.style.borderRadius = "50%";
      layer.appendChild(p);
      setTimeout(() => p.remove(), 4200);
    }
  }

  // ----- Section content builders (rendered into the modal body) -----
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  // navigator.clipboard is undefined on insecure origins (and when the page is
  // opened straight off disk), so keep the old execCommand path as a fallback.
  function legacyCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  // A copy button for any block of text. `getText` is called at click time so
  // sections can copy content that isn't known when the button is built.
  function copyBtn(getText, label) {
    const idle = label || "Copy";
    const btn = el("button", "ghost-btn copy-btn", idle);
    btn.type = "button";
    const flash = (msg) => {
      btn.textContent = msg;
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = idle; btn.classList.remove("copied"); }, 1500);
    };
    btn.addEventListener("click", () => {
      const text = getText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => flash("Copied!"))
          .catch(() => flash(legacyCopy(text) ? "Copied!" : "Copy failed"));
      } else {
        flash(legacyCopy(text) ? "Copied!" : "Copy failed");
      }
    });
    return btn;
  }

  // Four cards, one per category. The chips carry their own colour so the set
  // reads as four different things at a glance rather than one long list.
  function buildFact(body) {
    if (!facts.length) {
      body.append(el("p", "modal-text", "Today's facts failed to load."));
      return;
    }

    const list = el("div", "ff-list");
    facts.forEach((f, i) => {
      const card = el("article", "ff-card");
      card.dataset.cat = f.cat;
      card.style.setProperty("--i", i);

      // Each card copies its own fact — you usually want to pass on one of
      // them, not the whole set.
      const btn = copyBtn(() => f.text, "Copy");
      btn.classList.add("ff-copy");
      btn.setAttribute("aria-label", `Copy the ${f.cat} fact`);

      const head = el("div", "ff-head");
      head.append(el("span", "ff-chip", f.cat), btn);

      card.append(head, el("p", "ff-text", f.text));
      list.append(card);
    });
    body.append(list);

    // …and one for the whole set. Here the category labels are worth keeping,
    // since four facts pasted in a row need something to separate them.
    if (facts.length > 1) {
      const foot = el("div", "modal-foot");
      foot.append(copyBtn(
        () => facts.map((f) => `${f.cat}: ${f.text}`).join("\n\n"),
        `Copy all ${facts.length}`
      ));
      body.append(foot);
    }
  }

  function buildPuzzle(body) {
    const root = el("div", "pz-root");
    body.append(root);
    if (typeof Puzzles !== "undefined") Puzzles.mountHub(root);
    else body.append(el("p", "modal-text", "Puzzles failed to load."));
  }

  // The artwork card never shows the generated study as a placeholder — that
  // reads as "here is the painting" when it isn't. While the photograph is
  // being fetched the frame shows an empty canvas drawing itself, and the real
  // work is revealed into it. The study only ever appears as a final state,
  // when there is no photograph to show, and it says so.
  function buildArtworkLoader() {
    const loader = el("div", "aw-loader");
    loader.append(el("div", "aw-canvas"));

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "aw-loader-svg");
    svg.setAttribute("viewBox", "0 0 400 300");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", "awGold");
    grad.setAttribute("x1", "0%"); grad.setAttribute("y1", "0%");
    grad.setAttribute("x2", "100%"); grad.setAttribute("y2", "100%");
    [["0%", "#f5d489"], ["45%", "#c9a227"], ["100%", "#8a6a1a"]].forEach(([o, c]) => {
      const st = document.createElementNS(SVG_NS, "stop");
      st.setAttribute("offset", o); st.setAttribute("stop-color", c);
      grad.append(st);
    });
    defs.append(grad);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "aw-loader-rect");
    rect.setAttribute("x", "14"); rect.setAttribute("y", "14");
    rect.setAttribute("width", "372"); rect.setAttribute("height", "272");
    rect.setAttribute("rx", "3");
    svg.append(defs, rect);
    loader.append(svg);

    loader.append(el("div", "aw-sweep"));
    loader.append(el("span", "aw-loader-label", "Unveiling"));
    return loader;
  }

  function buildArtwork(body) {
    const a = artwork;

    const frame = el("div", "aw-frame");
    const tag = el("span", "aw-tag");
    const showTag = (text) => { tag.textContent = text; frame.append(tag); };

    const showStudy = (why) => {
      frame.classList.remove("is-loading");
      const loader = frame.querySelector(".aw-loader");
      if (loader) loader.remove();
      if (typeof Artwork !== "undefined") frame.prepend(Artwork.render(a));
      showTag(a.faithful ? "Reconstruction" : "Colour study");
      note.textContent = why;
    };

    const showPhoto = (src) => {
      const img = new Image();
      img.className = "aw-photo";
      img.alt = `${a.title} by ${a.artist}`;
      img.referrerPolicy = "no-referrer";
      img.addEventListener("load", () => {
        const loader = frame.querySelector(".aw-loader");
        if (loader) {
          loader.classList.add("done");
          setTimeout(() => loader.remove(), 500);
        }
        frame.classList.remove("is-loading");
        frame.classList.add("has-photo");
        frame.prepend(img);
        showTag("Wikimedia Commons");
        note.textContent = "Photograph of the original, via Wikimedia Commons.";
      });
      img.addEventListener("error", () => showStudy(LOOKUP_FAILED));
      img.src = src;
    };

    body.append(frame);

    const cap = el("div", "aw-caption");
    cap.append(el("h3", "aw-title", a.title));
    cap.append(el("p", "aw-artist", `${a.artist} · ${a.year}`));
    const meta = [a.medium, a.where].filter(Boolean).join(" · ");
    if (meta) cap.append(el("p", "aw-meta", meta));
    body.append(cap);

    body.append(el("p", "modal-text", a.blurb));

    const foot = el("div", "modal-foot aw-foot");
    foot.append(copyBtn(() =>
      `${a.title} — ${a.artist}, ${a.year}\n${meta}\n\n${a.blurb}`));
    const link = el("a", "ghost-btn", "See the real thing →");
    // Special:Search always resolves, so this can never land on a dead article.
    link.href = "https://en.wikipedia.org/wiki/Special:Search?search=" +
      encodeURIComponent(`${a.title} ${a.artist}`);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    foot.append(link);
    body.append(foot);

    const note = el("div", "modal-note", "");
    body.append(note);

    const NO_FREE_IMAGE = "No freely licensed photograph of this work exists — it is almost certainly still in copyright — so the image above is generated from its palette and composition. Use the link to see the original.";
    const LOOKUP_FAILED = "Couldn't reach Wikipedia just now, so the image above is generated from this work's palette and composition.";

    // Nothing to fetch: go straight to the study rather than flashing a loader.
    if (!a.wiki || typeof Artwork === "undefined") {
      showStudy(NO_FREE_IMAGE);
      return;
    }

    frame.classList.add("is-loading");
    frame.append(buildArtworkLoader());
    note.textContent = "Unveiling today's work…";

    Artwork.findImage(a).then((res) => {
      if (!res || !res.src) {
        showStudy(res && res.status === "error" ? LOOKUP_FAILED : NO_FREE_IMAGE);
        return;
      }
      showPhoto(res.src);
    }).catch(() => showStudy(LOOKUP_FAILED));
  }

  // Where in the World lives in locate.js. Returns its teardown so the key
  // handler goes away with the modal.
  function buildLocate(body) {
    if (typeof Locate === "undefined") {
      body.append(el("p", "modal-text", "The game failed to load."));
      return null;
    }
    const root = el("div", "pz-root loc-root");
    body.append(root);

    const teardown = Locate.mount(root, {
      onStart: registerPlay,
      onGameOver: () => { renderFills(); refreshFaces(); }
    });

    body.append(el("div", "modal-note",
      "Type the city name — accents, case and a single typo are forgiven, and common alternatives like Bombay or Peking are accepted. Populations are metro-area figures, rounded. Outlines are simplified from Natural Earth's public-domain data, so small islands and territories are left off."));
    return teardown;
  }

  // The date is stated in full above the entry — the section is about *this*
  // day, and the year alone never said which day that was.
  function buildHistory(body) {
    if (!hist) {
      body.append(el("p", "modal-text", `No entry for ${histDate} yet.`));
      return;
    }

    const line = el("div", "history-date");
    line.append(
      el("span", "history-on", "On "),
      el("span", "history-day", histDate + ", "),
      el("span", "history-year", String(hist.year))
    );
    body.append(line);
    body.append(el("p", "modal-text", hist.text));

    const foot = el("div", "modal-foot");
    foot.append(copyBtn(() => `On ${histDate}, ${hist.year} — ${hist.text}`));
    body.append(foot);
  }

  // The trivia run lives in trivia.js. It owns the questions, the clock and the
  // scoring; this only hands it today's state and folds the results back into
  // the lifetime stats. Returns the teardown so the clock stops with the modal.
  function buildTrivia(body) {
    if (typeof Trivia === "undefined") {
      body.append(el("p", "modal-text", "Trivia failed to load."));
      return null;
    }

    const a = accuracyPct();
    if (a !== null) {
      body.append(el("div", "tv-lifetime",
        `Lifetime ${stats.triviaCorrect}/${stats.triviaAnswered} · ${a}%` +
        (stats.triviaBest ? ` · best run ${stats.triviaBest} pts` : "")));
    }

    const root = el("div", "pz-root tv-root");
    body.append(root);

    return Trivia.mount(root, {
      bank: TRIVIA,
      dayNumber: dayNumber,
      state: stats.run,
      best: stats.triviaBest,
      save: () => saveStats(stats),
      onStart: registerPlay,
      onAnswer: (res) => {
        stats.triviaAnswered += 1;
        if (res.correct) stats.triviaCorrect += 1;
        saveStats(stats);
        renderFooter();
        renderFills();
        refreshFaces();
      },
      onBest: (score) => {
        stats.triviaBest = score;
        saveStats(stats);
      },
      onComplete: (res) => {
        refreshFaces();
        if (!res.replay && res.perfect) burstConfetti();
      }
    });
  }

  const SECTIONS = {
    fact: { icon: "💡", title: "Four Fun Facts", build: buildFact },
    puzzle: { icon: "🧩", title: "Daily Puzzle", build: buildPuzzle },
    artwork: { icon: "🎨", title: "Artwork of the Day", build: buildArtwork },
    history: { icon: "📜", title: "On This Day", build: buildHistory },
    locate: { icon: "🌍", title: "Where in the World?", build: buildLocate },
    trivia: { icon: "🎯", title: "Tech Trivia", build: buildTrivia }
  };

  // ----- Modal controller -----
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  const modalClose = document.getElementById("modalClose");
  const modalIcon = document.getElementById("modalIcon");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  let lastFocused = null;
  // Sections that keep something running (the trivia clock, its key handler)
  // return a teardown from build(); it runs before the body is replaced.
  let sectionTeardown = null;

  function teardownSection() {
    if (!sectionTeardown) return;
    const fn = sectionTeardown;
    sectionTeardown = null;
    fn();
  }

  function openModal(id) {
    const section = SECTIONS[id];
    if (!section) return;
    lastFocused = document.activeElement;

    modal.dataset.section = id;
    modalIcon.textContent = section.icon;
    modalTitle.textContent = section.title;
    teardownSection();
    modalBody.innerHTML = "";
    sectionTeardown = section.build(modalBody) || null;
    modalBody.scrollTop = 0;

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    // focus the close button after the open transition begins
    requestAnimationFrame(() => modalClose.focus());
  }

  function closeModal() {
    if (!overlay.classList.contains("open")) return;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    teardownSection();

    // Persist any results gathered while the modal was open, then sync the UI.
    saveStats(stats);
    refreshFaces();
    renderFills();
    renderFooter();

    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  modalClose.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(); // click on backdrop only
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ----- Init -----
  buildCube();
  renderFills();
  refreshFaces();
  initCube();   // wires the drag/keys and each face's click

  renderStreak(false);
  renderFooter();

  // Warm the artwork lookup once the page is idle. Nothing is displayed here —
  // it just means the reveal is instant when the face is actually opened.
  if (typeof Artwork !== "undefined" && artwork.wiki) {
    const warm = () => {
      Artwork.findImage(artwork).then((res) => {
        if (res && res.src) { const pre = new Image(); pre.src = res.src; }
      }).catch(() => { /* the card handles failure on open */ });
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 3000 });
    else setTimeout(warm, 1200);
  }

  // Visiting counts as playing — register on first load of the day.
  registerPlay();
})();
