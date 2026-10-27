// props.js — the things on the cartographer's desk, drawn as SVG.
//
// Each function returns markup for one object, seen from above as if the desk
// were photographed flat. The strings are fixed artwork, never built from
// content, so app.js can set them as innerHTML. The globe and the sea chart
// borrow the coastlines from places.js (Natural Earth, public domain).
//
// Exposes DeskProps.{ globe, bottle, spyglass, compass, quill, chart }.

const DeskProps = (function () {
  "use strict";

  let uid = 0;
  const id = (name) => `dp-${name}-${++uid}`;
  const world = () => (typeof WORLD !== "undefined" ? WORLD.d : "");

  // An antique terrestrial globe in its brass meridian ring. The land turns
  // slowly underneath a fixed shading, which is what makes it read as round.
  function globe() {
    const clip = id("clip"), sea = id("sea"), shade = id("shade");
    const k = 0.62;                       // map scale: 720 → 446 units a turn
    const land = `<path d="${world()}" />`;
    return `
<svg class="globe" viewBox="0 0 200 200" aria-hidden="true">
  <defs>
    <clipPath id="${clip}"><circle cx="100" cy="100" r="76"/></clipPath>
    <radialGradient id="${sea}" cx="42%" cy="38%" r="70%">
      <stop offset="0" stop-color="#e3d3a3"/><stop offset="1" stop-color="#b59d68"/>
    </radialGradient>
    <radialGradient id="${shade}" cx="36%" cy="32%" r="75%">
      <stop offset="0" stop-color="#fff8e0" stop-opacity="0.45"/>
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#1a0f05" stop-opacity="0.7"/>
    </radialGradient>
  </defs>
  <ellipse cx="104" cy="108" rx="86" ry="84" fill="rgba(0,0,0,0.35)" filter="blur(6px)"/>
  <g clip-path="url(#${clip})">
    <rect x="0" y="0" width="200" height="200" fill="url(#${sea})"/>
    <g transform="translate(0 ${(100 - 168 * k).toFixed(1)}) scale(${k})">
      <g class="globe-spin" fill="#a8864e" stroke="#4a3210" stroke-width="0.9">${land}<g transform="translate(720 0)">${land}</g></g>
    </g>
    <g fill="none" stroke="#5a3c17" stroke-opacity="0.35" stroke-width="0.6">
      <ellipse cx="100" cy="100" rx="26" ry="76"/><ellipse cx="100" cy="100" rx="52" ry="76"/>
      <line x1="100" y1="24" x2="100" y2="176"/>
      <line x1="24" y1="100" x2="176" y2="100" stroke-dasharray="2 2"/>
      <path d="M30 70 Q100 82 170 70 M30 130 Q100 118 170 130"/>
    </g>
    <circle cx="100" cy="100" r="76" fill="url(#${shade})"/>
  </g>
  <circle cx="100" cy="100" r="82" fill="none" stroke="#7a5a22" stroke-width="7"/>
  <circle cx="100" cy="100" r="82" fill="none" stroke="#e9c978" stroke-width="2.4" stroke-dasharray="1 5"/>
  <circle cx="100" cy="100" r="86" fill="none" stroke="#3a2608" stroke-width="1"/>
</svg>`;
  }

  // A message in a bottle: green glass, a cork, a rolled letter inside.
  function bottle() {
    const glass = id("glass"), paper = id("paper");
    return `
<svg class="bottle" viewBox="0 0 240 110" aria-hidden="true">
  <defs>
    <linearGradient id="${glass}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fd0b8" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="#3f7f68" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#1e4a3c" stop-opacity="0.75"/>
    </linearGradient>
    <linearGradient id="${paper}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f3e4bb"/><stop offset="0.5" stop-color="#e2cc93"/><stop offset="1" stop-color="#b99a5c"/>
    </linearGradient>
  </defs>
  <ellipse cx="118" cy="92" rx="104" ry="10" fill="rgba(0,0,0,0.35)" filter="blur(5px)"/>
  <rect x="44" y="38" width="104" height="34" rx="10" fill="url(#${paper})"/>
  <path d="M60 38v34M132 38v34" stroke="#9c7c40" stroke-width="1" opacity="0.6"/>
  <rect x="94" y="36" width="5" height="38" fill="#8e2a1e"/>
  <path d="M20 55 C20 24 34 20 60 20 H150 C168 20 174 36 186 40 H204 V70 H186 C174 74 168 90 150 90 H60 C34 90 20 86 20 55 Z"
        fill="url(#${glass})" stroke="#163a2e" stroke-opacity="0.7" stroke-width="1.5"/>
  <rect x="202" y="38" width="8" height="34" rx="2" fill="#4f8a72" stroke="#163a2e" stroke-opacity="0.6"/>
  <rect x="210" y="41" width="20" height="28" rx="4" fill="#9b6b3b" stroke="#5a3a1a"/>
  <path d="M214 46h12M214 52h12M214 58h12M214 64h12" stroke="#6e4826" stroke-width="1"/>
  <path d="M36 30 C70 24 120 24 150 26" stroke="#fff" stroke-opacity="0.55" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M30 76 C60 84 110 84 140 82" stroke="#fff" stroke-opacity="0.18" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`;
  }

  // A brass spyglass with a leather grip, drawn out to three draws.
  function spyglass() {
    const brass = id("brass"), leather = id("leather");
    const tube = (x, w, h, fill) =>
      `<rect x="${x}" y="${50 - h / 2}" width="${w}" height="${h}" rx="2" fill="${fill}"/>`;
    const band = (x, h) =>
      `<rect x="${x}" y="${50 - h / 2 - 1}" width="5" height="${h + 2}" rx="1.5" fill="url(#${brass})" stroke="#4a3210" stroke-width="0.6"/>`;
    return `
<svg class="spyglass" viewBox="0 0 280 100" aria-hidden="true">
  <defs>
    <linearGradient id="${brass}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5e4114"/><stop offset="0.3" stop-color="#f6dc8e"/>
      <stop offset="0.55" stop-color="#b98c35"/><stop offset="1" stop-color="#4c3410"/>
    </linearGradient>
    <linearGradient id="${leather}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a2212"/><stop offset="0.4" stop-color="#7b4a28"/><stop offset="1" stop-color="#2a170b"/>
    </linearGradient>
  </defs>
  <ellipse cx="146" cy="80" rx="126" ry="9" fill="rgba(0,0,0,0.35)" filter="blur(5px)"/>
  ${tube(14, 34, 18, `url(#${brass})`)}${band(12, 18)}
  ${tube(46, 58, 24, `url(#${brass})`)}${band(44, 24)}
  ${tube(102, 66, 30, `url(#${brass})`)}${band(100, 30)}
  ${tube(118, 46, 31, `url(#${leather})`)}
  <path d="M120 36v28M128 36v28M136 36v28M144 36v28M152 36v28M160 36v28" stroke="#24130a" stroke-opacity="0.5" stroke-width="0.8"/>
  ${tube(166, 74, 36, `url(#${brass})`)}${band(164, 36)}
  <path d="M238 30 L262 24 V76 L238 70 Z" fill="url(#${brass})" stroke="#4a3210" stroke-width="0.8"/>
  <ellipse cx="262" cy="50" rx="4" ry="26" fill="#1b2a30" stroke="#d9b866" stroke-width="1.5"/>
  <ellipse cx="261" cy="42" rx="1.4" ry="7" fill="#cfe6ee" opacity="0.6"/>
</svg>`;
  }

  // A pocket compass. Its needle is turned by candle.js to face the pointer.
  function compass() {
    const face = id("face"), brass = id("cbrass");
    const ticks = Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      const r1 = i % 8 === 0 ? 50 : i % 4 === 0 ? 54 : 57;
      const x1 = 70 + Math.sin(a) * r1, y1 = 70 - Math.cos(a) * r1;
      const x2 = 70 + Math.sin(a) * 60, y2 = 70 - Math.cos(a) * 60;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }).join("");
    return `
<svg class="compass" viewBox="0 0 140 140" aria-hidden="true">
  <defs>
    <radialGradient id="${face}" cx="45%" cy="40%" r="70%">
      <stop offset="0" stop-color="#f6ecd2"/><stop offset="1" stop-color="#d5c193"/>
    </radialGradient>
    <linearGradient id="${brass}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4d88a"/><stop offset="0.5" stop-color="#9c7428"/><stop offset="1" stop-color="#5a3f12"/>
    </linearGradient>
  </defs>
  <circle cx="73" cy="74" r="68" fill="rgba(0,0,0,0.35)" filter="blur(5px)"/>
  <circle cx="70" cy="70" r="68" fill="url(#${brass})"/>
  <circle cx="70" cy="70" r="61" fill="url(#${face})" stroke="#4a3210" stroke-width="1"/>
  <g stroke="#3b2a12" stroke-width="1">${ticks}</g>
  <path d="M70 18 L76 64 L70 70 L64 64 Z M70 122 L76 76 L70 70 L64 76 Z M18 70 L64 64 L70 70 L64 76 Z M122 70 L76 64 L70 70 L76 76 Z"
        fill="#3b2a12" opacity="0.25"/>
  <text x="70" y="38" text-anchor="middle" font-family="IM Fell English SC, serif" font-size="12" fill="#7d1d12">N</text>
  <g class="compass-needle">
    <path d="M70 26 L76 70 L64 70 Z" fill="#9b2516"/>
    <path d="M70 114 L76 70 L64 70 Z" fill="#2c2a28"/>
    <circle cx="70" cy="70" r="5" fill="url(#${brass})" stroke="#4a3210"/>
  </g>
  <circle cx="54" cy="50" r="30" fill="#fff" opacity="0.12"/>
</svg>`;
  }

  // An inkwell and a quill laid across the corner of the chart.
  function quill() {
    const ink = id("ink"), feather = id("feather");
    return `
<svg class="quill" viewBox="0 0 180 160" aria-hidden="true">
  <defs>
    <radialGradient id="${ink}" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#3b3f52"/><stop offset="0.6" stop-color="#0d0f18"/><stop offset="1" stop-color="#05060a"/>
    </radialGradient>
    <linearGradient id="${feather}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8f2e4"/><stop offset="1" stop-color="#c9bba0"/>
    </linearGradient>
  </defs>
  <circle cx="58" cy="104" r="40" fill="rgba(0,0,0,0.35)" filter="blur(5px)"/>
  <circle cx="54" cy="100" r="40" fill="#2a2a33" stroke="#0b0b10" stroke-width="2"/>
  <circle cx="54" cy="100" r="30" fill="url(#${ink})"/>
  <circle cx="54" cy="100" r="16" fill="#05060a" stroke="#4a4d60" stroke-width="2"/>
  <ellipse cx="44" cy="88" rx="9" ry="5" fill="#fff" opacity="0.18"/>
  <path d="M58 98 C88 70 120 38 170 8 C150 34 128 60 98 84 C86 92 72 98 58 98 Z" fill="url(#${feather})" stroke="#8d7b5c" stroke-width="0.8"/>
  <path d="M58 98 L170 8" stroke="#8d7b5c" stroke-width="1.2"/>
  <path d="M90 74 L104 70 M104 62 L118 58 M118 50 L132 46 M132 38 L146 33 M80 82 L84 92 M96 68 L100 80 M112 56 L116 68"
        stroke="#a8977a" stroke-width="0.7"/>
</svg>`;
  }

  // The sea chart the notes lie on: faded coastlines, rhumb lines fanning out
  // from two wind roses, and a cartouche in the corner.
  function rose(cx, cy, r) {
    const lines = Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      const x = cx + Math.cos(a) * 2000, y = cy + Math.sin(a) * 2000;
      const color = i % 4 === 0 ? "#7d1d12" : i % 2 === 0 ? "#2e5a3a" : "#3b2a12";
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(0)}" y2="${y.toFixed(0)}" stroke="${color}"/>`;
    }).join("");
    const pt = (a, d) => `${(cx + Math.cos(a) * d).toFixed(1)} ${(cy + Math.sin(a) * d).toFixed(1)}`;
    const star = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const tip = pt(a, i % 2 === 0 ? r : r * 0.6);
      return `<path d="M${cx} ${cy}L${pt(a - 0.4, r * 0.16)}L${tip}Z" fill="#3b2a12"/>` +
             `<path d="M${cx} ${cy}L${pt(a + 0.4, r * 0.16)}L${tip}Z" fill="#e9dcb8" stroke="#3b2a12" stroke-width="0.8"/>`;
    }).join("");
    return { lines, star };
  }

  function chart() {
    const a = rose(330, 380, 70), b = rose(980, 220, 46);
    return `
<svg class="chart-art" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <g stroke-width="0.6" opacity="0.28">${a.lines}${b.lines}</g>
  <g transform="translate(-40 60) scale(1.75)" fill="#8a6a3a" fill-opacity="0.16" stroke="#5a3c17" stroke-opacity="0.45" stroke-width="0.5">
    <path d="${world()}"/>
  </g>
  <g opacity="0.75">${a.star}<circle cx="330" cy="380" r="16" fill="none" stroke="#3b2a12"/></g>
  <g opacity="0.6">${b.star}</g>
  <g transform="translate(860 640)">
    <rect x="0" y="0" width="300" height="110" rx="6" fill="#efe2bf" stroke="#3b2a12" stroke-width="1.5"/>
    <rect x="8" y="8" width="284" height="94" rx="4" fill="none" stroke="#3b2a12" stroke-width="0.7"/>
    <text x="150" y="52" text-anchor="middle" font-family="IM Fell English SC, serif" font-size="30" fill="#3b2a12">Carta Diurna</text>
    <text x="150" y="80" text-anchor="middle" font-family="IM Fell English, serif" font-style="italic" font-size="15" fill="#5a3c17">a chart of the day, drawn anew each midnight</text>
  </g>
</svg>`;
  }

  return { globe, bottle, spyglass, compass, quill, chart };
})();
