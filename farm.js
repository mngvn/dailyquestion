// farm.js — "The Long Walk to the Farm" mini-game.
//
// Two walkers travel up toward a farm on either side of a train track.
// Every so often a train barrels down the track: while it passes you can't
// cross sides, and one side (left or right) has a pit or a monster. Read
// which side is dangerous and get BOTH walkers onto the safe side before
// the train arrives. Survive enough trains and you reach the farm.
//
// Timing is driven by setTimeout (not CSS animation), so the game stays
// playable even when prefers-reduced-motion freezes the visuals.

(function () {
  "use strict";

  const BEST_KEY = "daily.farmrun.best.v1";
  const GOAL = 10;          // trains to dodge to reach the farm
  const MILES = 60;

  const field = document.getElementById("fmField");
  const charA = document.getElementById("fmCharA");
  const charB = document.getElementById("fmCharB");
  const hazL = document.getElementById("fmHazL");
  const hazR = document.getElementById("fmHazR");
  const train = document.getElementById("fmTrain");
  const warn = document.getElementById("fmWarn");

  const scoreEl = document.getElementById("fmScore");
  const milesEl = document.getElementById("fmMiles");
  const bestEl = document.getElementById("fmBest");
  const hintEl = document.getElementById("fmHint");

  const startOv = document.getElementById("fmStart");
  const overOv = document.getElementById("fmOver");
  const winOv = document.getElementById("fmWin");
  const overTitle = document.getElementById("fmOverTitle");
  const overMsg = document.getElementById("fmOverMsg");
  const overScore = document.getElementById("fmOverScore");

  // walker positions (% from left) for each committed state
  const POS = {
    split: { a: 19, b: 81 },
    left:  { a: 13, b: 25 },
    right: { a: 75, b: 87 }
  };
  const TRAIN_START = "-56%";
  const TRAIN_END = "118%";

  // ----- State --------------------------------------------------------------
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) {}
  let state = "ready";        // ready | walk | warn | pass | over | win
  let side = "split";         // committed side of the pair
  let danger = "left";        // side the hazard is on
  let locked = false;         // input locked while the train passes
  let passes = 0;
  let timer = null;

  bestEl.textContent = best;

  // ----- Helpers ------------------------------------------------------------
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const setVar = (s) => field.style.setProperty("--sd", s + "s");

  function placeWalkers() {
    const p = POS[side];
    charA.style.left = p.a + "%";
    charB.style.left = p.b + "%";
  }

  function laneOf(which) {
    if (side === "split") return which === "a" ? "left" : "right";
    return side;
  }

  function resetTrain() {
    train.style.transition = "none";
    train.style.top = TRAIN_START;
    void train.offsetWidth; // commit before any future transition
  }

  function clearHazards() {
    [hazL, hazR].forEach((h) => {
      h.classList.remove("show", "pit", "monster");
    });
  }

  function scrollDuration() {
    // faster the further along you are
    return Math.max(0.55, 1.45 - passes * 0.09).toFixed(2);
  }
  function walkMs() { return Math.max(700, 1500 - passes * 80); }
  function warnMs() { return Math.max(560, 1250 - passes * 70); }
  const PASS_MS = 620;

  // ----- Input --------------------------------------------------------------
  function move(dir) {
    if (locked) return;
    if (state !== "walk" && state !== "warn") return;
    side = dir;
    placeWalkers();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { move("left"); }
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { move("right"); }
    else if ((e.key === " " || e.key === "Enter")) {
      if (state === "ready") { e.preventDefault(); startGame(); }
      else if (state === "over") { e.preventDefault(); startGame(); }
      else if (state === "win") { e.preventDefault(); startGame(); }
    }
  });

  document.getElementById("fmLeft").addEventListener("click", () => move("left"));
  document.getElementById("fmRight").addEventListener("click", () => move("right"));
  field.addEventListener("pointerdown", (e) => {
    if (state !== "walk" && state !== "warn") return;
    const r = field.getBoundingClientRect();
    move(e.clientX - r.left < r.width / 2 ? "left" : "right");
  });

  document.getElementById("fmStartBtn").addEventListener("click", startGame);
  document.getElementById("fmRetryBtn").addEventListener("click", startGame);
  document.getElementById("fmWinBtn").addEventListener("click", startGame);

  // ----- Game flow ----------------------------------------------------------
  function startGame() {
    clearTimeout(timer);
    startOv.hidden = true;
    overOv.hidden = true;
    winOv.hidden = true;
    field.classList.remove("fm-won");
    field.classList.add("fm-live");
    charA.classList.remove("fm-fall", "fm-eaten");
    charB.classList.remove("fm-fall", "fm-eaten");
    charA.style.opacity = charB.style.opacity = "";
    clearHazards();
    resetTrain();

    passes = 0;
    side = "split";
    locked = false;
    updateHud();
    setVar(scrollDuration());
    placeWalkers();
    field.focus({ preventScroll: true });

    state = "walk";
    timer = setTimeout(beginWarn, walkMs());
  }

  function updateHud() {
    scoreEl.textContent = passes;
    const miles = Math.max(0, MILES - Math.round((passes / GOAL) * MILES));
    milesEl.textContent = miles;
  }

  function beginWarn() {
    if (state !== "walk") return;
    state = "warn";
    danger = rand(["left", "right"]);
    const type = rand(["pit", "monster"]);
    const haz = danger === "left" ? hazL : hazR;
    haz.classList.add(type, "show");
    warn.classList.add("show");

    // train descends over the warn + pass window
    train.style.transition = "top " + (warnMs() + PASS_MS) + "ms linear";
    train.style.top = TRAIN_END;

    timer = setTimeout(beginPass, warnMs());
  }

  function beginPass() {
    if (state !== "warn") return;
    state = "pass";
    locked = true;
    warn.classList.remove("show");

    const safe = danger === "left" ? "right" : "left";
    if (side !== safe) {
      // someone is standing where the hazard is
      die();
      return;
    }
    timer = setTimeout(survive, PASS_MS);
  }

  function survive() {
    if (state !== "pass") return;
    passes += 1;
    locked = false;
    clearHazards();
    resetTrain();
    side = "split";
    placeWalkers();
    updateHud();

    if (passes >= GOAL) { winGame(); return; }

    setVar(scrollDuration());
    state = "walk";
    timer = setTimeout(beginWarn, walkMs());
  }

  function die() {
    state = "over";
    field.classList.remove("fm-live");
    const type = (danger === "left" ? hazL : hazR).classList.contains("pit") ? "pit" : "monster";

    // kill whichever walker(s) are on the danger lane
    [["a", charA], ["b", charB]].forEach(([key, el]) => {
      if (laneOf(key) === danger) el.classList.add(type === "pit" ? "fm-fall" : "fm-eaten");
    });

    if (passes > best) {
      best = passes;
      bestEl.textContent = best;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }

    overTitle.textContent = rand(["Oof.", "So close.", "Splat.", "Yikes."]);
    overMsg.textContent = type === "pit"
      ? rand([
          "Straight into the pit. Classic.",
          "There was a pit. You found the pit.",
          "The ground was a suggestion, apparently."
        ])
      : rand([
          "The monster was, in fact, on that side.",
          "Eaten. On the way to a farm. Tragic.",
          "Turns out that side had teeth."
        ]);
    overScore.textContent = passes;

    clearTimeout(timer);
    timer = setTimeout(() => { overOv.hidden = false; }, 700);
  }

  function winGame() {
    state = "win";
    field.classList.remove("fm-live");
    field.classList.add("fm-won");
    clearHazards();
    resetTrain();
    // walk the pair up into the farm
    side = "split";
    charA.style.transition = "left 0.8s ease, top 0.9s ease";
    charB.style.transition = "left 0.8s ease, top 0.9s ease";
    charA.style.left = "44%"; charB.style.left = "56%";
    charA.style.top = charB.style.top = "26%";

    if (passes > best) {
      best = passes;
      bestEl.textContent = best;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      winOv.hidden = false;
      // restore char transitions for next run
      charA.style.transition = charB.style.transition = "";
      charA.style.top = charB.style.top = "";
    }, 1400);
  }

  // ----- Boot ---------------------------------------------------------------
  resetTrain();
  placeWalkers();
  updateHud();
})();
