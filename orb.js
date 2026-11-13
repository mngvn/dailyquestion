// orb.js — the home page: a spider's web in the wind.
//
// This is where it is all put together and kept going. scene.js is the wind,
// the sky and the plants; silk.js the web strung between them; spider.js the
// spider on it; flies.js the flies about it. Here they are stepped and drawn,
// every frame, on one canvas — and the page's few controls are laid over it:
//
//   a fly                 click it, flying or caught, for what it is
//                         carrying: one of today's notes (app.js), on a card
//   the spider            click it for its larder: the games, Adrift among
//                         them (boat.js), which is laid over this page
//   the web itself        the pointer stirs it as it passes; click to pluck it
//
// The spider and each fly has a real button over it, moved about with it, so
// all of it can be reached from the keyboard too.
//
// And there is the hunt, which the spider keeps with the games: for a minute
// the spider is yours (W A S D, the arrows, or hold and drag), the flies come
// thick and fast, and each one you don't reach in time tears itself free.

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
const HUNT_S = 60;                  // how long a hunt lasts
const HUNT_BEST = "daily.web.hunt.best";

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
  web.build({ hub: scene.hub, R0: scene.R0, anchors: scene.anchors, seed: 1000 + daily.dayNumber, k: scene.k });
  spider = new Spider(web, eye, scene.k);
  spiderBtn.style.setProperty("--d", `${Math.round(Math.max(48, spider.S * 1.35))}px`);

  // the flies that were about go back into the new web, or back in the queue
  const was = flies ? flies.list.filter((f) => f.note && !["falling", "wrapped", "leave"].includes(f.state)) : [];
  for (const b of buttons.values()) b.remove();
  buttons.clear();
  closeFact(true);
  const onWeb = was.filter((f) => f.state === "stuck" || f.state === "wrapping");
  queue.unshift(...was.filter((f) => !onWeb.includes(f) && !f.read).map((f) => f.note));
  flies = new Flies({ web, eye, k: scene.k, W, H, notes: nextNote, onNew: addButton, onCaught, still });
  for (const f of onWeb) flies.place(f.note, f.read);
}

function onCaught(fly) {
  spider.notice(fly);
  const b = buttons.get(fly);
  if (b) b.setAttribute("aria-label", `A fly caught in the web. Read what it is carrying: ${fly.note.label}.`);
  say.textContent = `A fly is caught in the web, carrying a note: ${fly.note.label}.`;
}

function addButton(fly) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "hot-spot hot-fly";
  b.style.setProperty("--d", `${Math.round(Math.max(52, fly.o.size * 2.2))}px`);
  b.style.setProperty("--hue", fly.hue.rgb);
  b.setAttribute("aria-haspopup", "dialog");
  b.setAttribute("aria-label", `A fly${fly.state === "stuck" ? " caught in the web" : ""}. Read what it is carrying: ${fly.note.label}.`);
  b.addEventListener("click", () => (open === fly ? closeFact() : openFact(fly)));
  b.addEventListener("pointerenter", () => { fly.hover = true; });
  b.addEventListener("pointerleave", () => { fly.hover = false; });
  b.style.transform = `translate(${fly.sx.toFixed(1)}px, ${fly.sy.toFixed(1)}px)`;
  hot.append(b);
  buttons.set(fly, b);
}

// ----- A fly's note -----
function openFact(fly) {
  if (open) closeFact(true);
  // one on its way into the web thinks better of it
  if (fly.state === "dive") { fly.state = "air"; fly.node = -1; fly.way = null; }
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
  $("factClose").textContent = fly.state === "stuck" ? "Leave it to the spider" : "Let it go";
  $("factClose").focus({ preventScroll: true });
}
function closeFact(quiet) {
  if (!open) return;
  const fly = open, b = buttons.get(fly);
  const inside = document.activeElement && fact.contains(document.activeElement);
  fly.open = false;
  open = null;
  fact.hidden = true;
  // read, it is done with: the spider's if it is caught, away if it is not
  if (fly.state === "stuck") {
    if (!quiet) spider.call(fly);
    if (!quiet && inside && b) b.focus({ preventScroll: true });
  } else if (fly.state === "air") {
    fly.leave();
    if (!quiet && inside) spiderBtn.focus({ preventScroll: true });
  }
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
// keep the keyboard inside a dialog while it is open
function keepIn(box) {
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const stops = [...box.querySelectorAll("a, button")];
    const first = stops[0], end = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
  });
}
keepIn(larder);
keepIn($("huntOver"));
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.body.classList.contains("at-sea")) return;
  if (hunt.on) stopHunt();
  else if (!larder.hidden) closeLarder();
  else closeFact();
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

// ----- The hunt -----
const huntEl = $("hunt"), huntOver = $("huntOver");
const huntTime = $("huntTime"), huntScore = $("huntScore"), huntCount = $("huntCount"), huntKeys = $("huntKeys");
const hunt = { on: false, phase: "", left: 0, lead: 0, score: 0, pops: [], keys: new Set(), drag: null, shown: {} };
const STEER = {
  KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0],
  ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0]
};
let best = 0;
try { best = +localStorage.getItem(HUNT_BEST) || 0; } catch (e) { /* ignore */ }

function startHunt() {
  closeFact(true);
  larder.hidden = true;
  huntOver.hidden = true;
  for (const b of buttons.values()) b.remove();
  buttons.clear();
  // what the flies were carrying is kept for afterwards
  queue.unshift(...flies.begin());
  spider.drive(true);
  Object.assign(hunt, { on: true, phase: "ready", lead: 3, left: HUNT_S, score: 0, pops: [], drag: null, shown: {} });
  hunt.keys.clear();
  glade.dataset.hunt = "true";
  huntEl.hidden = false;
  huntKeys.dataset.show = "true";
  hint.dataset.show = "false";
  say.textContent = "The hunt. Steer the spider with W, A, S and D, or the arrow keys. Reach each fly before it gets away. Sixty seconds.";
  canvas.focus({ preventScroll: true });
  showHunt();
}
// time is up
function endHunt() {
  hunt.phase = "over";
  flies.end();
  spider.drive(false);
  const record = hunt.score > best;
  if (record) {
    best = hunt.score;
    try { localStorage.setItem(HUNT_BEST, String(best)); } catch (e) { /* ignore */ }
  }
  const n = hunt.score, away = flies.missed;
  $("huntKicker").textContent = record && n ? "A new best" : "The hunt is over";
  $("huntTitle").textContent = `${n} ${n === 1 ? "fly" : "flies"}`;
  $("huntLine").textContent = `${away ? `${away} got away.` : "Not one got away."} ${record && n ? "That's the most you've caught." : `Your best is ${best}.`}`;
  huntOver.hidden = false;
  huntKeys.dataset.show = "false";
  $("huntAgain").focus({ preventScroll: true });
}
// back to the web as it was
function stopHunt() {
  if (!hunt.on) return;
  if (hunt.phase !== "over") { flies.end(); spider.drive(false); }
  hunt.on = false; hunt.phase = "";
  flies.mode = "idle"; flies.catchAt = 2.5;
  huntEl.hidden = true; huntOver.hidden = true;
  huntCount.textContent = "";
  delete glade.dataset.hunt;
  spiderBtn.focus({ preventScroll: true });
}
function showHunt() {
  const secs = Math.ceil(hunt.left);
  if (hunt.shown.secs !== secs) {
    hunt.shown.secs = secs;
    huntTime.textContent = secs;
    huntTime.dataset.low = secs <= 10 && hunt.phase === "play" ? "true" : "false";
  }
  if (hunt.shown.score !== hunt.score) {
    hunt.shown.score = hunt.score;
    huntScore.textContent = hunt.score;
    $("huntUnit").textContent = hunt.score === 1 ? "fly" : "flies";
    if (hunt.score) { huntScore.dataset.bump = "false"; void huntScore.offsetWidth; huntScore.dataset.bump = "true"; }
  }
  const lead = hunt.phase === "ready" ? String(Math.ceil(hunt.lead)) : hunt.phase === "play" && hunt.left > HUNT_S - 0.9 ? "Go" : "";
  if (hunt.shown.lead !== lead) {
    hunt.shown.lead = lead;
    huntCount.textContent = lead;
    huntCount.removeAttribute("data-tick"); void huntCount.offsetWidth; huntCount.dataset.tick = "";
  }
}
function stepHunt(dt) {
  // which way it is being driven: the keys, or towards where a finger is held
  let ix = 0, iy = 0;
  for (const code of hunt.keys) { ix += STEER[code][0]; iy += STEER[code][1]; }
  const mag = Math.hypot(ix, iy);
  if (mag) { ix /= mag; iy /= mag; }
  else if (hunt.drag) {
    const dx = hunt.drag.x - spider.at.x, dy = hunt.drag.y - spider.at.y, d = Math.hypot(dx, dy);
    if (d > 6) { const f = Math.min(1, d / 46) / d; ix = dx * f; iy = dy * f; }
  }
  if (hunt.phase === "over") return;
  spider.manual.x = ix; spider.manual.y = iy;

  if (hunt.phase === "ready") {
    if ((hunt.lead -= dt) <= 0) { hunt.phase = "play"; flies.playing = true; }
  } else {
    hunt.left -= dt;
    flies.level = clamp(1 - hunt.left / HUNT_S, 0, 1);
    for (const f of flies.collect(spider.p, spider.S * 0.82)) {
      hunt.score++;
      spider.snap = 0.22;
      hunt.pops.push({ x: f.sx, y: f.sy, age: 0, rgb: f.hue.rgb });
      web.shove(f.x, f.y, 70 * scene.k, 0, 0, -500);
    }
    if (hunt.left < HUNT_S - 6) huntKeys.dataset.show = "false";
    if (hunt.left <= 0) { hunt.left = 0; endHunt(); }
  }
  showHunt();
}
// each catch: a puff of silk and a +1, going up
function drawPops(dt) {
  if (!hunt.pops.length) return;
  g.save();
  g.textAlign = "center";
  g.font = `italic 500 ${Math.round(26 * clamp(scene.k, 0.8, 1.2))}px Fraunces, Georgia, serif`;
  for (const p of hunt.pops) {
    p.age += dt;
    const u = p.age / 0.8, e = 1 - (1 - u) * (1 - u);
    g.globalAlpha = clamp(1.6 - u * 1.6, 0, 1);
    g.strokeStyle = `rgba(${p.rgb}, 0.9)`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(p.x, p.y, 10 + 34 * e, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#ffffff";
    g.shadowColor = `rgba(${p.rgb}, 0.9)`; g.shadowBlur = 14;
    g.fillText("+1", p.x, p.y - 18 - 36 * e);
    g.shadowBlur = 0;
  }
  g.restore();
  hunt.pops = hunt.pops.filter((p) => p.age < 0.8);
}
$("playHunt").addEventListener("click", startHunt);
$("huntAgain").addEventListener("click", startHunt);
$("huntBack").addEventListener("click", stopHunt);
$("huntQuit").addEventListener("click", stopHunt);
window.addEventListener("keydown", (e) => {
  if (!hunt.on || !STEER[e.code] || e.metaKey || e.ctrlKey || e.altKey) return;
  if (hunt.phase !== "over") { hunt.keys.add(e.code); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => { hunt.keys.delete(e.code); });
window.addEventListener("blur", () => { hunt.keys.clear(); hunt.drag = null; });

// ----- The pointer on the web -----
canvas.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = e.pointerType !== "touch" || hunt.on;
  if (hunt.drag) { hunt.drag.x = e.clientX; hunt.drag.y = e.clientY; }
});
canvas.addEventListener("pointerleave", () => { pointer.on = false; });
canvas.addEventListener("pointerdown", (e) => {
  if (hunt.on) {
    // hold, and the spider comes to where it is held
    hunt.drag = { x: e.clientX, y: e.clientY };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    return;
  }
  if (open) { closeFact(); return; }
  // pluck it
  web.shove(e.clientX, e.clientY, 130 * scene.k, 0, 0, 900);
  spider.pluck(e.clientX, e.clientY);
});
for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, () => { hunt.drag = null; });

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
  // the eye shifts a hair with the pointer, so what stands off the web moves
  const tx = pointer.on && !hunt.on ? -(pointer.x / W - 0.5) * 0.05 : 0, ty = pointer.on && !hunt.on ? -(pointer.y / H - 0.5) * 0.04 : 0;
  eye.kx += (tx - eye.kx) * Math.min(1, dt * 2.5); eye.ky += (ty - eye.ky) * Math.min(1, dt * 2.5);
  // …and the pointer stirs the web as it goes by
  if (pointer.on && !hunt.on) {
    const sp = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py) / Math.max(dt, 0.004);
    if (sp > 30 && pointer.px >= 0) web.shove(pointer.x, pointer.y, 70 * scene.k, (pointer.x - pointer.px) * 2.5, (pointer.y - pointer.py) * 2.5, -Math.min(260, sp * 0.25));
    pointer.px = pointer.x; pointer.py = pointer.y;
  }
  if (hunt.on) stepHunt(dt);
  if (shown > 0.5) spider.update(dt, t, flies);
  flies.update(dt, t, spider.at, shown >= 1, hunt.on ? null : pointer);
  web.step(dt, wind, t);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene.drawBack(g, t);
  scene.drawPlants(g, t);
  web.draw(g, eye, P, t, shown, wind);
  flies.drawHeld(g, mode, t);
  g.globalAlpha = smooth(clamp(shown * 4, 0, 1));
  spider.draw(g, mode, t);
  g.globalAlpha = 1;
  flies.drawAir(g, mode, t);
  if (open) thread();
  if (hunt.on) drawPops(dt);
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
    if (fly.gone || !fly.note || (fly.state !== "stuck" && fly.state !== "air" && fly.state !== "dive")) {
      if (open === fly) closeFact(true);
      if (b === document.activeElement) spiderBtn.focus({ preventScroll: true });
      b.remove(); buttons.delete(fly);
      continue;
    }
    b.style.transform = `translate(${fly.sx.toFixed(1)}px, ${fly.sy.toFixed(1)}px)`;
  }
}

function go() {
  if (running && !frameId) { last = 0; frameId = requestAnimationFrame(frame); }
}

canvas.tabIndex = -1;
build();
drawTally();
glade.dataset.up = "true";
go();
setTimeout(() => { if (!open && larder.hidden && !hunt.on) hint.dataset.show = "true"; }, 3200);
setTimeout(() => { hint.dataset.show = "false"; }, 26000);

let resizing = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    // a phone's toolbar sliding away is not worth restringing the web for
    if (window.innerWidth === W && Math.abs(window.innerHeight - H) < 90 && window.innerHeight <= H) return;
    stopHunt();
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
  if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; hunt.keys.clear(); }
  else go();
});

// for looking at it from outside: tests, and the curious
window.Orb = { web, wind, scene, hunt, get spider() { return spider; }, get flies() { return flies; } };
