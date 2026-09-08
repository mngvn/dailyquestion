// locate.js — Where in the World. A city is laid out as a dossier and you name
// it from four options.
//
// Everything is on the table from the start: vitals, the country's outline, the
// latitude it sits on, its climate, what people eat, and one detail of everyday
// life. There is no drip-feed and nothing to buy — the difficulty is in the
// clues themselves, which are written to be specific without naming the place.
// The country outline is deliberately unmarked, so it gets you a country and
// leaves the city to you.
//
// It is an endless run that tightens as you go. Nothing is ever taken away —
// the dossier stays complete — but the cities get more obscure, the decoys get
// harder to separate, there are more of them, and each round pays more:
//
//   rounds 1-3    Warm-up      well-known cities, 4 options, decoys from anywhere   100 pts
//   rounds 4-7    Stepping up  + mid cities,      4 options, decoys from the region 150 pts
//   rounds 8-12   Hard         mid and obscure,   5 options, decoys from the region 200 pts
//   round 13+     Expert       obscure only,      6 options, decoys as close as the  300 pts
//                                                            pool allows
//
// "As close as the pool allows" is doing real work in the last stage: it asks
// for decoys from the answer's own country first, but most obscure cities here
// are the only one from theirs, so in practice it usually falls back to the
// region. The difficulty there comes from the tier and the six options.
//
// A wrong answer ends the run, so the score is how deep you got. Best score
// lives in localStorage.
//
// The outlines live in places.js, generated from Natural Earth's public-domain
// 110m dataset — see the header there.

window.Locate = (function () {
  "use strict";

  const BEST_KEY = "daily.locate.v1";
  const KEYS = ["A", "B", "C", "D", "E", "F"];

  // The difficulty ramp. `from` is the first round of the stage, `tiers` the
  // city pools it draws on, `decoy` how close the wrong answers sit.
  const STAGES = [
    { from: 1,  name: "Warm-up",     tiers: [1],    opts: 4, points: 100, decoy: "any" },
    { from: 4,  name: "Stepping up", tiers: [1, 2], opts: 4, points: 150, decoy: "region" },
    { from: 8,  name: "Hard",        tiers: [2, 3], opts: 5, points: 200, decoy: "region" },
    { from: 13, name: "Expert",      tiers: [3],    opts: 6, points: 300, decoy: "country" }
  ];
  function stageFor(round) {
    let s = STAGES[0];
    for (const st of STAGES) if (round >= st.from) s = st;
    return s;
  }
  const SVG_NS = "http://www.w3.org/2000/svg";

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

  function fmtLat(lat) {
    return `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}`;
  }
  function fmtElev(m) {
    if (m < 0) return `${Math.abs(m)} m below sea level`;
    if (m < 10) return "at sea level";
    return `${m.toLocaleString("en-US")} m above sea level`;
  }

  // Decoys, ordered by how easily they can be told apart from the answer. Later
  // stages want the closest ones: same country beats same region beats anywhere.
  function optionsFor(place, pool, stage) {
    const others = pool.filter((p) => p.city !== place.city);
    const sameCountry = shuffled(others.filter((p) => p.country === place.country));
    const sameRegion = shuffled(others.filter((p) => p.country !== place.country && p.region === place.region));
    const rest = shuffled(others.filter((p) => p.region !== place.region));

    let ranked;
    if (stage.decoy === "country") ranked = sameCountry.concat(sameRegion, rest);
    else if (stage.decoy === "region") ranked = sameRegion.concat(sameCountry, rest);
    else ranked = shuffled(others);

    return shuffled([place].concat(ranked.slice(0, stage.opts - 1)));
  }

  /**
   * opts.onStart     called when the first guess of a run is locked in
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
    const choices = el("div", "choices loc-choices");
    const result = el("div", "loc-result");
    const controls = el("div", "loc-controls");

    wrap.append(hud, stageUp, dossier, choices, result, controls);
    root.append(wrap);

    // ----- the dossier -----
    function card(tag, body, cls) {
      const c = el("div", "loc-clue" + (cls ? " " + cls : ""));
      c.append(el("span", "loc-clue-tag", tag));
      c.append(body);
      return c;
    }

    // Facts that fit on one line each, as a labelled grid.
    function vitals(p) {
      const grid = el("dl", "loc-vitals");
      // Latitude is left out — the globe alongside already shows it.
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

    // The country, unmarked. Recognising the shape gets you a country, not a city.
    function mapArt(p) {
      const box = el("div", "loc-map");
      const s = svg("svg", { viewBox: "0 0 200 140", class: "loc-map-svg", role: "img" });
      s.setAttribute("aria-label", "Outline of the country the city is in");
      s.append(svg("path", { class: "loc-map-path", d: OUTLINES[p.country] || "" }));
      box.append(s);
      return box;
    }

    // A globe seen edge-on with the city's parallel drawn across it. Plenty of
    // cities share a latitude, so it narrows the band without giving the answer.
    function latArt(p) {
      const box = el("div", "loc-globe");
      const s = svg("svg", { viewBox: "0 0 120 120", class: "loc-globe-svg", role: "img" });
      s.setAttribute("aria-label", `The city's latitude, ${fmtLat(p.lat)}`);
      const R = 52, CX = 60, CY = 60;
      s.append(svg("circle", { class: "loc-globe-edge", cx: CX, cy: CY, r: R }));
      // tropics and equator for reference
      [23.44, -23.44].forEach((t) => {
        const y = CY - (t / 90) * R;
        const half = R * Math.cos((t * Math.PI) / 180);
        s.append(svg("line", { class: "loc-globe-tropic", x1: CX - half, y1: y, x2: CX + half, y2: y }));
      });
      s.append(svg("line", { class: "loc-globe-eq", x1: CX - R, y1: CY, x2: CX + R, y2: CY }));

      const y = CY - (p.lat / 90) * R;
      const half = R * Math.cos((p.lat * Math.PI) / 180);
      s.append(svg("line", { class: "loc-globe-lat", x1: CX - half, y1: y, x2: CX + half, y2: y }));
      const label = svg("text", { class: "loc-globe-label", x: CX, y: y - 6, "text-anchor": "middle" });
      label.textContent = fmtLat(p.lat);
      s.append(label);
      box.append(s);
      return box;
    }

    function renderDossier(p) {
      dossier.innerHTML = "";

      const art = el("div", "loc-art");
      art.append(card("The country it's in", mapArt(p), "loc-clue-map"),
                 card("Latitude", latArt(p), "loc-clue-globe"));
      dossier.append(art);

      dossier.append(card("Vitals", vitals(p)));
      dossier.append(card("Weather", el("p", "loc-clue-text", p.climate)));
      dossier.append(card("On the table", el("p", "loc-clue-text", p.food + ".")));
      dossier.append(card("Everyday life", el("p", "loc-clue-text", p.life)));
    }

    function renderHud() {
      roundEl.textContent = `Round ${round}`;
      stageEl.textContent = `${stage.name} · ${stage.points} pts`;
      scoreEl.textContent = `${score} pts`;
      bestEl.textContent = best ? `Best ${best}` : "No score yet";
    }

    // Draw from the stage's tiers, keeping a separate deck per tier so a city
    // can't come round again until its whole tier has been used.
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
      locked = false;

      // Say so when the run steps up, rather than silently changing the rules.
      if (round > 1 && stage !== previous) {
        stageUp.textContent = `${stage.name} — ${stage.opts} options now, ${stage.points} points a round.`;
        stageUp.classList.add("show");
      } else {
        stageUp.textContent = "";
        stageUp.classList.remove("show");
      }

      result.className = "loc-result";
      result.textContent = "";
      controls.innerHTML = "";
      renderHud();
      renderDossier(place);

      choices.innerHTML = "";
      optionsFor(place, pool, stage).forEach((opt, i) => {
        const btn = el("div", "choice");
        btn.setAttribute("role", "button");
        btn.setAttribute("tabindex", "0");
        btn.dataset.city = opt.city;
        btn.append(
          el("span", "key", KEYS[i]),
          el("span", "loc-opt", `${opt.city}, ${opt.country}`)
        );
        const go = () => guess(opt, btn);
        btn.addEventListener("click", go);
        btn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        });
        choices.append(btn);
      });
    }

    function guess(opt, btn) {
      if (locked) return;
      locked = true;

      const right = opt.city === place.city;

      [...choices.children].forEach((c) => {
        c.classList.add("disabled");
        if (c.dataset.city === place.city) c.classList.add("correct");
        else if (c === btn) c.classList.add("wrong");
      });

      if (!started) {
        started = true;
        if (typeof opts.onStart === "function") opts.onStart();
      }

      if (right) {
        score += stage.points;
        if (score > best) { best = score; saveBest(best); }
        renderHud();
        result.className = "loc-result show good";
        result.textContent = `${place.city} it is — +${stage.points} pts`;
        const next = el("button", "pz-btn", "Next city →");
        next.type = "button";
        next.addEventListener("click", nextRound);
        controls.append(next);
        requestAnimationFrame(() => next.focus());
      } else {
        result.className = "loc-result show bad";
        result.textContent = `Not quite — that was ${place.city}, ${place.country}.`;
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

    // ----- keyboard: A-D guess -----
    const keyHandler = function (e) {
      if (killed || locked) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = KEYS.indexOf(e.key.toUpperCase());
      if (i < 0) return;
      const btn = choices.children[i];
      if (!btn) return;
      e.preventDefault();
      btn.click();
    };
    document.addEventListener("keydown", keyHandler);

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
      document.removeEventListener("keydown", keyHandler);
    };
  }

  function bestScore() {
    return loadBest();
  }

  return { mount: mount, bestScore: bestScore };
})();
