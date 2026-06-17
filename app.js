// app.js — Daily. Deterministic daily content + streak tracking via localStorage.

(function () {
  "use strict";

  const STORE_KEY = "daily.stats.v1";
  const now = new Date();

  // ----- Date helpers -----
  // Local-day key (YYYY-MM-DD) so "today" matches the user's calendar.
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const mmdd = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // A stable integer that increments once per local day, used to pick content.
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayNumber = Math.floor(localMidnight.getTime() / 86400000);

  // Independent index per category so they don't all rotate in lockstep.
  const pick = (arr, salt) => arr[(((dayNumber * 2654435761 + salt) >>> 0)) % arr.length];

  // ----- Header date -----
  const weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const ord = (d) => {
    const t = d % 100;
    if (t >= 11 && t <= 13) return d + "th";
    return d + ({ 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th");
  };

  document.getElementById("weekday").textContent = weekdays[now.getDay()];
  document.getElementById("dateMain").textContent = `${months[now.getMonth()]} ${ord(now.getDate())}, ${now.getFullYear()}`;
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((localMidnight - startOfYear) / 86400000);
  document.getElementById("dayCounter").textContent = `Day ${dayOfYear} of ${now.getFullYear()}`;

  // ----- Fun fact -----
  document.getElementById("factText").textContent = pick(FUN_FACTS, 11);

  // ----- Puzzle -----
  const riddle = pick(RIDDLES, 23);
  document.getElementById("puzzleText").textContent = riddle.q;
  document.getElementById("puzzleAnswer").textContent = riddle.a;

  const answerWrap = document.getElementById("puzzleAnswerWrap");
  const revealBtn = document.getElementById("revealBtn");
  revealBtn.addEventListener("click", () => {
    const open = answerWrap.classList.toggle("open");
    revealBtn.textContent = open ? "Hide answer" : "Reveal answer";
  });

  // ----- On this day -----
  const hist = HISTORY_BY_DATE[mmdd] || pick(HISTORY_FALLBACK, 41);
  document.getElementById("historyYear").textContent = hist.year;
  document.getElementById("historyText").textContent = hist.text;

  // ----- Stats store -----
  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === "object") return s;
    } catch (e) { /* ignore */ }
    return {
      lastPlayed: null,    // dayKey of the most recent day played
      streak: 0,
      bestStreak: 0,
      daysPlayed: 0,
      triviaAnswered: 0,
      triviaCorrect: 0,
      answeredToday: false,   // whether today's trivia is locked in
      answeredKey: null       // which dayKey the above flag refers to
    };
  }
  function saveStats(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  const stats = loadStats();

  // Reset the per-day "answered" flag when a new day starts.
  if (stats.answeredKey !== dayKey) {
    stats.answeredToday = false;
    stats.answeredKey = dayKey;
  }

  // Register a "play" for today (first interaction of the day updates the streak).
  function registerPlay() {
    if (stats.lastPlayed === dayKey) return; // already counted today

    const yesterday = dayNumber - 1;
    const lastNum = stats.lastPlayed
      ? Math.floor(new Date(stats.lastPlayed + "T00:00:00").getTime() / 86400000)
      : null;

    if (lastNum === yesterday) stats.streak += 1;
    else stats.streak = 1;

    stats.lastPlayed = dayKey;
    stats.daysPlayed += 1;
    if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
    saveStats(stats);
    renderStreak(true);
    renderFooter();
  }

  // ----- Trivia -----
  const trivia = pick(TRIVIA, 67);
  document.getElementById("triviaQuestion").textContent = trivia.q;
  const choicesEl = document.getElementById("choices");
  const resultEl = document.getElementById("triviaResult");
  const keys = ["A", "B", "C", "D"];

  // Deterministically shuffle choices for the day while tracking the answer.
  const order = trivia.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (((dayNumber * 6364136223 + i * 97) >>> 0)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  function lockChoices(selectedDom, correctDom) {
    [...choicesEl.children].forEach((c) => c.classList.add("disabled"));
    correctDom.classList.add("correct");
    if (selectedDom && selectedDom !== correctDom) selectedDom.classList.add("wrong");
  }

  order.forEach((origIdx, slot) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.innerHTML = `<span class="key">${keys[slot]}</span><span>${trivia.choices[origIdx]}</span>`;
    btn.addEventListener("click", () => {
      if (stats.answeredToday) return;
      const correct = origIdx === trivia.correct;
      const correctDom = [...choicesEl.children].find(
        (c, i) => order[i] === trivia.correct
      );
      lockChoices(btn, correctDom);

      stats.answeredToday = true;
      stats.answeredKey = dayKey;
      stats.triviaAnswered += 1;
      if (correct) stats.triviaCorrect += 1;
      saveStats(stats);

      resultEl.classList.add("show", correct ? "good" : "bad");
      resultEl.textContent = correct
        ? "Correct! Nicely done. 🎉"
        : `Not quite — the answer is "${trivia.choices[trivia.correct]}".`;

      registerPlay();
      renderFooter();
      renderAccuracy();
      if (correct) burstConfetti();
    });
    choicesEl.appendChild(btn);
  });

  // If already answered today, show the locked state on load.
  if (stats.answeredToday) {
    const correctDom = [...choicesEl.children].find((c, i) => order[i] === trivia.correct);
    lockChoices(null, correctDom);
    resultEl.classList.add("show", "good");
    resultEl.textContent = "You've already played today's trivia. Come back tomorrow!";
  }

  // ----- Renderers -----
  const streakNumEl = document.getElementById("streakNum");
  const flameEl = document.getElementById("flame");

  function renderStreak(animate) {
    streakNumEl.textContent = stats.streak;
    flameEl.classList.toggle("lit", stats.streak > 0);
    if (animate) {
      streakNumEl.classList.remove("flash");
      void streakNumEl.offsetWidth; // reflow to restart animation
      streakNumEl.classList.add("flash");
    }
  }

  function renderFooter() {
    document.getElementById("statPlayed").textContent = stats.daysPlayed;
    document.getElementById("statBest").textContent = stats.bestStreak;
    document.getElementById("statCorrect").textContent = stats.triviaCorrect;
    const acc = stats.triviaAnswered
      ? Math.round((stats.triviaCorrect / stats.triviaAnswered) * 100) + "%"
      : "—";
    document.getElementById("statAccuracy").textContent = acc;
  }

  function renderAccuracy() {
    const tag = document.getElementById("accuracyTag");
    if (stats.triviaAnswered > 0) {
      const acc = Math.round((stats.triviaCorrect / stats.triviaAnswered) * 100);
      tag.textContent = `${stats.triviaCorrect}/${stats.triviaAnswered} · ${acc}%`;
    } else {
      tag.textContent = "new";
    }
  }

  // ----- Copy fact -----
  document.getElementById("copyFact").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const text = document.getElementById("factText").textContent;
    navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    }).catch(() => {
      btn.textContent = "Copy failed";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
  });

  // ----- Confetti -----
  function burstConfetti() {
    const layer = document.getElementById("confetti");
    const colors = ["#7c5cff", "#00e0c6", "#ff5c9c", "#ffd86b", "#2fe089"];
    const count = 90;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2 + Math.random() * 1.8 + "s";
      p.style.animationDelay = Math.random() * 0.3 + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      if (Math.random() > 0.5) p.style.borderRadius = "50%";
      layer.appendChild(p);
      setTimeout(() => p.remove(), 4200);
    }
  }

  // ----- Popular trivia vault -----
  const vaultList = document.getElementById("vaultList");
  if (vaultList && typeof POPULAR_TRIVIA !== "undefined") {
    POPULAR_TRIVIA.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "vault-item";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-expanded", "false");
      row.style.setProperty("--vi", idx);
      row.innerHTML =
        `<span class="vault-num">${String(idx + 1).padStart(2, "0")}</span>` +
        `<span class="vault-q">${item.q}</span>` +
        `<span class="vault-chev">▾</span>` +
        `<div class="vault-a-wrap"><span class="vault-a">${item.a}</span></div>`;
      const toggle = () => {
        const open = row.classList.toggle("open");
        row.setAttribute("aria-expanded", open ? "true" : "false");
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
      vaultList.appendChild(row);
    });
  }

  // ----- Init -----
  renderStreak(false);
  renderFooter();
  renderAccuracy();

  // Visiting counts as playing — register on first load of the day.
  registerPlay();
})();
