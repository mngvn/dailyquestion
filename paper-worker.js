// paper-worker.js — crumples paper off the main thread.
//
// Given a sheet's size and seed, it builds the same jittered mesh paper.js
// builds, runs the solver (paper-solver.js) and sends back the recorded frames
// and the creased sheet. The arrays are transferred, not copied.

import { buildMesh, createPaperPath } from "./paper-solver.js";

self.onmessage = (event) => {
  const { id, width, height, seed, detail, foldCount, foldSharpness, wrinkleDepth } = event.data;
  const mesh = buildMesh(width, height, seed, detail);
  const path = createPaperPath(mesh.original, mesh.indices, mesh.shortSide, foldCount, foldSharpness, wrinkleDepth, seed);
  const samples = path.samples.map((s) => (s instanceof Float32Array ? s : Float32Array.from(s)));
  self.postMessage({ id, samples, creased: path.creased }, [...samples.map((s) => s.buffer), path.creased.buffer]);
};
