// duel.js — App Duel. Two products, one question: which has more users?
//
// Round 1 hides both figures and you pick one. From then on the survivor keeps
// its revealed number and a fresh challenger arrives with its number hidden, so
// every round after the first is "is this one bigger or smaller than that one".
// A wrong answer ends the run. Best score is kept in localStorage.

window.Duel = (function () {
  "use strict";

  const DEFAULT_BEST_KEY = "daily.duel.v1";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // 3,200,000,000 -> "3.2B". Keeps one decimal only when it adds information.
  function fmt(n) {
    const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (const [size, suffix] of units) {
      if (n >= size) {
        const v = n / size;
        const s = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
        return String(s).replace(/\.0$/, "") + suffix;
      }
    }
    return String(n);
  }

  // Full figure with thousands separators, for the small print under the count.
  function exact(n) {
    return n.toLocaleString("en-US");
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Counts a number up so the reveal lands rather than just appearing.
  function countUp(node, target, ms) {
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / ms);
      // ease-out so it decelerates into the final value
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = fmt(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
      else node.textContent = fmt(target);
    };
    requestAnimationFrame(step);
  }

  function loadBest(key) {
    try { return parseInt(localStorage.getItem(key), 10) || 0; } catch (e) { return 0; }
  }
  function saveBest(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (e) { /* ignore */ }
  }

  // opts.onGameOver(score) fires once per finished run.
  // opts.onStart() fires when a run begins.
  function mount(root, opts) {
    opts = opts || {};
    const bestKey = opts.bestKey || DEFAULT_BEST_KEY;
    const pool = (typeof APPS !== "undefined" && APPS.length >= 2) ? APPS : null;

    root.innerHTML = "";
    if (!pool) {
      root.append(el("p", "modal-text", "App data failed to load."));
      return;
    }

    let deck = [];
    let left = null;      // the survivor — its figure is showing
    let right = null;     // the challenger — its figure is hidden
    // Round one hides both figures. Tracked here rather than on the app object,
    // which is shared with the APPS pool and must not be mutated.
    let leftRevealed = false;
    let score = 0;
    let best = loadBest(bestKey);
    let locked = false;   // true while a reveal animation is playing

    // ---- chrome ----
    const scoreBar = el("div", "duel-scorebar");
    const scoreEl = el("span", "duel-score", "0");
    const bestEl = el("span", "duel-best", "Best " + best);
    scoreBar.append(el("span", "duel-score-label", "Streak"), scoreEl, bestEl);

    const board = el("div", "duel-board");
    const status = el("div", "duel-status");
    const controls = el("div", "duel-controls");
    root.append(scoreBar, board, status, controls);

    function draw() {
      if (!deck.length) deck = shuffled(pool);
      return deck.pop();
    }

    // Pulls a card that isn't tied with `other`, so a round is never a coin
    // flip between two identical figures.
    function drawAgainst(other) {
      for (let i = 0; i < 12; i++) {
        const c = draw();
        if (!other || c.users !== other.users) return c;
      }
      return draw();
    }

    function card(app, revealed, side) {
      const c = el("div", "duel-card duel-" + side);
      c.dataset.side = side;

      c.append(el("div", "duel-name", app.name));
      c.append(el("div", "duel-has", "has"));

      const num = el("div", "duel-num", revealed ? fmt(app.users) : "?");
      c.append(num);

      const metric = el("div", "duel-metric", app.metric);
      c.append(metric);
      c.append(el("div", "duel-asof", app.asOf));

      if (revealed) {
        c.classList.add("revealed");
        c.append(el("div", "duel-exact", exact(app.users)));
      }
      // Either side can be chosen, including the survivor whose figure is
      // already showing — the question is always "which of these two is bigger".
      c.setAttribute("role", "button");
      c.setAttribute("tabindex", "0");
      c.classList.add("pickable");
      return c;
    }

    function render() {
      board.innerHTML = "";
      const l = card(left, leftRevealed, "left");
      const vs = el("div", "duel-vs", "VS");
      const r = card(right, false, "right");
      board.append(l, vs, r);
      wire(l, "left");
      wire(r, "right");
    }

    function wire(node, side) {
      const go = () => choose(side);
      node.addEventListener("click", go);
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    }

    function choose(side) {
      if (locked) return;
      locked = true;

      const picked = side === "left" ? left : right;
      const other = side === "left" ? right : left;
      const correct = picked.users >= other.users;

      // Reveal every hidden figure on the board.
      [...board.querySelectorAll(".duel-card")].forEach((c) => {
        const app = c.dataset.side === "left" ? left : right;
        c.classList.remove("pickable");
        c.removeAttribute("role");
        c.removeAttribute("tabindex");
        if (!c.classList.contains("revealed")) {
          c.classList.add("revealed");
          countUp(c.querySelector(".duel-num"), app.users, 700);
          c.append(el("div", "duel-exact", exact(app.users)));
        }
        c.classList.add(app === picked ? "picked" : "other");
      });

      setTimeout(() => finishRound(picked, other, correct), 780);
    }

    function finishRound(picked, other, correct) {
      const bigger = correct ? picked : other;
      const note = bigger.note ? " " + bigger.note : "";
      if (correct) {
        score += 1;
        scoreEl.textContent = String(score);
        if (score > best) {
          best = score;
          saveBest(bestKey, best);
          bestEl.textContent = "Best " + best;
        }
        status.className = "duel-status show good";
        status.textContent = `Correct — ${picked.name} has more.${note}`;

        const next = el("button", "pz-btn duel-next", "Next round →");
        next.type = "button";
        next.addEventListener("click", () => {
          // The winner carries forward with its figure showing.
          left = picked;
          leftRevealed = true;
          right = drawAgainst(left);
          status.className = "duel-status";
          status.textContent = "";
          controls.innerHTML = "";
          locked = false;
          render();
          next.blur();
        });
        controls.innerHTML = "";
        controls.append(next);
      } else {
        status.className = "duel-status show bad";
        status.textContent = `Not quite — ${other.name} has more.${note}`;
        controls.innerHTML = "";
        controls.append(el("div", "duel-final",
          score === 0 ? "No streak this time." : `Streak: ${score} · Best: ${best}`));
        const again = el("button", "pz-btn duel-next", "Play again");
        again.type = "button";
        again.addEventListener("click", start);
        controls.append(again);
        if (typeof opts.onGameOver === "function") opts.onGameOver(score);
      }
    }

    function start() {
      deck = shuffled(pool);
      score = 0;
      locked = false;
      scoreEl.textContent = "0";
      bestEl.textContent = "Best " + best;
      status.className = "duel-status";
      status.textContent = "";
      controls.innerHTML = "";
      left = draw();
      leftRevealed = false;
      right = drawAgainst(left);
      render();
      if (typeof opts.onStart === "function") opts.onStart();
    }

    start();
  }

  function bestScore(key) {
    return loadBest(key || DEFAULT_BEST_KEY);
  }

  return { mount, bestScore };
})();
