// city.js — the home page: the city at night, from close to.
//
// skyline.js is the towers and the sky behind them; here they are kept going,
// every frame, on one canvas — and the page's few controls are laid over it:
//
//   a lit window          every so often a light comes on in one of the
//                         towers in front, and stays on for a while. Click it
//                         before it goes out for the fact inside: one of
//                         today's notes (app.js), on a card, to read or copy
//   the hoarding          on a roof: today's crossword (crossword.html)
//   the sign              down the front of a tower: the arcade, where the
//                         games are, Adrift among them (boat.js), which is
//                         laid over this page
//   a dark window         click it and somebody puts the light on for a moment
//
// Each lit window has a real button over it, so all of it can be reached from
// the keyboard too.

import { Skyline, PALETTES, clamp } from "./skyline.js";

const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const daily = window.Daily;
const $ = (id) => document.getElementById(id);

const city = $("city"), canvas = $("sky"), g = canvas.getContext("2d");
const hot = $("hot"), board = $("board"), blade = $("blade");
const fact = $("fact"), factKicker = $("factKicker"), factText = $("factText");
const arcade = $("arcade"), hint = $("hint"), say = $("say"), tally = $("tally"), masthead = $("masthead");

const READ_KEY = "daily.city.read";   // which of today's notes have been read
const CROSS_KEY = "daily.cross.v1";   // the crossword's own record (crossword.js)
const HUES = { Tech: [110, 170, 255], Art: [255, 130, 175], History: [255, 200, 90], Misc: [110, 225, 150], day: [190, 150, 255] };
const LAMP = [255, 206, 140];
const ROOMS = 6;

const sky = new Skyline(still);
let W = 0, H = 0, dpr = 1, mode = "dark";
let t = 0, last = 0, running = true, frameId = 0;
let open = null;                      // the lit window whose card is showing
let lit = [];                         // the windows with a fact in them
let lamps = [];                       // the ones you switched on yourself
let lightIn = 1.4, room = 0;
const recent = [];                    // the last few windows used, to keep off them
const pointer = { x: -1, y: -1, on: false };

// ----- What is in the windows -----
// Today's five first — those not yet read before those that have been — and
// after them the rest of the facts.
let read = [];
try {
  const saved = JSON.parse(localStorage.getItem(READ_KEY) || "null");
  if (saved && saved.day === daily.dayKey) read = saved.read;
} catch (e) { /* ignore */ }
daily.notes.forEach((n, i) => { n.index = i; n.read = read.includes(i); });
const queue = daily.notes.filter((n) => !n.read).concat(daily.notes.filter((n) => n.read), daily.more);
const nextNote = () => queue.shift() || null;

function markRead(note) {
  note.read = true;
  if (note.today) {
    try {
      localStorage.setItem(READ_KEY, JSON.stringify({ day: daily.dayKey, read: daily.notes.filter((n) => n.read).map((n) => n.index) }));
    } catch (e) { /* ignore */ }
  }
  drawTally();
}
function drawTally() {
  const done = daily.notes.filter((n) => n.read).length;
  tally.replaceChildren(...daily.notes.map((n) => {
    const i = document.createElement("i");
    i.style.setProperty("--c", HUES[n.kind].join(", "));
    i.dataset.read = n.read ? "true" : "false";
    return i;
  }));
  const s = document.createElement("span");
  s.textContent = done === daily.notes.length ? "all of today's read" : `${done} of today's ${daily.notes.length} read`;
  tally.append(s);
}

// ----- Putting the city up -----
function build() {
  W = window.innerWidth; H = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (W * H * dpr * dpr > 5.5e6) dpr = Math.max(1, Math.sqrt(5.5e6 / (W * H)));
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  mode = document.body.classList.contains("light") ? "light" : "dark";

  // what was lit goes dark, and what was in it goes back to the front of the queue
  closeFact(true);
  queue.unshift(...lit.filter((l) => !l.read).map((l) => l.note));
  for (const l of lit) l.btn.remove();
  lit = []; lamps = []; recent.length = 0;
  lightIn = 0.9;

  sky.layout(W, H, dpr, PALETTES[mode], 4000 + daily.dayNumber);
  placeSigns();
}

function placeSigns() {
  const b = sky.signs.board, s = sky.signs.blade;
  board.hidden = !b; blade.hidden = !s;
  if (b) {
    board.style.left = `${b.x}px`; board.style.top = `${b.y}px`;
    board.style.width = `${b.w}px`; board.style.height = `${b.h}px`;
    board.style.setProperty("--foot", `${b.foot}px`);
    board.style.setProperty("--fs", `${(b.w / 9.4).toFixed(1)}px`);
  }
  if (s) {
    blade.style.left = `${s.x}px`; blade.style.top = `${s.y}px`;
    blade.style.width = `${s.w}px`; blade.style.height = `${s.h}px`;
    blade.style.setProperty("--fs", `${Math.min(s.w * 0.62, s.h / 7.4).toFixed(1)}px`);
  }
}

// What the hoarding says under the crossword's name: how the streak stands.
function crossLine() {
  let line = "Today's puzzle is up";
  try {
    const rec = JSON.parse(localStorage.getItem(CROSS_KEY) || "null");
    if (rec && rec.streak) {
      const d = new Date(), pad = (n) => String(n).padStart(2, "0");
      const key = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
      const today = key(d);
      d.setDate(d.getDate() - 1);
      const alive = rec.streak.last === today || rec.streak.last === key(d);
      const n = alive ? rec.streak.n : 0;
      const done = rec.days && rec.days[today] && rec.days[today].done;
      if (done) line = n > 1 ? `Solved · ${n} days running` : "Solved today";
      else if (n > 0) line = `${n}-day streak · keep it lit`;
    }
  } catch (e) { /* ignore */ }
  $("boardLine").textContent = line;
}

// ----- Lights going on and off -----
const wanted = () => clamp(Math.round((W * H) / 210000), 3, 6);
const held = (l) => open === l || l.hover || (document.activeElement === l.btn && l.btn.matches(":focus-visible"));

function clear(win) {
  if (win.blocked || recent.includes(win)) return false;
  if (win.x < 10 || win.x + win.w > W - 10 || win.y < 10 || win.y + win.h > H - 10) return false;
  // not under the words in the corner
  const m = masthead.getBoundingClientRect();
  if (win.x < m.right + 12 && win.x + win.w > m.left - 12 && win.y + win.h > m.top - 12 && win.y < m.bottom + 12) return false;
  for (const l of lit) {
    if (l.win === win) return false;
    if (l.win.tower === win.tower && Math.abs(l.win.col - win.col) <= 1 && Math.abs(l.win.row - win.row) <= 1) return false;
  }
  return true;
}

function light() {
  const pool = sky.windows.filter(clear);
  if (!pool.length) return;
  const note = nextNote();
  if (!note) return;
  // in whichever tower has the fewest on
  const on = new Map();
  for (const l of lit) on.set(l.win.tower, (on.get(l.win.tower) || 0) + 1);
  const least = Math.min(...pool.map((w) => on.get(w.tower) || 0));
  const few = pool.filter((w) => (on.get(w.tower) || 0) === least);
  const win = few[Math.floor(Math.random() * few.length)];
  recent.push(win);
  if (recent.length > 8) recent.shift();
  room = (room + 1 + Math.floor(Math.random() * (ROOMS - 1))) % ROOMS;

  const l = { win, note, hue: HUES[note.kind], room, age: 0, life: still ? 45 : 13 + Math.random() * 8, state: "on", k: 0, hover: false, read: false };
  const b = l.btn = document.createElement("button");
  b.type = "button";
  b.className = "hot-spot hot-window";
  const padX = Math.max(0, (44 - win.w) / 2), padY = Math.max(0, (44 - win.h) / 2);
  b.style.left = `${win.x - padX}px`; b.style.top = `${win.y - padY}px`;
  b.style.width = `${win.w + padX * 2}px`; b.style.height = `${win.h + padY * 2}px`;
  b.style.setProperty("--hue", l.hue.join(", "));
  b.setAttribute("aria-haspopup", "dialog");
  b.setAttribute("aria-label", `A lit window. Read the fact inside: ${note.label}.`);
  b.addEventListener("click", () => (open === l ? closeFact() : openFact(l)));
  b.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") l.hover = true; });
  b.addEventListener("pointerleave", () => { l.hover = false; });
  hot.append(b);
  lit.push(l);
  say.textContent = `A light has come on in a window: ${note.label}.`;
}

// How bright a window is: it stutters on like a tube, and gutters before it
// goes out.
function stepLit(l, dt) {
  if (l.state === "on") {
    l.age += dt;
    const u = l.age / 0.75;
    l.k = still ? 1 : u < 0.1 ? 0.8 : u < 0.22 ? 0.08 : u < 0.36 ? 0.7 : u < 0.46 ? 0.16 : 0.74 + 0.26 * clamp((u - 0.46) / 0.54, 0, 1);
    if (u >= 1) { l.state = "lit"; l.age = 0; }
  } else if (l.state === "lit") {
    if (held(l)) l.age = Math.min(l.age, l.life - 3.2);
    else l.age += dt;
    const left = l.life - l.age;
    l.k = 1;
    if (!still && left < 2.4) {
      // about to go: it dips, and dips again
      const n = Math.sin(t * 31 + l.win.x) * Math.sin(t * 17 + l.win.y);
      l.k = n > 0.25 + left * 0.2 ? 0.35 : 1 - (2.4 - left) * 0.12;
    }
    if (left <= 0) { l.state = "out"; l.age = 0; }
  } else {
    l.age += dt;
    l.k = still ? 0 : Math.max(0, 0.7 - l.age / 0.45);
    if (l.k <= 0) l.gone = true;
  }
}

function dark(l) {
  if (open === l) closeFact(true);
  if (document.activeElement === l.btn) blade.focus({ preventScroll: true });
  l.btn.remove();
  // one of today's that nobody read comes round again before long
  if (!l.read) { if (l.note.today) queue.splice(Math.min(queue.length, 2), 0, l.note); else queue.push(l.note); }
}

// ----- The fact in a window -----
function openFact(l) {
  if (open) closeFact(true);
  open = l;
  l.read = true;
  markRead(l.note);
  const win = l.win, wx = win.x + win.w / 2, wy = win.y + win.h / 2;
  fact.style.setProperty("--hue", l.hue.join(", "));
  factKicker.textContent = l.note.label;
  factText.textContent = l.note.text;
  // on a phone it comes up from the bottom — or down from the top, if that
  // is where the window is
  fact.dataset.top = wy > H * 0.55 ? "true" : "false";
  fact.hidden = false;
  // beside the window, on whichever side has the room
  const w = fact.offsetWidth, h = fact.offsetHeight, gap = win.w / 2 + 22;
  let left = wx < W / 2 ? wx + gap : wx - gap - w;
  left = clamp(left, 16, W - w - 16);
  const top = clamp(wy - h * 0.4, 16, H - h - 16);
  fact.style.left = `${left}px`; fact.style.top = `${top}px`;
  fact.style.setProperty("--from-x", `${clamp(wx - left, 0, w)}px`);
  fact.style.setProperty("--from-y", `${clamp(wy - top, 0, h)}px`);
  fact.style.animation = "none"; void fact.offsetWidth; fact.style.animation = "";
  hint.dataset.show = "false";
  $("factClose").focus({ preventScroll: true });
}
function closeFact(quiet) {
  if (!open) return;
  const l = open;
  const inside = document.activeElement && fact.contains(document.activeElement);
  open = null;
  fact.hidden = true;
  // read, and the light goes out soon after
  if (l.state === "lit") l.age = Math.max(l.age, l.life - 1.6);
  if (!quiet && inside) l.btn.focus({ preventScroll: true });
}
$("factClose").addEventListener("click", () => closeFact());
$("factCopy").addEventListener("click", (e) => { if (open) daily.copyText(open.note.text, e.currentTarget); });

// ----- The arcade -----
function openArcade() {
  closeFact(true);
  arcade.hidden = false;
  hint.dataset.show = "false";
  arcade.querySelector(".cab").focus({ preventScroll: true });
}
function closeArcade() {
  if (arcade.hidden) return;
  arcade.hidden = true;
  blade.focus({ preventScroll: true });
}
blade.addEventListener("click", openArcade);
$("arcadeClose").addEventListener("click", closeArcade);
$("arcadeVeil").addEventListener("click", closeArcade);
// keep the keyboard inside the dialog while it is open
arcade.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const stops = [...arcade.querySelectorAll("a, button")];
  const first = stops[0], end = stops[stops.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
  else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.body.classList.contains("at-sea")) return;
  if (!arcade.hidden) closeArcade();
  else closeFact();
});

// Adrift is laid over this page: the city floods, and stops once it is under.
let sea = null;
$("playBoat").addEventListener("click", () => {
  if (sea) return;
  if (!document.querySelector('link[href="boat.css"]')) {
    for (const href of ["boat.css", "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=swap"]) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href;
      document.head.append(l);
    }
  }
  sea = import("./boat.js").then((m) => {
    arcade.hidden = true;
    m.start({
      onCovered() {
        running = false;
        cancelAnimationFrame(frameId);
        city.dataset.away = "true";
      }
    });
  }).catch(() => { sea = null; });
});

// ----- The pointer -----
canvas.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = e.pointerType !== "touch";
});
canvas.addEventListener("pointerleave", () => { pointer.on = false; });
canvas.addEventListener("pointerdown", (e) => {
  if (open) { closeFact(); return; }
  // a dark window: somebody puts the light on, has a look out, and puts it off
  const win = sky.windowAt(e.clientX, e.clientY);
  if (!win || win.blocked || lit.some((l) => l.win === win) || lamps.some((l) => l.win === win)) return;
  lamps.push({ win, age: 0, life: 1.5 + Math.random() * 1.2 });
});

// ----- Every frame -----
function frame(now) {
  frameId = 0;
  if (!running) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
  last = now;
  t += dt;

  if (lit.length < wanted() && (lightIn -= dt) <= 0) {
    light();
    lightIn = lit.length < 3 ? 0.6 : 1.2 + Math.random() * 2.4;
  }
  for (const l of lit) stepLit(l, dt);
  for (const l of lit) if (l.gone) dark(l);
  lit = lit.filter((l) => !l.gone);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  sky.draw(g, t, dt, pointer);
  for (const l of lamps) {
    l.age += dt;
    const k = still ? 1 : l.age < 0.08 ? 0.5 : l.age < 0.14 ? 0.1 : Math.min(1, (l.life - l.age) / 0.25);
    sky.drawLit(g, l.win, k * 0.9, LAMP, t, -1);
  }
  lamps = lamps.filter((l) => l.age < l.life);
  for (const l of lit) sky.drawLit(g, l.win, l.k * (l.hover || open === l ? 1 : 0.94), l.hue, t, l.room);

  frameId = requestAnimationFrame(frame);
}

function go() {
  if (running && !frameId) { last = 0; frameId = requestAnimationFrame(frame); }
}

build();
drawTally();
crossLine();
city.dataset.up = "true";
go();
setTimeout(() => { if (!open && arcade.hidden) hint.dataset.show = "true"; }, 2600);
setTimeout(() => { hint.dataset.show = "false"; }, 24000);

let resizing = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    // a phone's toolbar sliding away is not worth rebuilding the city for
    if (window.innerWidth === W && Math.abs(window.innerHeight - H) < 90 && window.innerHeight <= H) return;
    build();
  }, 180);
});
new MutationObserver(() => {
  const now = document.body.classList.contains("light") ? "light" : "dark";
  if (now !== mode) build();
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; }
  else go();
});
// coming back from the crossword by the back button: the streak may have moved on
window.addEventListener("pageshow", crossLine);

// for looking at it from outside: tests, and the curious
window.City = { sky, get lit() { return lit; }, get queue() { return queue; } };
