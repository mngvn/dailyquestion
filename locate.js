// locate.js — Where in the World. A photograph of somewhere, and a map to
// point at. Click where you think it was taken; you score on how close you got.
//
// The picture comes from Wikimedia Commons, chosen from photographs taken
// within a few kilometres of the place (see photos.js). When there is no
// network, or nothing freely licensed nearby, the round falls back to the
// written clues instead — the game is playable with no pictures at all, it is
// just a different kind of puzzle.
//
// Scoring is by distance, as it should be:
//
//   points = 1000 · e^(−km / 1400)      1000 on the nose, ~490 at 1,000 km,
//                                       ~170 at 2,500 km, single digits by 6,000
//
// It is an endless run that tightens. Each stage draws on more obscure cities
// and demands a closer guess to survive; miss the cutoff and the run is over.
//
//   rounds 1-3    Warm-up      well-known cities   within 3,000 km
//   rounds 4-7    Stepping up  + mid cities        within 2,000 km
//   rounds 8-12   Hard         mid and obscure     within 1,200 km
//   round 13+     Expert       obscure only        within 700 km
//
// Best total lives in localStorage. The map and the coordinates come from
// places.js, generated from Natural Earth's public-domain data.

window.Locate = (function () {
  "use strict";

  const BEST_KEY = "daily.locate.v1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_POINTS = 1000;
  const FALLOFF_KM = 1400;

  const STAGES = [
    { from: 1,  name: "Warm-up",     tiers: [1],    cutoff: 3000 },
    { from: 4,  name: "Stepping up", tiers: [1, 2], cutoff: 2000 },
    { from: 8,  name: "Hard",        tiers: [2, 3], cutoff: 1200 },
    { from: 13, name: "Expert",      tiers: [3],    cutoff: 700 }
  ];
  function stageFor(round) {
    let s = STAGES[0];
    for (const st of STAGES) if (round >= st.from) s = st;
    return s;
  }

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

  // ----- geography -----
  const R_EARTH = 6371;
  function haversine(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // The map is equirectangular, so screen position and coordinate convert
  // straight into each other. This is what turns a click into a guess.
  function toXY(lat, lon) {
    return {
      x: ((lon + 180) / 360) * WORLD.w,
      y: ((WORLD.latMax - lat) / (WORLD.latMax - WORLD.latMin)) * WORLD.h
    };
  }
  function toLatLon(x, y) {
    return {
      lat: WORLD.latMax - (y / WORLD.h) * (WORLD.latMax - WORLD.latMin),
      lon: (x / WORLD.w) * 360 - 180
    };
  }

  function pointsFor(km) {
    return Math.round(MAX_POINTS * Math.exp(-km / FALLOFF_KM));
  }
  function fmtKm(km) {
    if (km < 1) return "under a kilometre";
    if (km < 10) return km.toFixed(1) + " km";
    return Math.round(km).toLocaleString("en-US") + " km";
  }

  /**
   * opts.onStart     called when the first guess of a run is made
   * opts.onGameOver  (score) — called when a run ends
   * Returns a teardown; call it when the view goes away.
   */
  function mount(root, opts) {
    opts = opts || {};
    const pool = (typeof PLACES !== "undefined" && PLACES.length >= 4) ? PLACES : null;
    if (!pool || typeof WORLD === "undefined") {
      root.append(el("p", "modal-text", "The map data failed to load."));
      return function () {};
    }

    const decks = {};
    let place = null;
    let score = 0;
    let round = 0;
    let stage = STAGES[0];
    let guess = null;       // {lat, lon} once the pin is dropped
    let locked = true;
    let best = loadBest();
    let started = false;
    let killed = false;
    let token = 0;          // guards against a slow photo landing in a later round

    const wrap = el("div", "loc");

    const hud = el("div", "loc-hud");
    const roundEl = el("span", "loc-round");
    const stageEl = el("span", "loc-stage");
    const scoreEl = el("span", "loc-score");
    const bestEl = el("span", "loc-best");
    hud.append(roundEl, stageEl, scoreEl, bestEl);

    const stageUp = el("div", "loc-stage-up");

    // the photograph
    const shot = el("figure", "loc-shot");
    const shotImg = el("img", "loc-shot-img");
    shotImg.alt = "A photograph taken somewhere in the world";
    shotImg.referrerPolicy = "no-referrer";
    shotImg.decoding = "async";
    const shotNote = el("figcaption", "loc-shot-note");
    shot.append(shotImg, shotNote);

    // written clues, shown when there is no photograph
    const clues = el("div", "loc-clues");

    // the map you point at
    const mapBox = el("div", "loc-worldbox");
    const mapSvg = svg("svg", {
      viewBox: `0 0 ${WORLD.w} ${WORLD.h}`, class: "loc-world", role: "application"
    });
    mapSvg.setAttribute("aria-label", "World map — click to place your guess");
    mapSvg.append(svg("rect", { class: "loc-sea", x: 0, y: 0, width: WORLD.w, height: WORLD.h }));
    mapSvg.append(svg("path", { class: "loc-land", d: WORLD.d }));
    const marks = svg("g", { class: "loc-marks" });
    mapSvg.append(marks);
    mapBox.append(mapSvg);
    const mapHint = el("div", "loc-maphint", "Click the map to place your guess");

    const controls = el("div", "loc-controls");
    const result = el("div", "loc-result");

    wrap.append(hud, stageUp, shot, clues, mapBox, mapHint, result, controls);
    root.append(wrap);

    // ----- written clues, for when there is no picture -----
    function card(tag, body) {
      const c = el("div", "loc-clue");
      c.append(el("span", "loc-clue-tag", tag));
      c.append(body);
      return c;
    }
    function fmtElev(m) {
      if (m < 0) return `${Math.abs(m)} m below sea level`;
      if (m < 10) return "at sea level";
      return `${m.toLocaleString("en-US")} m above sea level`;
    }
    function showClues(why) {
      clues.innerHTML = "";
      clues.style.display = "";
      clues.append(el("div", "loc-noshot", why));
      const grid = el("dl", "loc-vitals");
      [
        ["Region", place.region],
        ["Population", place.pop.replace(/^about /, "~")],
        ["Elevation", fmtElev(place.elev)],
        ["Clocks", place.tz]
      ].forEach(([k, v]) => grid.append(el("dt", "loc-vk", k), el("dd", "loc-vv", v)));
      clues.append(card("Vitals", grid));
      clues.append(card("Weather", el("p", "loc-clue-text", place.climate)));
      clues.append(card("On the table", el("p", "loc-clue-text", place.food + ".")));
    }

    // ----- the photograph -----
    function loadPhoto(p, mine) {
      shot.classList.add("loading");
      shot.style.display = "";
      clues.style.display = "none";
      shotImg.removeAttribute("src");
      shotNote.textContent = "";

      const noPhoto = (why) => {
        if (mine !== token || killed) return;
        shot.style.display = "none";
        showClues(why);
      };

      if (typeof Photos === "undefined") { noPhoto("No photograph for this one — go by the description."); return; }

      Photos.find(p).then((res) => {
        if (mine !== token || killed) return;
        if (!res || !res.src) {
          noPhoto(res && res.status === "error"
            ? "The photograph couldn't be fetched, so here is the description instead."
            : "No freely licensed photograph near this one — go by the description.");
          return;
        }
        shotImg.addEventListener("load", function onLoad() {
          shotImg.removeEventListener("load", onLoad);
          if (mine !== token || killed) return;
          shot.classList.remove("loading");
        });
        shotImg.addEventListener("error", function onErr() {
          shotImg.removeEventListener("error", onErr);
          noPhoto("That photograph wouldn't load, so here is the description instead.");
        });
        shotImg.src = res.src;
        shotNote.textContent = [res.credit, res.licence].filter(Boolean).join(" · ") || "Wikimedia Commons";
      });
    }

    // ----- the map -----
    function clearMarks() { marks.innerHTML = ""; }

    function pin(pt, cls, r) {
      const { x, y } = toXY(pt.lat, pt.lon);
      marks.append(svg("circle", { class: "loc-pin-halo " + cls, cx: x, cy: y, r: (r || 4) + 3 }));
      marks.append(svg("circle", { class: "loc-pin " + cls, cx: x, cy: y, r: r || 4 }));
    }

    function drawGuess() {
      clearMarks();
      if (guess) pin(guess, "is-guess");
    }

    function drawAnswer() {
      clearMarks();
      const g = toXY(guess.lat, guess.lon);
      const t = toXY(place.lat, place.lon);
      marks.append(svg("line", { class: "loc-link", x1: g.x, y1: g.y, x2: t.x, y2: t.y }));
      pin(guess, "is-guess");
      pin(place, "is-truth", 5);
      const label = svg("text", {
        class: "loc-truth-label",
        x: Math.min(WORLD.w - 4, Math.max(4, t.x)),
        y: t.y - 9,
        "text-anchor": t.x > WORLD.w - 90 ? "end" : (t.x < 90 ? "start" : "middle")
      });
      label.textContent = place.city;
      marks.append(label);
    }

    function mapPoint(evt) {
      const box = mapSvg.getBoundingClientRect();
      const x = ((evt.clientX - box.left) / box.width) * WORLD.w;
      const y = ((evt.clientY - box.top) / box.height) * WORLD.h;
      return toLatLon(
        Math.max(0, Math.min(WORLD.w, x)),
        Math.max(0, Math.min(WORLD.h, y))
      );
    }

    mapSvg.addEventListener("click", (e) => {
      if (locked) return;
      guess = mapPoint(e);
      drawGuess();
      mapHint.textContent = "Move the pin if you like, then lock it in.";
      renderControls();
    });

    // ----- chrome -----
    function renderHud() {
      roundEl.textContent = `Round ${round}`;
      stageEl.textContent = `${stage.name} · within ${stage.cutoff.toLocaleString("en-US")} km`;
      scoreEl.textContent = `${score} pts`;
      bestEl.textContent = best ? `Best ${best}` : "No score yet";
    }

    function renderControls() {
      controls.innerHTML = "";
      if (locked) return;
      const go = el("button", "pz-btn", guess ? "Lock in this spot" : "Place a pin first");
      go.type = "button";
      go.disabled = !guess;
      go.addEventListener("click", submit);
      controls.append(go);
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
      guess = null;
      locked = false;
      token += 1;

      if (round > 1 && stage !== previous) {
        stageUp.textContent = `${stage.name} — harder places, and now you must land within ${stage.cutoff.toLocaleString("en-US")} km.`;
        stageUp.classList.add("show");
      } else {
        stageUp.textContent = "";
        stageUp.classList.remove("show");
      }

      result.className = "loc-result";
      result.textContent = "";
      mapBox.classList.remove("revealed");
      mapHint.textContent = "Click the map to place your guess";
      clearMarks();
      renderHud();
      renderControls();
      loadPhoto(place, token);
    }

    function submit() {
      if (locked || !guess) return;
      locked = true;

      const km = haversine(guess, place);
      const points = pointsFor(km);
      const survived = km <= stage.cutoff;

      if (!started) {
        started = true;
        if (typeof opts.onStart === "function") opts.onStart();
      }

      score += points;
      if (score > best) { best = score; saveBest(best); }
      renderHud();

      drawAnswer();
      mapBox.classList.add("revealed");
      mapHint.textContent = `Your pin, and where it actually was.`;
      // the picture stays, but now it can be named
      shotNote.textContent = `${place.city}, ${place.country}` +
        (shotNote.textContent ? " · " + shotNote.textContent : "");

      controls.innerHTML = "";
      if (survived) {
        result.className = "loc-result show good";
        result.textContent = `${fmtKm(km)} away — ${place.city}, ${place.country}. +${points} pts`;
        const next = el("button", "pz-btn", "Next place →");
        next.type = "button";
        next.addEventListener("click", nextRound);
        controls.append(next);
        requestAnimationFrame(() => next.focus());
      } else {
        result.className = "loc-result show bad";
        result.textContent = `${fmtKm(km)} away — outside the ${stage.cutoff.toLocaleString("en-US")} km you needed. It was ${place.city}, ${place.country}.`;
        controls.append(el("div", "loc-final",
          `Made it to round ${round} · ${score} pts · Best: ${best}`));
        const again = el("button", "pz-btn", "Play again");
        again.type = "button";
        again.addEventListener("click", start);
        controls.append(again);
        if (typeof opts.onGameOver === "function") opts.onGameOver(score);
      }
    }

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
      token += 1;
    };
  }

  function bestScore() {
    return loadBest();
  }

  return { mount: mount, bestScore: bestScore };
})();
