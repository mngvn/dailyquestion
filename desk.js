// desk.js — today's five notes, and the desk they lie on.
//
// Four fun facts, one from each category, and what happened on this date
// arrive as balls of coloured paper. Hold one and it opens up; what's written
// on it is drawn here onto a canvas and printed on the sheet. A note once
// opened stays open for the rest of the visit — sessionStorage remembers it,
// so it is still lying open on the desk after a reload.
//
// This is also where the room is chosen. stage.js builds the desk in three
// dimensions with the notes lying on it in the candlelight; if three.js can't
// be loaded or there is no WebGL, the notes are simply laid out flat.
//
// app.js puts today's content on window.Daily before this runs — module scripts
// always run after the classic ones.
//
// All of it is made ready out of sight, behind the veil that opens round the
// candle (bleed.js): the desk built, every note crumpled, printed and its
// shaders compiled. Only then is the room shown and the veil let go, so from
// the first moment it can be seen nothing in it stalls.
//
// To be ready sooner, nothing waits on anything it doesn't need: the paper
// starts crumpling the moment the page starts, while three.js is still
// arriving, and the desk is built without waiting for the web fonts — its
// chart is lettered again if they arrive afterwards.

import { warm } from "./paper-solve.js";

const W = 360, H = 460;      // the note, in CSS pixels, before it is fitted to its stage
const RES = 1024 / W;        // texture pixels per CSS pixel
const INK = "#24211c";
const PENCIL = "#7d7466";
const SERIF = '"Newsreader", Georgia, serif';
const MONO = '"IM Fell English SC", Georgia, serif';
const OPENED_KEY = "daily.opened.v1";
const NOTE_PATIENCE_MS = 8000;   // a note not ready by then joins the desk late
const FONT_PATIENCE_MS = 2500;   // the notes are printed in the fallback face after this
const SEEDS = [7, 13, 17, 23];   // how each fun fact's paper crumples
const HISTORY_SEED = 11;

// Each note is its own colour of paper, with a darker ink of that colour for
// its heading.
const PAPERS = {
  Tech: { stock: "#a9c9ef", ink: "#1d4ed8", name: "blue" },
  Art: { stock: "#f4adc2", ink: "#be185d", name: "pink" },
  History: { stock: "#f4cf6a", ink: "#92400e", name: "yellow" },
  Misc: { stock: "#a5dcb3", ink: "#047857", name: "green" },
  day: { stock: "#c9b4ee", ink: "#6d28d9", name: "violet" }
};

const daily = window.Daily;
const bleed = window.Bleed || { reveal() {} };

// ----- Drawing the notes -----
function sheet(stock) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * RES);
  canvas.height = Math.round(H * RES);
  const g = canvas.getContext("2d");
  g.scale(RES, RES);
  g.fillStyle = stock;
  g.fillRect(0, 0, W, H);
  // faint ruling, the way a page torn from a pad would have it
  g.strokeStyle = "rgba(40, 60, 110, 0.12)";
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
  g.strokeStyle = "rgba(36, 33, 28, 0.2)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(28, 58); g.lineTo(W - 28, 58); g.stroke();
}

function footer(g) {
  g.font = `400 12px ${MONO}`;
  g.fillStyle = PENCIL;
  g.fillText(`DAILY · ${daily.shortDate.toUpperCase()}`, 28, H - 26);
}

function drawFact(fact, paper) {
  const { canvas, g } = sheet(paper.stock);
  header(g, `Fun fact · ${fact.cat}`, daily.shortDate, paper.ink);
  const box = { width: W - 56, height: H - 150 };
  const { lines, lineHeight } = fitText(g, fact.text, box, 26, 15, 500);
  g.fillStyle = INK;
  lines.forEach((line, i) => g.fillText(line, 28, 96 + i * lineHeight));
  footer(g);
  return canvas;
}

function drawHistory(hist, dateLabel, paper) {
  const { canvas, g } = sheet(paper.stock);
  header(g, "On this day", dateLabel, paper.ink);
  g.fillStyle = INK;
  g.font = `600 64px ${SERIF}`;
  g.fillText(String(hist.year), 26, 128);
  const box = { width: W - 56, height: H - 210 };
  const { lines, lineHeight } = fitText(g, hist.text, box, 22, 14, 400);
  lines.forEach((line, i) => g.fillText(line, 28, 170 + i * lineHeight));
  footer(g);
  return canvas;
}

function drawMissing(message, paper) {
  const { canvas, g } = sheet(paper.stock);
  header(g, "Daily", "", PENCIL);
  g.font = `italic 400 20px ${SERIF}`;
  g.fillStyle = PENCIL;
  g.fillText(message, 28, 110);
  return canvas;
}

// The canvas has to wait for the web fonts, or the note gets printed in the
// fallback face and stays that way. Their stylesheet loads without holding up
// the page (index.html), so it is waited for first. Asked for once, however
// often it is awaited: a font that never arrives costs the wait only once.
let fontsWait = null;
function fontSheet() {
  const link = document.getElementById("fonts");
  if (!link || link.media !== "print") return Promise.resolve();
  return new Promise((resolve) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
  });
}
function fontsReady() {
  if (fontsWait) return fontsWait;
  if (!document.fonts || !document.fonts.load) return (fontsWait = Promise.resolve());
  const wanted = [`500 26px ${SERIF}`, `600 64px ${SERIF}`, `italic 400 20px ${SERIF}`, `400 12px ${MONO}`,
    '30px "IM Fell English SC"', 'italic 17px "IM Fell English"'];
  const loaded = fontSheet().then(() => {
    getComputedStyle(document.body).fontFamily;   // let the stylesheet's faces be registered
    return Promise.all(wanted.map((f) => document.fonts.load(f)));
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, FONT_PATIENCE_MS));
  fontsWait = Promise.race([loaded, timeout]).catch(() => {});
  return fontsWait;
}

// ----- What has been opened this visit -----
// Kept for the day it was opened on, so tomorrow's notes arrive crumpled.
function loadOpened() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(OPENED_KEY));
    if (saved && saved.day === daily.dayKey && Array.isArray(saved.ids)) return new Set(saved.ids);
  } catch (e) { /* ignore */ }
  return new Set();
}

function saveOpened(ids) {
  try {
    sessionStorage.setItem(OPENED_KEY, JSON.stringify({ day: daily.dayKey, ids: [...ids] }));
  } catch (e) { /* ignore */ }
}

// ----- Today's five notes -----
// In the order the desk lays them out: the four facts, then this day.
function todaysNotes() {
  const opened = loadOpened();
  const notes = [];
  const add = (id, paper, seed, texture, title, text, copyText) => notes.push({
    id, seed, texture, title, text,
    color: paper.stock,
    label: `${title}, on ${paper.name} paper`,
    opened: opened.has(id),
    onOpen() {
      opened.add(id);
      saveOpened(opened);
    },
    copy(btn) { daily.copyText(copyText, btn); }
  });
  daily.facts.forEach((fact, i) => {
    const paper = PAPERS[fact.cat] || PAPERS.Misc;
    add(`fact-${fact.cat}`, paper, SEEDS[i % SEEDS.length], drawFact(fact, paper),
      `Fun fact · ${fact.cat}`, `${fact.cat} fact: ${fact.text}`, `${fact.cat}: ${fact.text}`);
  });
  const hist = daily.hist, date = daily.histDate, paper = PAPERS.day;
  if (hist) {
    add("history", paper, HISTORY_SEED, drawHistory(hist, date, paper), `On this day · ${date}`,
      `On ${date}, ${hist.year}: ${hist.text}`, `On ${date}, ${hist.year} — ${hist.text}`);
  } else {
    add("history", paper, HISTORY_SEED, drawMissing(`No entry for ${date}.`, paper), `On this day · ${date}`,
      `No entry for ${date} yet.`, `No entry for ${date} yet.`);
  }
  return notes;
}

// Without the 3D desk there is nothing to unfold, so the notes are simply laid
// out flat, already open.
function layFlat(notes) {
  const desk = document.getElementById("flatDesk");
  if (!desk) return;
  for (const note of notes) {
    const card = document.createElement("figure");
    card.className = "flat-note";
    note.texture.classList.add("flat-paper");
    note.texture.setAttribute("aria-hidden", "true");
    const caption = document.createElement("figcaption");
    caption.className = "sr-only";
    caption.textContent = note.text;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-ghost";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => note.copy(copy));
    card.append(note.texture, caption, copy);
    desk.append(card);
  }
}

// The 3D desk, if it can be had. three.js comes from a CDN, so a slow or
// blocked connection gives up after a while and the notes are laid out flat.
async function loadStage(room) {
  if (!room) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
  const mod = await Promise.race([import("./stage.js"), timeout]).catch((error) => {
    console.warn("three.js could not be loaded; laying the notes out flat.", error);
    return null;
  });
  if (!mod) return null;
  try {
    return await mod.start(room);
  } catch (error) {
    console.warn("The 3D desk could not be built; laying the notes out flat.", error);
    return null;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = (n) => new Promise((resolve) => {
  const next = () => (n-- > 0 ? requestAnimationFrame(next) : resolve());
  next();
});

async function init() {
  if (!daily) return bleed.reveal();
  warm([...SEEDS, HISTORY_SEED]);
  const fonts = fontsReady();
  let lettered = false;
  fonts.then(() => { lettered = true; });
  const room = document.getElementById("room");
  const stage = await loadStage(room);
  const early = !lettered;
  await fonts;
  // built before the fonts were in: letter the chart again, and fit the room
  // to the date as it is now set
  if (stage && early) stage.fontsArrived();
  const notes = todaysNotes();
  if (!stage) {
    if (room) room.dataset.mode = "2d";
    layFlat(notes);
    return bleed.reveal();
  }
  // every note made ready while the room is still out of sight, then a couple
  // of frames drawn with all of them in it, so there is nothing left to do
  // for the first time once it is seen
  const ready = Promise.allSettled(notes.map((note) => stage.note(note)));
  await Promise.race([ready, wait(NOTE_PATIENCE_MS)]);
  await frames(2);
  room.dataset.mode = "3d";
  stage.show();
  bleed.reveal();
}

init().catch((error) => {
  console.error(error);
  bleed.reveal();
});
