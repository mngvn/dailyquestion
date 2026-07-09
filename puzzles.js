// puzzles.js — five self-contained logic mini-games for the Daily Puzzle
// section. One game type is drawn per calendar day and its puzzle is seeded
// from that day, so every player gets the same single puzzle — no rerolling.
// Exposes Puzzles.todaysGame() and Puzzles.mountHub(root).

const Puzzles = (function () {
  "use strict";

  // ---------- daily seed + deterministic RNG ----------
  // A stable integer that increments once per local day. The whole module draws
  // randomness from a seeded generator keyed off this number, so the puzzles are
  // identical for everyone all day and cannot be re-rolled into an easier draw.
  const _now = new Date();
  const DAY_NUMBER = Math.floor(
    new Date(_now.getFullYear(), _now.getMonth(), _now.getDate()).getTime() / 86400000
  );

  // mulberry32 — small, fast, deterministic PRNG in [0, 1).
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Current source of randomness. Reseeded per game (by salt) before each mount.
  let rng = Math.random;
  function seedFor(salt) { rng = makeRng((DAY_NUMBER * 2654435761 + salt) >>> 0); }

  // ---------- tiny helpers ----------
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  const randInt = (n) => Math.floor(rng() * n);
  const pickRand = (arr) => arr[randInt(arr.length)];
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  function statusLine() { return el("div", "pz-status"); }
  function setStatus(s, text, type) {
    s.textContent = text;
    s.className = "pz-status" + (type ? " " + type : "");
  }
  function button(label, cls) {
    const b = el("button", cls || "pz-btn", label);
    b.type = "button";
    return b;
  }

  // ========================================================
  // Game 1 — Wordle
  // ========================================================
  // Less-common / trickier words (repeated letters, awkward vowels, uncommon
  // consonant clusters) to keep the daily Wordle genuinely challenging.
  const WORDLE_WORDS = [
    "AZURE", "BIJOU", "CRYPT", "DWELT", "EQUIP", "FJORD", "GLYPH", "HYMNS",
    "IDYLL", "JUMBO", "KNACK", "LYMPH", "MIRTH", "NYMPH", "OZONE", "PIXEL",
    "QUASH", "RHYME", "SYRUP", "THYME", "USURP", "VIXEN", "WALTZ", "XYLEM",
    "YEARN", "ZILCH", "ABYSS", "BLITZ", "CIVIC", "DODGE", "EXILE", "FLUFF",
    "GAUZE", "HAVOC", "ICILY", "JOUST", "KIOSK", "LLAMA", "MUMMY", "NINTH",
    "OAKEN", "PROXY", "QUIRK", "RUGBY", "SWIRL", "TWEAK", "UNZIP", "VOUCH",
    "WHARF", "YOLKS", "ZESTY", "BUXOM", "CHAFF", "DROLL", "EPOXY", "FRANK",
    "GECKO", "HUTCH", "INLET", "JAZZY", "KAPPA", "LURID", "MOTTO", "NUDGE",
    "ONION", "PUTTY", "QUELL", "ROUSE", "SHEEN", "TRUCE", "UDDER", "VYING",
    "WOOZY", "XEBEC", "YODEL", "ZONAL", "BOOZY", "CRANK", "DITTY", "EGRET"
  ];

  function scoreGuess(guess, target) {
    const res = new Array(5).fill("absent");
    const counts = {};
    for (const ch of target) counts[ch] = (counts[ch] || 0) + 1;
    for (let i = 0; i < 5; i++) {
      if (guess[i] === target[i]) { res[i] = "correct"; counts[guess[i]]--; }
    }
    for (let i = 0; i < 5; i++) {
      if (res[i] === "correct") continue;
      const ch = guess[i];
      if (counts[ch] > 0) { res[i] = "present"; counts[ch]--; }
    }
    return res;
  }

  function gameWordle(c) {
    const target = pickRand(WORDLE_WORDS);
    const maxRows = 5;
    let row = 0, done = false;

    c.append(el("div", "pz-intro", "Guess the hidden 5-letter word in 5 tries."));
    const grid = el("div", "pz-wgrid");
    const tiles = [];
    for (let r = 0; r < maxRows; r++) {
      const rowEl = el("div", "pz-wrow");
      tiles[r] = [];
      for (let i = 0; i < 5; i++) {
        const t = el("div", "pz-wtile");
        rowEl.append(t);
        tiles[r].push(t);
      }
      grid.append(rowEl);
    }
    const form = el("form", "pz-form");
    const input = el("input", "pz-input");
    input.maxLength = 5; input.autocomplete = "off"; input.placeholder = "type a word";
    const btn = el("button", "pz-btn", "Guess"); btn.type = "submit";
    form.append(input, btn);
    const status = statusLine();
    c.append(grid, form, status);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (done) return;
      const g = (input.value || "").toUpperCase();
      if (!/^[A-Z]{5}$/.test(g)) { setStatus(status, "Enter 5 letters.", "bad"); return; }
      const score = scoreGuess(g, target);
      for (let i = 0; i < 5; i++) {
        const t = tiles[row][i];
        t.textContent = g[i];
        t.style.animationDelay = (i * 0.08) + "s";
        t.classList.add("flip", score[i]);
      }
      input.value = "";
      if (g === target) {
        done = true;
        setStatus(status, `Solved in ${row + 1}! 🎉`, "good");
        input.disabled = btn.disabled = true;
        return;
      }
      row++;
      if (row >= maxRows) {
        done = true;
        setStatus(status, `Out of tries — the word was ${target}.`, "bad");
        input.disabled = btn.disabled = true;
      } else {
        setStatus(status, `${maxRows - row} ${maxRows - row === 1 ? "try" : "tries"} left.`, "");
      }
    });
  }

  // ========================================================
  // Game 2 — Number Sequence
  // ========================================================
  function genSequence() {
    const builders = [
      // Linear with a multiplier baked in: a*n + b — harder to spot than a plain gap.
      () => {
        const m = randInt(4) + 2, b = randInt(7) + 1, t = [];
        for (let i = 0; i < 5; i++) t.push(m * (i + 1) + b);
        return { terms: t, next: m * 6 + b, rule: `multiply the position by ${m}, then add ${b}` };
      },
      // Geometric growth.
      () => {
        const a = randInt(3) + 2, r = randInt(2) + 2, t = [];
        for (let i = 0; i < 5; i++) t.push(a * Math.pow(r, i));
        return { terms: t, next: a * Math.pow(r, 5), rule: `multiply by ${r} each time` };
      },
      // Quadratic: n^2 + c (second differences are constant).
      () => {
        const s = randInt(3) + 1, c = randInt(5), t = [];
        for (let i = 0; i < 5; i++) { const n = s + i; t.push(n * n + c); }
        const n = s + 5;
        return { terms: t, next: n * n + c, rule: `square the running number${c ? ` and add ${c}` : ""}` };
      },
      // Fibonacci-style with a head start.
      () => {
        const t = [randInt(4) + 2, randInt(5) + 3];
        for (let i = 2; i < 6; i++) t.push(t[i - 1] + t[i - 2]);
        return { terms: t.slice(0, 5), next: t[5], rule: "add the two previous terms (Fibonacci-style)" };
      },
      // Accelerating gap: the step grows by a fixed amount each time.
      () => {
        const t = []; let cur = randInt(5) + 1, add = randInt(3) + 2; const grow = randInt(2) + 1;
        for (let i = 0; i < 5; i++) { t.push(cur); cur += add; add += grow; }
        return { terms: t, next: cur, rule: `the gap grows by ${grow} each step` };
      },
      // Alternating two operations: ×k then +j, repeating.
      () => {
        const k = randInt(2) + 2, j = randInt(5) + 1, t = [randInt(4) + 2];
        for (let i = 1; i < 6; i++) t.push(i % 2 ? t[i - 1] * k : t[i - 1] + j);
        return { terms: t.slice(0, 5), next: t[5], rule: `alternate ×${k} and +${j}` };
      },
      // Two interleaved arithmetic sequences (odd vs. even positions).
      () => {
        const a = randInt(5) + 1, da = randInt(4) + 2, b = randInt(6) + 3, db = randInt(4) + 2;
        const t = [];
        for (let i = 0; i < 6; i++) t.push(i % 2 === 0 ? a + da * (i / 2) : b + db * ((i - 1) / 2));
        return { terms: t.slice(0, 5), next: t[5], rule: `two interleaved sequences (+${da} and +${db})` };
      }
    ];
    return pickRand(builders)();
  }

  function gameSequence(c) {
    const { terms, next, rule } = genSequence();
    let done = false;
    c.append(el("div", "pz-intro", "What number comes next?"));
    c.append(el("div", "pz-seq", terms.join("   ") + "   ?"));
    const form = el("form", "pz-form");
    const input = el("input", "pz-input");
    input.inputMode = "numeric"; input.autocomplete = "off"; input.placeholder = "next number";
    const btn = el("button", "pz-btn", "Check"); btn.type = "submit";
    form.append(input, btn);
    const status = statusLine();
    const reveal = button("Reveal answer", "pz-link");
    c.append(form, status, reveal);

    reveal.addEventListener("click", () => {
      if (done) return;
      done = true;
      setStatus(status, `Answer: ${next} — ${rule}.`, "");
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (done) return;
      const v = parseInt((input.value || "").trim(), 10);
      if (Number.isNaN(v)) { setStatus(status, "Enter a number.", "bad"); return; }
      if (v === next) { done = true; setStatus(status, `Correct! The rule: ${rule}. 🎉`, "good"); }
      else setStatus(status, "Not quite — try again or reveal.", "bad");
    });
  }

  // ========================================================
  // Game 3 — Mini Sudoku (4x4)
  // ========================================================
  const SUDOKU_BASE = [
    [1, 2, 3, 4],
    [3, 4, 1, 2],
    [2, 1, 4, 3],
    [4, 3, 2, 1]
  ];
  const cloneGrid = (g) => g.map((r) => r.slice());
  function swapRows(g, a, b) { const n = cloneGrid(g); [n[a], n[b]] = [n[b], n[a]]; return n; }
  function swapCols(g, a, b) { return g.map((r) => { const n = r.slice(); [n[a], n[b]] = [n[b], n[a]]; return n; }); }
  function swapBands(g) { return [g[2], g[3], g[0], g[1]].map((r) => r.slice()); }
  function swapStacks(g) { return g.map((r) => [r[2], r[3], r[0], r[1]]); }
  function transpose(g) { return g[0].map((_, col) => g.map((r) => r[col])); }

  function genSudokuSolution() {
    let g = cloneGrid(SUDOKU_BASE);
    const perm = shuffle([1, 2, 3, 4]);
    g = g.map((r) => r.map((v) => perm[v - 1]));
    const ops = [
      (x) => swapRows(x, 0, 1), (x) => swapRows(x, 2, 3),
      (x) => swapCols(x, 0, 1), (x) => swapCols(x, 2, 3),
      swapBands, swapStacks, transpose
    ];
    for (let i = 0; i < 24; i++) if (rng() < 0.5) g = pickRand(ops)(g);
    return g;
  }

  function validSudoku(g) {
    const ok = (arr) => { const s = new Set(arr); return s.size === 4 && [1, 2, 3, 4].every((n) => s.has(n)); };
    for (let r = 0; r < 4; r++) if (!ok(g[r])) return false;
    for (let col = 0; col < 4; col++) if (!ok([0, 1, 2, 3].map((r) => g[r][col]))) return false;
    for (const [br, bc] of [[0, 0], [0, 2], [2, 0], [2, 2]]) {
      const cells = [];
      for (let r = 0; r < 2; r++) for (let col = 0; col < 2; col++) cells.push(g[br + r][bc + col]);
      if (!ok(cells)) return false;
    }
    return true;
  }

  function gameSudoku(c) {
    const sol = genSudokuSolution();
    const cells = [];
    for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) cells.push([r, col]);
    shuffle(cells);
    const given = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]];
    // Leave only 6 clues (10 blanks) — fewer givens means more deduction.
    for (let i = 0; i < 10; i++) { const [r, col] = cells[i]; given[r][col] = 0; }

    c.append(el("div", "pz-intro", "Fill the grid so every row, column, and 2×2 box holds 1–4."));
    const grid = el("div", "pz-sgrid");
    const refs = [];
    for (let r = 0; r < 4; r++) {
      refs[r] = [];
      for (let col = 0; col < 4; col++) {
        const cell = el("div", "pz-scell");
        if (col === 1) cell.classList.add("bdr-r");
        if (r === 1) cell.classList.add("bdr-b");
        if (given[r][col]) {
          cell.textContent = sol[r][col];
          cell.classList.add("given");
          refs[r][col] = { given: true, val: sol[r][col] };
        } else {
          const inp = el("input", "pz-sinput");
          inp.maxLength = 1; inp.inputMode = "numeric";
          inp.addEventListener("input", () => { inp.value = inp.value.replace(/[^1-4]/g, ""); });
          cell.append(inp);
          refs[r][col] = { given: false, el: inp };
        }
        grid.append(cell);
      }
    }
    const btn = button("Check");
    const status = statusLine();
    c.append(grid, btn, status);

    btn.addEventListener("click", () => {
      const g = [];
      for (let r = 0; r < 4; r++) {
        g[r] = [];
        for (let col = 0; col < 4; col++) {
          const ref = refs[r][col];
          const v = ref.given ? ref.val : parseInt(ref.el.value, 10);
          if (!(v >= 1 && v <= 4)) { setStatus(status, "Fill every cell with 1–4.", "bad"); return; }
          g[r][col] = v;
        }
      }
      if (validSudoku(g)) setStatus(status, "Solved! Every line checks out. 🎉", "good");
      else setStatus(status, "Not valid yet — check your rows, columns, and boxes.", "bad");
    });
  }

  // ========================================================
  // Game 4 — Code Breaker (Mastermind)
  // ========================================================
  function feedback(secret, guess) {
    let exact = 0, partial = 0;
    const s = secret.slice(), g = guess.slice();
    for (let i = 0; i < 4; i++) if (g[i] === s[i]) { exact++; s[i] = g[i] = null; }
    for (let i = 0; i < 4; i++) {
      if (g[i] == null) continue;
      const idx = s.indexOf(g[i]);
      if (idx >= 0) { partial++; s[idx] = null; }
    }
    return { exact, partial };
  }

  function gameCode(c) {
    // Digits may now repeat, so deduction is harder and there are more codes.
    const secret = [];
    for (let i = 0; i < 4; i++) secret.push(randInt(6) + 1);
    const maxG = 7;
    let guesses = 0, done = false;

    c.append(el("div", "pz-intro",
      "Crack the secret 4-digit code (digits 1–6, repeats allowed). Bulls 🎯 = right digit & spot, Cows 🐮 = right digit, wrong spot."));
    const history = el("div", "pz-history");
    const form = el("form", "pz-form");
    const input = el("input", "pz-input");
    input.inputMode = "numeric"; input.maxLength = 4; input.autocomplete = "off"; input.placeholder = "e.g. 1356";
    const btn = el("button", "pz-btn", "Guess"); btn.type = "submit";
    form.append(input, btn);
    const status = statusLine();
    c.append(history, form, status);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (done) return;
      const raw = (input.value || "").trim();
      if (!/^[1-6]{4}$/.test(raw)) { setStatus(status, "Enter 4 digits, each 1–6.", "bad"); return; }
      const g = raw.split("").map(Number);
      const { exact, partial } = feedback(secret, g);
      guesses++;
      const rowEl = el("div", "pz-hrow");
      rowEl.innerHTML = `<span class="pz-hguess">${raw}</span>` +
        `<span class="pz-hfb">🎯 ${exact} &nbsp; 🐮 ${partial}</span>`;
      history.append(rowEl);
      input.value = "";
      if (exact === 4) {
        done = true;
        setStatus(status, `Cracked it in ${guesses}! 🎉`, "good");
        input.disabled = btn.disabled = true;
        return;
      }
      if (guesses >= maxG) {
        done = true;
        setStatus(status, `Out of guesses — the code was ${secret.join("")}.`, "bad");
        input.disabled = btn.disabled = true;
      } else {
        setStatus(status, `${maxG - guesses} guesses left.`, "");
      }
    });
  }

  // ========================================================
  // Game 5 — Nonogram (5x5 Picross)
  // ========================================================
  function runs(arr) {
    const out = []; let count = 0;
    for (const v of arr) { if (v) count++; else if (count) { out.push(count); count = 0; } }
    if (count) out.push(count);
    return out.length ? out : [0];
  }

  function gameNonogram(c) {
    const N = 6;
    let sol;
    do {
      sol = [];
      for (let r = 0; r < N; r++) {
        sol.push([]);
        for (let col = 0; col < N; col++) sol[r].push(rng() < 0.55 ? 1 : 0);
      }
    } while (sol.every((row) => row.every((v) => v === 0)));

    const rowClues = sol.map((r) => runs(r));
    const colClues = [];
    for (let col = 0; col < N; col++) colClues.push(runs(sol.map((r) => r[col])));
    const player = sol.map((r) => r.map(() => 0));
    let done = false;

    c.append(el("div", "pz-intro", "Fill cells to match the clues — numbers are the lengths of filled runs in each row/column. Click to fill or clear."));
    const wrap = el("div", "pz-nono");
    // CSS sizes a 5-wide board; size the columns to N so larger boards render.
    wrap.style.gridTemplateColumns = `40px repeat(${N}, 40px)`;
    wrap.append(el("div", "pz-ncorner"));
    for (let col = 0; col < N; col++) {
      const cc = el("div", "pz-nclue pz-ncol");
      cc.innerHTML = colClues[col].map((n) => `<span>${n}</span>`).join("");
      wrap.append(cc);
    }
    const cellEls = [];
    for (let r = 0; r < N; r++) {
      const rc = el("div", "pz-nclue pz-nrow");
      rc.innerHTML = rowClues[r].map((n) => `<span>${n}</span>`).join("");
      wrap.append(rc);
      cellEls[r] = [];
      for (let col = 0; col < N; col++) {
        const cell = el("div", "pz-ncell");
        cell.addEventListener("click", () => {
          if (done) return;
          player[r][col] = player[r][col] ? 0 : 1;
          cell.classList.toggle("on", !!player[r][col]);
          if (solved()) { done = true; setStatus(status, "Solved! 🎉", "good"); }
        });
        wrap.append(cell);
        cellEls[r][col] = cell;
      }
    }
    const btn = button("Check");
    const status = statusLine();
    c.append(wrap, btn, status);

    function solved() {
      for (let r = 0; r < N; r++) if (!arrEq(runs(player[r]), rowClues[r])) return false;
      for (let col = 0; col < N; col++) if (!arrEq(runs(player.map((row) => row[col])), colClues[col])) return false;
      return true;
    }
    btn.addEventListener("click", () => {
      if (done) return;
      if (solved()) { done = true; setStatus(status, "Solved! 🎉", "good"); }
      else setStatus(status, "Doesn't match the clues yet.", "bad");
    });
  }

  // ========================================================
  // Hub
  // ========================================================
  // Each game carries a salt so its daily seed is independent of the others.
  const GAMES = [
    { id: "wordle", name: "Wordle", icon: "🟩", salt: 101, mount: gameWordle },
    { id: "sequence", name: "Sequence", icon: "🔢", salt: 211, mount: gameSequence },
    { id: "sudoku", name: "Mini Sudoku", icon: "🔲", salt: 337, mount: gameSudoku },
    { id: "code", name: "Code Breaker", icon: "🔐", salt: 443, mount: gameCode },
    { id: "nonogram", name: "Nonogram", icon: "🎨", salt: 569, mount: gameNonogram }
  ];

  // The single game type drawn for today. Hashing the day number scrambles the
  // rotation so consecutive days don't just cycle through the list in order.
  function todaysGame() {
    return GAMES[((DAY_NUMBER * 2654435761) >>> 0) % GAMES.length];
  }

  function mountHub(root) {
    root.innerHTML = "";

    // Exactly one puzzle per day: today's drawn game, seeded from the calendar
    // day, with no tabs or "new puzzle" control to re-roll.
    const game = todaysGame();

    const head = el("div", "pz-today");
    head.innerHTML =
      `<span class="pz-today-ico">${game.icon}</span>` +
      `<span class="pz-today-meta">` +
      `<span class="pz-today-name">${game.name}</span>` +
      `<span class="pz-today-sub">Today's draw — a different puzzle type each day. No do-overs; a fresh one unlocks tomorrow.</span>` +
      `</span>`;

    const gameWrap = el("div", "pz-game");
    root.append(head, gameWrap);

    seedFor(game.salt);
    game.mount(gameWrap);
  }

  return { GAMES, todaysGame, mountHub };
})();
