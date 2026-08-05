// trivia.js — the daily trivia run.
//
// One question a day was too thin and, because the day picked a question by
// hashing the day number, the same one could come back long before the bank
// was exhausted. This is a three-question run instead, one from each
// difficulty tier so it escalates, drawn from a deck that only reshuffles once
// every question in that tier has been used — so nothing repeats for months.
//
// There's no clock. The questions carry a line of context and an explanation
// worth reading, and a countdown only pushes people to skim both. Scoring is
// about what you knew, not how fast you clicked:
//   base points per round      100 / 200 / 300
//   streak multiplier          x1, then x1.5, then x2 for consecutive hits
//   50:50                      one per day, drops two wrong answers and halves
//                              what that question is worth
//
// The run state is persisted by the caller, so closing the modal (or reloading)
// resumes where you left off rather than handing out a second attempt.

window.Trivia = (function () {
  "use strict";

  const ROUNDS = 3;
  const BASE = [100, 200, 300];          // base points per round
  const MAX_MULT = 2;                    // streak multiplier ceiling
  const TIER_NAME = ["Warm-up", "Middle round", "Boss round"];
  const KEYS = ["A", "B", "C", "D"];

  // Score bands for the end-of-run title. Without a speed component the reachable
  // scores are a short list: 1000 is a clean sweep, 650 is missing only the
  // warm-up, 400 is two of three, and a single hit is 100-300.
  const RANKS = [
    [1000, "🏆 Turing Award"],
    [650, "🚀 10x Engineer"],
    [400, "🧠 Senior Engineer"],
    [200, "⚙️ Junior Dev"],
    [1, "🌱 Script Kiddie"],
    [0, "💀 Null Pointer"]
  ];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ----- Deterministic randomness -----
  // mulberry32: small, fast, and identical in every browser, which matters
  // because everybody has to get the same questions on the same day.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A seeded permutation of 0..n-1 (Fisher-Yates).
  function permute(n, seed) {
    const r = rng(seed);
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // A tier's deck for one cycle through its whole pool.
  //
  // Reshuffling the whole pool every cycle would still let a question land at
  // the end of one deck and the start of the next — a repeat two days apart,
  // which is exactly the complaint. So the pool is split into two fixed halves
  // (by a permutation that never changes) and each cycle only shuffles *within*
  // each half, always dealing the first half before the second. Every question
  // still comes up exactly once per cycle, and because it can never cross into
  // the other half, two sightings are always more than half a cycle apart.
  function tierDeck(n, tier, cycle) {
    const half = Math.ceil(n / 2);
    const base = permute(n, tier * 2246822519 + 1013904223);
    const a = base.slice(0, half);
    const b = base.slice(half);
    const da = permute(a.length, cycle * 7919 + tier * 104729).map((i) => a[i]);
    const db = permute(b.length, cycle * 6151 + tier * 92821 + 7).map((i) => b[i]);
    return da.concat(db);
  }

  // Today's three questions: one per tier, dealt off that deck.
  function todaysRun(bank, dayNumber) {
    const out = [];
    for (let tier = 1; tier <= ROUNDS; tier++) {
      const pool = bank.filter((q) => q.diff === tier);
      if (!pool.length) continue;
      const cycle = Math.floor(dayNumber / pool.length);
      const pos = ((dayNumber % pool.length) + pool.length) % pool.length;
      out.push(pool[tierDeck(pool.length, tier, cycle)[pos]]);
    }
    return out;
  }

  // Choice order also has to be stable for the day, or a reload would reshuffle
  // the answers under a half-finished question.
  function choiceOrder(q, dayNumber, round) {
    return permute(q.choices.length, dayNumber * 2654435761 + round * 40503 + 17);
  }

  function rankFor(score) {
    for (const [min, name] of RANKS) if (score >= min) return name;
    return RANKS[RANKS.length - 1][1];
  }

  // Multiplier earned by `n` consecutive correct answers so far this run.
  function multFor(streak) {
    return Math.min(MAX_MULT, 1 + streak * 0.5);
  }

  function fmtMult(m) {
    return "×" + (m % 1 ? m.toFixed(1) : m);
  }

  /**
   * Render the run into `root`.
   *
   * opts.bank        the question array (TRIVIA)
   * opts.dayNumber   integer day index, used for the deterministic pick
   * opts.state       persisted run state, mutated in place as the run goes:
   *                  { i, score, fifty, results: [{ c, p }] }
   * opts.save        called after every state change
   * opts.onAnswer    ({ correct }) — per question, for lifetime accuracy
   * opts.onComplete  ({ score, results, best, perfect, replay }) — at the end,
   *                  with replay set when reopening an already-finished run
   * opts.onStart     called when the first answer of the run is locked in
   * opts.best        previous best score, shown on the scorecard
   * opts.onBest      (score) — called when today beats it
   *
   * Returns a teardown function; call it when the modal closes so the key
   * handler doesn't outlive the view.
   */
  function mount(root, opts) {
    const state = opts.state;
    const run = todaysRun(opts.bank, opts.dayNumber);
    if (!run.length) {
      root.append(el("p", "modal-text", "The question bank failed to load."));
      return function () {};
    }

    let locked = true;        // true whenever a click can't be an answer
    let fiftyOnThis = false;  // 50:50 used on the question being shown
    let killed = false;
    let keyHandler = null;

    // ----- chrome -----
    const wrap = el("div", "tv");

    const hud = el("div", "tv-hud");
    const roundEl = el("span", "tv-round");
    const catEl = el("span", "tv-chip");
    const multEl = el("span", "tv-mult");
    const scoreEl = el("span", "tv-score");
    hud.append(roundEl, catEl, multEl, scoreEl);

    const ctxEl = el("p", "tv-ctx");
    const qEl = el("p", "modal-text trivia-q");
    const choices = el("div", "choices");

    const tools = el("div", "tv-tools");
    const fiftyBtn = el("button", "ghost-btn tv-fifty", "50:50");
    fiftyBtn.type = "button";
    fiftyBtn.title = "Remove two wrong answers — costs half this question's points";
    const worthEl = el("span", "tv-worth");
    tools.append(fiftyBtn, worthEl);

    const result = el("div", "trivia-result");
    const why = el("div", "tv-why");
    const nextWrap = el("div", "tv-next-wrap");

    wrap.append(hud, ctxEl, qEl, choices, tools, result, why, nextWrap);
    root.append(wrap);

    // What the current question pays: base for the round, times the streak
    // multiplier, halved if the 50:50 has been spent on it.
    function worth() {
      const half = fiftyOnThis ? 0.5 : 1;
      return Math.round(BASE[state.i] * multFor(currentStreak()) * half);
    }

    // Consecutive correct answers so far this run.
    function currentStreak() {
      let n = 0;
      for (const r of state.results) {
        if (r.c) n++; else n = 0;
      }
      return n;
    }

    // ----- rendering -----
    function renderHud() {
      const round = state.i;
      const shown = Math.min(round + 1, ROUNDS);
      roundEl.textContent = `Round ${shown}/${ROUNDS} · ${TIER_NAME[shown - 1]}`;
      catEl.textContent = run[shown - 1].cat;
      const m = multFor(currentStreak());
      multEl.textContent = fmtMult(m);
      multEl.classList.toggle("hot", m > 1);
      scoreEl.textContent = `${state.score} pts`;
    }

    function question(round) {
      locked = false;
      fiftyOnThis = false;
      const q = run[round];
      const order = choiceOrder(q, opts.dayNumber, round);

      renderHud();
      ctxEl.textContent = q.ctx || "";
      ctxEl.style.display = q.ctx ? "" : "none";
      qEl.textContent = q.q;
      choices.innerHTML = "";
      result.className = "trivia-result";
      result.textContent = "";
      why.className = "tv-why";
      why.textContent = "";
      nextWrap.innerHTML = "";

      fiftyBtn.disabled = state.fifty;
      fiftyBtn.textContent = state.fifty ? "50:50 used" : "50:50";
      tools.style.display = "";

      order.forEach((origIdx, slot) => {
        const btn = el("div", "choice");
        btn.setAttribute("role", "button");
        btn.setAttribute("tabindex", "0");
        btn.dataset.idx = String(origIdx);
        btn.append(el("span", "key", KEYS[slot]), el("span", null, q.choices[origIdx]));
        btn.addEventListener("click", () => answer(origIdx));
        btn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); answer(origIdx); }
        });
        choices.append(btn);
      });

      worthEl.textContent = `Worth ${worth()} pts`;
    }

    // Reveal the outcome of the question just answered.
    function reveal(round, chosen, points) {
      const q = run[round];
      const correct = chosen === q.correct;

      [...choices.children].forEach((c) => {
        c.classList.add("disabled");
        const idx = Number(c.dataset.idx);
        if (idx === q.correct) c.classList.add("correct");
        else if (idx === chosen) c.classList.add("wrong");
      });

      result.className = "trivia-result show " + (correct ? "good" : "bad");
      result.textContent = correct
        ? `Correct — +${points} pts`
        : `Not quite — the answer is “${q.choices[q.correct]}”.`;

      why.className = "tv-why show";
      why.innerHTML = "";
      why.append(el("span", "tv-why-tag", q.cat), el("p", "tv-why-text", q.why));

      tools.style.display = "none";
      scoreEl.textContent = `${state.score} pts`;

      const last = round === ROUNDS - 1;
      const btn = el("button", "pz-btn tv-next", last ? "See your score →" : "Next question →");
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (last) scorecard();
        else question(state.i);
      });
      nextWrap.append(btn);
      requestAnimationFrame(() => btn.focus());
    }

    // ----- answering -----
    function answer(chosen) {
      if (locked) return;
      locked = true;

      const round = state.i;
      const correct = chosen === run[round].correct;
      const points = correct ? worth() : 0;

      state.results.push({ c: correct, p: points });
      state.score += points;
      state.i = round + 1;
      if (opts.save) opts.save();

      if (round === 0 && typeof opts.onStart === "function") opts.onStart();
      if (typeof opts.onAnswer === "function") opts.onAnswer({ correct: correct });

      reveal(round, chosen, points);
    }

    function useFifty() {
      if (locked || state.fifty) return;
      state.fifty = true;
      fiftyOnThis = true;
      if (opts.save) opts.save();

      const q = run[state.i];
      const wrong = [...choices.children].filter((c) => Number(c.dataset.idx) !== q.correct);
      // Drop two of the three wrong answers, chosen for the day so a reload
      // can't reroll them into a different pair. They fade first, then leave
      // the flow so the survivors close up.
      const order = permute(wrong.length, opts.dayNumber + state.i * 811);
      order.slice(0, 2).forEach((i) => {
        const c = wrong[i];
        c.classList.add("gone");
        setTimeout(() => c.classList.add("collapsed"), 280);
      });

      fiftyBtn.disabled = true;
      fiftyBtn.textContent = "50:50 used";
      worthEl.textContent = `Worth ${worth()} pts`;   // now halved
    }

    fiftyBtn.addEventListener("click", useFifty);

    // ----- the end -----
    // `replay` is true when the modal is reopened on a run that already
    // finished, so the caller can skip the celebration the second time.
    function scorecard(replay) {
      const perfect = state.results.every((r) => r.c);
      const best = Math.max(opts.best || 0, state.score);
      if (state.score > (opts.best || 0) && typeof opts.onBest === "function") {
        opts.onBest(state.score);
      }

      wrap.innerHTML = "";
      const card = el("div", "tv-card");

      card.append(el("div", "tv-card-rank", rankFor(state.score)));
      const big = el("div", "tv-card-score");
      big.append(el("span", "tv-card-num", String(state.score)), el("span", "tv-card-unit", "pts"));
      card.append(big);

      const rows = el("div", "tv-rows");
      state.results.forEach((r, i) => {
        const row = el("div", "tv-row " + (r.c ? "hit" : "miss"));
        row.append(
          el("span", "tv-row-mark", r.c ? "✓" : "✗"),
          el("span", "tv-row-name", `R${i + 1} · ${run[i].cat}`),
          el("span", "tv-row-pts", r.c ? `+${r.p}` : "0")
        );
        rows.append(row);
      });
      card.append(rows);

      const hits = state.results.filter((r) => r.c).length;
      card.append(el("div", "tv-card-line",
        `${hits}/${ROUNDS} correct${perfect ? " — clean sweep" : ""} · best run ${best} pts`));

      const foot = el("div", "modal-foot");
      foot.append(shareBtn());
      card.append(foot);

      card.append(el("div", "modal-note",
        "That's today's run. A fresh three come round at midnight — every question in a tier is used before any of them repeats."));

      wrap.append(card);

      if (typeof opts.onComplete === "function") {
        opts.onComplete({
          score: state.score, results: state.results,
          best: best, perfect: perfect, replay: !!replay
        });
      }
    }

    function shareText() {
      const squares = state.results.map((r) => (r.c ? "🟩" : "🟥")).join("");
      return `Daily Trivia — ${squares} ${state.score} pts · ${rankFor(state.score)}`;
    }

    function shareBtn() {
      const idle = "Copy result";
      const btn = el("button", "ghost-btn copy-btn", idle);
      btn.type = "button";
      const flash = (msg) => {
        btn.textContent = msg;
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = idle; btn.classList.remove("copied"); }, 1500);
      };
      btn.addEventListener("click", () => {
        const text = shareText();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => flash("Copied!")).catch(() => flash("Copy failed"));
        } else {
          flash("Copy failed");
        }
      });
      return btn;
    }

    // ----- keyboard: A-D answer, F spends the 50:50 -----
    keyHandler = function (e) {
      if (killed || locked) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (k === "F") { useFifty(); return; }
      const slot = KEYS.indexOf(k);
      if (slot < 0) return;
      const btn = choices.children[slot];
      if (!btn || btn.classList.contains("gone")) return;
      e.preventDefault();
      answer(Number(btn.dataset.idx));
    };
    document.addEventListener("keydown", keyHandler);

    // ----- resume -----
    if (state.i >= ROUNDS) {
      scorecard(true);
    } else if (state.i > 0) {
      question(state.i);          // mid-run: pick up at the unanswered question
    } else {
      question(0);
    }

    return function teardown() {
      killed = true;
      if (keyHandler) document.removeEventListener("keydown", keyHandler);
    };
  }

  return { mount: mount, todaysRun: todaysRun, ROUNDS: ROUNDS };
})();
