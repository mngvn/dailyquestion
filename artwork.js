// artwork.js — draws the daily artwork "study".
//
// Every image in the Artwork section is generated here from the palette and
// composition parameters in data.js. Nothing is loaded over the network and
// nothing is a reproduction: for the geometric and algorithmic works the study
// genuinely reconstructs the rule the artist used (Nees really did rotate a
// grid of squares by a growing random angle), and for everything else it is an
// abstraction of the composition — a stand-in that tells you the shape and the
// colour of the thing, and sends you to go look at the real one.
//
// Renderers are deterministic: the same artwork always draws the same study.

window.Artwork = (function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const W = 400, H = 300;   // viewBox of every study

  function n(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // Small deterministic PRNG so a given artwork always renders identically.
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Seed from the title so every work gets its own stable variation.
  function seedOf(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const ground = (p) => p[0] || "#111";
  // Colours other than the ground, cycled.
  const ink = (p, i) => p[1 + (i % Math.max(1, p.length - 1))] || "#eee";

  // ---------------------------------------------------------------- renderers
  // Each takes (g, palette, rand) and appends shapes to the group g.

  // Nees, Schotter: a grid of squares whose rotation and offset grow with depth.
  function scatter(g, p, rand) {
    const cols = 12, rows = 14, cell = 20;
    const x0 = (W - cols * cell) / 2, y0 = 12;
    for (let r = 0; r < rows; r++) {
      const chaos = Math.pow(r / rows, 2.2) * 22;
      for (let c = 0; c < cols; c++) {
        const dx = (rand() - 0.5) * chaos;
        const dy = (rand() - 0.5) * chaos;
        const rot = (rand() - 0.5) * chaos * 3.4;
        const cx = x0 + c * cell + cell / 2 + dx;
        const cy = y0 + r * cell * 0.72 + cell / 2 + dy;
        g.append(n("rect", {
          x: cx - cell / 2, y: cy - cell / 2, width: cell - 3, height: cell - 3,
          fill: "none", stroke: ink(p, 0), "stroke-width": 1.4,
          transform: `rotate(${rot.toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})`
        }));
      }
    }
  }

  // Molnár, Interruptions: a field of jittered segments with patches removed.
  function interruptions(g, p, rand) {
    // Molnár started from a 25-by-25 grid; keep that, since this one is
    // presented as a reconstruction rather than an impression.
    const cols = 25, rows = 25;
    const cw = (W - 40) / cols, ch = (H - 40) / rows;
    // A few circular "interruptions" punched out of the field.
    const holes = [];
    for (let i = 0; i < 5; i++) {
      holes.push([40 + rand() * (W - 80), 40 + rand() * (H - 80), 16 + rand() * 30]);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = 20 + c * cw + cw / 2;
        const cy = 20 + r * ch + ch / 2;
        if (holes.some(([hx, hy, hr]) => (cx - hx) ** 2 + (cy - hy) ** 2 < hr * hr)) continue;
        const a = rand() * Math.PI;
        const len = Math.min(cw, ch) * 0.85;
        g.append(n("line", {
          x1: cx - Math.cos(a) * len / 2, y1: cy - Math.sin(a) * len / 2,
          x2: cx + Math.cos(a) * len / 2, y2: cy + Math.sin(a) * len / 2,
          stroke: ink(p, 0), "stroke-width": 1.3, "stroke-linecap": "round"
        }));
      }
    }
  }

  // Mondrian / De Stijl: recursive orthogonal subdivision with heavy rules.
  function grid(g, p, rand) {
    const rects = [[0, 0, W, H]];
    for (let pass = 0; pass < 5; pass++) {
      const out = [];
      rects.forEach((r) => {
        const [x, y, w, h] = r;
        const canSplit = (w > 70 && h > 60) || rand() > 0.55;
        if (!canSplit || w < 50 || h < 45) { out.push(r); return; }
        if (w > h) {
          const cut = w * (0.32 + rand() * 0.36);
          out.push([x, y, cut, h], [x + cut, y, w - cut, h]);
        } else {
          const cut = h * (0.32 + rand() * 0.36);
          out.push([x, y, w, cut], [x, y + cut, w, h - cut]);
        }
      });
      rects.length = 0;
      rects.push(...out);
    }
    rects.forEach((r, i) => {
      const useColor = rand() > 0.62;
      g.append(n("rect", {
        x: r[0], y: r[1], width: r[2], height: r[3],
        fill: useColor ? ink(p, i + Math.floor(rand() * 3)) : ground(p),
        stroke: p[1] || "#111", "stroke-width": 7
      }));
    });
  }

  // Broadway Boogie Woogie / early bitmap art: a chunky cell grid.
  function pixel(g, p, rand) {
    const cell = 20, cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Lines of colour running through a quiet field, like the painting's
        // block-built rules rather than a uniform random fill.
        const online = (r % 4 === 1) || (c % 5 === 2);
        if (!online && rand() > 0.12) continue;
        g.append(n("rect", {
          x: c * cell + 2, y: r * cell + 2, width: cell - 4, height: cell - 4,
          fill: ink(p, Math.floor(rand() * (p.length - 1)) + (online ? 0 : 1)),
          rx: 2
        }));
      }
    }
  }

  // Rothko / Monet / Hopper: soft-edged colour blocks floating on a ground,
  // each with a wider halo behind it so the edges breathe rather than smear.
  function fields(g, p, rand) {
    const bands = Math.min(3, Math.max(2, p.length - 2));
    const inset = 30, top = 26, gap = 16;
    const bh = (H - top * 2 - gap * (bands - 1)) / bands;
    for (let i = 0; i < bands; i++) {
      const y = top + i * (bh + gap);
      const jx = (rand() - 0.5) * 10;
      const x = inset + jx, w = W - inset * 2;
      g.append(n("rect", {
        x: x - 8, y: y - 8, width: w + 16, height: bh + 16,
        fill: ink(p, i), opacity: 0.45, filter: "url(#aw-soft)"
      }));
      g.append(n("rect", {
        x, y, width: w, height: bh,
        fill: ink(p, i), opacity: 0.95, filter: "url(#aw-mist)"
      }));
    }
  }

  // Malevich / Klein / Magritte: one dominant form on a ground.
  function mono(g, p, rand) {
    const c = ink(p, 0);
    const inset = 34 + rand() * 10;
    g.append(n("rect", {
      x: inset, y: inset * 0.72, width: W - inset * 2, height: H - inset * 1.44,
      fill: c
    }));
    if (p.length > 2) {
      g.append(n("rect", {
        x: inset + 14, y: inset * 0.72 + 12,
        width: W - inset * 2 - 28, height: H - inset * 1.44 - 24,
        fill: "none", stroke: ink(p, 1), "stroke-width": 1.2, opacity: 0.35
      }));
    }
  }

  // Albers: nested squares, each offset downward inside the last.
  function concentric(g, p) {
    const steps = p.length;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const w = W * (0.86 - t * 0.6);
      const h = w;
      g.append(n("rect", {
        x: (W - w) / 2,
        y: H - h - (H * 0.07) - t * (H * 0.06),
        width: w, height: h,
        fill: p[i]
      }));
    }
  }

  // Riley: a stripe field compressed by a sine wave.
  function opwave(g, p) {
    const cols = 26;
    for (let c = 0; c < cols; c++) {
      const t = c / cols;
      // squeeze toward the middle, the way the original compresses its grid
      const squeeze = 1 - 0.62 * Math.exp(-Math.pow((t - 0.5) * 4.2, 2));
      const x = W * (t + 0.5 * (0.5 - t) * (1 - squeeze));
      const w = (W / cols) * squeeze;
      for (let r = 0; r < 10; r++) {
        if ((r + c) % 2) continue;
        g.append(n("rect", {
          x, y: r * (H / 10), width: Math.max(1.5, w), height: H / 10,
          fill: ink(p, 0)
        }));
      }
    }
  }

  // Pollock: layered spatter and poured lines.
  function drips(g, p, rand) {
    for (let layer = 0; layer < 9; layer++) {
      const col = ink(p, layer);
      let d = `M ${rand() * W} ${rand() * H}`;
      for (let i = 0; i < 30; i++) {
        d += ` Q ${rand() * W} ${rand() * H} ${rand() * W} ${rand() * H}`;
      }
      g.append(n("path", {
        d, fill: "none", stroke: col,
        // a couple of heavy pours among the thin whips
        "stroke-width": layer < 2 ? 3.4 + rand() * 3 : 0.7 + rand() * 2,
        opacity: 0.5 + rand() * 0.35,
        "stroke-linecap": "round"
      }));
    }
    for (let i = 0; i < 110; i++) {
      g.append(n("circle", {
        cx: rand() * W, cy: rand() * H, r: 0.6 + rand() * 2.2,
        fill: ink(p, i), opacity: 0.6
      }));
    }
  }

  // Hokusai: one big crest that rears up and curls back over its own trough,
  // redrawn a few times at shrinking scale to get the nested-claw structure.
  function wave(g, p, rand) {
    g.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: ground(p) }));

    // Fuji, small and calm, in the open sky the crest leaves to its right.
    g.append(n("path", { d: `M 288 148 L 340 84 L 392 148 Z`, fill: ink(p, 4), opacity: 0.45 }));
    g.append(n("path", { d: `M 324 102 L 340 84 L 356 102 Z`, fill: p[p.length - 2], opacity: 0.85 }));

    // The crest, anchored so each nested copy shrinks toward the curl.
    const CRX = 236, CRY = 96;
    const crest =
      `M -10 ${H + 10} L -10 214 C 44 168, 92 74, 174 58 ` +
      `C 214 50, 238 72, 252 100 C 240 80, 210 74, 192 94 ` +
      `C 208 124, 250 152, 306 170 C 348 184, 384 200, ${W + 10} 208 ` +
      `L ${W + 10} ${H + 10} Z`;

    [[1, 1], [0.84, 2], [0.66, 3]].forEach(([s, ci]) => {
      g.append(n("path", {
        d: crest,
        fill: ink(p, ci),
        opacity: 0.95,
        transform: `translate(${CRX} ${CRY}) scale(${s}) translate(${-CRX} ${-CRY})`
      }));
    });

    // Foam beading off the curl.
    const foam = p[p.length - 2] || "#fff";
    for (let i = 0; i < 34; i++) {
      const t = rand();
      const x = 174 + t * 110 + (rand() - 0.5) * 34;
      const y = 58 + Math.sin(t * 3.1) * 26 + (rand() - 0.5) * 30;
      g.append(n("circle", { cx: x, cy: y, r: 1.6 + rand() * 6, fill: foam, opacity: 0.55 + rand() * 0.4 }));
    }
  }

  // Van Gogh / Munch / Turner: real spirals plus a drifting current, which is
  // what makes this family of pictures read as moving rather than just messy.
  function swirl(g, p, rand) {
    g.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: ground(p) }));

    // Glowing bodies: a wide halo under a bright core.
    const glow = p[p.length - 2] || "#fff";
    [[W * 0.74, H * 0.24, 30], [W * 0.26, H * 0.19, 17], [W * 0.52, H * 0.11, 11]].forEach(([cx, cy, r], i) => {
      g.append(n("circle", { cx, cy, r: r * 1.9, fill: ink(p, 2 + i), opacity: 0.5, filter: "url(#aw-soft)" }));
      g.append(n("circle", { cx, cy, r, fill: glow, opacity: 0.9 }));
    });

    // Spiral eddies.
    for (let s = 0; s < 9; s++) {
      const cx = rand() * W, cy = rand() * H * 0.92;
      const turns = 1.3 + rand() * 1.7, steps = 46;
      const r0 = 4 + rand() * 6, r1 = 20 + rand() * 44;
      let d = "";
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const a = t * turns * Math.PI * 2;
        const r = r0 + (r1 - r0) * t;
        d += (k ? " L " : "M ") + (cx + Math.cos(a) * r).toFixed(1) + " " + (cy + Math.sin(a) * r * 0.62).toFixed(1);
      }
      g.append(n("path", {
        d, fill: "none", stroke: ink(p, s + 1),
        "stroke-width": 2 + rand() * 3, opacity: 0.55 + rand() * 0.3,
        "stroke-linecap": "round"
      }));
    }

    // Short comma strokes drifting across, the way the impasto reads up close.
    for (let i = 0; i < 44; i++) {
      const x = rand() * W, y = rand() * H;
      const len = 18 + rand() * 62, amp = 6 + rand() * 15;
      g.append(n("path", {
        d: `M ${x.toFixed(1)} ${y.toFixed(1)} q ${(len / 2).toFixed(1)} ${(-amp).toFixed(1)} ${len.toFixed(1)} 0`,
        fill: "none", stroke: ink(p, i), "stroke-width": 1.4 + rand() * 3,
        opacity: 0.4 + rand() * 0.4, "stroke-linecap": "round"
      }));
    }
  }

  // Seurat / Lichtenstein: a field built entirely from dots.
  function dots(g, p, rand) {
    g.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: ground(p) }));
    const step = 9;
    for (let y = 6; y < H; y += step) {
      for (let x = 6; x < W; x += step) {
        const off = (Math.floor(y / step) % 2) * step / 2;
        // large soft regions so the dots resolve into shapes at a distance
        const band = Math.floor((y / H) * 3) + Math.floor((x / W) * 2);
        const c = ink(p, band + (rand() > 0.82 ? 1 : 0));
        g.append(n("circle", {
          cx: x + off, cy: y, r: 2.1 + rand() * 1.6, fill: c, opacity: 0.9
        }));
      }
    }
  }

  // Warhol / Paik: the same cell repeated in rotating colourways.
  function repeat(g, p, rand) {
    g.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: ground(p) }));
    const cols = 5, rows = 4;
    const cw = W / cols, chh = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw, y = r * chh;
        g.append(n("rect", {
          x: x + 5, y: y + 5, width: cw - 10, height: chh - 10,
          fill: ink(p, r * cols + c), opacity: 0.9, rx: 3
        }));
        g.append(n("rect", {
          x: x + cw * 0.3, y: y + chh * 0.24, width: cw * 0.4, height: chh * 0.52,
          fill: ink(p, r * cols + c + 1), opacity: 0.85, rx: 2
        }));
      }
    }
  }

  // Cubism / Kandinsky: angular shards over a ground.
  function facets(g, p, rand) {
    g.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: ground(p) }));
    for (let i = 0; i < 22; i++) {
      const cx = rand() * W, cy = rand() * H;
      const pts = [];
      const sides = 3 + Math.floor(rand() * 3);
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2 + rand() * 0.9;
        const r = 22 + rand() * 66;
        pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r * 0.9).toFixed(1)}`);
      }
      g.append(n("polygon", {
        points: pts.join(" "),
        fill: ink(p, i), opacity: 0.55 + rand() * 0.35,
        stroke: p[p.length - 1], "stroke-width": 0.8
      }));
    }
  }

  // Representational works: a vignetted ground with a standing figure mass.
  function figure(g, p, rand) {
    g.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: ground(p) }));
    // atmospheric background blocks
    for (let i = 0; i < 5; i++) {
      g.append(n("rect", {
        x: rand() * W * 0.8, y: rand() * H * 0.7,
        width: 60 + rand() * 150, height: 50 + rand() * 130,
        fill: ink(p, i), opacity: 0.28, filter: "url(#aw-soft)"
      }));
    }
    const cx = W / 2 + (rand() - 0.5) * 30;
    // torso
    g.append(n("path", {
      d: `M ${cx - 74} ${H + 6} C ${cx - 62} ${H - 118}, ${cx - 34} ${H - 150}, ${cx} ${H - 152}` +
         ` C ${cx + 34} ${H - 150}, ${cx + 62} ${H - 118}, ${cx + 74} ${H + 6} Z`,
      fill: ink(p, 0), opacity: 0.95
    }));
    // head
    g.append(n("ellipse", {
      cx, cy: H - 178, rx: 32, ry: 38, fill: ink(p, 2), opacity: 0.95
    }));
    // light falling across the figure, the way these paintings are usually lit
    g.append(n("ellipse", {
      cx: cx - 16, cy: H - 186, rx: 20, ry: 26,
      fill: p[p.length - 1], opacity: 0.35, filter: "url(#aw-soft)"
    }));
  }

  // Landscapes, interiors, installations: a horizon with masses standing on
  // it, so the study reads as a place rather than as floating rectangles.
  function scene(g, p, rand) {
    const horizon = H * (0.54 + rand() * 0.12);
    g.append(n("rect", { x: 0, y: 0, width: W, height: horizon, fill: ink(p, 1) }));
    g.append(n("rect", { x: 0, y: horizon, width: W, height: H - horizon, fill: ground(p) }));

    // Light source low in the sky.
    g.append(n("circle", {
      cx: W * (0.2 + rand() * 0.6), cy: horizon * 0.4, r: 22 + rand() * 16,
      fill: ink(p, 3), opacity: 0.8, filter: "url(#aw-soft)"
    }));

    // Distant band of forms on the skyline.
    for (let i = 0; i < 9; i++) {
      const w = 22 + rand() * 46, h = 16 + rand() * 46;
      g.append(n("rect", {
        x: rand() * (W - w), y: horizon - h, width: w, height: h,
        fill: ink(p, i + 2), opacity: 0.35 + rand() * 0.2, rx: 3
      }));
    }

    // Nearer masses, some domed, all standing on the ground plane.
    for (let i = 0; i < 7; i++) {
      const w = 26 + rand() * 56, h = 40 + rand() * 92;
      const x = rand() * (W - w);
      const y = horizon - h * 0.35;
      g.append(n("rect", {
        x, y, width: w, height: h, rx: 4,
        fill: ink(p, i + 1), opacity: 0.62 + rand() * 0.3
      }));
      if (rand() > 0.5) {
        g.append(n("ellipse", {
          cx: x + w / 2, cy: y, rx: w / 2, ry: w * 0.36,
          fill: ink(p, i + 1), opacity: 0.62 + rand() * 0.3
        }));
      }
    }
  }

  // Sunflowers: heavy heads, two overlapping rings of petals each, packed
  // close enough to crowd the frame the way the originals do.
  function bloom(g, p, rand) {
    g.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: p[3] || ground(p) }));
    const heads = [
      [W * 0.26, H * 0.36, 58], [W * 0.62, H * 0.27, 46],
      [W * 0.78, H * 0.60, 50], [W * 0.42, H * 0.72, 54], [W * 0.10, H * 0.76, 38]
    ];
    heads.forEach(([cx, cy, R], hi) => {
      [[R * 0.80, 16, R * 0.40, R * 0.15], [R * 0.52, 12, R * 0.30, R * 0.13]].forEach(([dist, count, prx, pry], ring) => {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + hi * 0.7 + ring * 0.4;
          const px = cx + Math.cos(a) * dist, py = cy + Math.sin(a) * dist;
          g.append(n("ellipse", {
            cx: px, cy: py, rx: prx, ry: pry,
            fill: ink(p, i + hi + ring), opacity: 0.92,
            transform: `rotate(${(a * 180 / Math.PI).toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})`
          }));
        }
      });
      g.append(n("circle", { cx, cy, r: R * 0.38, fill: p[p.length - 1], opacity: 0.96 }));
      for (let i = 0; i < 22; i++) {
        const a = rand() * Math.PI * 2, rr = rand() * R * 0.34;
        g.append(n("circle", {
          cx: cx + Math.cos(a) * rr, cy: cy + Math.sin(a) * rr,
          r: 1.2 + rand() * 1.6, fill: p[2] || "#000", opacity: 0.5
        }));
      }
    });
  }

  const STYLES = {
    scatter, interruptions, grid, pixel, fields, mono, concentric, opwave,
    drips, wave, swirl, dots, repeat, facets, figure, scene, bloom
  };

  // Filter/clip ids have to be unique per <svg>: the modal can be reopened and
  // a stale duplicate id would silently capture the new element's references.
  let uid = 0;

  // Draws `art` into a fresh <svg> and returns it.
  function render(art) {
    const u = "aw" + (++uid);
    const svg = n("svg", {
      class: "aw-svg",
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid slice",
      role: "img",
      "aria-label": `An abstract colour study of ${art.title} by ${art.artist}`
    });

    const defs = n("defs", {});
    const blur = n("filter", { id: u + "-soft", x: "-30%", y: "-30%", width: "160%", height: "160%" });
    blur.append(n("feGaussianBlur", { stdDeviation: 9 }));
    // A gentler blur, for edges that should soften without dissolving.
    const mist = n("filter", { id: u + "-mist", x: "-20%", y: "-20%", width: "140%", height: "140%" });
    mist.append(n("feGaussianBlur", { stdDeviation: 3.2 }));
    const clip = n("clipPath", { id: u + "-clip" });
    clip.append(n("rect", { x: 0, y: 0, width: W, height: H, rx: 10 }));
    defs.append(blur, mist, clip);
    svg.append(defs);

    const palette = (art.palette && art.palette.length) ? art.palette : ["#222", "#eee"];
    svg.append(n("rect", { x: 0, y: 0, width: W, height: H, fill: ground(palette) }));

    const g = n("g", { "clip-path": `url(#${u}-clip)` });
    const fn = STYLES[art.style] || fields;
    fn(g, palette, rng(seedOf(art.title)));
    svg.append(g);

    // Renderers reference the filters by their shared names; rewrite them to
    // this instance's ids now that the subtree is built.
    ["soft", "mist"].forEach((name) => {
      g.querySelectorAll(`[filter="url(#aw-${name})"]`).forEach((el) => {
        el.setAttribute("filter", `url(#${u}-${name})`);
      });
    });

    return svg;
  }

  return { render };
})();
