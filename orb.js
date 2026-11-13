// orb.js — the home page: a spider's web in the wind.
//
// This is where it is all put together and kept going. scene.js is the wind,
// the sky and the plants; silk.js the web strung between them; spider.js the
// spider on it; flies.js the flies that end up in it. Here they are stepped
// and drawn, every frame, on one canvas — and the page's few controls are
// laid over it:
//
//   a fly that is stuck   click it for what it was carrying: one of today's
//                         notes (app.js), on a card beside it
//   the spider            click it for its larder: the games, Adrift among
//                         them (boat.js), which is laid over this page
//   the web itself        the pointer stirs it as it passes; click to pluck it
//
// The spider and each caught fly has a real button over it, moved about with
// it, so all of it can be reached from the keyboard too.

import { Web, Eye } from "./silk.js";
import { Scene, Wind, PALETTES } from "./scene.js";
import { Spider } from "./spider.js";
import { Flies } from "./flies.js";

const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const daily = window.Daily;
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

const glade = $("glade"), canvas = $("web"), g = canvas.getContext("2d");
const hot = $("hot"), spiderBtn = $("spiderBtn");
const fact = $("fact"), factKicker = $("factKicker"), factText = $("factText");
const larder = $("larder"), hint = $("hint"), say = $("say"), tally = $("tally");

const SPIN_S = 2.8;                 // how long the web takes to arrive
const READ_KEY = "daily.web.read";  // which of today's notes have been read

const wind = new Wind(still), scene = new Scene(wind), eye = new Eye(), web = new Web();
let W = 0, H = 0, dpr = 1, P = PALETTES.dark, mode = "dark";
let spider = null, flies = null;
let t = 0, last = 0, shown = still ? 1 : 0, running = true, frameId = 0;
let open = null;                    // the fly whose card is showing
const pointer = { x: -1, y: -1, px: -1, py: -1, on: false };
const buttons = new Map();          // fly → its button

// ----- What the flies carry -----
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
const RGB = { Tech: "110, 170, 255", Art: "255, 130, 175", History: "255, 200, 90", Misc: "110, 225, 150", day: "190, 150, 255" };
function drawTally() {
  const done = daily.notes.filter((n) => n.read).length;
  tally.replaceChildren(...daily.notes.map((n) => {
    const i = document.createElement("i");
    i.style.setProperty("--c", RGB[n.kind]);
    i.dataset.read = n.read ? "true" : "false";
    return i;
  }));
  const s = document.createElement("span");
  s.textContent = done === daily.notes.length ? "all of today's read" : `${done} of today's ${daily.notes.length} read`;
  tally.append(s);
}

// ----- Stringing it all up -----
function build() {
  W = window.innerWidth; H = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (W * H * dpr * dpr > 5.5e6) dpr = Math.max(1, Math.sqrt(5.5e6 / (W * H)));
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  mode = document.body.classList.contains("light") ? "light" : "dark";
  P = PALETTES[mode];
  scene.layout(W, H, P, 5);
  eye.cx = W / 2; eye.cy = H / 2;
  web.build({ W, H, hub: scene.hub, anchors: scene.anchors, seed: 1000 + daily.dayNumber, k: scene.k });
  spider = new Spider(web, eye, scene.k);
  spiderBtn.style.setProperty("--d", `${Math.round(Math.max(48, spider.S * 1.35))}px`);

  // any flies already in the web go back into the new one
  const kept = flies ? flies.list.filter((f) => f.note && f.state !== "falling" && f.state !== "wrapped") : [];
  for (const b of buttons.values()) b.remove();
  buttons.clear();
  closeFact(true);
  flies = new Flies({ web, eye, k: scene.k, W, H, notes: nextNote, onCaught, still });
  for (const f of kept) {
    if (f.state === "dive") { queue.unshift(f.note); continue; }
    const n = flies.place(f.note, f.read);
    if (n) addButton(n);
  }
}

function onCaught(fly) {
  addButton(fly);
  spider.notice(fly);
  say.textContent = `A fly is caught in the web, carrying a note: ${fly.note.label}.`;
}

function addButton(fly) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "hot-spot hot-fly";
  b.style.setProperty("--d", `${Math.round(Math.max(48, flies.size * 2.1))}px`);
  b.style.setProperty("--hue", fly.hue.rgb);
  b.setAttribute("aria-haspopup", "dialog");
  b.setAttribute("aria-label", `A fly caught in the web. Read what it is carrying: ${fly.note.label}.`);
  b.addEventListener("click", () => (open === fly ? closeFact() : openFact(fly)));
  b.addEventListener("pointerenter", () => { fly.hover = true; });
  b.addEventListener("pointerleave", () => { fly.hover = false; });
  hot.append(b);
  buttons.set(fly, b);
}

// ----- A fly's note -----
function openFact(fly) {
  if (open) open.open = false;
  open = fly;
  fly.open = true;
  fly.read = true;
  markRead(fly.note);
  fact.style.setProperty("--hue", fly.hue.rgb);
  factKicker.textContent = fly.note.label;
  factText.textContent = fly.note.text;
  // on a phone it comes up from the bottom — or down from the top, if that
  // is where the fly is
  fact.dataset.top = fly.sy > H * 0.55 ? "true" : "false";
  fact.hidden = false;
  // beside the fly, on whichever side has the room (measured as laid out:
  // it is still growing out of the fly at this point)
  const w = fact.offsetWidth, h = fact.offsetHeight, gap = flies.size * 1.9;
  let left = fly.sx < W / 2 ? fly.sx + gap : fly.sx - gap - w;
  left = clamp(left, 16, W - w - 16);
  const top = clamp(fly.sy - h * 0.4, 16, H - h - 16);
  fact.style.left = `${left}px`; fact.style.top = `${top}px`;
  fact.style.setProperty("--from-x", `${clamp(fly.sx - left, 0, w)}px`);
  fact.style.setProperty("--from-y", `${clamp(fly.sy - top, 0, h)}px`);
  fact.style.animation = "none"; void fact.offsetWidth; fact.style.animation = "";
  fact.rect = { left, top, right: left + w, bottom: top + h };
  hint.dataset.show = "false";
  $("factClose").focus({ preventScroll: true });
}
function closeFact(quiet) {
  if (!open) return;
  const b = buttons.get(open);
  open.open = false;
  if (!quiet) spider.call(open);
  open = null;
  fact.hidden = true;
  if (!quiet && b && document.activeElement && fact.contains(document.activeElement)) b.focus({ preventScroll: true });
}
$("factClose").addEventListener("click", () => closeFact());
$("factCopy").addEventListener("click", (e) => { if (open) daily.copyText(open.note.text, e.currentTarget); });

// ----- The spider's larder -----
function openLarder() {
  closeFact(true);
  spider.rear = true;
  larder.hidden = false;
  hint.dataset.show = "false";
  larder.querySelector(".parcel").focus({ preventScroll: true });
}
function closeLarder() {
  if (larder.hidden) return;
  larder.hidden = true;
  spider.rear = false; spider.hold = false;
  spiderBtn.focus({ preventScroll: true });
}
spiderBtn.addEventListener("click", openLarder);
spiderBtn.addEventListener("pointerenter", () => { spider.hold = true; });
spiderBtn.addEventListener("pointerleave", () => { spider.hold = false; });
spiderBtn.addEventListener("focus", () => { if (spiderBtn.matches(":focus-visible")) spider.hold = true; });
spiderBtn.addEventListener("blur", () => { spider.hold = false; });
$("larderClose").addEventListener("click", closeLarder);
$("larderVeil").addEventListener("click", closeLarder);
// keep the keyboard inside it while it is open
larder.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const stops = [...larder.querySelectorAll("a, button")];
  const first = stops[0], end = stops[stops.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
  else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.body.classList.contains("at-sea")) return;
  if (!larder.hidden) closeLarder(); else closeFact();
});

// Adrift is laid over this page: the web floods, and stops once it is under.
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
    larder.hidden = true;
    m.start({
      onCovered() {
        running = false;
        cancelAnimationFrame(frameId);
        glade.dataset.away = "true";
      }
    });
  }).catch(() => { sea = null; });
});

// ----- The pointer on the web -----
canvas.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = true;
});
canvas.addEventListener("pointerleave", () => { pointer.on = false; });
canvas.addEventListener("pointerdown", (e) => {
  if (open) { closeFact(); return; }
  // pluck it
  web.shove(e.clientX, e.clientY, 130 * scene.k, 0, 0, 1500);
  spider.pluck(e.clientX, e.clientY);
});

// ----- Every frame -----
function frame(now) {
  frameId = 0;
  if (!running) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
  last = now;
  t += dt;
  if (shown < 1) shown = Math.min(1, shown + dt / SPIN_S);

  wind.update(t, dt);
  scene.sway(t);
  web.hold(scene.anchors);
  // the eye drifts a little with the pointer, so what stands off the web shifts
  const tx = 0.2 - (pointer.on ? (pointer.x / W - 0.5) * 0.2 : 0), ty = -0.06 - (pointer.on ? (pointer.y / H - 0.5) * 0.14 : 0);
  eye.kx += (tx - eye.kx) * Math.min(1, dt * 2.5); eye.ky += (ty - eye.ky) * Math.min(1, dt * 2.5);
  // …and the pointer stirs the web as it goes by
  if (pointer.on) {
    const sp = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py) / Math.max(dt, 0.004);
    if (sp > 30 && pointer.px >= 0) web.shove(pointer.x, pointer.y, 70 * scene.k, (pointer.x - pointer.px) * 3, (pointer.y - pointer.py) * 3, -Math.min(420, sp * 0.35));
    pointer.px = pointer.x; pointer.py = pointer.y;
  }
  if (shown > 0.5) spider.update(dt, t, flies);
  flies.update(dt, t, spider.at, shown >= 1);
  web.step(dt, wind, t);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene.drawBack(g, t);
  scene.drawPlants(g, t);
  web.draw(g, eye, P, t, shown, wind);
  flies.drawHeld(g, mode, t);
  g.globalAlpha = smooth(clamp(shown * 4, 0, 1));
  spider.draw(g, mode, t);
  g.globalAlpha = 1;
  if (open) thread();
  flies.drawAir(g, mode, t);
  scene.drawFront(g, t, dt);

  place();
  frameId = requestAnimationFrame(frame);
}

// A thread from the fly to its card.
function thread() {
  const r = fact.rect;
  if (!r || W <= 640) return;
  const ex = clamp(open.sx, r.left + 18, r.right - 18), ey = clamp(open.sy, r.top + 18, r.bottom - 18);
  const sag = 10 + 6 * Math.sin(t * 1.3) + wind.gust * 8;
  g.strokeStyle = `rgba(${open.hue.rgb}, 0.7)`;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(open.sx, open.sy);
  g.quadraticCurveTo((open.sx + ex) / 2 + wind.gust * 6, (open.sy + ey) / 2 + sag, ex, ey);
  g.stroke();
}

// Keep each button over what it is for.
function place() {
  spiderBtn.hidden = shown < 0.6;
  spiderBtn.style.transform = `translate(${spider.at.x.toFixed(1)}px, ${spider.at.y.toFixed(1)}px)`;
  for (const [fly, b] of buttons) {
    if (fly.gone || fly.state !== "stuck") {
      if (open === fly) closeFact(true);
      b.remove(); buttons.delete(fly);
      continue;
    }
    b.style.transform = `translate(${fly.sx.toFixed(1)}px, ${fly.sy.toFixed(1)}px)`;
  }
}

function go() {
  if (running && !frameId) { last = 0; frameId = requestAnimationFrame(frame); }
}

build();
drawTally();
glade.dataset.up = "true";
go();
setTimeout(() => { if (!open && larder.hidden) hint.dataset.show = "true"; }, 3200);
setTimeout(() => { hint.dataset.show = "false"; }, 26000);

let resizing = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    // a phone's toolbar sliding away is not worth restringing the web for
    if (window.innerWidth === W && Math.abs(window.innerHeight - H) < 90 && window.innerHeight <= H) return;
    build();
  }, 180);
});
new MutationObserver(() => {
  const now = document.body.classList.contains("light") ? "light" : "dark";
  if (now === mode) return;
  mode = now; P = PALETTES[mode];
  scene.layout(W, H, P, 5);
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; }
  else go();
});

// for looking at it from outside: tests, and the curious
window.Orb = { web, wind, scene, get spider() { return spider; }, get flies() { return flies; } };
