// app.js — Daily. Deterministic daily content, the bento of sections, modal
// sections, and streak tracking via localStorage. The two crumpled notes at
// the top of the page are desk.js; this hands them today's content through
// window.Daily.

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

  // ----- The date, in the header and the hero -----
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ord = (d) => {
    const t = d % 100;
    if (t >= 11 && t <= 13) return d + "th";
    return d + ({ 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th");
  };

  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((localMidnight - startOfYear) / 86400000);
  const shortDate = `${months[now.getMonth()].slice(0, 3)} ${now.getDate()}`;

  document.getElementById("weekday").textContent = `${weekdays[now.getDay()]} · Day ${dayOfYear} of ${now.getFullYear()}`;
  document.getElementById("dateMain").textContent = `${months[now.getMonth()]} ${ord(now.getDate())}, ${now.getFullYear()}`;
  document.getElementById("navDay").textContent = `${weekdays[now.getDay()].slice(0, 3)}, ${shortDate}`;

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
  const TRIVIA_VERSION = (typeof Trivia !== "undefined") ? Trivia.VERSION : 0;

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
  // 50:50 has been spent, and the per-question results. Reset at midnight, and
  // when it was saved against an older shape of the bank, since its answers
  // belong to different questions. trivia.js reads and mutates this object.
  if (!stats.run || stats.run.key !== dayKey || !Array.isArray(stats.run.results) ||
      stats.run.v !== TRIVIA_VERSION) {
    stats.run = { key: dayKey, v: TRIVIA_VERSION, i: 0, score: 0, fifty: false, results: [] };
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

  // ----- Motion: small ports of React Bits pieces -----
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // BlurText: each word of the headline sharpens into place in turn. The
  // heading keeps its plain text for screen readers.
  function blurText(node) {
    const text = node.textContent.trim();
    node.setAttribute("aria-label", text);
    node.textContent = "";
    text.split(/\s+/).forEach((word, i) => {
      const w = document.createElement("span");
      w.className = "blur-word";
      w.style.setProperty("--i", i);
      w.setAttribute("aria-hidden", "true");
      w.textContent = word;
      node.append(w, " ");
    });
  }

  // CountUp: a number rolls up to its value the first time it is shown, then
  // simply follows it.
  const counted = new WeakSet();
  function countUp(node, value, suffix) {
    const end = Number(value) || 0;
    const unit = suffix || "";
    if (reduceMotion || counted.has(node) || end === 0) {
      counted.add(node);
      node.textContent = end + unit;
      return;
    }
    counted.add(node);
    const start = performance.now();
    const DURATION = 1100;
    (function tick(t) {
      const k = Math.min(1, (t - start) / DURATION);
      const eased = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(end * eased) + unit;
      if (k < 1) requestAnimationFrame(tick);
    })(start);
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

  // The plaque's numbers turn over on brass wheels (React Bits' Counter) when
  // bits.js is there, and simply count up when it isn't.
  function stat(node, value, suffix) {
    if (typeof Bits !== "undefined" && Bits.counter) Bits.counter(node, value, suffix);
    else countUp(node, value, suffix);
  }

  function renderFooter() {
    stat(document.getElementById("statPlayed"), stats.daysPlayed);
    stat(document.getElementById("statBest"), stats.bestStreak);
    stat(document.getElementById("statCorrect"), stats.triviaCorrect);
    const a = accuracyPct();
    const acc = document.getElementById("statAccuracy");
    if (a === null) acc.textContent = "—";
    else stat(acc, a, "%");
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  // Line icons for the sections, drawn on a 24-unit grid. These are fixed
  // strings, never built from content.
  const ICONS = {
    puzzle: '<path d="M9 3h6v3a2 2 0 1 0 4 0V3h2v6h-3a2 2 0 1 0 0 4h3v8h-6v-3a2 2 0 1 0-4 0v3H3v-8h3a2 2 0 1 0 0-4H3V3h6Z"/>',
    trivia: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    locate: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/>',
    artwork: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4l2 5M14 4l2 5"/>'
  };
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[name];
    return svg;
  }

  // ----- The desk: one object per section -----
  // Each section is something lying on the cartographer's desk. A parchment tag
  // pinned beside it names it, and for puzzle, trivia and Where? carries a
  // meter that fills with how you've been doing. The frame shows the day's
  // painting once the photograph has been found.
  const PROPS = [
    { id: "artwork", side: "deskLeft",   kind: "frame",    name: "Artwork of the Day", tilt: -4 },
    { id: "puzzle",  side: "deskLeft",   kind: "book",     name: "Captain's Log",      tilt: 3 },
    { id: "locate",  side: "deskRight",  kind: "globe",    name: "Where in the World", tilt: 0 },
    { id: "trivia",  side: "deskRight",  kind: "bottle",   name: "Message in a Bottle", tilt: -14 },
    { id: "movies",  side: "deskBottom", kind: "spyglass", name: "The Spyglass",       tilt: -6 }
  ];
  // Things on the desk that are only there to be looked at.
  const DECOR = [
    { side: "deskLeft",  kind: "quill" },
    { side: "deskRight", kind: "compass" }
  ];

  const LOCATE_TARGET = 1500;  // score at which the Where? meter fills completely
                               // (roughly round 10 of the endless run)

  // Props with a meter: id -> { fill, acc }.
  const cardMeters = {};
  let triviaSubEl = null;    // per-day state line on the trivia tag
  let artworkCanvas = null;  // the inside of the frame

  function span(cls, text) {
    const n = document.createElement("span");
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function propSub(id, sub) {
    if (id === "puzzle") {
      sub.textContent = todaysGame ? `Today's puzzle: ${todaysGame.name}` : "Today's puzzle";
    } else if (id === "trivia") {
      triviaSubEl = sub;
    } else if (id === "artwork") {
      sub.textContent = `${artwork.title}, ${artwork.artist}`;
    } else if (id === "locate") {
      sub.textContent = "Find the photograph on the map";
    } else if (id === "movies") {
      const n = Array.isArray(window.Movies) ? window.Movies.length : 0;
      sub.textContent = n === 1 ? "1 film to watch" : `${n} films to watch`;
    }
  }

  // The frame and the logbook are plain markup; the rest are drawn in props.js.
  function propArt(kind) {
    const art = span(`prop-art prop-art-${kind}`);
    if (kind === "frame") {
      const frame = span("frame");
      artworkCanvas = span("frame-canvas");
      if (typeof Artwork !== "undefined") artworkCanvas.append(Artwork.render(artwork));
      frame.append(artworkCanvas);
      art.append(frame);
    } else if (kind === "book") {
      const book = span("book");
      book.append(span("book-strap"), span("book-title", "Captain's Log"),
        span("book-rule"), span("book-day", `Day ${dayOfYear}`), span("book-ribbon"));
      art.append(book);
    } else if (typeof DeskProps !== "undefined" && DeskProps[kind]) {
      art.innerHTML = DeskProps[kind]();
    }
    return art;
  }

  function buildProp(p) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `prop prop-${p.kind}`;
    btn.dataset.section = p.id;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.style.setProperty("--tilt", `${p.tilt}deg`);

    const tag = span("prop-tag");
    const sub = span("prop-sub");
    tag.append(span("prop-name", p.name), sub);
    propSub(p.id, sub);
    if (p.id === "puzzle" || p.id === "trivia" || p.id === "locate") {
      const meter = span("prop-meter");
      const fill = span("prop-meter-fill");
      meter.append(fill);
      const acc = span("prop-acc");
      tag.append(meter, acc);
      cardMeters[p.id] = { fill, acc };
    }
    btn.append(propArt(p.kind), tag);
    btn.addEventListener("click", () => openModal(p.id));
    return btn;
  }

  function buildDesk() {
    const chart = document.getElementById("chart");
    if (chart && typeof DeskProps !== "undefined") chart.innerHTML = DeskProps.chart();
    // the bottom of the desk already holds the stats plaque; the spyglass goes before it
    PROPS.forEach((p) => {
      const host = document.getElementById(p.side);
      if (!host) return;
      if (p.side === "deskBottom") host.prepend(buildProp(p));
      else host.append(buildProp(p));
    });
    DECOR.forEach((d) => {
      const host = document.getElementById(d.side);
      if (!host || typeof DeskProps === "undefined") return;
      const item = span(`decor decor-${d.kind}`);
      item.setAttribute("aria-hidden", "true");
      item.innerHTML = DeskProps[d.kind]();
      host.append(item);
    });
  }

  // A card's meter fills left to right in proportion to how you're doing.
  function renderFill(id, pct, caption) {
    const m = cardMeters[id];
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
      ? `${Math.round(tPct * 100)}% correct`
      : "No answers yet");

    // Where? has no accuracy either, so its meter tracks the best score,
    // topping out at LOCATE_TARGET.
    const lBest = (typeof Locate !== "undefined") ? Locate.bestScore() : 0;
    renderFill("locate", lBest / LOCATE_TARGET,
      lBest ? `Best: ${lBest} pts` : "No score yet");
  }

  // Card state that changes within the day (how far into today's run you are).
  function refreshCards() {
    if (!triviaSubEl) return;
    const r = stats.run;
    triviaSubEl.textContent = runDone()
      ? `Done for today · ${r.score} pts`
      : r.i > 0
        ? `Round ${r.i + 1} of ${TRIVIA_ROUNDS}`
        : `${TRIVIA_ROUNDS} questions, new today`;
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
    const colors = ["#8b5cf6", "#0ea5e9", "#f43f5e", "#f59e0b", "#10b981"];
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

  // Copies `text` and says so on the button that asked, then puts its label back.
  function copyText(text, btn) {
    const idle = btn.dataset.idle || btn.textContent;
    btn.dataset.idle = idle;
    const flash = (msg) => {
      btn.textContent = msg;
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = idle; btn.classList.remove("copied"); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flash("Copied!"))
        .catch(() => flash(legacyCopy(text) ? "Copied!" : "Copy failed"));
    } else {
      flash(legacyCopy(text) ? "Copied!" : "Copy failed");
    }
  }

  // A copy button for any block of text. `getText` is called at click time so
  // sections can copy content that isn't known when the button is built.
  function copyBtn(getText, label) {
    const btn = el("button", "ghost-btn copy-btn", label || "Copy");
    btn.type = "button";
    btn.addEventListener("click", () => copyText(getText(), btn));
    return btn;
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
    if (typeof Bits !== "undefined") Bits.glare(frame);

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
      onGameOver: () => { renderFills(); refreshCards(); }
    });

    body.append(el("div", "modal-note",
      "Photographs come from Wikimedia Commons, taken within a few kilometres of the place and used only where they are freely licensed. Where there is no such photograph — or no connection — the round falls back to a written description. The map is Natural Earth's public-domain data."));
    return teardown;
  }

  // The date is stated in full above the entry — the section is about *this*
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
        refreshCards();
      },
      onBest: (score) => {
        stats.triviaBest = score;
        saveStats(stats);
      },
      onComplete: (res) => {
        refreshCards();
        if (!res.replay && res.perfect) burstConfetti();
      }
    });
  }

  // ----- Movies to watch -----
  // The list itself lives in movies.js so it can be added to without going
  // anywhere near this file. Entries are forgiving: a bare title string works
  // as well as { title, year, note }, and anything without a title is skipped.
  function buildMovies(body) {
    const raw = Array.isArray(window.Movies) ? window.Movies : [];
    const films = raw
      .map((m) => (typeof m === "string" ? { title: m } : m || {}))
      .filter((m) => m.title);

    if (!films.length) {
      body.append(el("p", "modal-text", "Nothing on the list yet."));
      body.append(el("p", "modal-note", "Add one in movies.js."));
      return;
    }

    const list = el("ol", "mv-list");
    films.forEach((m) => {
      const item = el("li", "mv-item");
      const head = el("div", "mv-head");
      head.append(el("span", "mv-title", m.title));
      if (m.year) head.append(el("span", "mv-year", String(m.year)));
      item.append(head);
      if (m.note) item.append(el("p", "mv-note", m.note));
      list.append(item);
    });
    body.append(list);
    if (typeof Bits !== "undefined") Bits.animatedList(list, modal);

    const foot = el("div", "modal-foot");
    foot.append(el("p", "modal-note", films.length === 1
      ? "1 film on the list"
      : `${films.length} films on the list`));
    body.append(foot);
  }

  const SECTIONS = {
    puzzle: { title: "Daily Puzzle", build: buildPuzzle },
    artwork: { title: "Artwork of the Day", build: buildArtwork },
    locate: { title: "Where in the World?", build: buildLocate },
    trivia: { title: "Trivia Run", build: buildTrivia },
    // also opens from the button in the header
    movies: { title: "Movies to Watch", build: buildMovies }
  };

  // ----- Modal controller -----
  // On the 3D desk a section opens out of the thing it lives in: the object
  // plays its gesture first (stage.js), then the dialog unfolds from where it
  // is on screen, in a way that suits it — the painting is carried forward in
  // its frame, the logbook's page turns, the globe opens a porthole, the
  // letter unrolls from the bottle and the spyglass focuses.
  const overlay = document.getElementById("modalOverlay");
  const frame = document.getElementById("modalFrame");
  const modal = document.getElementById("modal");
  const modalClose = document.getElementById("modalClose");
  const modalIcon = document.getElementById("modalIcon");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const rolls = Array.from(overlay.querySelectorAll(".modal-deco"));
  let lastFocused = null;
  let opening = false, closing = false;
  let reveal = [];          // the opening animations, played back to close
  let untilt = null;
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
    if (!section || opening || closing || overlay.classList.contains("open")) return;
    lastFocused = document.activeElement;
    const stage = window.DeskStage;
    if (!stage) return showModal(id, null);
    opening = true;
    // a slow machine shouldn't keep the section waiting on the gesture
    const patience = new Promise((resolve) => setTimeout(() => resolve(null), 1600));
    Promise.race([stage.open(id), patience]).then(
      (origin) => { opening = false; showModal(id, origin); },
      () => { opening = false; showModal(id, null); }
    );
  }

  function showModal(id, origin) {
    const section = SECTIONS[id];
    modal.dataset.section = frame.dataset.section = overlay.dataset.section = id;
    modalIcon.replaceChildren(icon(id));
    modalTitle.textContent = section.title;
    teardownSection();
    modalBody.innerHTML = "";
    sectionTeardown = section.build(modalBody) || null;
    modalBody.scrollTop = 0;

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (typeof Bits !== "undefined") {
      Bits.decrypt(modalTitle, section.title);
      Bits.stagger(modalBody);
      if (id === "artwork") untilt = Bits.tilt(frame);
    }
    playReveal(id, origin);
    // focus the close button after the open transition begins
    requestAnimationFrame(() => modalClose.focus({ preventScroll: true }));
  }

  // The keyframes for each way of opening. `o` is the object's rect on screen;
  // without one (the flat desk, or the desk scrolled away) things open from
  // the middle.
  function playReveal(id, origin) {
    reveal = [];
    if (reduceMotion || !frame.animate) return;
    const box = frame.getBoundingClientRect();
    const seen = origin && origin.y + origin.h > 0 && origin.y < window.innerHeight;
    const o = seen ? origin : { x: window.innerWidth / 2 - 30, y: window.innerHeight / 2 - 30, w: 60, h: 60 };
    const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
    const dx = ox - (box.left + box.width / 2), dy = oy - (box.top + box.height / 2);
    const s = Math.max(0.06, Math.min(0.7, Math.max(o.w / box.width, o.h / box.height)));
    const R = Math.hypot(Math.max(ox, window.innerWidth - ox), Math.max(oy, window.innerHeight - oy));
    const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const run = (el, frames, opts) => {
      const a = el.animate(frames, Object.assign({ easing: ease, fill: "backwards" }, opts));
      reveal.push(a);
      return a;
    };
    const porthole = (ms) => run(overlay, [
      { clipPath: `circle(0px at ${ox}px ${oy}px)` },
      { clipPath: `circle(${R}px at ${ox}px ${oy}px)` }
    ], { duration: ms, easing: "cubic-bezier(0.65, 0, 0.25, 1)" });

    if (id === "artwork") {
      run(frame, [
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) perspective(900px) rotateX(14deg)`, opacity: 0.3 },
        { opacity: 1, offset: 0.35 },
        { transform: "none", opacity: 1 }
      ], { duration: 700 });
    } else if (id === "puzzle") {
      run(frame, [
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) perspective(1400px) rotateY(-80deg)`, transformOrigin: "left center", opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: "perspective(1400px) rotateY(0deg)", transformOrigin: "left center", opacity: 1 }
      ], { duration: 820 });
    } else if (id === "locate") {
      porthole(760);
      run(frame, [{ transform: "scale(0.86) rotate(-6deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 760 });
    } else if (id === "trivia") {
      run(frame, [
        { transform: `translate(${dx}px, ${dy}px) scale(${s * 0.6}, ${s * 0.25})`, opacity: 0 },
        { transform: "none", opacity: 1, offset: 0.3 },
        { transform: "none", opacity: 1 }
      ], { duration: 1000 });
      run(modal, [
        { clipPath: "inset(50% 0 50% 0)" },
        { clipPath: "inset(50% 0 50% 0)", offset: 0.3 },
        { clipPath: "inset(0% 0 0% 0)" }
      ], { duration: 1000, easing: "cubic-bezier(0.5, 0, 0.2, 1)" });
      const half = box.height / 2 - 10;
      rolls.forEach((roll, i) => run(roll, [
        { transform: `translateY(${i ? -half : half}px)` },
        { transform: `translateY(${i ? -half : half}px)`, offset: 0.3 },
        { transform: "none" }
      ], { duration: 1000, easing: "cubic-bezier(0.5, 0, 0.2, 1)" }));
    } else if (id === "movies") {
      porthole(900);
      run(modal, [
        { filter: "blur(14px)", transform: "scale(1.14)" },
        { filter: "blur(4px)", transform: "scale(0.98)", offset: 0.6 },
        { filter: "blur(0px)", transform: "none" }
      ], { duration: 1050 });
    } else {
      run(frame, [{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 500 });
    }
  }

  function closeModal() {
    if (!overlay.classList.contains("open") || closing) return;
    const id = modal.dataset.section;
    if (window.DeskStage) window.DeskStage.close(id);
    if (untilt) { untilt(); untilt = null; }
    const anims = reveal;
    reveal = [];
    const done = () => {
      closing = false;
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("modal-open");
      teardownSection();
      // once the overlay has faded, let go of the held closing frames
      setTimeout(() => anims.forEach((a) => a.cancel()), 400);

      // Persist any results gathered while the modal was open, then sync the UI.
      saveStats(stats);
      refreshCards();
      renderFills();
      renderFooter();

      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus({ preventScroll: true });
    };
    if (!anims.length) return done();
    // play the opening backwards, quickly, and hold it there while it fades
    closing = true;
    anims.forEach((a) => {
      a.effect.updateTiming({ fill: "both" });
      a.updatePlaybackRate(-2.2);
      a.play();
    });
    Promise.all(anims.map((a) => a.finished)).then(done, done);
  }

  modalClose.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(); // click on backdrop only
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  // ----- The painting's photograph -----
  // Looked up once the page is idle. It goes into the frame on the desk, and
  // the reveal is instant when the frame is opened.
  let photoLookup = null;
  function findArtPhoto() {
    if (photoLookup) return photoLookup;
    photoLookup = new Promise((resolve) => {
      if (typeof Artwork === "undefined" || !artwork.wiki) return resolve(null);
      const look = () => Artwork.findImage(artwork)
        .then((res) => resolve(res && res.src ? res.src : null))
        .catch(() => resolve(null));
      if (typeof requestIdleCallback === "function") requestIdleCallback(look, { timeout: 3000 });
      else setTimeout(look, 1200);
    });
    return photoLookup;
  }

  // ----- Handing today's notes to desk.js -----
  window.Daily = Object.freeze({
    facts: facts.slice(),
    hist,
    histDate,
    shortDate,
    dayOfYear,
    artwork,
    artPhoto: findArtPhoto,
    copyText
  });

  // ----- Init -----
  document.querySelectorAll("[data-blur-text]").forEach(blurText);
  buildDesk();
  renderFills();
  refreshCards();

  const moviesBtn = document.getElementById("moviesBtn");
  if (moviesBtn) moviesBtn.addEventListener("click", () => openModal("movies"));

  renderStreak(false);
  renderFooter();

  // The frame on the flat desk shows the photograph too.
  findArtPhoto().then((src) => {
    if (!src) return;
    const pre = new Image();
    pre.referrerPolicy = "no-referrer";
    pre.addEventListener("load", () => {
      if (!artworkCanvas) return;
      artworkCanvas.style.setProperty("--art", `url("${src.replace(/["\\\n]/g, "")}")`);
      artworkCanvas.classList.add("has-art");
    });
    pre.src = src;
  });
})();
