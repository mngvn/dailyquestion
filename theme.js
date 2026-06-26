// theme.js — light / dark mode toggle for the home page. Persists the choice
// to localStorage and reflects it on <body> via the `light` class. The default
// remains the near-black dark theme; light mode is opt-in and tuned in
// styles.css so modal text stays readable.

(function () {
  "use strict";

  const KEY = "daily.theme.v1";
  const btn = document.getElementById("themeToggle");
  const body = document.body;

  function apply(theme) {
    const light = theme === "light";
    body.classList.toggle("light", light);
    if (btn) {
      btn.textContent = light ? "☀️" : "🌙";
      btn.setAttribute("aria-pressed", String(light));
      btn.title = light ? "Switch to dark mode" : "Switch to light mode";
    }
  }

  let theme = "dark";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (e) { /* ignore */ }
  apply(theme);

  if (btn) {
    btn.addEventListener("click", () => {
      theme = body.classList.contains("light") ? "dark" : "light";
      apply(theme);
      try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore */ }
    });
  }
})();
