// app.js — Daily. Works out today's date and today's notes: four fun facts,
// one from each category, and what happened on this date. desk.js writes them
// on the crumpled notes and puts them on the desk; it reads them from
// window.Daily, since module scripts always run after the classic ones.

(function () {
  "use strict";

  const now = new Date();

  // ----- Date helpers -----
  // Local-day key (YYYY-MM-DD) so "today" matches the user's calendar.
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const mmdd = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // A stable integer that increments once per local day, used to pick content.
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayNumber = Math.floor(localMidnight.getTime() / 86400000);

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ord = (d) => {
    const t = d % 100;
    if (t >= 11 && t <= 13) return d + "th";
    return d + ({ 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th");
  };

  const shortDate = `${months[now.getMonth()].slice(0, 3)} ${now.getDate()}`;
  const histDate = `${months[now.getMonth()]} ${ord(now.getDate())}`;

  const dateEl = document.getElementById("date");
  if (dateEl) dateEl.textContent = `${weekdays[now.getDay()]}, ${histDate}, ${now.getFullYear()}`;

  // ----- Today's notes -----
  // Four facts a day, one per category, each dealt off its own deck so a fact
  // is only seen again once its whole category has been used (see deck.js).
  const FACT_CATS = ["Tech", "Art", "History", "Misc"];
  const facts = FACT_CATS
    .map((cat, i) => Deck.deal(FUN_FACTS.filter((f) => f.cat === cat), 11 + i, dayNumber))
    .filter(Boolean);
  // Every date of the year has an entry.
  const hist = HISTORY_BY_DATE[mmdd] || null;

  // ----- Copying a note -----
  // navigator.clipboard is undefined on insecure origins (and when the page is
  // opened straight off disk), so keep the old execCommand path as a fallback.
  function legacyCopy(text) {
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
  }

  // Copies `text` and says so on the button that asked, then puts its label back.
  function copyText(text, btn) {
    const idle = btn.dataset.idle || btn.textContent;
    btn.dataset.idle = idle;
    const flash = (msg) => {
      btn.textContent = msg;
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = idle; btn.classList.remove("copied"); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flash("Copied!"))
        .catch(() => flash(legacyCopy(text) ? "Copied!" : "Copy failed"));
    } else {
      flash(legacyCopy(text) ? "Copied!" : "Copy failed");
    }
  }

  window.Daily = Object.freeze({
    facts: facts.slice(),
    hist,
    histDate,
    shortDate,
    dayKey,
    copyText
  });
})();
