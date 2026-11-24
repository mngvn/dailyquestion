// crossword.js — The Daily Mini: a five-by-five crossword, new every day.
//
// The puzzle is a block of flats, five windows by five: a light goes on in
// each window as it is filled in. Today's is dealt from crossword-data.js by
// the date (deck.js), so everybody gets the same one and none comes round
// again until all of them have been used. The six days before today can be
// caught up on too, from the row of days under the title.
//
// What is kept, in localStorage under daily.cross.v1:
//
//   days     each day's grid as far as it was filled in, what was checked or
//            revealed, the time taken, and whether it was finished
//   streak   how many days running today's puzzle has been solved on its own
//            day and without a reveal (n), the last such day (last), the
//            longest run there has been (best) — and, once a run is broken,
//            how long it was and when it ended (prev), so it isn't forgotten
//   solved, clean, times, best     for the record card
//
// The home page reads the same record, to say on its hoarding how the streak
// stands (city.js).

(function () {
  "use strict";

  const DATA = window.CROSSWORDS, Deck = window.Deck;
  const $ = (id) => document.getElementById(id);
  const N = 5, KEY = "daily.cross.v1";
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!DATA || !Deck) return;

  // ----- Days -----
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
  const shift = (key, n) => { const d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d); };
  // the same number for the same calendar date wherever it is read
  const dayNum = (key) => { const [y, m, d] = key.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const today = () => keyOf(new Date());
  const clock = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
  const longDate = (key) => dateOf(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const shortDate = (key) => dateOf(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;

  // ----- The record -----
  let rec = { days: {}, streak: { n: 0, last: "", best: 0, prev: null }, solved: 0, clean: 0, times: [], best: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object") {
      rec = Object.assign(rec, saved);
      rec.streak = Object.assign({ n: 0, last: "", best: 0, prev: null }, saved.streak);
      if (!rec.days || typeof rec.days !== "object") rec.days = {};
      if (!Array.isArray(rec.times)) rec.times = [];
    }
  } catch (e) { /* ignore */ }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* ignore */ }
  }
  // A streak that was let go is not thrown away: it becomes the last one.
  function settle() {
    const s = rec.streak, t = today();
    if (s.n > 0 && s.last !== t && s.last !== shift(t, -1)) { s.prev = { n: s.n, end: s.last }; s.n = 0; }
    const old = shift(t, -45);
    for (const k of Object.keys(rec.days)) if (k < old) delete rec.days[k];
    save();
  }
  // Today's, solved today, with nothing revealed: one more day on the run.
  function credit(key) {
    const s = rec.streak;
    if (s.last === key) return;
    if (s.n > 0 && s.last === shift(key, -1)) s.n += 1;
    else {
      if (s.n > 0) s.prev = { n: s.n, end: s.last };
      s.n = 1;
    }
    s.last = key;
    s.best = Math.max(s.best || 0, s.n);
  }

  // ----- A day's puzzle -----
  function puzzle(key) {
    const n = DATA.grids.length, dn = dayNum(key);
    const idx = Deck.order(n, 41, Math.floor(dn / n))[((dn % n) + n) % n];
    const [letters, picks] = DATA.grids[idx].split("|");
    const cells = [...letters].map((ch, i) => ({ i, r: Math.floor(i / N), c: i % N, block: ch === "#", sol: ch, num: 0, A: -1, D: -1 }));
    const startA = (c) => !c.block && (c.c === 0 || cells[c.i - 1].block) && c.c < N - 1 && !cells[c.i + 1].block;
    const startD = (c) => !c.block && (c.r === 0 || cells[c.i - N].block) && c.r < N - 1 && !cells[c.i + N].block;
    let num = 0;
    for (const c of cells) if (startA(c) || startD(c)) c.num = ++num;
    const entries = [];
    for (const dir of ["A", "D"]) {
      for (const c of cells) {
        if (!(dir === "A" ? startA(c) : startD(c))) continue;
        const run = [];
        for (let k = c.i; k < N * N && !cells[k].block && (dir === "D" || Math.floor(k / N) === c.r); k += dir === "A" ? 1 : N) run.push(k);
        for (const k of run) cells[k][dir] = entries.length;
        entries.push({ dir, num: c.num, cells: run, answer: run.map((k) => cells[k].sol).join("") });
      }
    }
    // a word that is in several puzzles has several clues: which one is set down with the grid
    entries.forEach((e, j) => {
      const list = DATA.clues[e.answer] || ["(this clue has gone missing)"];
      e.clue = list[(+((picks || "")[j]) || 0) % list.length];
    });
    return { key, idx, cells, entries };
  }

  // ----- Where things stand -----
  let P = null;                 // the puzzle on the page
  let fill = [], marks = [];    // a letter per square; and "x" wrong, "c" checked and right, "r" revealed
  let at = 0, dir = "A";        // the square the cursor is on, and which way it is going
  let secs = 0, done = false, help = false, started = false, fullSaid = false;
  let lastTick = 0;

  const grid = $("grid"), toastEl = $("toast"), sheet = $("sheet");
  const locked = (i) => marks[i] === "r" || marks[i] === "c";
  const entry = () => P.entries[P.cells[at][dir]];
  const firstOpen = (e) => { const k = e.cells.find((i) => !fill[i]); return k === undefined ? e.cells[0] : k; };
  const isFull = () => P.cells.every((c, i) => c.block || fill[i]);

  function stash() {
    if (!P || (!started && !rec.days[P.key])) return;
    rec.days[P.key] = { f: fill.map((ch) => ch || ".").join(""), m: marks.map((m) => m || ".").join(""), t: Math.round(secs), done, help };
    save();
  }

  function open(key) {
    stash();
    P = puzzle(key);
    const d = rec.days[key];
    fill = P.cells.map((c, i) => (c.block ? "#" : d && d.f && /[A-Z]/.test(d.f[i] || "") ? d.f[i] : ""));
    marks = P.cells.map((c, i) => (!c.block && d && d.m && /[xcr]/.test(d.m[i] || "") ? d.m[i] : ""));
    secs = d ? d.t || 0 : 0;
    done = !!(d && d.done);
    help = !!(d && d.help);
    started = !!d;
    fullSaid = false;
    lastTick = 0;
    dir = "A";
    at = firstOpen(P.entries[0]);
    grid.classList.remove("won");
    buildGrid();
    buildClues();
    buildWeek();
    $("when").textContent = key === today() ? longDate(key) : `${longDate(key)} · an earlier puzzle`;
    paint();
    showTime();
    toast("");
  }

  // ----- Building the page -----
  let cellEls = [], clueEls = [];
  function buildGrid() {
    cellEls = P.cells.map((c) => {
      const el = document.createElement("div");
      el.className = c.block ? "cell block" : "cell";
      el.id = `cell${c.i}`;
      el.dataset.i = c.i;
      el.setAttribute("role", "gridcell");
      el.style.setProperty("--d", `${(c.r + c.c) * 70}ms`);
      if (c.block) el.setAttribute("aria-hidden", "true");
      else {
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = c.num || "";
        const let_ = document.createElement("span");
        let_.className = "let";
        el.append(num, let_);
      }
      return el;
    });
    grid.replaceChildren(...cellEls);
  }
  function buildClues() {
    clueEls = [];
    for (const [id, d] of [["across", "A"], ["down", "D"]]) {
      const list = $(id);
      list.replaceChildren();
      P.entries.forEach((e, j) => {
        if (e.dir !== d) return;
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "clue";
        const n = document.createElement("b");
        n.textContent = e.num;
        const tx = document.createElement("span");
        tx.textContent = e.clue;
        const len = document.createElement("i");
        len.textContent = ` (${e.cells.length})`;
        tx.append(len);
        b.append(n, tx);
        b.addEventListener("click", () => { goEntry(j); grid.focus({ preventScroll: true }); });
        li.append(b);
        list.append(li);
        clueEls[j] = b;
      });
    }
  }
  function buildWeek() {
    const t = today(), week = $("week");
    week.replaceChildren();
    for (let i = 6; i >= 0; i--) {
      const key = shift(t, -i), d = rec.days[key], date = dateOf(key);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day";
      b.dataset.state = d && d.done ? (d.help ? "helped" : "done") : d ? "begun" : "new";
      if (key === t) b.dataset.today = "true";
      if (key === P.key) b.setAttribute("aria-current", "true");
      const wd = document.createElement("span");
      wd.textContent = date.toLocaleDateString(undefined, { weekday: "short" });
      const dn = document.createElement("b");
      dn.textContent = date.getDate();
      b.append(wd, dn);
      const what = d && d.done ? (d.help ? "solved with a reveal" : "solved") : d ? "started" : "not started";
      b.setAttribute("aria-label", `${longDate(key)}${key === t ? ", today" : ""}: ${what}`);
      b.addEventListener("click", () => { if (key !== P.key) { open(key); grid.focus({ preventScroll: true }); } });
      week.append(b);
    }
  }

  // ----- Drawing where things stand -----
  function paint() {
    const e = entry(), other = P.entries[P.cells[at][dir === "A" ? "D" : "A"]];
    P.cells.forEach((c, i) => {
      if (c.block) return;
      const el = cellEls[i];
      el.classList.toggle("lit", !!fill[i]);
      el.classList.toggle("inword", e.cells.includes(i));
      el.classList.toggle("cursor", i === at);
      el.classList.toggle("wrong", marks[i] === "x");
      el.classList.toggle("right", marks[i] === "c");
      el.classList.toggle("shown", marks[i] === "r");
      el.lastChild.textContent = fill[i];
      const a = P.entries[c.A], d = P.entries[c.D];
      el.setAttribute("aria-label", `Row ${c.r + 1}, column ${c.c + 1}. ${fill[i] ? `Letter ${fill[i]}` : "Empty"}${marks[i] === "x" ? ", marked wrong" : ""}. ${a.num} Across: ${a.clue}. ${d.num} Down: ${d.clue}.`);
    });
    grid.setAttribute("aria-activedescendant", `cell${at}`);
    grid.dataset.dir = dir;
    clueEls.forEach((b, j) => {
      const x = P.entries[j];
      b.classList.toggle("on", x === e);
      b.classList.toggle("cross", x === other);
      b.classList.toggle("filled", x.cells.every((i) => fill[i]));
    });
    $("clueNow").replaceChildren();
    const tag = document.createElement("b");
    tag.textContent = `${e.num}${e.dir === "A" ? " Across" : " Down"}`;
    $("clueNow").append(tag, ` ${e.clue}`);
    $("streakNum").textContent = rec.streak.n;
    $("streakBtn").dataset.lit = rec.streak.n > 0 ? "true" : "false";
    document.body.dataset.done = done ? "true" : "false";
  }
  function showTime() {
    $("time").textContent = clock(secs);
  }
  let toastTimer = 0;
  function toast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.dataset.show = msg ? "true" : "false";
    if (msg) toastTimer = setTimeout(() => { toastEl.dataset.show = "false"; }, 3200);
  }

  // ----- The clock -----
  // It starts at the first letter, and stops while the page is out of sight.
  setInterval(() => {
    const now = performance.now();
    if (started && !done && !document.hidden && sheet.hidden) {
      if (lastTick) secs += Math.min(1.5, (now - lastTick) / 1000);
      lastTick = now;
      showTime();
    } else lastTick = 0;
  }, 250);
  function begin() {
    started = true;
  }

  // ----- Moving about -----
  function goEntry(j) {
    const e = P.entries[j];
    dir = e.dir;
    at = firstOpen(e);
    paint();
  }
  // on to the next word — one with room in it, if any has
  function stepEntry(step) {
    const n = P.entries.length, from = P.cells[at][dir];
    let j = from;
    for (let k = 0; k < n; k++) {
      j = (j + step + n) % n;
      if (P.entries[j].cells.some((i) => !fill[i])) return goEntry(j);
    }
    goEntry((from + step + n) % n);
  }
  function turn() {
    dir = dir === "A" ? "D" : "A";
    paint();
  }
  function arrow(dr, dc) {
    // across the way it is going: it turns, and stays where it is
    if ((dc ? "A" : "D") !== dir) return turn();
    let r = P.cells[at].r + dr, c = P.cells[at].c + dc;
    while (r >= 0 && r < N && c >= 0 && c < N && P.cells[r * N + c].block) { r += dr; c += dc; }
    if (r >= 0 && r < N && c >= 0 && c < N) at = r * N + c;
    paint();
  }

  // ----- Filling it in -----
  function type(ch) {
    if (done) return;
    begin();
    const e = entry(), pos = e.cells.indexOf(at), was = fill[at];
    if (!locked(at)) { fill[at] = ch; marks[at] = ""; }
    if (was) {
      // writing over what was there: just the next square along
      if (pos < e.cells.length - 1) at = e.cells[pos + 1];
    } else {
      // the next empty square in this word; failing that, on to the next word
      const later = e.cells.slice(pos + 1).find((i) => !fill[i]);
      const any = e.cells.find((i) => !fill[i]);
      if (later !== undefined) at = later;
      else if (any !== undefined) at = any;
      else if (!isFull()) {
        const n = P.entries.length, from = P.cells[at][dir];
        for (let k = 1; k <= n; k++) {
          const x = P.entries[(from + k) % n];
          if (x.cells.some((i) => !fill[i])) { dir = x.dir; at = firstOpen(x); break; }
        }
      }
    }
    after();
  }
  function rub() {
    if (done) return;
    if (fill[at] && !locked(at)) { fill[at] = ""; marks[at] = ""; }
    else {
      const e = entry(), pos = e.cells.indexOf(at);
      if (pos > 0) {
        at = e.cells[pos - 1];
        if (!locked(at)) { fill[at] = ""; marks[at] = ""; }
      }
    }
    after();
  }
  function after() {
    const full = isFull();
    if (full && !done) {
      if (P.cells.every((c, i) => c.block || fill[i] === c.sol)) return solved();
      if (!fullSaid) { fullSaid = true; toast("Every light is on, but something isn't right yet."); }
    } else if (!full) fullSaid = false;
    paint();
    stash();
  }

  // ----- Checking, revealing, clearing -----
  function scope(what) {
    return what === "cell" ? [at] : what === "word" ? entry().cells.slice() : P.cells.filter((c) => !c.block).map((c) => c.i);
  }
  function check(what) {
    if (done) return;
    let seen = 0, wrong = 0;
    for (const i of scope(what)) {
      if (!fill[i] || marks[i] === "r") continue;
      seen++;
      if (fill[i] === P.cells[i].sol) marks[i] = "c";
      else { marks[i] = "x"; wrong++; }
    }
    if (seen) begin();
    toast(!seen ? "Nothing there to check yet." : wrong ? `${wrong} ${wrong === 1 ? "square is" : "squares are"} wrong.` : "Right so far.");
    paint();
    stash();
  }
  function reveal(what) {
    if (done) return;
    begin();
    help = true;
    for (const i of scope(what)) {
      if (fill[i] === P.cells[i].sol) { if (!marks[i]) marks[i] = "c"; continue; }
      fill[i] = P.cells[i].sol;
      marks[i] = "r";
    }
    after();
  }
  function clearAll() {
    if (done) return;
    P.cells.forEach((c, i) => { if (!c.block && marks[i] !== "r") { fill[i] = ""; marks[i] = ""; } });
    at = firstOpen(entry());
    toast("Cleared.");
    after();
  }

  // ----- Solved -----
  function solved() {
    done = true;
    const live = P.key === today();
    rec.solved = (rec.solved || 0) + 1;
    if (!help) {
      rec.clean = (rec.clean || 0) + 1;
      rec.times.push(Math.round(secs));
      if (rec.times.length > 200) rec.times.shift();
      if (!rec.best || secs < rec.best) rec.best = Math.max(1, Math.round(secs));
    }
    if (live && !help) credit(P.key);
    paint();
    stash();
    buildWeek();
    toast("");
    grid.classList.add("won");
    setTimeout(() => showSheet("solved"), still ? 200 : 1500);
  }

  // The card: what happened just now, or the record so far.
  function showSheet(why) {
    const s = rec.streak, t = today();
    const live = P.key === t, row = $("stats");
    const mean = rec.times.length ? rec.times.reduce((a, b) => a + b, 0) / rec.times.length : 0;
    if (why === "solved") {
      $("sheetKicker").textContent = help ? "Solved, with a reveal" : live ? "Solved" : "Solved, a little late";
      $("sheetTitle").textContent = clock(secs);
      $("sheetLine").textContent = help
        ? "A reveal was used, so this one doesn't count toward your streak."
        : !live ? "Earlier puzzles don't add to the streak, but they do go on your record."
        : s.n === 1 ? "That's day one of a new streak. Come back tomorrow to keep it lit."
        : `${days(s.n)} running.${s.n === s.best ? " Your longest streak yet." : ""}`;
    } else {
      const todayDone = rec.days[t] && rec.days[t].done && !rec.days[t].help;
      $("sheetKicker").textContent = "Your record";
      $("sheetTitle").textContent = s.n > 0 ? `${s.n}-day streak` : "No streak going";
      $("sheetLine").textContent = todayDone ? "Today's is done. A new puzzle is up at midnight."
        : s.n > 0 ? `Solve today's, without a reveal, to make it ${days(s.n + 1)}.`
        : "Solve today's puzzle, without a reveal, to start one.";
    }
    const stat = (label, value) => {
      const div = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = value;
      div.append(dd, dt);
      return div;
    };
    row.replaceChildren(
      stat("Current streak", s.n),
      stat("Longest streak", s.best || 0),
      stat("Puzzles solved", rec.solved || 0),
      stat("Average time", mean ? clock(mean) : "–"),
      stat("Best time", rec.best ? clock(rec.best) : "–")
    );
    $("sheetPast").textContent = s.prev && s.prev.n > 0
      ? `Your last streak ran ${days(s.prev.n)}, and ended on ${shortDate(s.prev.end)}.` : "";
    $("shareBtn").hidden = !done;
    sheet.hidden = false;
    (done ? $("shareBtn") : $("sheetClose")).focus({ preventScroll: true });
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    grid.focus({ preventScroll: true });
  }

  function shareText() {
    const s = rec.streak, live = P.key === today();
    const lines = [`The Daily Mini · ${dateOf(P.key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`];
    lines.push(`Solved in ${clock(secs)}${help ? " (with a reveal)" : ""}${live && !help && s.n > 0 ? ` · ${s.n}-day streak` : ""}`);
    lines.push(location.href.split(/[?#]/)[0]);
    return lines.join("\n");
  }
  // navigator.clipboard is missing on insecure origins and off disk: keep the old way too
  function copy(text, btn) {
    const idle = btn.dataset.idle || btn.textContent;
    btn.dataset.idle = idle;
    const flash = (msg) => {
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = idle; }, 1600);
    };
    const old = () => {
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
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => flash("Copied!")).catch(() => flash(old() ? "Copied!" : "Copy failed"));
    } else flash(old() ? "Copied!" : "Copy failed");
  }

  // ----- Hands -----
  grid.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".cell");
    if (!el || el.classList.contains("block")) return;
    const i = +el.dataset.i;
    if (i === at) dir = dir === "A" ? "D" : "A";   // the same square again: turn the corner
    else at = i;
    paint();
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      if (!sheet.hidden) closeSheet();
      for (const m of document.querySelectorAll(".menu[open]")) m.open = false;
      return;
    }
    if (!sheet.hidden) return;
    const onControl = e.target.closest && e.target.closest("button, a, summary");
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); type(e.key.toUpperCase()); return; }
    switch (e.key) {
      case "Backspace": e.preventDefault(); rub(); break;
      case "Delete": e.preventDefault(); if (!done && !locked(at)) { fill[at] = ""; marks[at] = ""; after(); } break;
      case "ArrowLeft": e.preventDefault(); arrow(0, -1); break;
      case "ArrowRight": e.preventDefault(); arrow(0, 1); break;
      case "ArrowUp": e.preventDefault(); arrow(-1, 0); break;
      case "ArrowDown": e.preventDefault(); arrow(1, 0); break;
      case " ":
      case "Enter":
        if (onControl) return;                     // a button is being pressed, not the grid
        e.preventDefault(); turn(); break;
      case "Tab":
        // in the grid, Tab goes from word to word; anywhere else it is left alone
        if (document.activeElement !== grid) return;
        e.preventDefault(); stepEntry(e.shiftKey ? -1 : 1); break;
      default:
    }
  });

  $("prevClue").addEventListener("click", () => stepEntry(-1));
  $("nextClue").addEventListener("click", () => stepEntry(1));
  $("clueNow").addEventListener("click", turn);
  $("clearBtn").addEventListener("click", clearAll);
  for (const b of document.querySelectorAll(".menu-list button")) {
    b.addEventListener("click", () => {
      const [act, what] = b.dataset.do.split("-");
      (act === "check" ? check : reveal)(what === "all" ? "all" : what);
      b.closest(".menu").open = false;
      grid.focus({ preventScroll: true });
    });
  }
  // one menu open at a time, and a click elsewhere shuts it
  document.addEventListener("click", (e) => {
    for (const m of document.querySelectorAll(".menu[open]")) if (!m.contains(e.target)) m.open = false;
  });

  $("streakBtn").addEventListener("click", () => showSheet("record"));
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheetVeil").addEventListener("click", closeSheet);
  $("shareBtn").addEventListener("click", (e) => copy(shareText(), e.currentTarget));
  sheet.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const stops = [...sheet.querySelectorAll("a, button")].filter((x) => !x.hidden);
    const first = stops[0], end = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
  });

  // the keys for fingers
  const keys = $("keys");
  for (const row of ["QWERTYUIOP", "ASDFGHJKL", "<ZXCVBNM>"]) {
    const div = document.createElement("div");
    div.className = "keys-row";
    for (const ch of row) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key";
      b.tabIndex = -1;
      if (ch === "<") { b.textContent = "⇄"; b.dataset.k = "turn"; b.classList.add("key-wide"); b.setAttribute("aria-label", "Turn: across or down"); }
      else if (ch === ">") { b.textContent = "⌫"; b.dataset.k = "rub"; b.classList.add("key-wide"); b.setAttribute("aria-label", "Delete"); }
      else { b.textContent = ch; b.dataset.k = ch; }
      div.append(b);
    }
    keys.append(div);
  }
  keys.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".key");
    if (!b) return;
    e.preventDefault();
    const k = b.dataset.k;
    if (k === "turn") turn();
    else if (k === "rub") rub();
    else type(k);
  });

  document.addEventListener("visibilitychange", () => { if (document.hidden) stash(); });
  window.addEventListener("pagehide", stash);

  // ----- The skyline along the bottom -----
  (function backdrop() {
    const R = Deck.rng(77);
    let x = -10, out = "";
    while (x < 1600) {
      const w = 44 + R() * 90, h = 50 + R() * R() * 230, y = 300 - h;
      out += `<rect class="b${R() < 0.5 ? 1 : 2}" x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/>`;
      if (R() < 0.3) out += `<rect class="b1" x="${(x + w / 2 - 1).toFixed(0)}" y="${(y - 26).toFixed(0)}" width="2" height="26"/>`;
      for (let wy = y + 9; wy < 290; wy += 13) {
        for (let wx = x + 6; wx < x + w - 8; wx += 10) if (R() < 0.2) out += `<rect class="w" x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="4" height="6"/>`;
      }
      x += w + R() * 8 - 3;
    }
    $("backdrop").innerHTML = `<svg viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice">${out}</svg>`;
  })();

  settle();
  open(today());
  grid.focus({ preventScroll: true });

  // for looking at it from outside: tests, and the curious
  window.Cross = {
    get puzzle() { return P; },
    get record() { return rec; },
    get state() { return { fill: fill.slice(), marks: marks.slice(), at, dir, secs, done, help }; },
    open, type, rub
  };
})();
