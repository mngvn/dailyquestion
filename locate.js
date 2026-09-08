// locate.js — Where in the World. A city is described and you type its name.
//
// The round opens with the vague material: region, population, elevation, the
// time zone and the climate. That is rarely enough, and it isn't meant to be.
// Every wrong guess buys you a hint and costs you points:
//
//   attempt 1   the opening dossier                          full points
//   attempt 2   + the country's outline, unmarked            75%
//   attempt 3   + what people eat there                      50%
//   attempt 4   + a detail of everyday life                  30%
//   attempt 5   + the country named and the first letter     15%
//
// Miss all five and the run ends, so the hints are a lifeline with a real
// price rather than a free reveal.
//
// It is an endless run that climbs as you go: the cities get more obscure and
// the rounds pay more.
//
//   rounds 1-3    Warm-up      well-known cities    100 pts
//   rounds 4-7    Stepping up  + mid cities         150 pts
//   rounds 8-12   Hard         mid and obscure      200 pts
//   round 13+     Expert       obscure only         300 pts
//
// Answers are matched loosely — accents, case and punctuation are ignored, a
// single typo is forgiven on longer names, and historical or common alternative
// names are accepted. Best score lives in localStorage.
//
// The outlines live in places.js, generated from Natural Earth's public-domain
// 110m dataset — see the header there.

window.Locate = (function () {
  "use strict";

  const BEST_KEY = "daily.locate.v1";
  const MAX_ATTEMPTS = 5;
  const SVG_NS = "http://www.w3.org/2000/svg";

  // What a round pays, by the attempt you get it on.
  const VALUE = [1, 0.75, 0.5, 0.3, 0.15];

  // The ramp. `tiers` are the city pools the stage draws on.
  const STAGES = [
    { from: 1,  name: "Warm-up",     tiers: [1],    points: 100 },
    { from: 4,  name: "Stepping up", tiers: [1, 2], points: 150 },
    { from: 8,  name: "Hard",        tiers: [2, 3], points: 200 },
    { from: 13, name: "Expert",      tiers: [3],    points: 300 }
  ];
  function stageFor(round) {
    let s = STAGES[0];
    for (const st of STAGES) if (round >= st.from) s = st;
    return s;
  }

  // Alternative spellings and older names people reasonably type.
  const ALIASES = {
    "New York": ["new york city", "nyc"],
    "Mexico City": ["ciudad de mexico", "cdmx"],
    "Hong Kong": ["hongkong"],
    "Kuala Lumpur": ["kl"],
    "Beijing": ["peking"],
    "Mumbai": ["bombay"],
    "Kyiv": ["kiev"],
    "Marrakesh": ["marrakech"],
    "São Paulo": ["sao paulo"],
    "Bogotá": ["bogota"],
    "Reykjavik": ["reykjavík"],
    "Istanbul": ["constantinople"],
    "Addis Ababa": ["addis"],
    "Rio de Janeiro": ["rio"],
    "Buenos Aires": ["ba"],
    "Cape Town": ["capetown"]
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svg(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function saveBest(n) {
    try { localStorage.setItem(BEST_KEY, String(n)); } catch (e) { /* ignore */ }
  }

  function fmtElev(m) {
    if (m < 0) return `${Math.abs(m)} m below sea level`;
    if (m < 10) return "at sea level";
    return `${m.toLocaleString("en-US")} m above sea level`;
  }

  // Strip accents, case and everything that isn't a letter or digit, so
  // "São Paulo", "sao paulo" and "SAOPAULO" all land on the same string.
  function norm(s) {
    return String(s)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  // Levenshtein, capped — used only to forgive a single slip on longer names.
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(
          prev[j] + 1,
          row[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = row;
    }
    return prev[b.length];
  }

  function accepted(place) {
    return [place.city].concat(ALIASES[place.city] || []).map(norm);
  }

  function matches(guess, place) {
    const g = norm(guess);
    if (!g) return false;
    return accepted(place).some((a) =>
      a === g || (a.length >= 6 && editDistance(a, g) <= 1)
    );
  }

  /**
   * opts.onStart     called when the first guess of a run is made
   * opts.onGameOver  (score) — called when a run ends
   * Returns a teardown; call it when the view goes away.
   */
  function mount(root, opts) {
    opts = opts || {};
    const pool = (typeof PLACES !== "undefined" && PLACES.length >= 4) ? PLACES : null;
    if (!pool) {
      root.append(el("p", "modal-text", "The place data failed to load."));
      return function () {};
    }

    const decks = {};      // tier -> remaining cities, reshuffled when spent
    let place = null;
    let score = 0;
    let round = 0;
    let stage = STAGES[0];
    let attempts = 0;      // wrong guesses so far this round
    let tried = [];        // what has already been typed, to ignore repeats
    let locked = true;
    let best = loadBest();
    let started = false;
    let killed = false;

    const wrap = el("div", "loc");

    const hud = el("div", "loc-hud");
    const roundEl = el("span", "loc-round");
    const stageEl = el("span", "loc-stage");
    const scoreEl = el("span", "loc-score");
    const bestEl = el("span", "loc-best");
    hud.append(roundEl, stageEl, scoreEl, bestEl);

    const stageUp = el("div", "loc-stage-up");
    const dossier = el("div", "loc-clues");

    // guessing
    const form = el("form", "loc-guess");
    const input = el("input", "loc-input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Name the city…";
    input.setAttribute("aria-label", "Type the name of the city");
    const submit = el("button", "pz-btn loc-submit", "Guess");
    submit.type = "submit";
    form.append(input, submit);

    const meter = el("div", "loc-meter");
    const dots = el("div", "loc-dots");
    const worthEl = el("span", "loc-worth");
    meter.append(dots, worthEl);

    const triedEl = el("div", "loc-tried");
    const result = el("div", "loc-result");
    const controls = el("div", "loc-controls");

    wrap.append(hud, stageUp, dossier, meter, form, triedEl, result, controls);
    root.append(wrap);

    // ----- dossier pieces -----
    function card(tag, body, cls) {
      const c = el("div", "loc-clue" + (cls ? " " + cls : ""));
      c.append(el("span", "loc-clue-tag", tag));
      c.append(body);
      return c;
    }

    function vitals(p) {
      const grid = el("dl", "loc-vitals");
      [
        ["Region", p.region],
        ["Population", p.pop.replace(/^about /, "~")],
        ["Elevation", fmtElev(p.elev)],
        ["Clocks", p.tz]
      ].forEach(([k, v]) => {
        grid.append(el("dt", "loc-vk", k), el("dd", "loc-vv", v));
      });
      return grid;
    }

    // The country, unmarked: it gets you a country, not a city.
    function mapArt(p) {
      const box = el("div", "loc-map");
      const s = svg("svg", { viewBox: "0 0 200 140", class: "loc-map-svg", role: "img" });
      s.setAttribute("aria-label", "Outline of the country the city is in");
      s.append(svg("path", { class: "loc-map-path", d: OUTLINES[p.country] || "" }));
      box.append(s);
      return box;
    }

    // Bought one at a time, with a wrong guess. Ordered least to most revealing.
    const HINTS = [
      { tag: "Hint · the country it's in", build: mapArt },
      { tag: "Hint · on the table", build: (p) => el("p", "loc-clue-text", p.food + ".") },
      { tag: "Hint · everyday life", build: (p) => el("p", "loc-clue-text", p.life) },
      { tag: "Hint · nearly telling you", build: (p) =>
          el("p", "loc-clue-text",
             `It is in ${p.country}, and the name begins with “${p.city.charAt(0)}”.`) }
    ];

    function renderDossier() {
      const p = place;
      dossier.innerHTML = "";
      dossier.append(card("Vitals", vitals(p)));
      dossier.append(card("Weather", el("p", "loc-clue-text", p.climate)));
      // one hint per wrong guess so far
      HINTS.slice(0, attempts).forEach((h) => {
        dossier.append(card(h.tag, h.build(p), "loc-hint"));
      });
    }

    function roundValue() {
      return Math.round((stage.points * VALUE[attempts]) / 5) * 5;
    }

    function renderMeter() {
      dots.innerHTML = "";
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        dots.append(el("span", "loc-dot" + (i < attempts ? " used" : "")));
      }
      dots.setAttribute("aria-label", `${MAX_ATTEMPTS - attempts} of ${MAX_ATTEMPTS} guesses left`);
      worthEl.textContent = `Worth ${roundValue()} pts`;
    }

    function renderTried() {
      triedEl.innerHTML = "";
      if (!tried.length) return;
      tried.forEach((t) => triedEl.append(el("span", "loc-tried-chip", t)));
    }

    function renderHud() {
      roundEl.textContent = `Round ${round}`;
      stageEl.textContent = `${stage.name} · ${stage.points} pts`;
      scoreEl.textContent = `${score} pts`;
      bestEl.textContent = best ? `Best ${best}` : "No score yet";
    }

    function draw() {
      const tier = stage.tiers[Math.floor(Math.random() * stage.tiers.length)];
      if (!decks[tier] || !decks[tier].length) {
        decks[tier] = shuffled(pool.filter((p) => p.tier === tier));
      }
      return decks[tier].pop();
    }

    // ----- a round -----
    function nextRound() {
      round += 1;
      const previous = stage;
      stage = stageFor(round);
      place = draw();
      attempts = 0;
      tried = [];
      locked = false;

      if (round > 1 && stage !== previous) {
        stageUp.textContent = `${stage.name} — cities get harder, and a round is now worth ${stage.points}.`;
        stageUp.classList.add("show");
      } else {
        stageUp.textContent = "";
        stageUp.classList.remove("show");
      }

      result.className = "loc-result";
      result.textContent = "";
      controls.innerHTML = "";
      form.style.display = "";
      meter.style.display = "";
      input.value = "";
      input.disabled = false;

      renderHud();
      renderDossier();
      renderMeter();
      renderTried();
      // Not on the opening round: the modal puts focus on its close button for
      // accessibility, and grabbing it here would also throw up the on-screen
      // keyboard before anyone has read a word. From round two on you are
      // already typing, so the focus is welcome.
      if (!killed && round > 1) requestAnimationFrame(() => input.focus());
    }

    function endRound(won) {
      locked = true;
      form.style.display = "none";
      meter.style.display = "none";

      if (won) {
        const next = el("button", "pz-btn", "Next city →");
        next.type = "button";
        next.addEventListener("click", nextRound);
        controls.append(next);
        requestAnimationFrame(() => next.focus());
      } else {
        controls.append(el("div", "loc-final",
          score === 0
            ? "No points this run."
            : `Made it to round ${round} · ${score} pts · Best: ${best}`));
        const again = el("button", "pz-btn", "Play again");
        again.type = "button";
        again.addEventListener("click", start);
        controls.append(again);
        if (typeof opts.onGameOver === "function") opts.onGameOver(score);
      }
    }

    function guess(text) {
      if (locked) return;
      const raw = text.trim();
      if (!raw) return;

      // A repeat isn't a new attempt — it's almost always a double submit.
      if (tried.some((t) => norm(t) === norm(raw))) {
        result.className = "loc-result show warn";
        result.textContent = "You already tried that one.";
        return;
      }

      if (!started) {
        started = true;
        if (typeof opts.onStart === "function") opts.onStart();
      }

      if (matches(raw, place)) {
        const points = roundValue();
        score += points;
        if (score > best) { best = score; saveBest(best); }
        renderHud();
        result.className = "loc-result show good";
        result.textContent = attempts === 0
          ? `${place.city}, ${place.country} — first guess, +${points} pts`
          : `${place.city}, ${place.country} — +${points} pts`;
        endRound(true);
        return;
      }

      // Wrong: bank the guess, spend an attempt, open the next hint.
      tried.push(raw);
      attempts += 1;
      input.value = "";
      renderTried();

      if (attempts >= MAX_ATTEMPTS) {
        renderDossier();
        result.className = "loc-result show bad";
        result.textContent = `Out of guesses — it was ${place.city}, ${place.country}.`;
        endRound(false);
        return;
      }

      renderDossier();
      renderMeter();
      result.className = "loc-result show bad";
      result.textContent = `Not ${raw}. Here's another hint — now worth ${roundValue()} pts.`;
      if (!killed) requestAnimationFrame(() => input.focus());
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      guess(input.value);
    });

    function start() {
      Object.keys(decks).forEach((k) => delete decks[k]);
      score = 0;
      round = 0;
      stage = STAGES[0];
      best = loadBest();
      stageUp.textContent = "";
      stageUp.classList.remove("show");
      nextRound();
    }

    start();

    return function teardown() {
      killed = true;
    };
  }

  function bestScore() {
    return loadBest();
  }

  return { mount: mount, bestScore: bestScore };
})();
