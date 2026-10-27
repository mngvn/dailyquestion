// theme.js — light / dark for the home page, following the system setting.
// The mode is reflected on <body> via the `light` class, which home.css and
// stage.js read: by candlelight in the dark, by daylight in the light.
//
// There is no toggle on the page, so a choice saved by the old one is cleared
// rather than left to pin the page to a mode it can no longer leave.

(function () {
  "use strict";

  const body = document.body;
  const mq = window.matchMedia("(prefers-color-scheme: light)");

  try { localStorage.removeItem("daily.theme.v1"); } catch (e) { /* ignore */ }

  const apply = () => body.classList.toggle("light", mq.matches);
  apply();
  mq.addEventListener("change", apply);
})();
