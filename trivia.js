// trivia.js — the daily trivia run.
//
// One question a day was too thin and, because the day picked a question by
// hashing the day number, the same one could come back long before the bank
// was exhausted. This is a three-question run instead, one from each
// difficulty tier so it escalates, drawn from a deck that only reshuffles once
// every question in that tier has been used — so nothing repeats for months.
//
// Scoring rewards knowing it *and* knowing it fast:
//   base points per round      100 / 200 / 300
//   speed                      full points at the buzzer's start, decaying to
//                              half by the time the clock runs out
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
  const LIMIT = [25, 30, 35];            // seconds on the clock per round
  const SPEED_FLOOR = 0.5;               // worst-case speed factor (at 0:00)
  const MAX_MULT = 2;                    // streak multiplier ceiling
  const TIER_NAME = ["Warm-up", "Middle round", "Boss round"];
  const KEYS = ["A", "B", "C", "D"];

  // Score bands for the end-of-run title. Max is 1000 (three instant hits with
  // the multiplier running), so these are deliberately generous at the bottom.
  const RANKS = [
    [900, "🏆 Turing Award"],
    [700, "🚀 10x Engineer"],
    [500, "🧠 Principal Engineer"],
    [300, "⚙️ Senior Dev"],
    [120, "🌱 Junior Dev"],
    [1, "📟 Script Kiddie"],
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
   *                  { i, score, fifty, results: [{ c, p, t }], left }
   * opts.save        called after every state change
   * opts.onAnswer    ({ correct }) — per question, for lifetime accuracy
   * opts.onComplete  ({ score, results, best, perfect, replay }) — at the end,
   *                  with replay set when reopening an already-finished run
   * opts.onStart     called when the first answer of the run is locked in
   * opts.best        previous best score, shown on the scorecard
   * opts.onBest      (score) — called when today beats it
   *
   * Returns a teardown function; call it when the modal closes so the clock
   * and the key handler don't outlive the view.
   */
  function mount(root, opts) {
    const state = opts.state;
    const run = todaysRun(opts.bank, opts.dayNumber);
    if (!run.length) {
      root.append(el("p", "modal-text", "The question bank failed to load."));
      return function () {};
    }

    let raf = 0;              // clock frame handle
    let deadline = 0;         // performance.now() at which the clock hits zero
    let limitMs = 0;
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

    const clock = el("div", "tv-clock");
    const clockBar = el("i", "tv-clock-bar");
    const clockNum = el("span", "tv-clock-num");
    clock.append(clockBar, clockNum);

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

    wrap.append(hud, clock, qEl, choices, tools, result, why, nextWrap);
    root.append(wrap);

    // ----- clock -----
    function stopClock() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // Fraction of the clock already spent, 0 → 1.
    function spent() {
      if (!limitMs) return 0;
      return Math.min(1, Math.max(0, 1 - (deadline - performance.now()) / limitMs));
    }

    // What the current question would pay if answered right now.
    function worth() {
      const round = state.i;
      const speed = 1 - (1 - SPEED_FLOOR) * spent();
      const mult = multFor(currentStreak());
      const half = fiftyOnThis ? 0.5 : 1;
      return Math.max(1, Math.round(BASE[round] * speed * mult * half));
    }

    // Consecutive correct answers so far this run.
    function currentStreak() {
      let n = 0;
      for (const r of state.results) {
        if (r.c) n++; else n = 0;
      }
      return n;
    }

    function tick() {
      if (killed) return;
      const p = spent();
      clockBar.style.width = (100 - p * 100).toFixed(2) + "%";
      const left = Math.max(0, (deadline - performance.now()) / 1000);
      clockNum.textContent = left.toFixed(1) + "s";
      clock.classList.toggle("low", left <= 5);
      worthEl.textContent = `Worth ${worth()} pts`;
      if (p >= 1) { answer(null); return; }
      raf = requestAnimationFrame(tick);
    }

    // `leftMs` resumes a question that was already on the clock when the modal
    // was closed — the clock pauses rather than restarting, so reopening isn't
    // a way to buy back speed points.
    function startClock(round, leftMs) {
      limitMs = LIMIT[round] * 1000;
      deadline = performance.now() + (leftMs == null ? limitMs : Math.max(0, leftMs));
      clock.classList.remove("done");
      stopClock();
      raf = requestAnimationFrame(tick);
    }

    // Store what's left on the clock so a close (or a tab dismissal) resumes
    // where it stopped.
    function parkClock() {
      if (locked || !limitMs) return;
      state.left = { r: state.i, ms: Math.max(0, deadline - performance.now()) };
      if (opts.save) opts.save();
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

      const parked = (state.left && state.left.r === round) ? state.left.ms : null;
      state.left = null;
      startClock(round, parked);
    }

    // Reveal the outcome of the question just answered.
    function reveal(round, chosen, points, timedOut) {
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
        : timedOut
          ? `Out of time — the answer was “${q.choices[q.correct]}”.`
          : `Not quite — the answer is “${q.choices[q.correct]}”.`;

      why.className = "tv-why show";
      why.innerHTML = "";
      why.append(el("span", "tv-why-tag", q.cat), el("p", "tv-why-text", q.why));

      tools.style.display = "none";
      clock.classList.add("done");
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
      stopClock();

      const round = state.i;
      const q = run[round];
      const timedOut = chosen === null;
      const correct = !timedOut && chosen === q.correct;
      const points = correct ? worth() : 0;

      state.results.push({ c: correct, p: points, t: timedOut });
      state.score += points;
      state.i = round + 1;
      state.left = null;
      if (opts.save) opts.save();

      if (round === 0 && typeof opts.onStart === "function") opts.onStart();
      if (typeof opts.onAnswer === "function") opts.onAnswer({ correct: correct });

      reveal(round, timedOut ? -1 : chosen, points, timedOut);
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
    }

    fiftyBtn.addEventListener("click", useFifty);

    // ----- the end -----
    // `replay` is true when the modal is reopened on a run that already
    // finished, so the caller can skip the celebration the second time.
    function scorecard(replay) {
      stopClock();
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
          el("span", "tv-row-pts", r.c ? `+${r.p}` : (r.t ? "timed out" : "0"))
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
    window.addEventListener("pagehide", parkClock);

    // ----- resume -----
    if (state.i >= ROUNDS) {
      scorecard(true);
    } else if (state.i > 0) {
      // Mid-run: the clock restarts for the unanswered question, which is the
      // honest reading of "you closed it and came back".
      question(state.i);
    } else {
      question(0);
    }

    return function teardown() {
      parkClock();
      killed = true;
      stopClock();
      if (keyHandler) document.removeEventListener("keydown", keyHandler);
      window.removeEventListener("pagehide", parkClock);
    };
  }

  return { mount: mount, todaysRun: todaysRun, ROUNDS: ROUNDS };
})();
