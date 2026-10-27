// desk.js — the two crumpled notes at the top of the home page.
//
// Today's fun facts and today's entry from history arrive as balls of paper.
// Hold one (or tug it around) and it opens up; what's written on it is drawn
// here onto a canvas and printed on the sheet by paper.js. The facts come four
// to a day, so that note can be balled back up and the next one handed over.
//
// app.js puts today's content on window.Daily before this runs — module scripts
// always run after the classic ones. three.js comes from a CDN; if it can't be
// loaded, or there is no WebGL, the notes are simply shown flat.

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
// The paper lives in .paper-stage; the card around it carries data-state,
// which the CSS uses to swap the hint for the actions once the paper is open.
function mountNote(paperModule, note, { texture, label, seed }) {
  const stage = note.querySelector(".paper-stage");
  const live = note.querySelector(".note-live");
  const setState = (state) => { note.dataset.state = state; };
  const opened = () => {
    setState("open");
    live.textContent = note.dataset.text || "";
    // the candle gutters in the draught of a sheet being shaken open
    if (typeof Candle !== "undefined") Candle.puff(1);
  };

  if (!paperModule || !paperModule.supported) return flatNote(stage, texture, opened);

  let paper;
  try {
    paper = new paperModule.PaperSheet(stage, {
      texture, label, seed, width: W, height: H,
      onProgress: (p) => {
        note.style.setProperty("--progress", p.toFixed(3));
        if (note.dataset.state !== "open") setState(p > 0 ? "opening" : "wad");
      },
      onOpen: opened
    });
  } catch (error) {
    stage.replaceChildren();
    return flatNote(stage, texture, opened);
  }
  stage.dataset.status = "ready";
  setState("wad");
  return {
    crumple: () => {
      setState("wad");
      live.textContent = "";
      return paper.crumple();
    },
    setTexture: (canvas) => paper.setTexture(canvas)
  };
}

// Without WebGL there is nothing to unfold, so the note is just laid out flat.
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
    }
  };
}

const focusPaper = (note) => {
  const hit = note.querySelector(".paper-hit");
  if (hit) hit.focus({ preventScroll: true });
};

// ----- Today's two notes -----
function mountFacts(paperModule) {
  const note = document.getElementById("factNote");
  if (!note) return;
  const facts = daily.facts;
  const next = note.querySelector("[data-action=next]");
  if (!facts.length) {
    note.dataset.text = "Today's facts failed to load.";
    next.hidden = true;
    mountNote(paperModule, note, { texture: drawMissing("Nothing written today."), label: "An empty note", seed: 7 });
    return;
  }

  let index = 0;
  const count = note.querySelector(".note-count");
  const show = (i) => {
    const fact = facts[i];
    note.dataset.text = `${fact.cat} fact: ${fact.text}`;
    count.textContent = `${i + 1} of ${facts.length}`;
    next.textContent = i + 1 < facts.length ? "Next fact" : "Back to the first";
  };
  show(0);

  const paper = mountNote(paperModule, note, {
    texture: drawFact(facts[0], 0, facts.length),
    label: "A crumpled note with today's fun fact",
    seed: 7
  });

  note.querySelector("[data-action=copy]").addEventListener("click", (e) =>
    daily.copyText(`${facts[index].cat}: ${facts[index].text}`, e.currentTarget));

  // Ball this one up, then hand over the next, still crumpled, to be opened.
  next.addEventListener("click", async () => {
    next.disabled = true;
    await paper.crumple();
    index = (index + 1) % facts.length;
    show(index);
    paper.setTexture(drawFact(facts[index], index, facts.length));
    next.disabled = false;
    focusPaper(note);
  });
}

function mountHistory(paperModule) {
  const note = document.getElementById("historyNote");
  if (!note) return;
  const hist = daily.hist;
  const dateLabel = daily.histDate;
  note.querySelector(".note-count").textContent = dateLabel;
  if (!hist) {
    note.dataset.text = `No entry for ${dateLabel} yet.`;
    mountNote(paperModule, note, { texture: drawMissing(`No entry for ${dateLabel}.`), label: "An empty note", seed: 11 });
    return;
  }
  note.dataset.text = `On ${dateLabel}, ${hist.year}: ${hist.text}`;
  const paper = mountNote(paperModule, note, {
    texture: drawHistory(hist, dateLabel),
    label: `A crumpled note about ${dateLabel} in history`,
    seed: 11
  });

  note.querySelector("[data-action=copy]").addEventListener("click", (e) =>
    daily.copyText(`On ${dateLabel}, ${hist.year} — ${hist.text}`, e.currentTarget));
  note.querySelector("[data-action=refold]").addEventListener("click", async () => {
    await paper.crumple();
    focusPaper(note);
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

async function init() {
  if (!daily) return;
  const [paperModule] = await Promise.all([
    import("./paper.js").catch(() => null),
    fontsReady(),
    whenIdle()
  ]);
  mountFacts(paperModule);
  await whenIdle();
  mountHistory(paperModule);
}

init();
