// desk.js — the two crumpled notes on the desk, and the desk itself.
//
// Today's fun facts and today's entry from history arrive as balls of paper.
// Hold one (or tug it around) and it opens up; what's written on it is drawn
// here onto a canvas and printed on the sheet. The facts come four to a day,
// so that note can be balled back up and the next one handed over.
//
// This is also where the room is chosen. stage.js builds the desk in three
// dimensions, with the notes lying on it in the candlelight; if three.js can't
// be loaded or there is no WebGL, the flat desk in the page stays, candle.js
// lights it, and the notes are simply laid on it open.
//
// app.js puts today's content on window.Daily before this runs — module scripts
// always run after the classic ones.

const W = 360, H = 460;      // the note, in CSS pixels, before it is fitted to its stage
const RES = 1024 / W;        // texture pixels per CSS pixel
const INK = "#24211c";
const PENCIL = "#8b8274";
const STOCK = "#f5f1e8";
const SERIF = '"Newsreader", Georgia, serif';
const MONO = '"IM Fell English SC", Georgia, serif';

const CAT_INK = { Tech: "#2563eb", Art: "#db2777", History: "#b45309", Misc: "#059669" };

const daily = window.Daily;

// ----- Drawing the notes -----
function sheet() {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * RES);
  canvas.height = Math.round(H * RES);
  const g = canvas.getContext("2d");
  g.scale(RES, RES);
  g.fillStyle = STOCK;
  g.fillRect(0, 0, W, H);
  // faint ruling, the way a page torn from a pad would have it
  g.strokeStyle = "rgba(70, 110, 170, 0.10)";
  g.lineWidth = 0.6;
  for (let y = 92; y < H - 40; y += 24) {
    g.beginPath(); g.moveTo(24, y); g.lineTo(W - 24, y); g.stroke();
  }
  return { canvas, g };
}

function wrap(g, text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// The largest size, from `max` down, at which the text fits the box.
function fitText(g, text, box, max, min, weight) {
  for (let size = max; size >= min; size -= 1) {
    g.font = `${weight} ${size}px ${SERIF}`;
    const lines = wrap(g, text, box.width);
    const lineHeight = size * 1.32;
    if (lines.length * lineHeight <= box.height) return { lines, size, lineHeight };
  }
  g.font = `${weight} ${min}px ${SERIF}`;
  return { lines: wrap(g, text, box.width), size: min, lineHeight: min * 1.32 };
}

function header(g, left, right, color) {
  g.font = `400 13px ${MONO}`;
  g.textBaseline = "alphabetic";
  g.fillStyle = color;
  g.fillText(left.toUpperCase(), 28, 44);
  g.fillStyle = PENCIL;
  g.textAlign = "right";
  g.fillText(right.toUpperCase(), W - 28, 44);
  g.textAlign = "left";
  g.strokeStyle = "rgba(36, 33, 28, 0.18)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(28, 58); g.lineTo(W - 28, 58); g.stroke();
}

function footer(g) {
  g.font = `400 12px ${MONO}`;
  g.fillStyle = PENCIL;
  g.fillText(`DAILY · ${daily.shortDate.toUpperCase()}`, 28, H - 26);
}

function drawFact(fact, index, total) {
  const { canvas, g } = sheet();
  header(g, `Fun fact · ${fact.cat}`, `${index + 1} / ${total}`, CAT_INK[fact.cat] || INK);
  const box = { width: W - 56, height: H - 150 };
  const { lines, lineHeight } = fitText(g, fact.text, box, 26, 15, 500);
  g.fillStyle = INK;
  lines.forEach((line, i) => g.fillText(line, 28, 96 + i * lineHeight));
  footer(g);
  return canvas;
}

function drawHistory(hist, dateLabel) {
  const { canvas, g } = sheet();
  header(g, "On this day", dateLabel, "#b45309");
  g.fillStyle = INK;
  g.font = `600 64px ${SERIF}`;
  g.fillText(String(hist.year), 26, 128);
  const box = { width: W - 56, height: H - 210 };
  const { lines, lineHeight } = fitText(g, hist.text, box, 22, 14, 400);
  lines.forEach((line, i) => g.fillText(line, 28, 170 + i * lineHeight));
  footer(g);
  return canvas;
}

function drawMissing(message) {
  const { canvas, g } = sheet();
  header(g, "Daily", "", PENCIL);
  g.font = `italic 400 20px ${SERIF}`;
  g.fillStyle = PENCIL;
  g.fillText(message, 28, 110);
  return canvas;
}

// The canvas has to wait for the web fonts, or the note gets printed in the
// fallback face and stays that way.
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wanted = [`500 26px ${SERIF}`, `600 64px ${SERIF}`, `italic 400 20px ${SERIF}`, `400 12px ${MONO}`];
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  return Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f))), timeout]).catch(() => {});
}

// ----- A note on the page -----
// The card around the paper carries data-state, which the CSS uses to swap
// the hint for the actions once the paper is open.
function mountNote(stage, note, { texture, label, seed }) {
  const live = note.querySelector(".note-live");
  const setState = (state) => { note.dataset.state = state; };
  const opened = () => {
    setState("open");
    live.textContent = note.dataset.text || "";
    // the candle gutters in the draught of a sheet being shaken open
    if (typeof Candle !== "undefined") Candle.puff(1);
  };

  if (!stage) return flatNote(note.querySelector(".paper-stage"), texture, opened);

  const paper = stage.note(note, {
    texture, label, seed,
    onProgress: (p) => {
      note.style.setProperty("--progress", p.toFixed(3));
      if (note.dataset.state !== "open") setState(p > 0 ? "opening" : "wad");
    },
    onOpen: opened
  });
  setState("wad");
  return {
    crumple: () => {
      setState("wad");
      live.textContent = "";
      return paper.crumple();
    },
    setTexture: (canvas) => paper.setTexture(canvas),
    focus: () => paper.focus()
  };
}

// Without the 3D desk there is nothing to unfold, so the note is just laid
// out flat.
function flatNote(stage, texture, opened) {
  const lay = (canvas) => {
    canvas.classList.add("paper-flat");
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  };
  stage.dataset.status = "flat";
  stage.append(lay(texture));
  opened();
  return {
    crumple: () => Promise.resolve(),
    setTexture: (canvas) => {
      stage.querySelector(".paper-flat").replaceWith(lay(canvas));
      opened();
    },
    focus: () => {}
  };
}

// ----- Today's two notes -----
function mountFacts(stage) {
  const note = document.getElementById("factNote");
  if (!note) return;
  const facts = daily.facts;
  const next = note.querySelector("[data-action=next]");
  const copy = note.querySelector("[data-action=copy]");
  const count = note.querySelector(".note-count");
  if (!facts.length) {
    note.dataset.text = "Today's facts failed to load.";
    next.hidden = true;
    mountNote(stage, note, { texture: drawMissing("Nothing written today."), label: "An empty note", seed: 7 });
    return;
  }

  let index = 0;
  const show = (i) => {
    const fact = facts[i];
    note.dataset.text = `${fact.cat} fact: ${fact.text}`;
    count.textContent = `${i + 1} of ${facts.length}`;
    next.textContent = i + 1 < facts.length ? "Next fact" : "Back to the first";
  };
  show(0);

  const paper = mountNote(stage, note, {
    texture: drawFact(facts[0], 0, facts.length),
    label: "A crumpled note with today's fun fact",
    seed: 7
  });

  copy.addEventListener("click", (e) =>
    daily.copyText(`${facts[index].cat}: ${facts[index].text}`, e.currentTarget));

  // Ball this one up, then hand over the next, still crumpled, to be opened.
  next.addEventListener("click", async () => {
    next.disabled = true;
    await paper.crumple();
    index = (index + 1) % facts.length;
    show(index);
    paper.setTexture(drawFact(facts[index], index, facts.length));
    next.disabled = false;
    paper.focus();
  });
}

function mountHistory(stage) {
  const note = document.getElementById("historyNote");
  if (!note) return;
  const hist = daily.hist;
  const dateLabel = daily.histDate;
  const copy = note.querySelector("[data-action=copy]");
  const refold = note.querySelector("[data-action=refold]");
  note.querySelector(".note-count").textContent = dateLabel;
  if (!hist) {
    note.dataset.text = `No entry for ${dateLabel} yet.`;
    mountNote(stage, note, { texture: drawMissing(`No entry for ${dateLabel}.`), label: "An empty note", seed: 11 });
    return;
  }
  note.dataset.text = `On ${dateLabel}, ${hist.year}: ${hist.text}`;
  const paper = mountNote(stage, note, {
    texture: drawHistory(hist, dateLabel),
    label: `A crumpled note about ${dateLabel} in history`,
    seed: 11
  });

  copy.addEventListener("click", (e) =>
    daily.copyText(`On ${dateLabel}, ${hist.year} — ${hist.text}`, e.currentTarget));
  refold.addEventListener("click", async () => {
    await paper.crumple();
    paper.focus();
  });
}

// Solving the paper takes a few hundred milliseconds, so let the page paint
// and its entrance play first.
function whenIdle() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(resolve, { timeout: 900 });
    else setTimeout(resolve, 300);
  });
}

// The 3D desk, if it can be had. three.js comes from a CDN, so a slow or
// blocked connection gives up after a while and the flat desk is used instead.
async function loadStage(room) {
  if (!room) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
  const mod = await Promise.race([import("./stage.js"), timeout]).catch((error) => {
    console.warn("three.js could not be loaded; using the flat desk.", error);
    return null;
  });
  if (!mod) return null;
  try {
    return await mod.start(room);
  } catch (error) {
    console.warn("The 3D desk could not be built; using the flat desk.", error);
    return null;
  }
}

async function init() {
  if (!daily) return;
  const room = document.getElementById("room");
  const stage = await loadStage(room);
  if (room) room.dataset.mode = stage ? "3d" : "2d";
  if (typeof Candle !== "undefined") {
    if (stage) Candle.use(stage.puff);
    else Candle.start();
  }
  if (stage) window.DeskStage = stage;
  await Promise.all([fontsReady(), whenIdle()]);
  mountFacts(stage);
  await whenIdle();
  mountHistory(stage);
}

init();
