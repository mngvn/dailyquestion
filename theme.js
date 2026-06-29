// theme.js — light / dark mode for the home page. The choice is persisted to
// localStorage; with no saved choice we follow the OS preference. The mode is
// reflected on <body> via the `light` class and read by styles.css, trail.js
// and events.js so the whole page (and its effects) adapt.

(function () {
  "use strict";

  const KEY = "daily.theme.v1";
  const btn = document.getElementById("themeToggle");
  const body = document.body;
  const mq = window.matchMedia("(prefers-color-scheme: light)");

  function apply(theme) {
    const light = theme === "light";
    body.classList.toggle("light", light);
    if (btn) {
      btn.textContent = light ? "☀️" : "🌙";
      btn.setAttribute("aria-pressed", String(light));
      btn.title = light ? "Switch to dark mode" : "Switch to light mode";
    }
  }

  function saved() {
    try {
      const s = localStorage.getItem(KEY);
      if (s === "light" || s === "dark") return s;
    } catch (e) { /* ignore */ }
    return null;
  }

  // initial: explicit choice wins, otherwise mirror the system setting
  apply(saved() || (mq.matches ? "light" : "dark"));

  // allow a brief cross-fade only after first paint (avoids a flash on load)
  requestAnimationFrame(() => body.classList.add("theme-ready"));

  if (btn) {
    btn.addEventListener("click", () => {
      const next = body.classList.contains("light") ? "dark" : "light";
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    });
  }

  // if the user hasn't chosen explicitly, keep following the OS
  mq.addEventListener("change", (e) => {
    if (!saved()) apply(e.matches ? "light" : "dark");
  });
})();
