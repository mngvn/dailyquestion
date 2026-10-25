// cave.js — "Rare Air". A cave dive where every junction is a prompt ("Name a
// fruit") and the rarer your answer, the deeper the passage it opens.
//
// Rarity comes from crossroads.js, where each prompt's answers are sorted into
// tiers by how often people give them. Those tiers are an estimate, not a
// count: rarityOf() is the one place to blend in live answer counts later.
//
// Air is the clock. Every junction costs air, and breathing gets dearer the
// deeper you go (gas use scales with pressure); rare answers find air pockets.
// A common answer leads into a squeeze: the next prompt comes with a rule
// ("…without the letter E") and a lamp that burns down faster. An answer that
// isn't on the map is a dead end — you back out, lose air, and try the same
// junction again. Let the lamp run out and you lose more air and get pushed
// down a different, tighter passage.
//
// The map is a side-view cross-section drawn on the canvas: every passage you
// took, the ones you didn't, the dead ends, and your guideline through it all.
// At the end it becomes a card to share.
//
// The daily dive deals the same prompts to everyone and is saved after every
// move, so a reload picks up where you were. Free dives are random.

(function () {
  "use strict";

  const PROMPTS = window.CAVE_PROMPTS || [];
  const canvas = document.getElementById("caveCanvas");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- tiers ---------------------------------------------------------------
  // depth   metres the passage drops
  // air     refill from an air pocket at the bottom
  // squeeze the next junction is a squeeze
  const TIERS = {
    common:    { label: "Common",     emoji: "🟫", color: "#c4a984", depth: 10,  air: 0,  squeeze: true },
    clever:    { label: "Too clever", emoji: "👣", color: "#e3cf9f", depth: 15,  air: 0,  squeeze: true },
    uncommon:  { label: "Uncommon",   emoji: "🟩", color: "#5fd38d", depth: 30,  air: 0 },
    rare:      { label: "Rare",       emoji: "🟦", color: "#4fb3ff", depth: 60,  air: 8 },
    deep:      { label: "Deep cut",   emoji: "🟪", color: "#b98bff", depth: 85,  air: 15 },
    uncharted: { label: "Uncharted",  emoji: "💎", color: "#7df2ff", depth: 100, air: 25 },
  };
  const ORDER = ["common", "clever", "uncommon", "rare", "deep", "uncharted"];
  const DEAD_EMOJI = "🧱", LAMP_EMOJI = "🕯️";

  const STORIES = {
    common: [
      "You take the main tunnel. Fin scuffs everywhere — everybody comes this way. Ahead, it pinches into a squeeze.",
      "The obvious way. The silt is churned up by a thousand divers before you, and the walls start closing in.",
    ],
    clever: [
      "A secret shortcut! …with a guideline already tied off in it. Everyone thought of that one. It narrows to a squeeze.",
      "You were sure nobody else would think of it. The fin marks say otherwise — and the passage tightens.",
    ],
    uncommon: [
      "You slip into a side passage. Fewer fin marks here.",
      "A side tunnel most divers swim straight past. It slopes down into the dark.",
    ],
    rare: [
      "A narrow chimney drops away beneath you. At the bottom, a shimmering air pocket.",
      "You squeeze through a crack nobody else noticed and find a pocket of trapped air.",
    ],
    deep: [
      "You catch an underground river and ride the current down into the dark. There's air trapped in the ceiling where it slows.",
      "The floor gives way to a flooded shaft. You sink past rock no lamp has lit in years, and find a dome of air at the bottom.",
    ],
    uncharted: [
      "An uncharted chamber. No guideline has ever been laid here, so it's yours to name: the {name}.",
    ],
  };

  // ---- the dive --------------------------------------------------------------
  const AIR_MAX = 100;
  const DEAD_END_AIR = 6;           // backing out of a dead end
  const LAMP_OUT_AIR = 12;          // letting the lamp run out at a junction
  const LAMP_TIME = 25;             // seconds to answer…
  const SQUEEZE_TIME = 16;          // …or in a squeeze
  const breath = (depth) => 8 + depth / 70;

  const ZONES = [
    { from: 0, name: "The Cenote" },
    { from: 50, name: "Twilight Zone" },
    { from: 200, name: "Dark Zone" },
    { from: 500, name: "The Abyss" },
    { from: 1000, name: "The Deep Unknown" },
  ];
  const zoneAt = (d) => ZONES.reduce((z, x) => (d >= x.from ? x : z), ZONES[0]).name;

  // ---- dates & storage -------------------------------------------------------
  // Date.UTC of the local calendar date: one integer per local day, and no DST
  // hour can push two days onto the same number.
  const now = new Date();
  const dayNumber = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
  const diveNo = dayNumber - Date.UTC(2026, 9, 25) / 86400000 + 1;
  const DAILY_KEY = "cave.daily.v1";   // { day, run } — today's dive, saved as it goes
  const BEST_KEY = "cave.best.v1";     // { daily, free } — deepest metres

  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  const best = Object.assign({ daily: 0, free: 0 }, load(BEST_KEY));

  // ---- answers ---------------------------------------------------------------
  function norm(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/#/g, " sharp ")
      .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
      .replace(/^(a|an|the|some)\s+/, "");
  }
  const compact = (s) => norm(s).replace(/ /g, "");

  // Every spelling of every answer, keyed by its compact form.
  const indexes = new Map();
  function indexOf(p) {
    let idx = indexes.get(p);
    if (idx) return idx;
    idx = { byKey: new Map(), entries: [] };
    ORDER.forEach((tier) => {
      (p[tier] || "").split("|").forEach((raw) => {
        const aliases = raw.split("/").map((a) => a.trim()).filter(Boolean);
        if (!aliases.length) return;
        const entry = { tier, name: aliases[0], key: compact(aliases[0]) };
        idx.entries.push(entry);
        aliases.forEach((a) => {
          const key = compact(a);
          if (key && !idx.byKey.has(key)) idx.byKey.set(key, { entry, key });
        });
      });
    });
    indexes.set(p, idx);
    return idx;
  }

  // Plurals: "peaches" → "peach", "berries" → "berry", "grapes" → "grape".
  function variants(c) {
    return [c, c.replace(/ies$/, "y"), c.replace(/oes$/, "o"), c.replace(/es$/, ""), c.replace(/s$/, "")];
  }

  function lev(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return prev[b.length];
  }

  // The answer `text` names in prompt `p`, or null if it's not on the map.
  // Returns { entry: { tier, name, key }, key } where key is the spelling that
  // matched (a squeeze's rule is checked against what was written).
  //
  // This is the seam for live rarity: once answers are counted somewhere, the
  // tier can come from the share of divers who gave entry.name instead.
  function rarityOf(p, text) {
    const idx = indexOf(p);
    const c = compact(text);
    if (!c) return null;
    for (const v of variants(c)) {
      const hit = idx.byKey.get(v);
      if (hit) return hit;
    }
    // forgive a typo: one wrong letter in a longer word, two in a long one
    if (c.length < 5) return null;
    const allow = c.length >= 9 ? 2 : 1;
    let found = null, bestD = allow + 1, tie = false;
    idx.byKey.forEach((hit, key) => {
      if (Math.abs(key.length - c.length) > allow) return;
      const d = lev(c, key);
      if (d < bestD) { found = hit; bestD = d; tie = false; }
      else if (d === bestD && found && hit.entry !== found.entry) tie = true;
    });
    return found && !tie ? found : null;
  }

  // ---- squeezes --------------------------------------------------------------
  // A rule only makes a squeeze if plenty of answers survive it but at least
  // half of the obvious ones don't.
  const ruleCache = new Map();
  function rulesFor(p) {
    let rules = ruleCache.get(p);
    if (rules) return rules;
    const all = [];
    "aeiorsntl".split("").forEach((ch) =>
      all.push({ text: `without the letter ${ch.toUpperCase()}`, test: (w) => !w.includes(ch) }));
    "abcdefghiklmnoprstw".split("").forEach((ch) =>
      all.push({ text: `starting with ${ch.toUpperCase()}`, test: (w) => w[0] === ch }));
    [7, 9].forEach((n) => all.push({ text: `at least ${n} letters long`, test: (w) => w.length >= n }));
    [4, 5].forEach((n) => all.push({ text: `${n} letters or fewer`, test: (w) => w.length <= n }));
    "aey".split("").forEach((ch) =>
      all.push({ text: `ending in ${ch.toUpperCase()}`, test: (w) => w.endsWith(ch) }));
    const entries = indexOf(p).entries;
    const commons = entries.filter((e) => e.tier === "common");
    rules = all.filter((r) => {
      const fits = entries.filter((e) => r.test(e.key)).length;
      const easy = commons.filter((e) => r.test(e.key)).length;
      return fits >= 6 && easy <= commons.length / 2;
    });
    ruleCache.set(p, rules);
    return rules;
  }

  // ---- map geometry ----------------------------------------------------------
  // World units are pixels at scale 1; one metre of depth is YM pixels down.
  const YM = 2;
  const SURF = -120;                  // the jungle floor the cenote opens from
  const SHAPE = {                     // sideways travel and start/end width
    common:    { dx: [130, 170], w: [30, 14] },
    clever:    { dx: [110, 140], w: [24, 14] },
    uncommon:  { dx: [70, 100],  w: [22, 18] },
    rare:      { dx: [8, 26],    w: [14, 18] },
    deep:      { dx: [40, 80],   w: [24, 28] },
    uncharted: { dx: [20, 50],   w: [20, 24] },
  };
  // The three passage mouths at a junction — level, sloping, and a drop —
  // and which one each tier takes.
  const MOUTHS = [[0.98, 0.18], [0.7, 0.72], [0.12, 0.99]];
  const MOUTH_OF = { common: 0, clever: 0, uncommon: 1, rare: 2, deep: 2, uncharted: 2 };
  // Dead ends fan out up and back, away from the mouths.
  const DEAD_DIRS = [[-0.9, -0.45], [0.95, -0.3], [-0.6, -0.8], [0.55, -0.85], [-1, 0.05], [0.2, -1]];

  const rand = (a, b) => a + Math.random() * (b - a);
  const r1 = (n) => Math.round(n * 10) / 10;

  // A passage from `from` that ends exactly at from + (dx, dy), with a gentle
  // bend so it doesn't look ruled.
  function passage(from, dx, dy, bend) {
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const amp = rand(-1, 1) * Math.min(bend, len * 0.12);
    const n = Math.max(3, Math.round(len / 24));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = Math.sin(Math.PI * t) * amp + (i && i < n ? rand(-2.5, 2.5) : 0);
      pts.push([r1(from[0] + dx * t + nx * w), r1(from[1] + dy * t + ny * w)]);
    }
    return pts;
  }

  // ---- state -----------------------------------------------------------------
  let run = null;
  let phase = "intro";               // intro | ask | result | over
  let lampT = 0, lampMax = LAMP_TIME;
  let anim = null;                   // the diver swimming a passage
  let resultAt = 0;
  const diver = { x: 0, y: 0, a: Math.PI / 2 };
  const cam = { x: 0, y: SURF / 2, s: 1 };
  let bubbles = [], bubbleClock = 0, clock = 0;

  function newRun(mode) {
    const n = PROMPTS.length;
    let order;
    if (mode === "daily") order = Deck.permute(n, dayNumber * 7919 + 1013);
    else {
      order = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return {
      v: 1, mode, day: dayNumber, order, ptr: 0,
      depth: 0, air: AIR_MAX, junction: 1,
      tight: false, rule: null, dir: 1, mouths: null,
      tried: [], log: [], segs: [], nx: 0, ny: 0, over: false,
    };
  }

  const current = () => PROMPTS[run.order[run.ptr % run.order.length] % PROMPTS.length];
  function currentRule() {
    if (!run.rule) return null;
    return rulesFor(current()).find((r) => r.text === run.rule) || null;
  }
  function pickRule(p) {
    const rules = rulesFor(p);
    if (!rules.length) return null;
    const r = run.mode === "daily" ? Deck.rng(dayNumber * 31 + run.ptr * 977 + 7)() : Math.random();
    return rules[Math.floor(r * rules.length)].text;
  }
  const promptLabel = () => current().q + (run.rule ? ` — ${run.rule}` : "");

  function persist() {
    if (run && run.mode === "daily") save(DAILY_KEY, { day: dayNumber, run });
  }

  // ---- the junction ----------------------------------------------------------
  const panel = $("cavePanel"), input = $("caveInput");

  function openJunction() {
    if (!run.mouths) {
      // keep the route on screen: head back toward the middle when it strays
      if (Math.abs(run.nx) > 220) run.dir = run.nx > 0 ? -1 : 1;
      else if (run.junction > 1 && Math.random() < 0.35) run.dir = -run.dir;
      run.mouths = MOUTHS.map(([mx, my]) => {
        const len = rand(38, 50);
        return passage([run.nx, run.ny], mx * run.dir * len, my * len, 4);
      });
      persist();
    }
    $("caveJunction").textContent = `Junction ${run.junction}`;
    $("caveSqueeze").hidden = !run.tight;
    $("caveQ").textContent = current().q;
    const rule = $("caveRule");
    rule.hidden = !run.rule;
    rule.textContent = run.rule ? `…${run.rule}` : "";
    lampMax = run.tight ? SQUEEZE_TIME : LAMP_TIME;
    lampT = lampMax;
    phase = "ask";
    $("caveAsk").hidden = false;
    $("caveResult").hidden = true;
    note("");
    input.value = "";
    input.focus({ preventScroll: true });
    hud();
  }

  function note(text, bad) {
    const el = $("caveNote");
    el.textContent = text;
    el.classList.toggle("bad", !!bad);
  }

  function shake() {
    panel.classList.remove("shake");
    void panel.offsetWidth;            // restart the animation
    panel.classList.add("shake");
  }

  function submit() {
    if (phase !== "ask") return;
    const typed = input.value.trim();
    const key = compact(typed);
    if (!key) return;
    if (run.tried.includes(key)) {
      note("You already backed out of that one. Try another way.", true);
      shake();
      return;
    }
    const hit = rarityOf(current(), typed);
    const rule = currentRule();
    if (!hit) deadEnd(typed, `Dead end. “${typed}” isn't on any map. Back out and try another way.`);
    else if (rule && !rule.test(hit.key)) deadEnd(typed, `Too tight. In this squeeze it has to be ${rule.text}.`);
    else advance(hit, typed, rule);
  }

  function deadEnd(typed, msg) {
    run.air = Math.max(0, run.air - DEAD_END_AIR);
    run.tried.push(compact(typed));
    run.log.push({ q: promptLabel(), a: typed, tier: "dead" });
    const k = run.segs.filter((s) => s.kind === "dead" && s.j === run.junction).length;
    const [dx, dy] = DEAD_DIRS[k % DEAD_DIRS.length];
    const len = rand(44, 60);
    const pts = passage([run.nx, run.ny], dx * run.dir * len, dy * len, 6);
    run.segs.push({ kind: "dead", j: run.junction, pts, w0: 14, w1: 7 });
    anim = { pts, t: 0, dur: reduceMotion ? 0.01 : 1.1, back: true };
    persist();
    hud();
    input.value = "";
    note(msg, true);
    shake();
    if (run.air <= 0) finish();
  }

  function lampOut() {
    run.air = Math.max(0, run.air - LAMP_OUT_AIR);
    run.log.push({ q: promptLabel(), a: "", tier: "lamp" });
    run.ptr++;
    run.tight = true;
    run.rule = pickRule(current());
    run.tried = [];
    persist();
    if (run.air <= 0) { hud(); finish(); return; }
    openJunction();
    note("Your lamp gutters out. You feel your way to a different passage — a tight one.", true);
    shake();
  }

  function advance(hit, typed, rule) {
    const tier = hit.entry.tier;
    const T = TIERS[tier];
    const p = current();
    const label = promptLabel();
    const used = breath(run.depth);
    const s = SHAPE[tier];
    const pts = passage([run.nx, run.ny], run.dir * rand(s.dx[0], s.dx[1]), T.depth * YM, 18);
    const seg = { kind: "path", tier, pts, w0: s.w[0], w1: s.w[1], label: hit.entry.name, dir: run.dir };
    if (T.air) seg.pocket = true;
    if (tier === "uncharted") seg.chamber = chamberName(hit.entry.name);
    // the passages you didn't take stay on the map
    (run.mouths || []).forEach((m, i) => {
      if (i !== MOUTH_OF[tier]) run.segs.push({ kind: "stub", pts: m, w0: 13, w1: 4 });
    });
    run.segs.push(seg);

    const end = pts[pts.length - 1];
    run.nx = end[0];
    run.ny = end[1];
    run.depth += T.depth;
    run.air = Math.max(0, Math.min(AIR_MAX, run.air - used + T.air));
    run.log.push({ q: label, a: hit.entry.name, tier });
    run.junction++;
    run.ptr++;
    run.tried = [];
    run.mouths = null;
    run.tight = !!T.squeeze;
    run.rule = run.tight ? pickRule(current()) : null;
    persist();

    anim = { pts, t: 0, dur: reduceMotion ? 0.01 : 1.4 };
    showResult(tier, hit.entry.name, typed, used, p, rule, seg.chamber);
  }

  function chamberName(name) {
    return name.replace(/\b[a-z]/g, (c) => c.toUpperCase()) + " Chamber";
  }

  function showResult(tier, name, typed, used, p, rule, chamber) {
    const T = TIERS[tier];
    phase = "result";
    $("caveAsk").hidden = true;
    $("caveResult").hidden = false;

    const tierEl = $("caveTier");
    tierEl.textContent = `${T.emoji} ${T.label}`;
    tierEl.style.color = T.color;
    const said = document.createElement("small");
    said.textContent = compact(typed) === compact(name) ? `“${name}”` : `“${typed}” → ${name}`;
    tierEl.appendChild(said);

    const lines = STORIES[tier];
    $("caveStory").textContent = lines[Math.floor(Math.random() * lines.length)].replace("{name}", chamber || "");

    const gain = [`+${T.depth} m`, `breathed ${Math.round(used)} air`];
    if (T.air) gain.push(`air pocket +${T.air}`);
    if (T.squeeze) gain.push("squeeze ahead");
    $("caveGain").textContent = gain.join(" · ");

    // the answers most divers would have given here
    const trodden = indexOf(p).entries
      .filter((e) => e.tier === "common" && (!rule || rule.test(e.key)))
      .slice(0, 3).map((e) => e.name);
    $("caveTrodden").textContent = !trodden.length ? ""
      : tier === "common" ? `You and most divers: ${trodden.join(" · ")}`
      : `The well-trodden way: ${trodden.join(" · ")}`;

    resultAt = performance.now();
    const next = $("caveNext");
    next.textContent = run.air <= 0 ? "Tank's on reserve — head up ↑" : "Keep diving ↓";
    next.focus({ preventScroll: true });
    hud();
  }

  function next() {
    // the Enter that submitted the answer (or a held one) shouldn't skip past it
    if (phase !== "result" || performance.now() - resultAt < 450) return;
    if (run.air <= 0) finish();
    else openJunction();
  }

  // ---- HUD -------------------------------------------------------------------
  function hud() {
    if (!run) return;
    $("caveDepth").textContent = run.depth;
    const a = Math.round(run.air);
    $("caveAir").textContent = a;
    $("caveAirBar").style.width = `${a}%`;
    $("caveAirWrap").classList.toggle("warn", a <= 25);
    $("caveZone").textContent = zoneAt(run.depth);
    $("caveBest").textContent = Math.max(best[run.mode] || 0, run.depth);
    $("caveChip").textContent = run.mode === "daily" ? `🔦 daily dive #${diveNo}` : "🔦 free dive";
  }

  // ---- starting & ending -----------------------------------------------------
  function todaysRun() {
    const saved = load(DAILY_KEY);
    return saved && saved.day === dayNumber && saved.run && saved.run.v === 1 ? saved.run : null;
  }

  function intro() {
    phase = "intro";
    run = null;
    anim = null;
    $("caveOver").hidden = true;
    panel.hidden = true;
    $("caveHud").hidden = true;
    $("caveChip").textContent = "🔦 rare air";
    const today = todaysRun();
    $("caveDaily").textContent = !today ? `▶ Today's dive · #${diveNo}`
      : today.over ? `See today's dive · ${today.depth} m`
      : `▶ Resume today's dive · ${today.depth} m`;
    const bestLine = Math.max(best.daily, best.free)
      ? `Your deepest: ${best.daily} m on a daily dive, ${best.free} m free diving.`
      : "Everyone gets the same cave each day. Free dives are random.";
    $("caveIntroBest").textContent = bestLine;
    $("caveIntro").hidden = false;
    $("caveDaily").focus({ preventScroll: true });
  }

  function begin(mode) {
    run = mode === "daily" ? todaysRun() || newRun("daily") : newRun("free");
    $("caveIntro").hidden = true;
    $("caveOver").hidden = true;
    diver.x = run.nx;
    diver.y = run.ny;
    bubbles = [];
    if (run.over || run.air <= 0) { finish(); return; }
    $("caveHud").hidden = false;
    panel.hidden = false;
    persist();
    openJunction();
  }

  function finish() {
    run.over = true;
    phase = "over";
    persist();
    if (run.depth > (best[run.mode] || 0)) {
      best[run.mode] = run.depth;
      save(BEST_KEY, best);
    }
    hud();
    panel.hidden = true;
    showOver();
  }

  function rarest() {
    let top = null;
    run.log.forEach((l) => {
      const i = ORDER.indexOf(l.tier);
      if (i >= 0 && (!top || i >= ORDER.indexOf(top.tier))) top = l;
    });
    return top;
  }

  function showOver() {
    const top = rarest();
    const chambers = run.segs.filter((s) => s.chamber).map((s) => s.chamber);
    const deadEnds = run.log.filter((l) => l.tier === "dead").length;
    const passages = run.log.filter((l) => TIERS[l.tier]).length;

    $("caveOverTitle").textContent = `${run.depth} m down`;
    $("caveOverMsg").textContent = run.depth
      ? `Your tank hit reserve in the ${zoneAt(run.depth).replace(/^The /, "")}, and you followed your guideline back to daylight.`
      : "Your tank hit reserve before you found a way down. The cave will be here tomorrow.";
    const stats = [`${passages} passage${passages === 1 ? "" : "s"}`, `${deadEnds} dead end${deadEnds === 1 ? "" : "s"}`];
    if (top) stats.push(`rarest find: “${top.a}” (${TIERS[top.tier].label})`);
    if (chambers.length) stats.push(`named ${chambers.join(", ")}`);
    $("caveOverStats").textContent = stats.join(" · ");

    const list = $("caveRecap");
    list.textContent = "";
    run.log.forEach((l) => {
      const li = document.createElement("li");
      const em = document.createElement("span");
      em.textContent = TIERS[l.tier] ? TIERS[l.tier].emoji : l.tier === "dead" ? DEAD_EMOJI : LAMP_EMOJI;
      const what = document.createElement("span");
      what.textContent = `${l.q}: ${l.a ? `“${l.a}”` : "—"}`;
      const tag = document.createElement("span");
      tag.textContent = TIERS[l.tier] ? TIERS[l.tier].label : l.tier === "dead" ? "dead end" : "lamp out";
      li.append(em, what, tag);
      list.appendChild(li);
    });

    $("caveAgain").textContent = run.mode === "daily" ? "Free dive" : "Dive again";
    const share = $("caveShare");
    share.textContent = "Save map image";
    $("caveCard").removeAttribute("src");
    $("caveOver").hidden = false;
    $("caveCopy").focus({ preventScroll: true });
    makeCard();
  }

  // ---- sharing ---------------------------------------------------------------
  const pageUrl = () => location.origin + location.pathname;

  function shareText() {
    const head = run.mode === "daily" ? `🔦 Rare Air · Daily dive #${diveNo}` : "🔦 Rare Air · Free dive";
    const route = run.log.map((l) => (TIERS[l.tier] ? TIERS[l.tier].emoji : l.tier === "dead" ? DEAD_EMOJI : LAMP_EMOJI)).join("");
    const top = rarest();
    const lines = [head, `${run.depth} m down · ${zoneAt(run.depth)}`, route];
    if (top) lines.push(`Rarest find: “${top.a}” (${TIERS[top.tier].label})`);
    lines.push(pageUrl());
    return lines.join("\n");
  }

  function flash(btn, text) {
    const was = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = was; }, 1600);
  }

  function copyResult() {
    const text = shareText();
    const btn = $("caveCopy");
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* ignore */ }
      ta.remove();
      flash(btn, ok ? "Copied ✓" : "Couldn't copy");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => flash(btn, "Copied ✓"), fallback);
    } else fallback();
  }

  let cardFile = null;
  function makeCard() {
    cardFile = null;
    const forRun = run;
    const draw = () => {
      if (run !== forRun) return;
      const c = drawCard();
      $("caveCard").src = c.toDataURL("image/png");
      $("caveCard").alt = `Map of a ${run.depth} metre dive through the cave`;
      c.toBlob((blob) => {
        if (!blob || run !== forRun) return;
        const file = new File([blob], `rare-air-${run.depth}m.png`, { type: "image/png" });
        cardFile = file;
        if (navigator.canShare && navigator.canShare({ files: [file] })) $("caveShare").textContent = "Share map";
      }, "image/png");
    };
    // the card is drawn with the page's fonts
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    else draw();
  }

  function shareCard() {
    if (!cardFile) return;
    if (navigator.canShare && navigator.canShare({ files: [cardFile] })) {
      navigator.share({ files: [cardFile], text: shareText() }).catch(() => { /* dismissed */ });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(cardFile);
    a.download = cardFile.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    flash($("caveShare"), "Saved ✓");
  }

  // ---- drawing ---------------------------------------------------------------
  const WATER = [[0, [46, 134, 140]], [100, [30, 96, 120]], [300, [18, 60, 92]], [700, [10, 34, 62]], [1500, [6, 18, 38]]];
  const ROCK = [[0, [74, 62, 50]], [150, [56, 47, 39]], [500, [38, 32, 28]], [1200, [24, 21, 19]], [3000, [14, 12, 11]]];
  function mixAt(stops, d, dim) {
    let i = 0;
    while (i < stops.length - 2 && d > stops[i + 1][0]) i++;
    const [d0, c0] = stops[i], [d1, c1] = stops[i + 1];
    const t = Math.max(0, Math.min(1, (d - d0) / (d1 - d0)));
    const k = dim || 1;
    return `rgb(${c0.map((v, j) => Math.round((v + (c1[j] - v) * t) * k)).join(",")})`;
  }

  // Speckled rock, tiled. Built once.
  const texture = (() => {
    const t = document.createElement("canvas");
    t.width = t.height = 180;
    const g = t.getContext("2d");
    for (let i = 0; i < 900; i++) {
      const light = Math.random() < 0.45;
      g.fillStyle = light ? `rgba(255,240,220,${rand(0.02, 0.07)})` : `rgba(0,0,0,${rand(0.08, 0.22)})`;
      const r = rand(0.6, 2.8);
      g.beginPath();
      g.ellipse(rand(0, 180), rand(0, 180), r * rand(1, 2.4), r, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (let y = 8; y < 180; y += rand(16, 34)) {        // faint bedding planes
      g.strokeStyle = `rgba(0,0,0,${rand(0.08, 0.16)})`;
      g.lineWidth = rand(0.6, 1.6);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 180; x += 30) g.lineTo(x, y + rand(-2, 2));
      g.lineTo(180, y);
      g.stroke();
    }
    return t;
  })();
  let rockPattern = null;

  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // a passage's own seed, so its decorations don't change as others scroll in and out of view
  const seedOf = (s) => Math.round(s.pts[0][0] * 13 + s.pts[0][1] * 7);

  const bboxes = new WeakMap();
  function bbox(seg) {
    let b = bboxes.get(seg);
    if (!b) {
      b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      seg.pts.forEach(([x, y]) => {
        b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
        b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      });
      const pad = Math.max(seg.w0, seg.w1) + (seg.chamber ? 80 : 20);
      b.x0 -= pad; b.y0 -= pad + (seg.pocket ? 20 : 0); b.x1 += pad; b.y1 += pad;
      bboxes.set(seg, b);
    }
    return b;
  }

  function strokeTaper(g, pts, w0, w1, pad, min) {
    for (let i = 1; i < pts.length; i++) {
      const t = (i - 0.5) / (pts.length - 1);
      g.lineWidth = Math.max(w0 + (w1 - w0) * t, min || 0) + pad;
      g.beginPath();
      g.moveTo(pts[i - 1][0], pts[i - 1][1]);
      g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }
  }

  const SHAFT = { kind: "shaft", pts: [[0, SURF], [0, SURF / 2], [0, 0]], w0: 110, w1: 46 };
  const midDepth = (seg) => (seg.pts[0][1] + seg.pts[seg.pts.length - 1][1]) / 2 / YM;

  // Draws the cave into `g`. v maps the world onto a screen rectangle:
  //   rect {x, y, w, h}, anchor {ax, ay} inside it, world point (cx, cy), scale s
  // o.live adds the diver and the open mouths. For the card (not live), o.ui
  // fixes text and lines at a pixel size however far the map is zoomed out,
  // o.minW keeps passages visible, and o.maxLabels names only the rarest finds.
  function paint(g, v, o) {
    const segs = run ? run.segs : [];
    const px = (n) => (o.live ? n : (n * (o.ui || 1)) / v.s);
    const minW = (s) => (o.live ? 0 : ((o.minW || 0) / v.s) * (s.kind === "path" || s.kind === "shaft" ? 1 : 0.6));
    let labelled = null;
    if (!o.live && o.maxLabels) {
      const paths = segs.filter((s) => s.kind === "path");
      labelled = new Set(paths.slice().sort((a, b) => ORDER.indexOf(b.tier) - ORDER.indexOf(a.tier)).slice(0, o.maxLabels));
    }
    const vx0 = v.cx - v.ax / v.s, vx1 = v.cx + (v.w - v.ax) / v.s;
    const vy0 = v.cy - v.ay / v.s, vy1 = v.cy + (v.h - v.ay) / v.s;
    const seen = (s) => { const b = bbox(s); return b.x1 > vx0 && b.x0 < vx1 && b.y1 > vy0 && b.y0 < vy1; };

    g.save();
    g.beginPath();
    g.rect(v.x, v.y, v.w, v.h);
    g.clip();
    g.translate(v.x + v.ax, v.y + v.ay);
    g.scale(v.s, v.s);
    g.translate(-v.cx, -v.cy);

    // rock, darkening with depth
    const rockTop = Math.max(vy0, SURF);
    if (vy1 > rockTop) {
      const grad = g.createLinearGradient(0, SURF, 0, 3000 * YM);
      ROCK.forEach(([d, c]) => grad.addColorStop(Math.max(0, (d * YM - SURF) / (3000 * YM - SURF)), `rgb(${c.join(",")})`));
      g.fillStyle = grad;
      g.fillRect(vx0, rockTop, vx1 - vx0, vy1 - rockTop);
      if (!rockPattern) rockPattern = g.createPattern(texture, "repeat");
      g.globalAlpha = 0.9;
      g.fillStyle = rockPattern;
      g.fillRect(vx0, rockTop, vx1 - vx0, vy1 - rockTop);
      g.globalAlpha = 1;
    }
    // sky and the jungle floor above the cenote
    if (vy0 < SURF) {
      const sky = g.createLinearGradient(0, SURF - 400, 0, SURF);
      sky.addColorStop(0, "#0b1424");
      sky.addColorStop(1, "#2c5161");
      g.fillStyle = sky;
      g.fillRect(vx0, vy0, vx1 - vx0, SURF - vy0);
      g.fillStyle = "#0a130f";
      g.beginPath();
      g.moveTo(vx0, SURF + 2);
      for (let x = Math.floor(vx0 / 18) * 18; x <= vx1 + 18; x += 18) {
        if (Math.abs(x) < 64) { g.lineTo(x, SURF + 2); continue; }
        g.lineTo(x, SURF - 4 - hash(x) * 22 - (hash(x * 3) > 0.8 ? 26 : 0));
      }
      g.lineTo(vx1, SURF + 2);
      g.closePath();
      g.fill();
    }

    g.save();
    g.beginPath();
    g.rect(vx0, SURF, vx1 - vx0, Math.max(0, vy1 - SURF));
    g.clip();

    const drawn = [SHAFT].concat(segs.filter(seen));
    const mouths = o.live && run && run.mouths && (phase === "ask") ? run.mouths : [];
    g.lineCap = "round";
    g.lineJoin = "round";

    // passage walls, then the water inside them
    g.strokeStyle = "rgba(150,128,104,0.55)";
    drawn.forEach((s) => strokeTaper(g, s.pts, s.w0, s.w1, 7, minW(s)));
    mouths.forEach((m) => strokeTaper(g, m, 16, 6, 6));
    drawn.forEach((s) => {
      if (s.chamber) {
        const [x, y] = s.pts[s.pts.length - 1];
        g.fillStyle = "rgba(150,128,104,0.55)";
        g.beginPath(); g.ellipse(x, y, 78, 50, 0, 0, Math.PI * 2); g.fill();
      }
    });
    drawn.forEach((s) => {
      g.strokeStyle = mixAt(WATER, s.kind === "shaft" ? 0 : midDepth(s), s.kind === "stub" ? 0.7 : 1);
      strokeTaper(g, s.pts, s.w0, s.w1, 0, minW(s));
      if (s.chamber) {
        const [x, y] = s.pts[s.pts.length - 1];
        g.fillStyle = mixAt(WATER, midDepth(s));
        g.beginPath(); g.ellipse(x, y, 72, 44, 0, 0, Math.PI * 2); g.fill();
      }
    });
    if (mouths.length) {
      g.strokeStyle = mixAt(WATER, run.depth, 0.8);
      mouths.forEach((m) => strokeTaper(g, m, 16, 6, 0));
    }

    // light falling into the cenote
    if (vy0 < 20) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const rays = g.createLinearGradient(0, SURF, 0, 0);
      rays.addColorStop(0, "rgba(190,240,230,0.2)");
      rays.addColorStop(1, "rgba(190,240,230,0)");
      g.fillStyle = rays;
      [[-46, -30, -22, -10], [-14, 4, -6, 8], [16, 36, 6, 20]].forEach(([a, b, c, d], i) => {
        const sway = Math.sin(clock * 0.6 + i * 2) * 3;
        g.beginPath();
        g.moveTo(a, SURF); g.lineTo(b, SURF); g.lineTo(d + sway, 0); g.lineTo(c + sway, 0);
        g.closePath(); g.fill();
      });
      g.restore();
      g.strokeStyle = "rgba(210,250,245,0.6)";
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(-54, SURF + 3); g.lineTo(54, SURF + 3); g.stroke();
    }

    // stalactites and stalagmites along the flatter passages
    g.fillStyle = "rgba(96,82,68,0.95)";
    drawn.forEach((s) => {
      if (s.kind !== "path") return;
      const si = seedOf(s);
      const [ax, ay] = s.pts[0], [bx, by] = s.pts[s.pts.length - 1];
      if (Math.abs(by - ay) > Math.abs(bx - ax) * 0.8) return;
      for (let i = 1; i < s.pts.length - 1; i++) {
        const [x, y] = s.pts[i];
        const w = s.w0 + (s.w1 - s.w0) * (i / (s.pts.length - 1));
        const h1 = 3 + hash(si * 31 + i) * 7, h2 = 2 + hash(si * 17 + i * 3) * 5;
        g.beginPath(); g.moveTo(x - 3, y - w / 2 - 1); g.lineTo(x + 3, y - w / 2 - 1); g.lineTo(x, y - w / 2 + h1); g.fill();
        if (hash(si + i * 7) > 0.5) {
          g.beginPath(); g.moveTo(x - 3 + 6, y + w / 2 + 1); g.lineTo(x + 3 + 6, y + w / 2 + 1); g.lineTo(x + 6, y + w / 2 - h2); g.fill();
        }
      }
    });

    // rubble at the end of each dead end
    drawn.forEach((s) => {
      if (s.kind !== "dead") return;
      const si = seedOf(s);
      const [x, y] = s.pts[s.pts.length - 1];
      g.fillStyle = "rgba(120,104,88,1)";
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(x + (hash(si * 9 + i) - 0.5) * 9, y + (hash(si * 5 + i * 2) - 0.5) * 7, 2 + hash(si + i) * 2.4, 0, Math.PI * 2);
        g.fill();
      }
    });

    // an underground river runs through the deep cuts
    g.save();
    g.setLineDash([7, 15]);
    g.lineDashOffset = -clock * 26;
    g.strokeStyle = "rgba(160,220,255,0.35)";
    g.lineWidth = 1.6;
    drawn.forEach((s) => {
      if (s.tier !== "deep") return;
      g.beginPath();
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    });
    g.restore();

    // air pockets trapped in the ceiling
    drawn.forEach((s) => {
      if (!s.pocket) return;
      const [x, y] = s.pts[s.pts.length - 1];
      const top = y - s.w1 / 2 - (s.chamber ? 38 : 2);
      g.fillStyle = "rgba(205,235,255,0.28)";
      g.beginPath(); g.ellipse(x, top + 4, 16, 9, 0, Math.PI, 0); g.fill();
      g.strokeStyle = "rgba(225,245,255,0.7)";
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x - 15, top + 4); g.lineTo(x + 15, top + 4); g.stroke();
    });

    // crystals in an uncharted chamber
    drawn.forEach((s) => {
      if (!s.chamber) return;
      const si = seedOf(s);
      const [cx, cy] = s.pts[s.pts.length - 1];
      for (let i = 0; i < 14; i++) {
        const a = hash(si * 13 + i) * Math.PI * 2;
        const x = cx + Math.cos(a) * 70, y = cy + Math.sin(a) * 42;
        const tw = 0.55 + 0.45 * Math.sin(clock * 2 + i);
        g.fillStyle = `rgba(125,242,255,${0.35 + 0.5 * tw})`;
        const h = 5 + hash(i * 3 + si) * 7;
        g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + 2.4, y); g.lineTo(x, y + h * 0.4); g.lineTo(x - 2.4, y); g.closePath(); g.fill();
      }
    });

    // depth zones
    g.font = `600 ${px(11)}px Inter, sans-serif`;
    g.textAlign = "left";
    ZONES.slice(1).forEach((z) => {
      const y = z.from * YM;
      if (y < vy0 || y > vy1) return;
      g.strokeStyle = "rgba(125,242,255,0.16)";
      g.lineWidth = px(1);
      g.setLineDash([px(5), px(7)]);
      g.beginPath(); g.moveTo(vx0, y); g.lineTo(vx1, y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = "rgba(170,220,230,0.5)";
      g.fillText(`${z.from} m · ${z.name}`, vx0 + 12 / v.s, y - px(5));
    });

    // the guideline, tied off at the surface and run through every passage
    const route = [[0, SURF + 8], [0, 0]];
    segs.forEach((s) => { if (s.kind === "path") route.push(...s.pts.slice(1)); });
    g.strokeStyle = "rgba(255,214,110,0.85)";
    g.lineWidth = px(1.4);
    g.beginPath();
    route.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    // line arrows point the way out, as they do on a real guideline
    g.fillStyle = "rgba(255,214,110,0.9)";
    segs.forEach((s) => {
      if (s.kind !== "path" || !seen(s)) return;
      const [x0, y0] = s.pts[0], [x1, y1] = s.pts[1];
      const a = Math.atan2(y0 - y1, x0 - x1);
      g.save(); g.translate((x0 + x1) / 2, (y0 + y1) / 2); g.rotate(a); g.scale(px(1), px(1));
      g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -3.5); g.lineTo(-3, 3.5); g.closePath(); g.fill();
      g.restore();
    });

    // what you said at each junction
    const font = `600 ${px(13)}px Inter, sans-serif`;
    g.font = font;
    segs.forEach((s) => {
      if (s.kind !== "path" || !seen(s)) return;
      const [x, y] = s.pts[s.pts.length - 1];
      g.fillStyle = TIERS[s.tier].color;
      g.beginPath(); g.arc(x, y, px(2.6), 0, Math.PI * 2); g.fill();
      if (s.chamber) {
        g.textAlign = "center";
        g.font = `italic ${font}`;
        g.fillText(s.chamber, x, y + 50 + px(14));
        g.font = font;
        return;
      }
      if (labelled && !labelled.has(s)) return;
      g.textAlign = s.dir > 0 ? "left" : "right";
      g.fillText(s.label, x + s.dir * (s.w1 / 2 + px(6)), y - s.w1 / 2 - px(5));
    });

    if (o.live && run) {
      // the mouths glow faintly where they open into the dark
      mouths.forEach((m, i) => {
        const [x, y] = m[m.length - 1];
        g.fillStyle = `rgba(125,242,255,${0.12 + 0.1 * Math.sin(clock * 2.4 + i * 2)})`;
        g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
      });
      bubbles.forEach((b) => {
        g.strokeStyle = `rgba(220,245,255,${0.55 * (1 - b.age / b.life)})`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.stroke();
      });
      drawDiver(g);
    }
    g.restore();      // waterline clip
    g.restore();
  }

  function drawDiver(g) {
    g.save();
    g.translate(diver.x, diver.y);
    g.rotate(diver.a);
    // lamp beam
    const beam = g.createLinearGradient(0, 0, 90, 0);
    beam.addColorStop(0, "rgba(255,226,150,0.32)");
    beam.addColorStop(1, "rgba(255,226,150,0)");
    g.fillStyle = beam;
    g.beginPath(); g.moveTo(6, 0); g.lineTo(90, -26); g.lineTo(90, 26); g.closePath(); g.fill();
    // fins, body, tank, head
    const kick = Math.sin(clock * (anim ? 14 : 5)) * 3;
    g.fillStyle = "#1b2a33";
    g.beginPath(); g.moveTo(-9, 0); g.lineTo(-17, -4 + kick); g.lineTo(-17, 4 + kick); g.closePath(); g.fill();
    g.fillStyle = "#f2b84b";
    g.beginPath(); g.ellipse(-1, 0, 9, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#8fa3ad";
    g.fillRect(-6, -5.6, 8, 2.6);
    g.fillStyle = "#f6d9a8";
    g.beginPath(); g.arc(8, 0, 3.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff4cf";
    g.beginPath(); g.arc(10.4, -1.2, 1.3, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ---- the share card --------------------------------------------------------
  function routeBounds() {
    const b = { x0: -90, x1: 90, y0: SURF - 40, y1: 40 };
    run.segs.forEach((s) => {
      const k = bbox(s);
      b.x0 = Math.min(b.x0, k.x0); b.x1 = Math.max(b.x1, k.x1);
      b.y0 = Math.min(b.y0, k.y0); b.y1 = Math.max(b.y1, k.y1);
    });
    return b;
  }

  function fitView(rect, b, maxScale) {
    const s = Math.min(rect.w / (b.x1 - b.x0), rect.h / (b.y1 - b.y0), maxScale);
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, ax: rect.w / 2, ay: rect.h / 2,
      cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s };
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawCard() {
    const W = 1080, H = 1350;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0c1a24");
    bg.addColorStop(1, "#04060c");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    g.textAlign = "left";
    g.fillStyle = "#ffcf6b";
    g.font = "700 40px 'Space Grotesk', sans-serif";
    g.fillText("RARE AIR", 64, 96);
    g.fillStyle = "#8b9bb0";
    g.font = "500 28px Inter, sans-serif";
    const when = now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    g.fillText(run.mode === "daily" ? `Daily dive #${diveNo} · ${when}` : `Free dive · ${when}`, 64, 140);

    g.textAlign = "right";
    g.fillStyle = "#f5f6ff";
    g.font = "700 120px 'Space Grotesk', sans-serif";
    g.fillText(`${run.depth} m`, W - 64, 150);
    g.fillStyle = "#4fd1c5";
    g.font = "600 28px Inter, sans-serif";
    g.fillText(zoneAt(run.depth), W - 64, 196);

    const box = { x: 64, y: 236, w: W - 128, h: 860 };
    g.save();
    roundRect(g, box.x, box.y, box.w, box.h, 28);
    g.clip();
    const b = routeBounds();
    paint(g, fitView(box, b, 2.2), { live: false, ui: 1.7, minW: 9, maxLabels: 10 });
    g.restore();
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.lineWidth = 2;
    roundRect(g, box.x, box.y, box.w, box.h, 28);
    g.stroke();

    // one tile per junction, coloured by tier
    const marks = run.log.map((l) => (TIERS[l.tier] ? TIERS[l.tier].color : l.tier === "dead" ? "#ff6b6b" : "#6b7280"));
    const size = 26, gap = 8, perRow = 28;
    const rows = Math.min(2, Math.ceil(marks.length / perRow));
    for (let r = 0; r < rows; r++) {
      const row = marks.slice(r * perRow, (r + 1) * perRow);
      const total = row.length * size + (row.length - 1) * gap;
      row.forEach((col, i) => {
        g.fillStyle = col;
        roundRect(g, (W - total) / 2 + i * (size + gap), 1130 + r * (size + gap), size, size, 6);
        g.fill();
      });
    }

    const top = rarest();
    g.textAlign = "center";
    g.fillStyle = "#dfe9f2";
    g.font = "600 34px Inter, sans-serif";
    g.fillText(top ? `Rarest find: “${top.a}” · ${TIERS[top.tier].label}` : "No way down today", W / 2, 1240);
    g.fillStyle = "#8b9bb0";
    g.font = "500 26px Inter, sans-serif";
    g.fillText(`How deep can you go? · ${location.host}${location.pathname.replace(/\/cave\.html$/, "/")}`, W / 2, 1296);
    return c;
  }

  // ---- the loop --------------------------------------------------------------
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  function pointAlong(pts, u) {
    let total = 0;
    const lens = [];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l);
      total += l;
    }
    let d = u * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const t = lens[i] ? Math.min(1, d / lens[i]) : 0;
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, a: Math.atan2(y1 - y0, x1 - x0) };
      }
      d -= lens[i];
    }
    return { x: pts[0][0], y: pts[0][1], a: diver.a };
  }

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const turnTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000);   // a hidden tab doesn't eat the lamp
    last = t;
    clock += dt;

    if (phase === "ask") {
      lampT -= dt;
      $("caveLamp").style.width = `${Math.max(0, lampT / lampMax) * 100}%`;
      if (lampT <= 0) lampOut();
    }

    // the diver swims the passage it just chose, or idles at the junction
    if (anim) {
      anim.t += dt;
      const k = Math.min(1, anim.t / anim.dur);
      const u = anim.back ? (1 - Math.abs(1 - 2 * k)) * 0.85 : ease(k);
      const p = pointAlong(anim.pts, u);
      diver.x = p.x;
      diver.y = p.y;
      diver.a = turnTo(diver.a, anim.back && k > 0.5 ? p.a + Math.PI : p.a, 0.2);
      if (k >= 1) anim = null;
    } else if (run) {
      diver.x += (run.nx - diver.x) * 0.2;
      diver.y += (run.ny - diver.y) * 0.2 + Math.sin(clock * 1.6) * 0.05;
      diver.a = turnTo(diver.a, Math.atan2(0.9, 0.45 * run.dir), 0.04);
    }

    // bubbles rise from the diver
    if (run && phase !== "over") {
      bubbleClock -= dt;
      if (bubbleClock <= 0 && !reduceMotion) {
        bubbleClock = anim ? 0.12 : rand(0.35, 0.8);
        bubbles.push({ x: diver.x + Math.cos(diver.a) * 8, y: diver.y - 4, r: rand(1, 2.8), age: 0, life: rand(1.6, 2.6), vx: rand(-6, 6) });
      }
    }
    bubbles = bubbles.filter((b) => (b.age += dt) < b.life);
    bubbles.forEach((b) => { b.y -= 26 * dt; b.x += Math.sin(clock * 3 + b.r * 7) * 6 * dt + b.vx * dt; });

    // camera: follow the diver; pull back to the whole route when the dive ends
    let tx, ty, ts;
    const base = Math.max(0.75, Math.min(1.35, Math.min(W, H) / 640));
    if (phase === "over" && run) {
      const v = fitView({ x: 0, y: 0, w: W, h: H }, routeBounds(), base);
      tx = v.cx; ty = v.cy; ts = v.s;
    } else if (run) {
      tx = diver.x; ty = diver.y; ts = base;
    } else {
      tx = 0; ty = SURF * 0.4; ts = base;
    }
    const k = reduceMotion ? 1 : Math.min(1, dt * 3);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.s += (ts - cam.s) * k;

    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05080f";
    ctx.fillRect(0, 0, W, H);
    const over = phase === "over";
    const ay = over ? H / 2 : H * 0.36;
    paint(ctx, { x: 0, y: 0, w: W, h: H, ax: W / 2, ay, cx: cam.x, cy: cam.y, s: cam.s }, { live: !over });

    // darkness, held back by the lamp; the lamp dims as the time runs down
    if (!over) {
      const depth = run ? run.depth : 0;
      const dark = Math.min(0.93, 0.42 + depth / 420);
      let lamp = Math.min(W, H) * 0.46 * (run && run.tight ? 0.8 : 1);
      if (phase === "ask") lamp *= 0.55 + 0.45 * Math.max(0, lampT / lampMax);
      const sx = W / 2 + (diver.x - cam.x) * cam.s, sy = ay + (diver.y - cam.y) * cam.s;
      const shade = ctx.createRadialGradient(sx, sy, lamp * 0.2, sx, sy, lamp);
      const d = run ? dark : 0.35;
      shade.addColorStop(0, "rgba(3,6,12,0)");
      shade.addColorStop(0.55, `rgba(3,6,12,${d * 0.55})`);
      shade.addColorStop(1, `rgba(3,6,12,${d})`);
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---- wiring ----------------------------------------------------------------
  $("caveForm").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  $("caveNext").addEventListener("click", next);
  $("caveDaily").addEventListener("click", () => begin("daily"));
  $("caveFree").addEventListener("click", () => begin("free"));
  $("caveAgain").addEventListener("click", () => begin("free"));
  $("caveHome").addEventListener("click", intro);
  $("caveCopy").addEventListener("click", copyResult);
  $("caveShare").addEventListener("click", shareCard);
  panel.addEventListener("animationend", () => panel.classList.remove("shake"));

  // keep the panel above an on-screen keyboard
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fit = () => document.body.style.setProperty("--kb", `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
  }

  intro();
  requestAnimationFrame(frame);
})();
