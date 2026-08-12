// deck.js — deterministic daily dealing, shared by the trivia run and the
// fun facts.
//
// The rule both sections need: everybody gets the same item on the same day,
// and an item must not come back around until its whole pool has been used.
// A plain hash of the day number fails that badly — collisions bring the same
// item back within days.
//
// So each pool is dealt as a deck. The pool is split into two fixed halves by
// a permutation that never changes, and each cycle only shuffles *within* each
// half, always dealing the first half before the second. Every item still
// appears exactly once per cycle, and because an item can never cross into the
// other half, two sightings are always more than half a cycle apart.

window.Deck = (function () {
  "use strict";

  // mulberry32: small, fast, and identical in every browser, which matters
  // because everybody has to get the same content on the same day.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A seeded permutation of 0..n-1 (Fisher-Yates).
  function permute(n, seed) {
    const r = rng(seed);
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // The order a pool of n items is dealt in during one cycle. `lane` separates
  // pools that share a day counter (a difficulty tier, a fact category) so they
  // don't move in lockstep.
  function order(n, lane, cycle) {
    const half = Math.ceil(n / 2);
    const base = permute(n, lane * 2246822519 + 1013904223);
    const a = base.slice(0, half);
    const b = base.slice(half);
    const da = permute(a.length, cycle * 7919 + lane * 104729).map((i) => a[i]);
    const db = permute(b.length, cycle * 6151 + lane * 92821 + 7).map((i) => b[i]);
    return da.concat(db);
  }

  // Today's item from `pool`.
  function deal(pool, lane, dayNumber) {
    if (!pool || !pool.length) return null;
    const n = pool.length;
    const cycle = Math.floor(dayNumber / n);
    const pos = ((dayNumber % n) + n) % n;
    return pool[order(n, lane, cycle)[pos]];
  }

  return { rng: rng, permute: permute, order: order, deal: deal };
})();
