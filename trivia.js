// trivia.js — the daily trivia run.
//
// One question a day was too thin and, because the day picked a question by
// hashing the day number, the same one could come back long before the bank
// was exhausted. This is a three-question run instead, one from each round of
// the bank: a warm-up, a picture round (an emoji clue or a photo) and a final
// round. Each round is dealt from a deck that only reshuffles once every
// question in it has been used, so nothing repeats for weeks.
//
// Questions come in several shapes, set by `type` in the bank (see data.js):
// plain multiple choice, true or false, odd one out, emoji clues, picture
// questions and put-in-order. They all score the same way.
//
// There's no clock. The questions carry a line of context and an explanation
// worth reading, and a countdown only pushes people to skim both. Scoring is
// about what you knew, not how fast you clicked:
//   base points per round      100 / 200 / 300
//   streak multiplier          x1, then x1.5, then x2 for consecutive hits
//   50:50                      one per day, drops two wrong answers and halves
//                              what that question is worth. Only on questions
//                              with four answers to choose from
//
// The run state is persisted by the caller, so closing the modal (or reloading)
// resumes where you left off rather than handing out a second attempt.

window.Trivia = (function () {
  "use strict";

  const ROUNDS = 3;
  // Bumped whenever the bank changes shape, so a run saved against the old
  // one is started again instead of resumed onto different questions.
  const VERSION = 2;
  const BASE = [100, 200, 300];          // base points per round
  const MAX_MULT = 2;                    // streak multiplier ceiling
  const ROUND_NAME = ["Warm-up", "Picture round", "Final round"];
  const KEYS = ["A", "B", "C", "D"];
  const TF_KEYS = ["T", "F"];
  const ORDINAL = ["1st", "2nd", "3rd", "4th"];
  // What each kind of question asks you to do, shown above it.
  const KIND = {
    tf: "True or false?",
    odd: "Odd one out",
    emoji: "Emoji clue",
    picture: "Picture question",
    order: "Put them in order"
  };

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

  // Deterministic dealing lives in deck.js: every question in a round is used
  // once before any of them repeats. The round number is the deck's lane, so
  // the three rounds don't rotate in lockstep.
  const permute = Deck.permute;

  // Today's three questions, one per round.
  function todaysRun(bank, dayNumber) {
    const out = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const q = Deck.deal(bank.filter((x) => x.round === round), round, dayNumber);
      if (q) out.push(q);
    }
    return out;
  }

  // The answers a question offers, in the bank's order, and which one is right.
  // True or false has no choices in the bank; it's always True, then False.
  const optionsOf = (q) => (q.type === "tf" ? ["True", "False"] : q.choices);
  const correctOf = (q) => (q.type === "tf" ? (q.answer ? 0 : 1) : q.correct);
  // Only a question with four answers has two wrong ones to spare.
  const canFifty = (q) => q.type !== "tf" && q.type !== "order";

  // Choice order also has to be stable for the day, or a reload would reshuffle
  // the answers under a half-finished question. True or false stays put.
  function choiceOrder(q, dayNumber, round) {
    if (q.type === "tf") return [0, 1];
    const n = q.type === "order" ? q.items.length : q.choices.length;
    const order = permute(n, dayNumber * 2654435761 + round * 40503 + 17);
    // a put-in-order question dealt out already in order would be a giveaway
    if (q.type === "order" && order.every((v, i) => v === i)) order.push(order.shift());
    return order;
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
    let picked = [];          // put-in-order: item indices, in the order tapped
    let token = 0;            // guards against a slow photo landing on a later question
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

    const kindEl = el("div", "tv-kind");
    const ctxEl = el("p", "tv-ctx");
    const visual = el("div", "tv-visual");    // an emoji clue or a photo
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

    wrap.append(hud, kindEl, ctxEl, visual, qEl, choices, tools, result, why, nextWrap);
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
      roundEl.textContent = `Round ${shown}/${ROUNDS} · ${ROUND_NAME[shown - 1]}`;
      catEl.textContent = run[shown - 1].cat;
      const m = multFor(currentStreak());
      multEl.textContent = fmtMult(m);
      multEl.classList.toggle("hot", m > 1);
      scoreEl.textContent = `${state.score} pts`;
    }

    function question(round) {
      locked = false;
      fiftyOnThis = false;
      token += 1;
      const q = run[round];

      renderHud();
      kindEl.textContent = KIND[q.type] || "";
      kindEl.style.display = q.type ? "" : "none";
      ctxEl.textContent = q.ctx || "";
      ctxEl.style.display = q.ctx ? "" : "none";
      showVisual(q);
      qEl.textContent = q.q;
      choices.innerHTML = "";
      result.className = "trivia-result";
      result.textContent = "";
      why.className = "tv-why";
      why.textContent = "";
      nextWrap.innerHTML = "";

      const fiftyHere = canFifty(q);
      fiftyBtn.disabled = state.fifty || !fiftyHere;
      fiftyBtn.textContent = state.fifty ? "50:50 used" : "50:50";
      fiftyBtn.title = fiftyHere || state.fifty
        ? "Remove two wrong answers — costs half this question's points"
        : "The 50:50 only works on questions with four answers";
      tools.style.display = "";

      if (q.type === "order") renderOrder(q, round);
      else renderChoices(q, round);

      worthEl.textContent = `Worth ${worth()} pts`;
    }

    function choiceButton(key, label, onPick) {
      const btn = el("div", "choice");
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
      btn.append(el("span", "key", key), el("span", "tv-label", label));
      btn.addEventListener("click", onPick);
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); }
      });
      return btn;
    }

    function renderChoices(q, round) {
      const options = optionsOf(q);
      const keys = q.type === "tf" ? TF_KEYS : KEYS;
      choices.className = "choices" + (q.type === "tf" ? " tv-tf" : "");
      choiceOrder(q, opts.dayNumber, round).forEach((origIdx, slot) => {
        const btn = choiceButton(keys[slot], options[origIdx], () => answer(origIdx));
        btn.dataset.idx = String(origIdx);
        choices.append(btn);
      });
    }

    // ----- put in order -----
    // Tap the items in order; each one shows where you've put it, and tapping
    // a placed item takes it back out. Nothing counts until you lock it in.
    function renderOrder(q, round) {
      picked = [];
      choices.className = "choices tv-order";
      choiceOrder(q, opts.dayNumber, round).forEach((itemIdx, slot) => {
        const btn = choiceButton(KEYS[slot], q.items[itemIdx][0], () => pick(itemIdx));
        btn.dataset.idx = String(itemIdx);
        btn.append(el("span", "tv-pos"));
        choices.append(btn);
      });
      const lock = el("button", "pz-btn tv-next tv-lock", "Lock in this order");
      lock.type = "button";
      lock.addEventListener("click", submitOrder);
      nextWrap.append(lock);
      renderPicks();
    }

    function pick(itemIdx) {
      if (locked) return;
      const at = picked.indexOf(itemIdx);
      if (at >= 0) picked.splice(at, 1);
      else picked.push(itemIdx);
      renderPicks();
      // once all four are placed, Enter locks them in
      if (picked.length === run[state.i].items.length) {
        nextWrap.querySelector(".tv-lock").focus();
      }
    }

    function renderPicks() {
      [...choices.children].forEach((c) => {
        const at = picked.indexOf(Number(c.dataset.idx));
        c.classList.toggle("placed", at >= 0);
        c.querySelector(".tv-pos").textContent = at >= 0 ? ORDINAL[at] : "";
      });
      const lock = nextWrap.querySelector(".tv-lock");
      const left = run[state.i].items.length - picked.length;
      lock.disabled = left > 0;
      lock.textContent = left > 0 ? `Pick ${left} more` : "Lock in this order";
    }

    function submitOrder() {
      if (locked) return;
      const q = run[state.i];
      if (picked.length !== q.items.length) return;
      settle(picked.every((itemIdx, at) => itemIdx === at), picked.slice());
    }

    // ----- emoji clues and pictures -----
    function showVisual(q) {
      visual.innerHTML = "";
      visual.style.display = q.type === "emoji" || q.type === "picture" ? "" : "none";
      if (q.type === "emoji") {
        const clue = el("div", "tv-emoji-clue", q.emoji);
        clue.setAttribute("role", "img");
        clue.setAttribute("aria-label", "Emoji clue: " + q.emoji.replace(/\n/g, " "));
        visual.append(clue);
      } else if (q.type === "picture") {
        showPicture(q, token);
      }
    }

    // The photo is the lead image of a Wikipedia article (see photos.js). It
    // can't always be had, so its description stands in for it: the question
    // still works without the picture.
    function showPicture(q, mine) {
      const fig = el("figure", "tv-pic loading");
      const img = el("img", "tv-pic-img");
      img.alt = q.alt;
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      const note = el("figcaption", "tv-pic-note");
      fig.append(img, note);
      visual.append(fig);

      const describe = () => {
        if (mine !== token || killed) return;
        visual.innerHTML = "";
        const box = el("div", "tv-pic-alt");
        box.append(el("span", "tv-pic-alt-tag", "No picture this time — here's what it shows"),
          el("span", null, q.alt));
        visual.append(box);
      };

      if (typeof Photos === "undefined" || !Photos.forArticle) { describe(); return; }
      Photos.forArticle(q.pic).then((res) => {
        if (mine !== token || killed) return;
        if (!res || !res.src) { describe(); return; }
        img.addEventListener("load", () => fig.classList.remove("loading"), { once: true });
        img.addEventListener("error", describe, { once: true });
        img.src = res.src;
        note.textContent = "Photo: " +
          ([res.credit, res.licence].filter(Boolean).join(" · ") || "Wikimedia Commons");
      });
    }

    // Reveal the outcome of the question just answered. `chosen` is the index
    // picked, or for a put-in-order question the order the items were placed.
    function reveal(round, chosen, points, correct) {
      const q = run[round];

      if (q.type === "order") {
        // lay the items out in the right order, each with its date, and say
        // where yours went when it wasn't there
        const byIdx = {};
        [...choices.children].forEach((c) => { byIdx[c.dataset.idx] = c; });
        q.items.forEach((item, at) => {
          const c = byIdx[at];
          const yours = chosen.indexOf(at);
          c.classList.remove("placed");
          c.classList.add("disabled", yours === at ? "correct" : "wrong");
          c.querySelector(".key").textContent = String(at + 1);
          c.querySelector(".tv-pos").textContent = yours === at
            ? item[1]
            : `${item[1]} · you had it ${ORDINAL[yours]}`;
          choices.append(c);
        });
      } else {
        const right = correctOf(q);
        [...choices.children].forEach((c) => {
          c.classList.add("disabled");
          const idx = Number(c.dataset.idx);
          if (idx === right) c.classList.add("correct");
          else if (idx === chosen) c.classList.add("wrong");
        });
      }

      result.className = "trivia-result show " + (correct ? "good" : "bad");
      result.textContent = correct
        ? `Correct — +${points} pts`
        : q.type === "order"
          ? "Not quite — that's the right order above."
          : q.type === "tf"
            ? `Not quite — it's ${q.answer ? "true" : "false"}.`
            : `Not quite — the answer is “${optionsOf(q)[correctOf(q)]}”.`;

      why.className = "tv-why show";
      why.innerHTML = "";
      why.append(el("span", "tv-why-tag", q.cat), el("p", "tv-why-text", q.why));

      tools.style.display = "none";
      scoreEl.textContent = `${state.score} pts`;

      nextWrap.innerHTML = "";
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
      settle(chosen === correctOf(run[state.i]), chosen);
    }

    // Score the question being shown, save, and reveal it.
    function settle(correct, chosen) {
      locked = true;

      const round = state.i;
      const points = correct ? worth() : 0;

      state.results.push({ c: correct, p: points });
      state.score += points;
      state.i = round + 1;
      if (opts.save) opts.save();

      if (round === 0 && typeof opts.onStart === "function") opts.onStart();
      if (typeof opts.onAnswer === "function") opts.onAnswer({ correct: correct });

      reveal(round, chosen, points, correct);
    }

    function useFifty() {
      if (locked || state.fifty || !canFifty(run[state.i])) return;
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
        "That's today's run. A fresh three come round at midnight — every question in a round is used before any of them repeats."));

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

    // ----- keyboard -----
    // A-D answer and F spends the 50:50. True or false takes T and F instead.
    // Putting in order, A-D place the items, Backspace takes the last one
    // back, and Enter on the lock-in button commits.
    keyHandler = function (e) {
      if (killed || locked) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const q = run[state.i];
      const k = e.key.toUpperCase();
      if (q.type === "order" && e.key === "Backspace") {
        if (!picked.length) return;
        e.preventDefault();
        picked.pop();
        renderPicks();
        return;
      }
      if (q.type !== "tf" && k === "F") { useFifty(); return; }
      const slot = (q.type === "tf" ? TF_KEYS : KEYS).indexOf(k);
      if (slot < 0) return;
      const btn = choices.children[slot];
      if (!btn || btn.classList.contains("gone")) return;
      e.preventDefault();
      if (q.type === "order") pick(Number(btn.dataset.idx));
      else answer(Number(btn.dataset.idx));
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

  return { mount: mount, todaysRun: todaysRun, ROUNDS: ROUNDS, VERSION: VERSION };
})();
