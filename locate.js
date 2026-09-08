// locate.js — Where in the World. A city is described one clue at a time and
// you name it; the sooner you commit, the more it pays.
//
// Clues escalate deliberately: region and population barely narrow it down, the
// country outline gets you a country, the local dish often gets you the city,
// and the landmark gives it away. Guessing on the first clue is worth four
// times guessing on the last.
//
//   clue 1  region + population        100 pts
//   clue 2  the country's outline        75 pts
//   clue 3  what people eat there        50 pts
//   clue 4  a landmark                   25 pts
//
// The outline is not marked with the city. A pin answered the question, and
// the outline only narrows things to a country anyway — often less than the
// local dish gives away, which is why the dish comes after it.
//
// A wrong answer ends the run, so the score is really "how far can you get
// before you get greedy". Best score is kept in localStorage.
//
// The outlines live in places.js, generated from Natural Earth's public-domain
// 110m dataset — see the header there.

window.Locate = (function () {
  "use strict";

  const BEST_KEY = "daily.locate.v1";
  const POINTS = [100, 75, 50, 25];
  const KEYS = ["A", "B", "C", "D"];
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

  // Three decoys, drawn from the same region where possible so the answer can't
  // be reached by elimination on continent alone.
  function optionsFor(place, pool) {
    const others = pool.filter((p) => p.city !== place.city);
    const near = shuffled(others.filter((p) => p.region === place.region));
    const far = shuffled(others.filter((p) => p.region !== place.region));
    return shuffled([place].concat(near.concat(far).slice(0, 3)));
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

    let deck = [];
    let place = null;
    let clues = 1;        // how many clues are showing
    let score = 0;
    let round = 0;
    let locked = true;
    let best = loadBest();
    let started = false;
    let killed = false;

    const wrap = el("div", "loc");

    const hud = el("div", "loc-hud");
    const roundEl = el("span", "loc-round");
    const scoreEl = el("span", "loc-score");
    const bestEl = el("span", "loc-best");
    hud.append(roundEl, scoreEl, bestEl);

    const clueList = el("div", "loc-clues");

    const tools = el("div", "loc-tools");
    const moreBtn = el("button", "ghost-btn loc-more");
    moreBtn.type = "button";
    const worthEl = el("span", "loc-worth");
    tools.append(moreBtn, worthEl);

    const choices = el("div", "choices loc-choices");
    const result = el("div", "loc-result");
    const controls = el("div", "loc-controls");

    wrap.append(hud, clueList, tools, choices, result, controls);
    root.append(wrap);

    // ----- clue cards -----
    function clueCard(tag, body) {
      const card = el("div", "loc-clue");
      card.append(el("span", "loc-clue-tag", tag));
      card.append(body);
      return card;
    }

    // The outline only — marking the city on it gave the answer away.
    function mapClue(p) {
      const box = el("div", "loc-map");
      const s = svg("svg", { viewBox: "0 0 200 140", class: "loc-map-svg", role: "img" });
      s.setAttribute("aria-label", "Outline of the country the city is in");
      s.append(svg("path", { class: "loc-map-path", d: OUTLINES[p.country] || "" }));
      box.append(s);
      return box;
    }

    function renderClues() {
      clueList.innerHTML = "";
      const p = place;
      if (clues >= 1) clueList.append(clueCard("Where and how big", el("p", "loc-clue-text", `${p.region} · Population ${p.pop}.`)));
      if (clues >= 2) clueList.append(clueCard("Somewhere in this country", mapClue(p)));
      if (clues >= 3) clueList.append(clueCard("On the table", el("p", "loc-clue-text", p.food + ".")));
      if (clues >= 4) clueList.append(clueCard("Look for", el("p", "loc-clue-text", p.landmark + ".")));
    }

    function renderHud() {
      roundEl.textContent = `Round ${round}`;
      scoreEl.textContent = `${score} pts`;
      bestEl.textContent = best ? `Best ${best}` : "No score yet";
    }

    function renderTools() {
      const last = clues >= POINTS.length;
      moreBtn.disabled = last;
      moreBtn.textContent = last ? "No clues left" : `Another clue (−${POINTS[clues - 1] - POINTS[clues]})`;
      worthEl.textContent = `Worth ${POINTS[clues - 1]} pts`;
      tools.style.display = "";
    }

    // ----- a round -----
    function nextRound() {
      if (!deck.length) deck = shuffled(pool);
      place = deck.pop();
      clues = 1;
      locked = false;
      round += 1;

      result.className = "loc-result";
      result.textContent = "";
      controls.innerHTML = "";
      renderHud();
      renderClues();
      renderTools();

      choices.innerHTML = "";
      optionsFor(place, pool).forEach((opt, i) => {
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

    function moreClue() {
      if (locked || clues >= POINTS.length) return;
      clues += 1;
      renderClues();
      renderTools();
    }
    moreBtn.addEventListener("click", moreClue);

    function guess(opt, btn) {
      if (locked) return;
      locked = true;

      const right = opt.city === place.city;
      const points = right ? POINTS[clues - 1] : 0;

      [...choices.children].forEach((c) => {
        c.classList.add("disabled");
        if (c.dataset.city === place.city) c.classList.add("correct");
        else if (c === btn) c.classList.add("wrong");
      });

      // Everything they didn't ask for, now that the round is over.
      clues = POINTS.length;
      renderClues();
      tools.style.display = "none";

      if (!started) {
        started = true;
        if (typeof opts.onStart === "function") opts.onStart();
      }

      if (right) {
        score += points;
        if (score > best) { best = score; saveBest(best); }
        renderHud();
        result.className = "loc-result show good";
        result.textContent = `${place.city} it is — +${points} pts`;
        const next = el("button", "pz-btn", "Next city →");
        next.type = "button";
        next.addEventListener("click", nextRound);
        controls.append(next);
        requestAnimationFrame(() => next.focus());
      } else {
        result.className = "loc-result show bad";
        result.textContent = `Not quite — that was ${place.city}, ${place.country}.`;
        controls.append(el("div", "loc-final",
          score === 0 ? "No points this run." : `Final score: ${score} pts · Best: ${best}`));
        const again = el("button", "pz-btn", "Play again");
        again.type = "button";
        again.addEventListener("click", start);
        controls.append(again);
        if (typeof opts.onGameOver === "function") opts.onGameOver(score);
      }
    }

    // ----- keyboard: A-D guess, C for another clue -----
    const keyHandler = function (e) {
      if (killed || locked) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (k === "C") { e.preventDefault(); moreClue(); return; }
      const i = KEYS.indexOf(k);
      if (i < 0) return;
      const btn = choices.children[i];
      if (!btn) return;
      e.preventDefault();
      btn.click();
    };
    document.addEventListener("keydown", keyHandler);

    function start() {
      deck = shuffled(pool);
      score = 0;
      round = 0;
      best = loadBest();
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
