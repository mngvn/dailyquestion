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

const W = 360, H = 460;      // the note, in CSS pixels, before it is fitted to its stage
const RES = 1024 / W;        // texture pixels per CSS pixel
const INK = "#24211c";
const PENCIL = "#7d7466";
const SERIF = '"Newsreader", Georgia, serif';
const MONO = '"IM Fell English SC", Georgia, serif';
const OPENED_KEY = "daily.opened.v1";

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
// fallback face and stays that way.
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wanted = [`500 26px ${SERIF}`, `600 64px ${SERIF}`, `italic 400 20px ${SERIF}`, `400 12px ${MONO}`,
    '30px "IM Fell English SC"', 'italic 17px "IM Fell English"'];
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  return Promise.race([Promise.all(wanted.map((f) => document.fonts.load(f))), timeout]).catch(() => {});
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
  const seeds = [7, 13, 17, 23];
  daily.facts.forEach((fact, i) => {
    const paper = PAPERS[fact.cat] || PAPERS.Misc;
    add(`fact-${fact.cat}`, paper, seeds[i % seeds.length], drawFact(fact, paper),
      `Fun fact · ${fact.cat}`, `${fact.cat} fact: ${fact.text}`, `${fact.cat}: ${fact.text}`);
  });
  const hist = daily.hist, date = daily.histDate, paper = PAPERS.day;
  if (hist) {
    add("history", paper, 11, drawHistory(hist, date, paper), `On this day · ${date}`,
      `On ${date}, ${hist.year}: ${hist.text}`, `On ${date}, ${hist.year} — ${hist.text}`);
  } else {
    add("history", paper, 11, drawMissing(`No entry for ${date}.`, paper), `On this day · ${date}`,
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
  const [mod] = await Promise.all([
    Promise.race([import("./stage.js"), timeout]).catch((error) => {
      console.warn("three.js could not be loaded; laying the notes out flat.", error);
      return null;
    }),
    fontsReady()
  ]);
  if (!mod) return null;
  try {
    return await mod.start(room);
  } catch (error) {
    console.warn("The 3D desk could not be built; laying the notes out flat.", error);
    return null;
  }
}

async function init() {
  if (!daily) return;
  const room = document.getElementById("room");
  const stage = await loadStage(room);
  await fontsReady();
  const notes = todaysNotes();
  if (room) room.dataset.mode = stage ? "3d" : "2d";
  if (!stage) {
    layFlat(notes);
    return;
  }
  for (const note of notes) stage.note(note);
}

init();
