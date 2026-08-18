// app.js — Daily. Deterministic daily content, the pie-chart section wheel,
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

  // ----- The pie: every section is a slice of one circle -----
  // Fractions are how much of the circle each section takes. The puzzle and
  // trivia slices additionally fill from the hub outward according to their
  // respective accuracy.
  const SLICES = [
    { id: "puzzle",  frac: 0.27, c1: "#7c5cff", c2: "#b06bff", icon: "🧩", name: "Puzzle" },
    { id: "trivia",  frac: 0.19, c1: "#ff5c9c", c2: "#ff8a5c", icon: "🎯", name: "Trivia" },
    { id: "duel",    frac: 0.14, c1: "#a3e635", c2: "#4d7c0f", icon: "⚖️", name: "App Duel" },
    { id: "fact",    frac: 0.13, c1: "#ffd86b", c2: "#ff9a3c", icon: "💡", name: "Fun Fact" },
    { id: "artwork", frac: 0.15, c1: "#47e0a0", c2: "#0fb5a5", icon: "🎨", name: "Artwork" },
    { id: "history", frac: 0.12, c1: "#4aa8ff", c2: "#1f5fe0", icon: "📜", name: "On This Day" }
  ];

  const DUEL_TARGET = 15;   // streak at which the duel slice fills completely

  const SVG_NS = "http://www.w3.org/2000/svg";
  const CX = 260, CY = 260, R = 244;
  const HUB_R = 74;              // central disc — slice fills grow out from it
  const PAD = 0.016;             // radians shaved off each slice edge (the gap)

  const polar = (a, r) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r];

  function wedgePath(a0, a1, r) {
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a1, r);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${CX} ${CY} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  }

  // Annular wedge (a slice with the hub cut out) used for the accuracy fill.
  function ringWedgePath(a0, a1, r0, r1) {
    const [ox0, oy0] = polar(a0, r1);
    const [ox1, oy1] = polar(a1, r1);
    const [ix0, iy0] = polar(a0, r0);
    const [ix1, iy1] = polar(a1, r0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${ox0} ${oy0} A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1} ` +
           `L ${ix1} ${iy1} A ${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0} Z`;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // Slices with an accuracy fill: id -> { el, accEl, a0, a1 }. The fill path
  // grows from the hub outward in proportion to that section's accuracy.
  const sliceFills = {};
  let triviaSubEl = null;    // per-day state line in the trivia slice

  function buildPie() {
    const svg = document.getElementById("pieSvg");
    if (!svg) return;
    svg.innerHTML = "";

    const defs = svgEl("defs", {});
    SLICES.forEach((s) => {
      const grad = svgEl("linearGradient", {
        id: "grad-" + s.id, x1: "0%", y1: "0%", x2: "100%", y2: "100%"
      });
      grad.append(
        svgEl("stop", { offset: "0%", "stop-color": s.c1 }),
        svgEl("stop", { offset: "100%", "stop-color": s.c2 })
      );
      defs.append(grad);
    });
    svg.append(defs);

    let angle = -Math.PI / 2; // start at 12 o'clock, sweep clockwise
    SLICES.forEach((s, idx) => {
      const a0 = angle + PAD;
      const a1 = angle + s.frac * Math.PI * 2 - PAD;
      angle += s.frac * Math.PI * 2;

      const mid = (a0 + a1) / 2;
      const g = svgEl("g", {
        class: "pie-slice",
        "data-section": s.id,
        role: "button",
        tabindex: "0",
        "aria-haspopup": "dialog",
        "aria-label": s.name
      });
      g.style.setProperty("--i", idx);
      // hover nudge: the slice slides outward along its own mid-angle
      g.style.setProperty("--ox", (Math.cos(mid) * 12).toFixed(1) + "px");
      g.style.setProperty("--oy", (Math.sin(mid) * 12).toFixed(1) + "px");

      g.append(svgEl("path", {
        class: "slice-bg",
        d: wedgePath(a0, a1, R),
        fill: `url(#grad-${s.id})`,
        stroke: s.c1
      }));

      if (s.id === "puzzle" || s.id === "trivia" || s.id === "duel") {
        const fill = svgEl("path", {
          class: "slice-fill",
          d: "",
          fill: `url(#grad-${s.id})`
        });
        g.append(fill);
        sliceFills[s.id] = { el: fill, accEl: null, a0, a1 };
      }

      // labels sit on the slice's mid-angle
      const [lx, ly] = polar(mid, R * 0.63);
      const label = svgEl("g", { class: "slice-label", transform: `translate(${lx} ${ly})` });
      const icon = svgEl("text", { class: "slice-icon", x: 0, y: -14, "text-anchor": "middle" });
      icon.textContent = s.icon;
      const name = svgEl("text", { class: "slice-name", x: 0, y: 16, "text-anchor": "middle" });
      name.textContent = s.name;
      const sub = svgEl("text", { class: "slice-sub", x: 0, y: 36, "text-anchor": "middle" });
      label.append(icon, name, sub);
      g.append(label);

      if (s.id === "puzzle") {
        sub.textContent = todaysGame ? `Today: ${todaysGame.name} ${todaysGame.icon}` : "One draw a day";
      } else if (s.id === "trivia") {
        triviaSubEl = sub;
      } else if (s.id === "fact") {
        // Kept short: the slice is narrow and SVG text doesn't wrap.
        sub.textContent = `${facts.length} facts, ${facts.length} categories`;
      } else if (s.id === "artwork") {
        sub.textContent = artwork.artist;
      } else if (s.id === "history") {
        // Just the year: the full date is in the header and inside the
        // section, and a long date string overflows this wedge.
        sub.textContent = hist ? String(hist.year) : "—";
      } else if (s.id === "duel") {
        sub.textContent = "Which has more users?";
      }

      if (sliceFills[s.id]) {
        const acc = svgEl("text", { class: "slice-sub slice-acc", x: 0, y: 54, "text-anchor": "middle" });
        label.append(acc);
        sliceFills[s.id].accEl = acc;
      }

      svg.append(g);
    });

    // central hub covering the point where all slices meet
    const hub = svgEl("g", { class: "pie-hub" });
    hub.append(svgEl("circle", { class: "hub-ring", cx: CX, cy: CY, r: HUB_R + 8 }));
    hub.append(svgEl("circle", { class: "hub-disc", cx: CX, cy: CY, r: HUB_R }));
    const hubTop = svgEl("text", { class: "hub-top", x: CX, y: CY - 6, "text-anchor": "middle" });
    hubTop.textContent = "DAILY";
    const hubSub = svgEl("text", { class: "hub-sub", x: CX, y: CY + 18, "text-anchor": "middle" });
    hubSub.textContent = `Day ${dayOfYear}`;
    hub.append(hubTop, hubSub);
    svg.append(hub);
  }

  // A slice's fill grows from the hub outward, proportionally to accuracy.
  function renderFill(id, pct, caption) {
    const f = sliceFills[id];
    if (!f) return;
    if (pct <= 0) {
      f.el.setAttribute("d", "");
    } else {
      const r1 = HUB_R + (R - HUB_R) * Math.min(1, pct);
      f.el.setAttribute("d", ringWedgePath(f.a0, f.a1, HUB_R, r1));
    }
    if (f.accEl) f.accEl.textContent = caption;
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

    // The duel has no accuracy, so the fill tracks the best streak instead,
    // topping out at DUEL_TARGET.
    const dBest = (typeof Duel !== "undefined") ? Duel.bestScore() : 0;
    renderFill("duel", dBest / DUEL_TARGET,
      dBest ? `Best streak: ${dBest}` : "No streak yet");
  }

  // Slice state that changes within the day (how far into today's run you are).
  function refreshSlices() {
    if (!triviaSubEl) return;
    const r = stats.run;
    triviaSubEl.textContent = runDone()
      ? `✓ ${r.score} pts today`
      : r.i > 0
        ? `Round ${r.i + 1} of ${TRIVIA_ROUNDS}`
        : `${TRIVIA_ROUNDS} questions · new today`;
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

  function buildDuel(body) {
    const root = el("div", "pz-root duel-root");
    body.append(root);
    if (typeof Duel === "undefined") {
      body.append(el("p", "modal-text", "The duel failed to load."));
      return;
    }
    Duel.mount(root, {
      onStart: registerPlay,
      onGameOver: () => { renderFills(); refreshSlices(); }
    });
    body.append(el("div", "modal-note",
      "Figures are the latest publicly reported numbers, and they don't all count the same thing — each card says which metric and which year it is. Discontinued apps are shown at their peak."));
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
        refreshSlices();
      },
      onBest: (score) => {
        stats.triviaBest = score;
        saveStats(stats);
      },
      onComplete: (res) => {
        refreshSlices();
        if (!res.replay && res.perfect) burstConfetti();
      }
    });
  }

  const SECTIONS = {
    fact: { icon: "💡", title: "Four Fun Facts", build: buildFact },
    puzzle: { icon: "🧩", title: "Daily Puzzle", build: buildPuzzle },
    artwork: { icon: "🎨", title: "Artwork of the Day", build: buildArtwork },
    history: { icon: "📜", title: "On This Day", build: buildHistory },
    duel: { icon: "⚖️", title: "App Duel", build: buildDuel },
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
    refreshSlices();
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
  buildPie();
  renderFills();
  refreshSlices();

  // Wire each slice to open its section.
  document.querySelectorAll(".pie-slice[data-section]").forEach((slice) => {
    const id = slice.getAttribute("data-section");
    slice.addEventListener("click", () => openModal(id));
    slice.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(id); }
    });
  });

  renderStreak(false);
  renderFooter();

  // Warm the artwork lookup once the page is idle. Nothing is displayed here —
  // it just means the reveal is instant when the slice is actually opened.
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
