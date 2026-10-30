// paper-solve.js — crumpling the paper, off the main thread and ahead of time.
//
// How a sheet balls up depends only on its size and seed, so it can be
// worked out before three.js has even arrived: desk.js asks for today's five
// sheets the moment the page starts (warm), and by the time the desk is
// built and paper.js wants them they are ready. Nothing here needs three.js.

import { buildMesh, createPaperPath } from "./paper-solver.js";

// the sheet every note is cut from; paper.js uses the same
export const SHEET = { width: 360, height: 460, detail: 64, foldCount: 6, foldSharpness: 0.6, wrinkleDepth: 0.65 };

// Start crumpling these seeds now (or fetch them from IndexedDB), so they are
// waiting when the notes are made.
export function warm(seeds) {
  for (const seed of seeds) solve({ ...SHEET, seed }).catch(() => {});
}

// ----- Solving, off the main thread -----
// A few workers share the notes between them; each shape of note is solved
// once, and kept for next time (below). Where module workers aren't
// available it is done here instead, a note at a time between frames.
const solved = new Map();
let pool = null, nextJob = 0, turn = 0;
const jobs = new Map();

function workers() {
  if (pool) return pool;
  pool = [];
  try {
    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL("./paper-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (e) => {
        const job = jobs.get(e.data.id);
        jobs.delete(e.data.id);
        if (job) job.resolve({ samples: e.data.samples, creased: e.data.creased });
      };
      worker.onerror = () => failOver(worker);
      pool.push(worker);
    }
  } catch (e) {
    pool = [];
  }
  return pool;
}

// A worker that can't start (an old browser, a file:// page) hands its
// jobs back to the main thread.
function failOver(worker) {
  pool = pool.filter((w) => w !== worker);
  worker.terminate();
  for (const [id, job] of jobs) {
    if (job.worker !== worker) continue;
    jobs.delete(id);
    job.resolve(solveHere(job.opts));
  }
}

function solveHere(opts) {
  return new Promise((resolve) => setTimeout(() => {
    const mesh = buildMesh(opts.width, opts.height, opts.seed, opts.detail);
    resolve(createPaperPath(mesh.original, mesh.indices, mesh.shortSide,
      opts.foldCount, opts.foldSharpness, opts.wrinkleDepth, opts.seed));
  }, 0));
}

function solveFresh(opts) {
  const list = workers();
  if (!list.length) return solveHere(opts);
  return new Promise((resolve) => {
    const id = ++nextJob;
    const worker = list[turn++ % list.length];
    jobs.set(id, { resolve, worker, opts });
    const { width, height, seed, detail, foldCount, foldSharpness, wrinkleDepth } = opts;
    worker.postMessage({ id, width, height, seed, detail, foldCount, foldSharpness, wrinkleDepth });
  });
}

export function solve(opts) {
  const key = "v1:" + JSON.stringify([opts.width, opts.height, opts.seed, opts.detail, opts.foldCount, opts.foldSharpness, opts.wrinkleDepth]);
  if (solved.has(key)) return solved.get(key);
  const promise = recall(key).then((kept) => kept || solveFresh(opts).then((path) => {
    keep(key, path);
    return path;
  }));
  solved.set(key, promise);
  return promise;
}

// ----- Kept between visits -----
// The same seed always crumples the same way, so a solved sheet is kept in
// IndexedDB and the next visit's notes arrive without any solving at all.
// Anything going wrong here just means solving it again.
const STORE = "paths";
let db;

function database() {
  if (db) return db;
  db = new Promise((resolve) => {
    try {
      const request = indexedDB.open("daily-paper", 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  return db;
}

function recall(key) {
  return database().then((d) => d && new Promise((resolve) => {
    try {
      const request = d.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => {
        const v = request.result;
        resolve(v && v.samples && v.creased ? v : null);
      };
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  }));
}

function keep(key, path) {
  database().then((d) => {
    if (!d) return;
    try {
      d.transaction(STORE, "readwrite").objectStore(STORE).put({ samples: path.samples, creased: path.creased }, key);
    } catch (e) { /* not kept; it will be solved again next time */ }
  });
}
