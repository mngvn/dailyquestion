// app.js — Daily. Deterministic daily content, modal sections, and streak
// tracking via localStorage.

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
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
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

  // ----- Today's content (computed once) -----
  const fact = pick(FUN_FACTS, 11);
  const riddle = pick(RIDDLES, 23);
  const hist = HISTORY_BY_DATE[mmdd] || pick(HISTORY_FALLBACK, 41);
  const trivia = pick(TRIVIA, 67);
  const keys = ["A", "B", "C", "D"];
  let puzzleRevealed = false; // session-only UI state

  // Deterministically shuffle trivia choices for the day, tracking the answer.
  const order = trivia.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (((dayNumber * 6364136223 + i * 97) >>> 0)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

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

  function accuracyPct() {
    return stats.triviaAnswered
      ? Math.round((stats.triviaCorrect / stats.triviaAnswered) * 100)
      : null;
  }

  function renderFooter() {
    document.getElementById("statPlayed").textContent = stats.daysPlayed;
    document.getElementById("statBest").textContent = stats.bestStreak;
    document.getElementById("statCorrect").textContent = stats.triviaCorrect;
    const a = accuracyPct();
    document.getElementById("statAccuracy").textContent = a === null ? "—" : a + "%";
  }

  // ----- Card state -----
  // Card previews are static teasers (set in HTML) describing each section;
  // the actual content only appears inside the modal. Only the trivia card
  // reflects per-day state (played vs. new).
  function refreshCards() {
    const badge = document.getElementById("triviaBadge");
    const cta = document.getElementById("triviaCta");
    if (stats.answeredToday) {
      badge.textContent = "✓ Played";
      badge.classList.add("done");
      cta.innerHTML = "View result <span class=\"cta-arrow\">↗</span>";
    } else {
      badge.textContent = "New";
      badge.classList.remove("done");
      cta.innerHTML = "Tap to play <span class=\"cta-arrow\">↗</span>";
    }
  }

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

  // ----- Section content builders (rendered into the modal body) -----
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildFact(body) {
    body.append(el("p", "modal-text", fact));
    const foot = el("div", "modal-foot");
    const btn = el("button", "ghost-btn", "Copy");
    btn.type = "button";
    btn.addEventListener("click", () => {
      navigator.clipboard?.writeText(fact).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      }).catch(() => {
        btn.textContent = "Copy failed";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      });
    });
    foot.append(btn);
    body.append(foot);
  }

  function buildPuzzle(body) {
    body.append(el("p", "modal-text", riddle.q));

    const wrap = el("div", "answer-wrap");
    const reveal = el("div", "answer-reveal", riddle.a);
    wrap.append(reveal);
    if (puzzleRevealed) wrap.classList.add("open");

    const foot = el("div", "modal-foot");
    const btn = el("button", "ghost-btn", puzzleRevealed ? "Hide answer" : "Reveal answer");
    btn.type = "button";
    btn.addEventListener("click", () => {
      const open = wrap.classList.toggle("open");
      puzzleRevealed = open;
      btn.textContent = open ? "Hide answer" : "Reveal answer";
    });
    foot.append(btn);
    body.append(wrap, foot);
  }

  function buildHistory(body) {
    body.append(el("div", "history-year", String(hist.year)));
    body.append(el("p", "modal-text", hist.text));
  }

  function lockChoices(container, selectedDom, correctDom) {
    [...container.children].forEach((c) => c.classList.add("disabled"));
    if (correctDom) correctDom.classList.add("correct");
    if (selectedDom && selectedDom !== correctDom) selectedDom.classList.add("wrong");
  }

  function buildTrivia(body) {
    body.append(el("p", "modal-text trivia-q", trivia.q));

    const choices = el("div", "choices");
    const result = el("div", "trivia-result");

    const findCorrect = () =>
      [...choices.children].find((c, i) => order[i] === trivia.correct);

    order.forEach((origIdx, slot) => {
      const btn = el("div", "choice");
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
      btn.innerHTML = `<span class="key">${keys[slot]}</span><span>${trivia.choices[origIdx]}</span>`;

      const answer = () => {
        if (stats.answeredToday) return;
        const correct = origIdx === trivia.correct;
        lockChoices(choices, btn, findCorrect());

        stats.answeredToday = true;
        stats.answeredKey = dayKey;
        stats.triviaAnswered += 1;
        if (correct) stats.triviaCorrect += 1;
        saveStats(stats);

        result.classList.add("show", correct ? "good" : "bad");
        result.textContent = correct
          ? "Correct! Nicely done. 🎉"
          : `Not quite — the answer is "${trivia.choices[trivia.correct]}".`;

        registerPlay();
        renderFooter();
        refreshCards();
        if (correct) burstConfetti();
      };

      btn.addEventListener("click", answer);
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); answer(); }
      });
      choices.append(btn);
    });

    // Already played today → show the locked state.
    if (stats.answeredToday) {
      lockChoices(choices, null, findCorrect());
      result.classList.add("show", "good");
      result.textContent = "You've already played today's trivia. Come back tomorrow!";
    }

    body.append(choices, result);

    const a = accuracyPct();
    if (a !== null) {
      body.append(el("div", "modal-note", `Your accuracy: ${stats.triviaCorrect}/${stats.triviaAnswered} · ${a}%`));
    }
  }

  const SECTIONS = {
    fact: { icon: "💡", title: "Fun Fact", build: buildFact },
    puzzle: { icon: "🧩", title: "Daily Puzzle", build: buildPuzzle },
    history: { icon: "📜", title: "On This Day", build: buildHistory },
    trivia: { icon: "🎯", title: "Trivia", build: buildTrivia }
  };

  // ----- Modal controller -----
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  const modalClose = document.getElementById("modalClose");
  const modalIcon = document.getElementById("modalIcon");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  let lastFocused = null;
  let currentSection = null;

  function openModal(id) {
    const section = SECTIONS[id];
    if (!section) return;
    currentSection = id;
    lastFocused = document.activeElement;

    modal.dataset.section = id;
    modalIcon.textContent = section.icon;
    modalTitle.textContent = section.title;
    modalBody.innerHTML = "";
    section.build(modalBody);
    modalBody.scrollTop = 0;

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    // focus the close button after the open transition begins
    requestAnimationFrame(() => modalClose.focus());
  }

  function closeModal() {
    if (!overlay.classList.contains("open")) return;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    currentSection = null;

    // Persist any results gathered while the modal was open, then sync the UI.
    saveStats(stats);
    refreshCards();
    renderFooter();

    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  modalClose.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(); // click on backdrop only
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // Wire each card to open its section.
  document.querySelectorAll(".card[data-section]").forEach((card) => {
    const id = card.getAttribute("data-section");
    card.addEventListener("click", () => openModal(id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(id); }
    });
  });

  // ----- Popular trivia vault -----
  const vaultList = document.getElementById("vaultList");
  if (vaultList && typeof POPULAR_TRIVIA !== "undefined") {
    POPULAR_TRIVIA.forEach((item, idx) => {
      const row = el("div", "vault-item");
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
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
      vaultList.appendChild(row);
    });
  }

  // ----- Init -----
  renderStreak(false);
  renderFooter();
  refreshCards();

  // Visiting counts as playing — register on first load of the day.
  registerPlay();
})();
