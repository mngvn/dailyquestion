// cave.js — "Rare Air". A cave dive where every junction is a prompt ("Name a
// fruit") and the rarer your answer, the deeper the tunnel it opens.
//
// Rarity comes from crossroads.js, where each prompt's answers are sorted into
// tiers by how often people give them. Those tiers are an estimate, not a
// count: rarityOf() is the one place to blend in live answer counts later.
//
// Oxygen is the clock. Every junction costs some, and you breathe faster the
// deeper you go (gas use scales with pressure). Common answers lead down
// crowded tunnels where everyone is breathing the same stale air, so they cost
// more; rare answers find tunnels nobody has breathed in, and give some back.
// An answer that isn't on the map is a dead end — one of the tunnels caves in —
// and you lose oxygen and try the same junction again. Let the lamp run out
// and you lose more and face a different question.
//
// Every junction opens a fan of tunnels, all heading down. Answer, and you
// swim yours while the divers who gave worse answers swim theirs: shorter
// tunnels, so yours always goes furthest. They fade when the next question
// comes up. What stays is a side-view map of your route, which becomes a card
// to share at the end.
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
  // depth  metres the tunnel drops
  // o2     oxygen on top of breathing: crowded tunnels cost it, fresh ones give it
  // crowd  how many other divers went the same way
  const TIERS = {
    common:    { label: "Common",     emoji: "🟫", color: "#c4a984", depth: 10,  o2: -5, crowd: 6 },
    clever:    { label: "Too clever", emoji: "👣", color: "#e3cf9f", depth: 15,  o2: -3, crowd: 4 },
    uncommon:  { label: "Uncommon",   emoji: "🟩", color: "#5fd38d", depth: 30,  o2: 0,  crowd: 2 },
    rare:      { label: "Rare",       emoji: "🟦", color: "#4fb3ff", depth: 60,  o2: 7,  crowd: 0 },
    deep:      { label: "Deep cut",   emoji: "🟪", color: "#b98bff", depth: 85,  o2: 13, crowd: 0 },
    uncharted: { label: "Uncharted",  emoji: "💎", color: "#7df2ff", depth: 100, o2: 22, crowd: 0 },
  };
  const ORDER = ["common", "clever", "uncommon", "rare", "deep", "uncharted"];
  const DEAD_EMOJI = "🧱", LAMP_EMOJI = "🕯️";

  const STORIES = {
    common: [
      "The main tunnel, packed with divers who all said the same thing. Everyone's breathing the same stale air.",
      "You follow the crowd. The tunnel is short, the silt is churned up, and the oxygen is already thin.",
    ],
    clever: [
      "You were sure nobody else would say it. Half the cave did. The tunnel's crowded and the air is stale.",
      "A “secret” tunnel with a queue of divers in it. Everyone thought of that one.",
    ],
    uncommon: [
      "A side tunnel with only a couple of other divers in it. The air's still decent.",
      "Fewer fins have been through here. It slopes away into the dark.",
    ],
    rare: [
      "A tunnel almost nobody takes. The water is clear, and there's fresh air trapped in the ceiling.",
      "Nobody has breathed down here in a long time. You find a pocket of fresh air.",
    ],
    deep: [
      "An empty underground river carries you down. The air in the domes above it has never been breathed.",
      "The floor drops into a flooded shaft nobody else found. Fresh, cold air waits at the bottom.",
    ],
    uncharted: [
      "An uncharted chamber. No one has ever breathed this air, so it's yours to name: the {name}.",
    ],
  };

  // ---- the dive --------------------------------------------------------------
  const AIR_MAX = 100;
  const DEAD_END_AIR = 6;           // backing out of a tunnel that caved in
  const LAMP_OUT_AIR = 12;          // letting the lamp run out at a junction
  const LAMP_TIME = 25;             // seconds to answer
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
  const diveNo = dayNumber - Date.UTC(2026, 9, 26) / 86400000 + 1;   // launch day is dive #1
  const DAILY_KEY = "cave.daily.v2";   // { day, run } — today's dive, saved as it goes
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
  // matched.
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

  // The best-known answer of a tier, to name the divers who gave it.
  function example(p, tier) {
    const e = indexOf(p).entries.find((x) => x.tier === tier);
    return e ? e.name : TIERS[tier].label;
  }

  // ---- map geometry ----------------------------------------------------------
  // World units are pixels at scale 1, y pointing down. Height on the map isn't
  // linear in metres: every tunnel drops 50 px plus 2.6 px a metre, so a 10 m
  // tunnel is still long enough to see and a 100 m one is four times as long.
  const drop = (m) => 50 + 2.6 * m;
  const SURF = -150;                 // the jungle floor the cenote opens from
  const FAN = 1.05;                  // mouths spread this far either side of straight down (radians)
  const STEER = 0.8;                 // your own tunnel keeps within this of straight down
  const NODE_R = 26;                 // the small chamber at every junction
  const WIDTH = { common: 46, clever: 40, uncommon: 36, rare: 30, deep: 40, uncharted: 34 };
  const MOUTH_W = [28, 12];          // an unexplored mouth, fading into the rock

  const rand = (a, b) => a + Math.random() * (b - a);
  const r1 = (n) => Math.round(n * 10) / 10;

  // A tunnel from `from`, heading `a` radians off straight down until it has
  // dropped `dy`, with a gentle bend so it doesn't look ruled. Its y never
  // decreases: tunnels only ever go down.
  function tunnel(from, a, dy, bend) {
    const dx = Math.tan(a) * dy;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const amp = rand(-1, 1) * Math.min(bend, len * 0.1);
    const n = Math.max(3, Math.round(len / 26));
    const end = [from[0] + dx, from[1] + dy];
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = Math.sin(Math.PI * t) * amp + (i && i < n ? rand(-2, 2) : 0);
      let x = from[0] + dx * t + nx * w, y = from[1] + dy * t + ny * w;
      if (i) y = Math.min(end[1], Math.max(y, pts[i - 1][1]));
      if (i === n) { x = end[0]; y = end[1]; }
      pts.push([r1(x), r1(y)]);
    }
    return pts;
  }

  // One mouth per kind of answer this prompt has, plus a spare for dead ends,
  // spread evenly across the fan.
  function makeMouths(p) {
    const n = ORDER.filter((t) => p[t]).length + 1;
    return Array.from({ length: n }, (_, i) => ({
      a: Math.round((-FAN + (2 * FAN * i) / (n - 1) + rand(-0.06, 0.06)) * 100) / 100,
      len: Math.round(rand(70, 88)),
      dead: false,
    }));
  }
  const mouthPts = (m) => tunnel([run.nx, run.ny], m.a, m.len * Math.cos(m.a), 3);

  // Where the route wants to be at junction j: it snakes from side to side, so
  // the dive sweeps across the screen instead of falling down one column.
  const meander = (j) => 230 * Math.sin(j * 0.8 + run.wave);

  // ---- state -----------------------------------------------------------------
  let run = null;
  let phase = "intro";               // intro | ask | result | over
  let lampT = 0;
  let anim = null;                   // you swimming a tunnel: { pts, t, dur, back, seg }
  let resultAt = 0;
  // The tunnels open at a junction and the other divers in them. They fade
  // when the next question comes up, and are never saved.
  let fans = [];
  const diver = { x: 0, y: 0, a: Math.PI / 2 };
  const cam = { x: 0, y: SURF / 2, s: 1, ay: 400 };
  let bubbles = [], bubbleClock = 0, clock = 0;
  const silt = [];

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
      v: 2, mode, day: dayNumber, order, ptr: 0,
      depth: 0, air: AIR_MAX, junction: 1, wave: rand(0, Math.PI * 2), mouths: null,
      tried: [], log: [], segs: [], nx: 0, ny: 0, over: false,
    };
  }

  const current = () => PROMPTS[run.order[run.ptr % run.order.length] % PROMPTS.length];

  function persist() {
    if (run && run.mode === "daily") save(DAILY_KEY, { day: dayNumber, run });
  }

  // ---- the junction ----------------------------------------------------------
  const panel = $("cavePanel"), input = $("caveInput");
  const openFan = () => fans.find((f) => f.kind === "mouths" && f.target === 1);

  function openJunction() {
    if (!run.mouths) {
      run.mouths = makeMouths(current());
      persist();
    }
    // the last junction's tunnels and divers fade as this one opens
    const open = openFan();
    if (!open || open.x !== run.nx || open.y !== run.ny) {
      fans.forEach((f) => { f.target = 0; });
      fans.push({
        kind: "mouths", x: run.nx, y: run.ny, alpha: 0, target: 1, t: 0, divers: [],
        items: run.mouths.map((m) => ({ kind: "mouth", m, pts: mouthPts(m), w0: MOUTH_W[0], w1: MOUTH_W[1] })),
      });
    }
    $("caveJunction").textContent = `Junction ${run.junction}`;
    $("caveQ").textContent = current().q;
    lampT = LAMP_TIME;
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
    if (hit) advance(hit, typed);
    else deadEnd(typed);
  }

  // You swim into one of the open mouths and find it caved in. The outer ones
  // go first, and one is always left open for a real answer; after that you
  // just bump into rubble you've already found.
  function deadEnd(typed) {
    run.air = Math.max(0, run.air - DEAD_END_AIR);
    run.tried.push(compact(typed));
    run.log.push({ q: current().q, a: typed, tier: "dead" });
    const open = run.mouths.filter((m) => !m.dead).sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
    let pts;
    if (open.length > 1) {
      const m = open[Math.floor(Math.random() * Math.min(2, open.length - 1))];
      m.dead = true;
      const fan = openFan();
      const item = fan && fan.items.find((it) => it.m === m);
      pts = item ? item.pts : mouthPts(m);
      run.segs.push({ kind: "dead", j: run.junction, pts, w0: MOUTH_W[0], w1: 18 });
    } else {
      const here = run.segs.filter((s) => s.kind === "dead" && s.j === run.junction);
      pts = here.length ? here[Math.floor(Math.random() * here.length)].pts : mouthPts(open[0]);
    }
    anim = { pts, t: 0, u: 0, dur: reduceMotion ? 0.01 : 1.1, back: true };
    persist();
    hud();
    input.value = "";
    note(`Dead end. “${typed}” isn't on any map, and that tunnel caved in. Back out and try another way.`, true);
    shake();
    if (run.air <= 0) finish();
  }

  function lampOut() {
    run.air = Math.max(0, run.air - LAMP_OUT_AIR);
    run.log.push({ q: current().q, a: "", tier: "lamp" });
    run.ptr++;
    run.tried = [];
    persist();
    if (run.air <= 0) { hud(); finish(); return; }
    openJunction();
    note("Your lamp gutters out. By the time it flickers back, you're facing a different question.", true);
    shake();
  }

  function swimTime(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return reduceMotion ? 0.01 : 0.9 + len / 230;
  }

  const SUITS = ["#8fb3c9", "#b7a6d9", "#9fd1b5", "#d9b38c", "#c9c9c9", "#e39b9b"];
  function crowd(item, pts, count, dur, w) {
    return Array.from({ length: count }, () => ({
      item, pts,
      delay: rand(0, 0.7),
      dur: dur * rand(0.9, 1.2),
      stop: rand(0.68, 0.95),
      off: rand(-0.3, 0.3) * w,
      suit: SUITS[Math.floor(Math.random() * SUITS.length)],
      x: pts[0][0], y: pts[0][1], a: Math.PI / 2, u: 0,
    }));
  }

  function advance(hit, typed) {
    const tier = hit.entry.tier;
    const T = TIERS[tier];
    const p = current();
    const node = [run.nx, run.ny];
    const before = run.air;

    // your tunnel: the open mouth that best keeps the route snaking across the screen
    const free = run.mouths.filter((m) => !m.dead);
    const dy = drop(T.depth);
    const goal = meander(run.junction);
    const steerable = free.filter((m) => Math.abs(m.a) <= STEER);
    const miss = (m) => Math.abs(node[0] + Math.tan(m.a) * dy - goal);
    const mine = (steerable.length ? steerable : free).reduce((b, m) => (miss(m) < miss(b) ? m : b));
    const pts = tunnel(node, mine.a, dy, 16);
    const end = pts[pts.length - 1];
    const seg = {
      kind: "path", tier, pts, w0: WIDTH[tier], w1: WIDTH[tier] * 0.9, label: hit.entry.name,
      side: end[0] >= node[0] ? 1 : -1, d0: run.depth, d1: run.depth + T.depth,
    };
    if (T.o2 > 0) seg.pocket = true;
    if (tier === "uncharted") seg.chamber = chamberName(hit.entry.name);
    run.segs.push(seg);

    // Everyone who gave a worse answer takes a shorter tunnel of their own;
    // the crowds go to the mouths furthest from yours. Mouths for better
    // answers stay dark.
    const fan = { kind: "result", x: node[0], y: node[1], alpha: 1, target: 1, t: 0, items: [], divers: [] };
    const old = openFan();
    const others = free.filter((m) => m !== mine).sort((a, b) => Math.abs(b.a - mine.a) - Math.abs(a.a - mine.a));
    const lesser = ORDER.filter((t) => p[t] && ORDER.indexOf(t) < ORDER.indexOf(tier)).slice(0, others.length);
    others.forEach((m, i) => {
      const t = lesser[i];
      if (t) {
        const tp = tunnel(node, m.a, drop(TIERS[t].depth), 10);
        const item = { kind: "lesser", tier: t, pts: tp, w0: WIDTH[t], w1: WIDTH[t] * 0.9, label: example(p, t), reveal: 0 };
        fan.items.push(item);
        fan.divers.push(...crowd(item, tp, Math.max(1, TIERS[t].crowd), swimTime(tp), WIDTH[t]));
      } else {
        const was = old && old.items.find((it) => it.m === m);
        fan.items.push({ kind: "mouth", m, pts: was ? was.pts : mouthPts(m), w0: MOUTH_W[0], w1: MOUTH_W[1] });
      }
    });
    const dur = swimTime(pts);
    fan.divers.push(...crowd(null, pts, T.crowd, dur, WIDTH[tier]));
    fans = fans.filter((f) => f !== old);
    fans.push(fan);

    run.nx = end[0];
    run.ny = end[1];
    run.depth += T.depth;
    run.air = Math.max(0, Math.min(AIR_MAX, run.air - breath(seg.d0) + T.o2));
    run.log.push({ q: p.q, a: hit.entry.name, tier });
    run.junction++;
    run.ptr++;
    run.tried = [];
    run.mouths = null;
    persist();

    anim = { pts, t: 0, u: 0, dur, seg };
    showResult(tier, hit.entry.name, typed, run.air - before, lesser.map((t) => example(p, t)), p, seg.chamber);
  }

  function chamberName(name) {
    return name.replace(/\b[a-z]/g, (c) => c.toUpperCase()) + " Chamber";
  }

  function showResult(tier, name, typed, change, behind, p, chamber) {
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

    const delta = Math.round(change);
    const gain = [`+${T.depth} m`, `oxygen ${delta >= 0 ? "+" : "−"}${Math.abs(delta)}`];
    if (T.o2 < 0) gain.push(`${T.crowd} divers sharing your air`);
    if (T.o2 > 0) gain.push(`fresh air +${T.o2}`);
    $("caveGain").textContent = gain.join(" · ");

    // who went where
    const trodden = indexOf(p).entries.filter((e) => e.tier === "common").slice(0, 3).map((e) => e.name);
    $("caveTrodden").textContent = tier === "common" ? `You and most divers: ${trodden.join(" · ")}`
      : behind.length ? `Turned back shallower: divers who said ${behind.join(", ")}`
      : "";

    resultAt = performance.now();
    const next = $("caveNext");
    next.textContent = run.air <= 0 ? "Out of oxygen — head up ↑" : "Keep diving ↓";
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
    return saved && saved.day === dayNumber && saved.run && saved.run.v === 2 ? saved.run : null;
  }

  function intro() {
    phase = "intro";
    run = null;
    anim = null;
    fans = [];
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
    fans = [];
    anim = null;
    if (run.over || run.air <= 0) { finish(); return; }
    $("caveHud").hidden = false;
    panel.hidden = false;
    persist();
    openJunction();
  }

  function finish() {
    run.over = true;
    phase = "over";
    fans.forEach((f) => { f.target = 0; });
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
    const tunnels = run.log.filter((l) => TIERS[l.tier]).length;

    $("caveOverTitle").textContent = `${run.depth} m down`;
    $("caveOverMsg").textContent = run.depth
      ? `You ran low on oxygen in the ${zoneAt(run.depth).replace(/^The /, "")}, and followed your guideline back to daylight.`
      : "You ran low on oxygen before you found a way down. The cave will be here tomorrow.";
    const stats = [`${tunnels} tunnel${tunnels === 1 ? "" : "s"}`, `${deadEnds} dead end${deadEnds === 1 ? "" : "s"}`];
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
  // colours by height on the map (world y), darkening as the cave goes down
  const WATER = [[SURF, [70, 170, 172]], [0, [46, 134, 140]], [500, [30, 96, 120]], [1400, [18, 60, 92]], [3000, [10, 34, 62]], [6000, [6, 18, 38]]];
  const ROCK = [[SURF, [78, 66, 53]], [400, [58, 49, 40]], [1300, [40, 34, 29]], [3000, [26, 22, 20]], [6000, [15, 13, 12]]];
  const RIM = "rgba(150,128,104,0.6)";
  function gradientOf(g, stops) {
    const y0 = stops[0][0], y1 = stops[stops.length - 1][0];
    const grad = g.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([y, c]) => grad.addColorStop((y - y0) / (y1 - y0), `rgb(${c.join(",")})`));
    return grad;
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
  // a tunnel's own seed, so its shape and decorations stay put as others scroll in and out of view
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
      const pad = Math.max(seg.w0, seg.w1, NODE_R * 2) + (seg.chamber ? 80 : 20);
      b.x0 -= pad; b.y0 -= pad; b.x1 += pad; b.y1 += pad;
      bboxes.set(seg, b);
    }
    return b;
  }

  // Where you are `u` of the way along a tunnel (by length), which way it
  // heads there, and the index of the stretch you're on.
  function pointAlong(pts, u) {
    let total = 0;
    const lens = [];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l);
      total += l;
    }
    let d = Math.max(0, Math.min(1, u)) * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const t = lens[i] ? Math.min(1, d / lens[i]) : 0;
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, a: Math.atan2(y1 - y0, x1 - x0), i };
      }
      d -= lens[i];
    }
    return { x: pts[0][0], y: pts[0][1], a: Math.PI / 2, i: 0 };
  }

  // The part of a tunnel opened up so far.
  function partial(pts, u) {
    if (u >= 1) return pts;
    const p = pointAlong(pts, u);
    return pts.slice(0, p.i + 1).concat([[p.x, p.y]]);
  }

  // Adds a tunnel's rock-cut outline to `path`: two ragged walls either side of
  // its line, joined smoothly, with a rounded end. Every shape added to a path
  // winds the same way, so overlapping tunnels merge instead of cancelling.
  function addTunnel(path, s, minW, u) {
    if (u <= 0) return;
    const full = s.pts, pts = partial(full, u);
    if (pts.length < 2) return;
    const seed = seedOf(s);
    const left = [], right = [];
    const n = full.length - 1;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const t = Math.min(1, i / n);
      const w = Math.max(minW, s.w0 + (s.w1 - s.w0) * t) / 2;
      const wl = w * (0.84 + 0.32 * hash(seed + i * 7.3)), wr = w * (0.84 + 0.32 * hash(seed + i * 3.1 + 50));
      left.push([p[0] + nx * wl, p[1] + ny * wl]);
      right.push([p[0] - nx * wr, p[1] - ny * wr]);
    });
    smoothClosed(path, left.concat(right.reverse()));
    if (s.kind === "mouth") return;                // unexplored: no end, it just vanishes
    const [ex, ey] = pts[pts.length - 1];
    const er = Math.max(minW, s.w0 + (s.w1 - s.w0) * Math.min(1, (pts.length - 1) / n)) / 2;
    path.moveTo(ex + er, ey);
    path.arc(ex, ey, er, 0, Math.PI * 2, true);
  }

  function smoothClosed(path, P) {
    const n = P.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m0 = mid(P[n - 1], P[0]);
    path.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid(P[i], P[(i + 1) % n]);
      path.quadraticCurveTo(P[i][0], P[i][1], m[0], m[1]);
    }
    path.closePath();
  }

  function addCircle(path, x, y, rx, ry) {
    path.moveTo(x + rx, y);
    path.ellipse(x, y, rx, ry || rx, 0, 0, Math.PI * 2, true);
  }

  const SHAFT = { kind: "shaft", pts: [[0, SURF], [0, SURF / 2], [0, 0]], w0: 120, w1: 56 };

  // Draws the cave into `g`. v maps the world onto a screen rectangle:
  //   rect {x, y, w, h}, anchor {ax, ay} inside it, world point (cx, cy), scale s
  // o.live adds the open tunnels at the junction, the other divers and you.
  // For the card (not live), o.ui fixes text and lines at a pixel size however
  // far the map is zoomed out, o.minW keeps tunnels visible, and o.maxLabels
  // names only the rarest finds.
  function paint(g, v, o) {
    const segs = run ? run.segs : [];
    const px = (n) => (o.live ? n : (n * (o.ui || 1)) / v.s);
    const minW = o.live ? 0 : (o.minW || 0) / v.s;
    let labelled = null;
    if (!o.live && o.maxLabels) {
      const paths = segs.filter((s) => s.kind === "path");
      labelled = new Set(paths.slice().sort((a, b) => ORDER.indexOf(b.tier) - ORDER.indexOf(a.tier)).slice(0, o.maxLabels));
    }
    const vx0 = v.cx - v.ax / v.s, vx1 = v.cx + (v.w - v.ax) / v.s;
    const vy0 = v.cy - v.ay / v.s, vy1 = v.cy + (v.h - v.ay) / v.s;
    const seen = (s) => { const b = bbox(s); return b.x1 > vx0 && b.x0 < vx1 && b.y1 > vy0 && b.y0 < vy1; };
    // the tunnel you're swimming opens up just ahead of you
    const swimming = o.live && anim && !anim.back ? anim.seg : null;
    const opened = (s) => (s === swimming ? Math.min(1, anim.u + 0.08) : 1);

    g.save();
    g.beginPath();
    g.rect(v.x, v.y, v.w, v.h);
    g.clip();
    g.translate(v.x + v.ax, v.y + v.ay);
    g.scale(v.s, v.s);
    g.translate(-v.cx, -v.cy);

    // rock
    const rockTop = Math.max(vy0, SURF);
    if (vy1 > rockTop) {
      g.fillStyle = gradientOf(g, ROCK);
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
        if (Math.abs(x) < 70) { g.lineTo(x, SURF + 2); continue; }
        g.lineTo(x, SURF - 4 - hash(x) * 22 - (hash(x * 3) > 0.8 ? 26 : 0));
      }
      g.lineTo(vx1, SURF + 2);
      g.closePath();
      g.fill();
    }

    // below the surface, everything is clipped flat at the waterline
    g.save();
    g.beginPath();
    g.rect(vx0, SURF, vx1 - vx0, Math.max(0, vy1 - SURF));
    g.clip();
    g.lineJoin = "round";
    const waterFill = gradientOf(g, WATER);

    // the tunnels open at the junction, under the map so the junction covers their mouths
    if (o.live) fans.forEach((f) => drawFan(g, f, waterFill, px));

    // the map: the cenote, every tunnel you took, the dead ends, the chambers
    const drawn = segs.filter(seen);
    const water = new Path2D();
    addTunnel(water, SHAFT, 0, 1);
    addCircle(water, 0, 0, NODE_R);
    drawn.forEach((s) => {
      addTunnel(water, s, minW, opened(s));
      if (s.kind !== "path" || opened(s) < 1) return;
      const [x, y] = s.pts[s.pts.length - 1];
      if (s.chamber) addCircle(water, x, y, 78, 50);
      else addCircle(water, x, y, Math.max(NODE_R, minW / 2));
    });
    g.strokeStyle = RIM;
    g.lineWidth = 8;
    g.stroke(water);
    g.fillStyle = waterFill;
    g.fill(water);

    // inside the water: daylight in the cenote, silt, and the river in the deep cuts
    g.save();
    g.clip(water);
    if (vy0 < 40) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const rays = g.createLinearGradient(0, SURF, 0, 30);
      rays.addColorStop(0, "rgba(190,240,230,0.22)");
      rays.addColorStop(1, "rgba(190,240,230,0)");
      g.fillStyle = rays;
      [[-52, -34, -24, -8], [-16, 6, -6, 10], [18, 42, 8, 24]].forEach(([a, b, c, d], i) => {
        const sway = Math.sin(clock * 0.6 + i * 2) * 4;
        g.beginPath();
        g.moveTo(a, SURF); g.lineTo(b, SURF); g.lineTo(d + sway, 30); g.lineTo(c + sway, 30);
        g.closePath(); g.fill();
      });
      g.restore();
    }
    if (o.live) {
      g.fillStyle = "rgba(220,235,240,0.35)";
      silt.forEach((p) => { g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill(); });
    }
    g.setLineDash([px(7), px(15)]);
    g.lineDashOffset = -clock * 30;
    g.strokeStyle = "rgba(160,220,255,0.35)";
    g.lineWidth = px(1.8);
    drawn.forEach((s) => {
      if (s.tier !== "deep") return;
      [-0.18, 0.18].forEach((k) => {
        g.beginPath();
        s.pts.forEach(([x, y], i) => (i ? g.lineTo(x + k * s.w0, y) : g.moveTo(x + k * s.w0, y)));
        g.stroke();
      });
    });
    g.setLineDash([]);
    g.restore();
    if (vy0 < SURF + 10) {
      g.strokeStyle = "rgba(210,250,245,0.6)";
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(-60, SURF + 3); g.lineTo(60, SURF + 3); g.stroke();
    }

    // stalactites hang from the ceiling of sloping tunnels; stalagmites rise from the floor
    g.fillStyle = "rgba(110,94,78,0.95)";
    drawn.forEach((s) => {
      if (s.kind !== "path" || opened(s) < 1) return;
      const si = seedOf(s);
      for (let i = 1; i < s.pts.length - 1; i++) {
        const [ax, ay] = s.pts[i - 1], [x, y] = s.pts[i], [bx, by] = s.pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        if (Math.abs(ny) < 0.3) continue;              // walls of a steep shaft, not a ceiling
        const w = (s.w0 + (s.w1 - s.w0) * (i / (s.pts.length - 1))) / 2 - 3;
        const up = ny < 0 ? 1 : -1;                    // which normal points at the ceiling
        const cx = x + nx * w * up, cy = y + ny * w * up;
        const fx = x - nx * w * up, fy = y - ny * w * up;
        const h1 = 5 + hash(si * 31 + i) * 9, h2 = 3 + hash(si * 17 + i * 3) * 6;
        g.beginPath(); g.moveTo(cx - 3.5, cy - 2); g.lineTo(cx + 3.5, cy - 2); g.lineTo(cx, cy + h1); g.fill();
        if (hash(si + i * 7) > 0.45) {
          g.beginPath(); g.moveTo(fx - 3.5, fy + 2); g.lineTo(fx + 3.5, fy + 2); g.lineTo(fx, fy - h2); g.fill();
        }
      }
    });

    // rubble where a tunnel caved in
    drawn.forEach((s) => {
      if (s.kind !== "dead") return;
      const si = seedOf(s);
      const [x, y] = s.pts[s.pts.length - 1];
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? "rgba(132,114,96,1)" : "rgba(98,84,70,1)";
        g.beginPath();
        g.arc(x + (hash(si * 9 + i) - 0.5) * 16, y + (hash(si * 5 + i * 2) - 0.5) * 12, 3 + hash(si + i) * 4, 0, Math.PI * 2);
        g.fill();
      }
    });

    // fresh air trapped in the ceiling at the end of the rare tunnels
    drawn.forEach((s) => {
      if (!s.pocket || opened(s) < 1) return;
      const [x, y] = s.pts[s.pts.length - 1];
      const top = y - (s.chamber ? 46 : NODE_R - 4);
      g.fillStyle = "rgba(205,235,255,0.3)";
      g.beginPath(); g.ellipse(x, top + 6, 20, 11, 0, Math.PI, 0); g.fill();
      g.strokeStyle = "rgba(225,245,255,0.75)";
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x - 19, top + 6); g.lineTo(x + 19, top + 6); g.stroke();
    });

    // crystals in an uncharted chamber
    drawn.forEach((s) => {
      if (!s.chamber || opened(s) < 1) return;
      const si = seedOf(s);
      const [cx, cy] = s.pts[s.pts.length - 1];
      for (let i = 0; i < 16; i++) {
        const a = hash(si * 13 + i) * Math.PI * 2;
        const x = cx + Math.cos(a) * 72, y = cy + Math.sin(a) * 45;
        const tw = 0.55 + 0.45 * Math.sin(clock * 2 + i);
        g.fillStyle = `rgba(125,242,255,${0.35 + 0.5 * tw})`;
        const h = 6 + hash(i * 3 + si) * 8;
        g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + 2.8, y); g.lineTo(x, y + h * 0.4); g.lineTo(x - 2.8, y); g.closePath(); g.fill();
      }
    });

    // depth zones, marked where your route crossed them
    g.font = `600 ${px(11)}px Inter, sans-serif`;
    g.textAlign = "left";
    segs.forEach((s) => {
      if (s.kind !== "path" || opened(s) < 1) return;
      ZONES.slice(1).forEach((z) => {
        if (!(z.from > s.d0 && z.from <= s.d1)) return;
        const y0 = s.pts[0][1], y1 = s.pts[s.pts.length - 1][1];
        const y = y0 + ((y1 - y0) * (z.from - s.d0)) / (s.d1 - s.d0);
        if (y < vy0 || y > vy1) return;
        g.strokeStyle = "rgba(125,242,255,0.18)";
        g.lineWidth = px(1);
        g.setLineDash([px(5), px(7)]);
        g.beginPath(); g.moveTo(vx0, y); g.lineTo(vx1, y); g.stroke();
        g.setLineDash([]);
        g.fillStyle = "rgba(170,220,230,0.55)";
        g.fillText(`${z.from} m · ${z.name}`, vx0 + 12 / v.s, y - px(5));
      });
    });

    // the guideline, tied off at the surface and run through every tunnel you took
    const route = [[0, SURF + 8], [0, 0]];
    segs.forEach((s) => { if (s.kind === "path") route.push(...partial(s.pts, opened(s)).slice(1)); });
    g.strokeStyle = "rgba(255,214,110,0.85)";
    g.lineWidth = px(1.4);
    g.beginPath();
    route.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    // line arrows point the way out, as they do on a real guideline
    g.fillStyle = "rgba(255,214,110,0.9)";
    segs.forEach((s) => {
      if (s.kind !== "path" || !seen(s)) return;
      const [x0, y0] = s.pts[1], [x1, y1] = s.pts[2] || s.pts[1];
      const a = Math.atan2(y0 - y1, x0 - x1);
      g.save(); g.translate((x0 + x1) / 2, (y0 + y1) / 2); g.rotate(a); g.scale(px(1), px(1));
      g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -3.5); g.lineTo(-3, 3.5); g.closePath(); g.fill();
      g.restore();
    });

    // what you said at each junction
    const font = `600 ${px(13)}px Inter, sans-serif`;
    g.font = font;
    segs.forEach((s) => {
      if (s.kind !== "path" || !seen(s) || opened(s) < 1) return;
      const [x, y] = s.pts[s.pts.length - 1];
      g.fillStyle = TIERS[s.tier].color;
      g.beginPath(); g.arc(x, y, px(2.8), 0, Math.PI * 2); g.fill();
      if (s.chamber) {
        g.textAlign = "center";
        g.font = `italic ${font}`;
        g.fillText(s.chamber, x, y + 50 + px(16));
        g.font = font;
        return;
      }
      if (labelled && !labelled.has(s)) return;
      g.textAlign = s.side > 0 ? "left" : "right";
      g.fillText(s.label, x + s.side * (NODE_R + px(6)), y - px(4));
    });

    if (o.live && run) {
      fans.forEach((f) => f.divers.forEach((d) => {
        if (d.u > 0) drawDiver(g, d.x, d.y, d.a, d.suit, f.alpha * 0.9, d.u < d.stop - 0.01);
      }));
      bubbles.forEach((b) => {
        g.strokeStyle = `rgba(220,245,255,${0.55 * (1 - b.age / b.life)})`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.stroke();
      });
      drawDiver(g, diver.x, diver.y, diver.a, "#f2b84b", 1, !!anim);
    }
    g.restore();      // waterline clip
    g.restore();
  }

  // The tunnels open at a junction. Before you answer, they're dark mouths;
  // after, the ones for worse answers open up behind the divers swimming them.
  function drawFan(g, f, waterFill, px) {
    if (f.alpha < 0.01) return;
    const lit = new Path2D(), dark = new Path2D();
    f.items.forEach((it) => {
      if (it.m && it.m.dead) return;
      if (it.kind === "lesser") addTunnel(lit, it, 0, Math.min(1, it.reveal));
      else addTunnel(dark, it, 0, 1);
    });
    g.save();
    g.globalAlpha = f.alpha;
    g.strokeStyle = RIM;
    g.lineWidth = 7;
    g.stroke(lit);
    g.fillStyle = waterFill;
    g.fill(lit);
    // unexplored mouths: open at the junction, fading into the rock
    const fade = (rgb, a) => {
      const gr = g.createRadialGradient(f.x, f.y, NODE_R * 0.8, f.x, f.y, 92);
      gr.addColorStop(0, `rgba(${rgb},${a})`);
      gr.addColorStop(0.55, `rgba(${rgb},${a * 0.6})`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      return gr;
    };
    g.strokeStyle = fade("150,128,104", 0.6);
    g.stroke(dark);
    g.fillStyle = fade("16,46,62", 1);
    g.fill(dark);
    // a faint breath of light at the far end of each
    f.items.forEach((it, i) => {
      if (it.kind !== "mouth" || (it.m && it.m.dead)) return;
      const [x, y] = it.pts[it.pts.length - 1];
      g.fillStyle = `rgba(125,242,255,${0.05 + 0.05 * Math.sin(clock * 2.2 + i * 1.7)})`;
      g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    });
    // name each crowd once its divers reach the end of their tunnel
    g.font = `600 ${px(12)}px Inter, sans-serif`;
    g.textAlign = "center";
    f.items.forEach((it) => {
      if (it.kind !== "lesser" || it.reveal < 0.95) return;
      const [x, y] = it.pts[it.pts.length - 1];
      g.globalAlpha = f.alpha * Math.min(1, (it.reveal - 0.95) * 20);
      g.fillStyle = TIERS[it.tier].color;
      g.fillText(it.label, x, y + it.w1 / 2 + px(16));
    });
    g.restore();
  }

  function drawDiver(g, x, y, a, suit, alpha, moving) {
    g.save();
    g.globalAlpha *= alpha;
    g.translate(x, y);
    g.rotate(a);
    // lamp beam
    const beam = g.createLinearGradient(0, 0, 90, 0);
    beam.addColorStop(0, "rgba(255,226,150,0.3)");
    beam.addColorStop(1, "rgba(255,226,150,0)");
    g.fillStyle = beam;
    g.beginPath(); g.moveTo(6, 0); g.lineTo(90, -26); g.lineTo(90, 26); g.closePath(); g.fill();
    // fins, body, tank, head
    const kick = Math.sin(clock * (moving ? 14 : 5) + x) * 3;
    g.fillStyle = "#1b2a33";
    g.beginPath(); g.moveTo(-9, 0); g.lineTo(-17, -4 + kick); g.lineTo(-17, 4 + kick); g.closePath(); g.fill();
    g.fillStyle = suit;
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
    const b = { x0: -100, x1: 100, y0: SURF - 40, y1: 40 };
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
    paint(g, fitView(box, routeBounds(), 2), { live: false, ui: 1.7, minW: 9, maxLabels: 10 });
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
  const shadeCanvas = document.createElement("canvas");
  const shade = shadeCanvas.getContext("2d");
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = shadeCanvas.width = Math.round(W * dpr);
    canvas.height = shadeCanvas.height = Math.round(H * dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const turnTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

  // ---- the camera ------------------------------------------------------------
  // It frames what matters and fits it into the part of the screen between the
  // HUD and the panel: the cenote before you start, the junction and its mouths
  // while you answer, the whole fan of tunnels while the divers swim it, and
  // your whole route at the end.
  const MAX_SCALE = 1.5, MIN_SCALE = 0.5;
  function region() {
    if (phase === "over" || phase === "intro") return { top: 0, bottom: H };
    const hud = $("caveHud").getBoundingClientRect(), box = panel.getBoundingClientRect();
    const top = hud.bottom + 8, bottom = box.top - 8;
    return { top, bottom: Math.max(top + 160, bottom) };
  }
  function boxAround(lists, pad) {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    lists.forEach((pts) => pts.forEach(([x, y]) => {
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
      b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }));
    return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  }
  function focus() {
    if (!run) return { x0: -230, y0: SURF - 90, x1: 230, y1: 150 };
    if (phase === "over") return routeBounds();
    const fan = fans.find((f) => f.kind === "result" && f.target === 1);
    if (phase === "result" && fan) {
      const mine = run.segs.filter((s) => s.kind === "path").pop();
      return boxAround(fan.items.map((it) => it.pts).concat([mine.pts]), 70);
    }
    return { x0: run.nx - 230, y0: run.ny - 120, x1: run.nx + 230, y1: run.ny + 170 };
  }

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000);   // a hidden tab doesn't eat the lamp
    last = t;
    clock += dt;
    const reg = region();          // measured before anything on the page is touched this frame

    if (phase === "ask") {
      lampT -= dt;
      $("caveLamp").style.width = `${Math.max(0, lampT / LAMP_TIME) * 100}%`;
      if (lampT <= 0) lampOut();
    }

    // you swim the tunnel you chose; at a junction you look around the mouths
    if (anim) {
      anim.t += dt;
      const k = Math.min(1, anim.t / anim.dur);
      anim.u = anim.back ? (1 - Math.abs(1 - 2 * k)) * 0.8 : ease(k);
      const p = pointAlong(anim.pts, anim.u);
      diver.x = p.x;
      diver.y = p.y;
      diver.a = turnTo(diver.a, anim.back && k > 0.5 ? p.a + Math.PI : p.a, 0.2);
      if (k >= 1) anim = null;
    } else if (run) {
      diver.x += (run.nx - diver.x) * 0.2;
      diver.y += (run.ny - diver.y) * 0.2 + Math.sin(clock * 1.6) * 0.05;
      const look = phase === "ask" ? Math.sin(clock * 0.7) * 0.9 : 0;
      diver.a = turnTo(diver.a, Math.PI / 2 + look, 0.05);
    }

    // the other divers swim their tunnels and gather near the end
    fans.forEach((f) => {
      f.t += dt;
      f.alpha += (f.target - f.alpha) * Math.min(1, dt * (f.target ? 6 : 2.5));
      f.divers.forEach((d) => {
        const k = Math.max(0, Math.min(1, (f.t - d.delay) / d.dur));
        d.u = ease(k) * d.stop;
        if (d.u <= 0) return;
        const p = pointAlong(d.pts, d.u);
        d.x = p.x - Math.sin(p.a) * d.off;
        d.y = p.y + Math.cos(p.a) * d.off + (k >= 1 ? Math.sin(clock * 1.3 + d.off) * 1.5 : 0);
        d.a = turnTo(d.a, k < 1 ? p.a : Math.PI / 2 + Math.sin(clock * 0.6 + d.off) * 0.7, 0.12);
        if (d.item) d.item.reveal = k >= 1 ? 1 : Math.max(d.item.reveal, Math.min(1, d.u + 0.12));
        if (!reduceMotion && f.target && Math.random() < dt * (k < 1 ? 3 : 0.8)) {
          bubbles.push({ x: d.x, y: d.y - 4, r: rand(0.8, 2.2), age: 0, life: rand(1.2, 2.2), vx: rand(-5, 5) });
        }
      });
      if (f.kind === "result" && f.t > 4) f.items.forEach((it) => { if (it.kind === "lesser") it.reveal = 1; });
    });
    fans = fans.filter((f) => f.target > 0 || f.alpha > 0.02);

    // bubbles rise from you
    if (run && phase !== "over") {
      bubbleClock -= dt;
      if (bubbleClock <= 0 && !reduceMotion) {
        bubbleClock = anim ? 0.12 : rand(0.35, 0.8);
        bubbles.push({ x: diver.x + Math.cos(diver.a) * 8, y: diver.y - 4, r: rand(1, 2.8), age: 0, life: rand(1.6, 2.6), vx: rand(-6, 6) });
      }
    }
    bubbles = bubbles.filter((b) => (b.age += dt) < b.life).slice(-240);
    bubbles.forEach((b) => { b.y -= 26 * dt; b.x += Math.sin(clock * 3 + b.r * 7) * 6 * dt + b.vx * dt; });

    const b = focus();
    const ts = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (W * 0.94) / (b.x1 - b.x0), (reg.bottom - reg.top) / (b.y1 - b.y0)));
    const k = reduceMotion ? 1 : Math.min(1, dt * 2.4);
    cam.x += ((b.x0 + b.x1) / 2 - cam.x) * k;
    cam.y += ((b.y0 + b.y1) / 2 - cam.y) * k;
    cam.s += (ts - cam.s) * k;
    cam.ay += ((reg.top + reg.bottom) / 2 - cam.ay) * k;

    // silt drifting in the water around you
    const vw = W / cam.s, vh = H / cam.s;
    const left = cam.x - vw / 2, top = cam.y - cam.ay / cam.s;
    while (silt.length < 90) silt.push({ x: 0, y: 0, r: 0, vx: 0, vy: 0, dead: true });
    silt.forEach((p) => {
      if (p.dead || p.x < left - 40 || p.x > left + vw + 40 || p.y < top - 40 || p.y > top + vh + 40) {
        Object.assign(p, { x: left + Math.random() * vw, y: top + Math.random() * vh, r: rand(0.5, 1.6), vx: rand(-4, 4), vy: rand(-3, 5), dead: false });
      }
      p.x += (p.vx + Math.sin(clock * 0.5 + p.y * 0.01) * 3) * dt;
      p.y += p.vy * dt;
    });

    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05080f";
    ctx.fillRect(0, 0, W, H);
    const over = phase === "over";
    const ay = cam.ay;
    const view = { x: 0, y: 0, w: W, h: H, ax: W / 2, ay, cx: cam.x, cy: cam.y, s: cam.s };
    paint(ctx, view, { live: !over });
    if (over) return;

    // Darkness, cut away by lamps: your beam (dimming as the lamp runs down),
    // the other divers' lamps, daylight in the cenote, and the glow of crystals.
    const sx = (x) => W / 2 + (x - cam.x) * cam.s, sy = (y) => ay + (y - cam.y) * cam.s;
    const depth = run ? run.depth : 0;
    shade.setTransform(dpr, 0, 0, dpr, 0, 0);
    shade.globalCompositeOperation = "source-over";
    shade.clearRect(0, 0, W, H);
    shade.fillStyle = `rgba(3,6,12,${run ? Math.min(0.9, 0.52 + depth / 800) : 0.45})`;
    shade.fillRect(0, 0, W, H);
    shade.globalCompositeOperation = "destination-out";
    const light = (x, y, r, a) => {
      const gr = shade.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,0,0,${a})`);
      gr.addColorStop(0.55, `rgba(0,0,0,${a * 0.6})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      shade.fillStyle = gr;
      shade.beginPath(); shade.arc(x, y, r, 0, Math.PI * 2); shade.fill();
    };
    const lampK = phase === "ask" ? 0.5 + 0.5 * Math.max(0, lampT / LAMP_TIME) : 1;
    const dx = sx(diver.x), dy = sy(diver.y);
    light(dx, dy, 120 * cam.s, 1);
    // the beam: a cone of light the way you're facing
    const reach = 430 * cam.s * lampK, spread = 0.55;
    const beam = shade.createRadialGradient(dx, dy, 0, dx, dy, reach);
    beam.addColorStop(0, "rgba(0,0,0,1)");
    beam.addColorStop(0.6, "rgba(0,0,0,0.75)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    shade.fillStyle = beam;
    shade.beginPath();
    shade.moveTo(dx, dy);
    shade.arc(dx, dy, reach, diver.a - spread, diver.a + spread);
    shade.closePath();
    shade.fill();
    fans.forEach((f) => f.divers.forEach((d) => { if (d.u > 0) light(sx(d.x), sy(d.y), 70 * cam.s, 0.85 * f.alpha); }));
    if (run) run.segs.forEach((s) => {
      if (!s.chamber) return;
      const [x, y] = s.pts[s.pts.length - 1];
      light(sx(x), sy(y), 110 * cam.s, 0.7);
    });
    const surf = sy(SURF);
    if (surf > -400) {
      const day = shade.createLinearGradient(0, surf - 300 * cam.s, 0, sy(140));
      day.addColorStop(0, "rgba(0,0,0,1)");
      day.addColorStop(0.65, "rgba(0,0,0,0.9)");
      day.addColorStop(1, "rgba(0,0,0,0)");
      shade.fillStyle = day;
      shade.fillRect(0, 0, W, Math.max(0, sy(140)));
    }
    ctx.drawImage(shadeCanvas, 0, 0, W, H);
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
