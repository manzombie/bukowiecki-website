/* ============================================================================
 * art-generator/engine.js — Cipher 01 "Algorithm Studio" engine.
 *
 * This file is the ART BRAIN. It knows nothing about buttons or the page; it
 * only knows how to turn settings + a seed into pixels. The user interface
 * (ui.js) feeds it; this file draws.
 *
 * THE CHAIN (follow it top to bottom even if you don't code):
 *
 *     a slider/toggle you move        →   config        (a plain settings object)
 *     deriveTraits(seed, config)      →   traits        (this token's recipe)
 *     render(ctx, traits, size)       →   pixels        (the actual artwork)
 *
 * Everything below is organised in exactly that order:
 *   1. OPTIONS + defaultConfig   — what the sliders/menus can be
 *   2. PALETTES + colour helpers — the colour vocabulary
 *   3. deriveTraits              — settings + seed  → a single artwork's recipe
 *   4. render                    — a recipe         → drawing on a canvas
 *   5. texture post-process      — paper / print / grain feel
 *
 * Determinism rule: nothing here ever calls Math.random() or looks at the
 * clock. All randomness comes from makeRng(seed) in ../shared/prng.js, so the
 * same seed + same config always produce byte-identical art.
 * ========================================================================== */

import { makeRng } from "../shared/prng.js";

/* ----------------------------------------------------------------------------
 * 1. OPTIONS — the menu of choices the UI exposes.
 *    Keeping these here (not in the HTML) means the UI can be built from data
 *    and future tools can reuse the same vocabulary.
 * ------------------------------------------------------------------------- */

export const OPTIONS = {
  // "What kind of mark gets drawn?"
  element: [
    { id: "lines", label: "Lines", hint: "Long strokes that travel across the canvas." },
    { id: "shapes", label: "Shapes", hint: "Circles, squares and triangles." },
    { id: "particles", label: "Particles", hint: "Many tiny dots, like spray or dust." },
    { id: "blocks", label: "Blocks", hint: "Solid rectangles, architectural and bold." },
    { id: "stroke", label: "Brush stroke", hint: "Tapered painterly marks with weight." },
  ],

  // "How are the marks arranged across the page?"
  movement: [
    { id: "flowing", label: "Flowing", hint: "Marks follow smooth invisible currents." },
    { id: "scattered", label: "Scattered", hint: "Spread evenly and freely, no order." },
    { id: "clustered", label: "Clustered", hint: "Gathered into a few dense groups." },
    { id: "radial", label: "Radial", hint: "Arranged in rings around a centre." },
    { id: "grid", label: "Grid", hint: "Lined up in neat rows and columns." },
    { id: "chaotic", label: "Chaotic", hint: "Placed and turned with wild abandon." },
  ],

  // "Which colours, and how are they chosen?"
  colorRule: [
    { id: "sequential", label: "Sequential", hint: "Cycle through the palette in order." },
    { id: "random", label: "Random", hint: "Pick any palette colour for each mark." },
    { id: "weighted", label: "Weighted", hint: "Favour the first palette colours." },
    { id: "gradient", label: "Gradient", hint: "Blend smoothly from first to last." },
  ],

  // "What surface texture sits on top?"
  texture: [
    { id: "clean", label: "Clean", hint: "Crisp digital edges, no texture." },
    { id: "rough", label: "Rough", hint: "Fine grain, like toothy paper." },
    { id: "organic", label: "Organic", hint: "Soft mottling and a gentle vignette." },
    { id: "printed", label: "Printed", hint: "Halftone dots, like a risograph print." },
  ],
};

/**
 * defaultConfig — sensible starting point so the first preview already looks good.
 * Every field here maps to one control in the UI.
 */
export function defaultConfig() {
  return {
    // --- Panel 1: Algorithm design ---
    element: "stroke",
    movement: "flowing",

    // Composition (all 0..1; the UI shows them as percent sliders)
    density: 0.5, // how many marks (few ↔ many)
    scale: 0.5, // how big each mark is (small ↔ large)
    spacing: 0.5, // breathing room between marks
    margin: 0.18, // empty frame around the art
    negativeSpace: 0.35, // chance a region is intentionally left blank

    // Behaviours: each has an on/off and a strength (0..1)
    behaviours: {
      overlap: { on: true, strength: 0.6 }, // let marks sit on top of each other
      avoid: { on: false, strength: 0.5 }, // keep marks apart
      connect: { on: false, strength: 0.4 }, // draw links between near marks
      collide: { on: false, strength: 0.5 }, // push overlapping marks apart
      distort: { on: true, strength: 0.3 }, // warp positions for life
    },

    palette: "ink", // see PALETTES below
    colorRule: "weighted",
    texture: "organic",

    chaos: 0.35, // master predictable ↔ unpredictable dial
    jitter: 0.4, // per-mark wiggle on top of chaos

    // --- Panel 2: Collection rules ---
    seed: "studio-cipher", // text or number; same seed = same collection
    size: 64, // how many pieces in the collection

    // which traits stay CONSTANT across the whole collection ("locked"),
    // versus VARY piece to piece. true = locked/consistent.
    locks: {
      element: true,
      movement: true,
      palette: true,
      colorRule: false,
      texture: true,
      density: false,
      scale: false,
      spacing: false,
    },

    variation: 0.5, // how far "varying" traits may drift from the base
    rarity: 0.12, // chance a piece becomes an "unusual" outlier
    mustBeUnique: true, // reject byte-identical repeats
    similarity: 0.05, // near-duplicate flag threshold (small = strict)

    // forbidden combinations: [{ifTrait, ifValue, neverTrait, neverValue}]
    forbid: [],
  };
}

/* ----------------------------------------------------------------------------
 * 2. PALETTES — the colour vocabulary. Editorial / plotter / risograph feel.
 *    Each palette has a paper colour (bg), an ink colour, and a set of marks.
 * ------------------------------------------------------------------------- */

export const PALETTES = {
  ink: {
    label: "Ink",
    bg: "#f4f1ea",
    ink: "#16130f",
    colors: ["#16130f", "#3b3a36", "#8a8780", "#c0392b"],
  },
  riso: {
    label: "Riso",
    bg: "#f3efe3",
    ink: "#2a2a2a",
    colors: ["#2b4af2", "#ff4d8d", "#ffb800", "#00a3a3"],
  },
  plotter: {
    label: "Plotter",
    bg: "#efe9dd",
    ink: "#2d2a26",
    colors: ["#1f6f6b", "#b5552f", "#caa64a", "#2d2a26"],
  },
  mono: {
    label: "Mono",
    bg: "#ededed",
    ink: "#111111",
    colors: ["#111111", "#4a4a4a", "#888888", "#bdbdbd"],
  },
  sodalite: {
    label: "Sodalite",
    bg: "#0e1320",
    ink: "#e9edf5",
    colors: ["#e9edf5", "#7aa2ff", "#c9a227", "#3a4a78"],
  },
  bauhaus: {
    label: "Bauhaus",
    bg: "#efe7d6",
    ink: "#1a1a1a",
    colors: ["#d6332e", "#1f3fb3", "#f2c200", "#1a1a1a"],
  },
};

/** convert "#rrggbb" → {r,g,b} */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
/** blend two hex colours; t=0 → a, t=1 → b */
function hexLerp(a, b, t) {
  const A = hexToRgb(a),
    B = hexToRgb(b);
  const r = Math.round(A.r + (B.r - A.r) * t);
  const g = Math.round(A.g + (B.g - A.g) * t);
  const bl = Math.round(A.b + (B.b - A.b) * t);
  return `rgb(${r},${g},${bl})`;
}

/* ----------------------------------------------------------------------------
 * 3. deriveTraits(seed, config) → traits
 *
 *    This is the PURE recipe step. Given one piece's seed and the studio
 *    settings, it decides this piece's exact trait values. Traits that are
 *    "locked" copy the base setting; traits that "vary" are rolled within a
 *    range whose width grows with `variation` and `chaos`.
 *
 *    It returns a plain object — no drawing happens here.
 * ------------------------------------------------------------------------- */

export function deriveTraits(seed, config) {
  const rng = makeRng(seed); // this piece's private, repeatable randomness
  const c = config;

  // How wide may a "varying" numeric trait drift? Chaos widens everything.
  const drift = c.variation * (0.5 + c.chaos); // 0..~1.5

  // Decide if this piece is a RARE outlier (pushes values to extremes).
  const rarityTier = rng.chance(c.rarity)
    ? rng.chance(0.3)
      ? "rare"
      : "uncommon"
    : "common";
  const extreme = rarityTier === "rare" ? 1 : rarityTier === "uncommon" ? 0.5 : 0;

  // helper: a numeric trait. If locked → base value. If varies → base ± drift,
  // nudged toward an extreme when this piece is rare.
  const num = (key, base) => {
    if (c.locks[key]) return base;
    const spread = drift * 0.5;
    let v = base + rng.gauss(0, spread) + (rng.next() - 0.5) * c.jitter * 0.3;
    if (extreme) v += (rng.next() < 0.5 ? -1 : 1) * extreme * 0.4;
    return Math.max(0, Math.min(1, v));
  };

  // helper: a categorical (menu) trait. Locked → base. Varies → maybe re-pick.
  const cat = (key, base, list) => {
    if (c.locks[key]) return base;
    // probability of changing grows with variation; rare pieces almost always change
    const changeP = 0.2 + c.variation * 0.5 + extreme * 0.4;
    return rng.chance(changeP) ? rng.pick(list.map((o) => o.id)) : base;
  };

  // Build the trait recipe.
  let traits = {
    seed: String(seed),
    rarityTier,

    element: cat("element", c.element, OPTIONS.element),
    movement: cat("movement", c.movement, OPTIONS.movement),
    palette: c.locks.palette ? c.palette : rng.pick(Object.keys(PALETTES)),
    colorRule: cat("colorRule", c.colorRule, OPTIONS.colorRule),
    texture: cat("texture", c.texture, OPTIONS.texture),

    density: num("density", c.density),
    scale: num("scale", c.scale),
    spacing: num("spacing", c.spacing),
    margin: c.margin, // margin is a framing choice → always consistent
    negativeSpace: num("negativeSpace", c.negativeSpace),

    chaos: c.chaos,
    jitter: c.jitter,

    // Behaviours are copied as-is (Panel-1 design decisions). A rare piece may
    // flip one behaviour to make true outliers.
    behaviours: JSON.parse(JSON.stringify(c.behaviours)),

    // A separate seed for the *drawing* step so render() is reproducible on its
    // own, independent of how many random numbers deriveTraits happened to use.
    renderSeed: String(seed) + ":render",
  };

  if (rarityTier === "rare") {
    const keys = Object.keys(traits.behaviours);
    const k = rng.pick(keys);
    traits.behaviours[k].on = !traits.behaviours[k].on;
  }

  // ----- Enforce forbidden combinations (Panel 2 rules) -----
  // "IF trait = X THEN never Y": if violated, fall back to the base value.
  for (const rule of c.forbid || []) {
    if (
      rule.ifTrait &&
      rule.neverTrait &&
      traits[rule.ifTrait] === rule.ifValue &&
      traits[rule.neverTrait] === rule.neverValue
    ) {
      traits[rule.neverTrait] = c[rule.neverTrait]; // revert to the safe base
    }
  }

  // Derived count: density → an actual number of marks (kept modest for speed).
  traits.count = Math.round(20 + traits.density * 380); // 20 .. 400

  return traits;
}

/**
 * traitSignature — a short, comparable fingerprint of a piece, used by the
 * collection to spot near-duplicates and to sort. Pure function of traits.
 * Returns an array of numbers in [0,1].
 */
export function traitSignature(traits) {
  const palIdx = Object.keys(PALETTES).indexOf(traits.palette) /
    Object.keys(PALETTES).length;
  const elIdx = OPTIONS.element.findIndex((o) => o.id === traits.element) /
    OPTIONS.element.length;
  const mvIdx = OPTIONS.movement.findIndex((o) => o.id === traits.movement) /
    OPTIONS.movement.length;
  return [
    palIdx,
    elIdx,
    mvIdx,
    traits.density,
    traits.scale,
    traits.spacing,
    traits.negativeSpace,
  ];
}

/** distance between two signatures (0 = identical, larger = more different).
 *  Plain Euclidean so the number lives on an intuitive scale: locked traits
 *  contribute 0, and only the traits that actually vary move the needle. */
export function signatureDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/* ----------------------------------------------------------------------------
 * 4. render(ctx, traits, size) → pixels
 *
 *    Takes one recipe and draws it. Pure: it reads ONLY `traits`, never the UI.
 *    Steps: paper → choose colours → place marks (by movement) → draw marks (by
 *    element) → apply behaviours → texture.
 * ------------------------------------------------------------------------- */

export function render(ctx, traits, size) {
  const rng = makeRng(traits.renderSeed);
  const pal = PALETTES[traits.palette] || PALETTES.ink;

  // --- paper ---
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, size, size);

  // working area inside the margin
  const m = traits.margin * size * 0.5 + size * 0.06;
  const area = { x: m, y: m, w: size - m * 2, h: size - m * 2 };

  // --- colour chooser based on the colour rule ---
  const colors = pal.colors;
  const colorFor = (i, n) => {
    switch (traits.colorRule) {
      case "sequential":
        return colors[i % colors.length];
      case "random":
        return rng.pick(colors);
      case "weighted":
        // weight earlier colours more heavily (4,3,2,1...)
        return rng.weighted(
          colors,
          colors.map((_, k) => colors.length - k)
        );
      case "gradient": {
        const t = n <= 1 ? 0 : i / (n - 1);
        const seg = t * (colors.length - 1);
        const lo = Math.floor(seg);
        return hexLerp(colors[lo], colors[Math.min(lo + 1, colors.length - 1)], seg - lo);
      }
      default:
        return colors[0];
    }
  };

  // --- 4a. PLACE marks: produce a list of points according to movement ---
  const n = traits.count;
  const pts = placeMarks(rng, traits, area, n);

  // --- 4b. BEHAVIOURS that affect placement (avoid / collide / distort) ---
  applyPlacementBehaviours(rng, traits, pts, area);

  // --- 4c. negative space: blank out a region sometimes ---
  const kept = applyNegativeSpace(rng, traits, pts, area);

  // --- 4d. DRAW each mark by element type ---
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const baseSize = (0.004 + traits.scale * 0.05) * size; // px scale of a mark
  for (let i = 0; i < kept.length; i++) {
    const p = kept[i];
    const col = colorFor(i, kept.length);
    drawMark(ctx, rng, traits, p, baseSize, col, size, area);
  }

  // --- 4e. connect behaviour: draw links between nearby marks ---
  if (traits.behaviours.connect.on) {
    drawConnections(ctx, rng, traits, kept, pal, size);
  }

  // --- 5. texture post-process ---
  applyTexture(ctx, rng, traits, size, pal);
}

/* --- placement: turn a movement mode into a list of {x,y,angle} points --- */
function placeMarks(rng, traits, area, n) {
  const pts = [];
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const chaosJ = (traits.chaos * 0.5 + traits.jitter * 0.5);

  switch (traits.movement) {
    case "grid": {
      const cols = Math.max(2, Math.round(Math.sqrt(n)));
      const rows = Math.max(2, Math.ceil(n / cols));
      const gx = area.w / cols,
        gy = area.h / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (pts.length >= n) break;
          const jx = (rng.next() - 0.5) * gx * chaosJ;
          const jy = (rng.next() - 0.5) * gy * chaosJ;
          pts.push({
            x: area.x + gx * (c + 0.5) + jx,
            y: area.y + gy * (r + 0.5) + jy,
            angle: rng.range(0, Math.PI * 2) * traits.chaos,
          });
        }
      break;
    }
    case "radial": {
      const rings = Math.max(3, Math.round(3 + traits.density * 8));
      for (let i = 0; i < n; i++) {
        const ring = i % rings;
        const rad = (ring / rings) * Math.min(area.w, area.h) * 0.5;
        const a = (i / n) * Math.PI * 2 * (1 + traits.spacing) + rng.gauss(0, chaosJ);
        pts.push({
          x: cx + Math.cos(a) * rad + rng.gauss(0, 6 * chaosJ),
          y: cy + Math.sin(a) * rad + rng.gauss(0, 6 * chaosJ),
          angle: a + Math.PI / 2,
        });
      }
      break;
    }
    case "clustered": {
      const k = Math.max(2, Math.round(2 + traits.density * 5));
      const centers = [];
      for (let i = 0; i < k; i++)
        centers.push({ x: area.x + rng.next() * area.w, y: area.y + rng.next() * area.h });
      const spread = (0.06 + traits.spacing * 0.12) * Math.min(area.w, area.h);
      for (let i = 0; i < n; i++) {
        const ctr = centers[i % k];
        pts.push({
          x: ctr.x + rng.gauss(0, spread),
          y: ctr.y + rng.gauss(0, spread),
          angle: rng.range(0, Math.PI * 2),
        });
      }
      break;
    }
    case "flowing": {
      // a simple flow field: angle at any point comes from smooth sine waves.
      const f1 = rng.range(1.5, 3.5),
        f2 = rng.range(1.5, 3.5);
      const ph = rng.range(0, Math.PI * 2);
      const field = (x, y) => {
        const nx = (x - area.x) / area.w,
          ny = (y - area.y) / area.h;
        return (
          Math.sin(nx * f1 * Math.PI + ph) * Math.cos(ny * f2 * Math.PI) * Math.PI +
          traits.chaos * (rng.next() - 0.5)
        );
      };
      for (let i = 0; i < n; i++) {
        const x = area.x + rng.next() * area.w;
        const y = area.y + rng.next() * area.h;
        pts.push({ x, y, angle: field(x, y), field });
      }
      break;
    }
    case "chaotic": {
      for (let i = 0; i < n; i++)
        pts.push({
          x: area.x + rng.next() * area.w,
          y: area.y + rng.next() * area.h,
          angle: rng.range(0, Math.PI * 2),
        });
      break;
    }
    case "scattered":
    default: {
      // even-ish scatter via jittered low-discrepancy-ish sampling
      for (let i = 0; i < n; i++)
        pts.push({
          x: area.x + rng.next() * area.w,
          y: area.y + rng.next() * area.h,
          angle: rng.range(0, Math.PI * 2) * traits.chaos,
        });
    }
  }
  return pts;
}

/* --- placement behaviours: avoid (thin out crowding), collide (relax apart),
 *     distort (warp positions). overlap is the default (do nothing). --- */
function applyPlacementBehaviours(rng, traits, pts, area) {
  const b = traits.behaviours;

  if (b.distort.on) {
    const amp = b.distort.strength * 0.08 * Math.min(area.w, area.h);
    const fx = rng.range(2, 5),
      fy = rng.range(2, 5);
    for (const p of pts) {
      const nx = (p.x - area.x) / area.w;
      p.x += Math.sin(nx * fy * Math.PI) * amp * (rng.next() * 0.5 + 0.5);
      p.y += Math.cos(((p.y - area.y) / area.h) * fx * Math.PI) * amp * (rng.next() * 0.5 + 0.5);
    }
  }

  if (b.avoid.on && !b.overlap.on) {
    const minD = b.avoid.strength * 0.05 * Math.min(area.w, area.h);
    const min2 = minD * minD;
    for (let i = pts.length - 1; i > 0; i--) {
      for (let j = 0; j < i; j++) {
        const dx = pts[i].x - pts[j].x,
          dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy < min2) {
          pts.splice(i, 1); // too close → drop it
          break;
        }
      }
    }
  }

  if (b.collide.on) {
    // a couple of relaxation passes pushing close points apart
    const minD = b.collide.strength * 0.04 * Math.min(area.w, area.h);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[j].x - pts[i].x,
            dy = pts[j].y - pts[i].y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d < minD) {
            const push = (minD - d) / 2;
            const ux = dx / d,
              uy = dy / d;
            pts[i].x -= ux * push;
            pts[i].y -= uy * push;
            pts[j].x += ux * push;
            pts[j].y += uy * push;
          }
        }
    }
  }
}

/* --- negative space: optionally wipe one rectangular region blank --- */
function applyNegativeSpace(rng, traits, pts, area) {
  if (traits.negativeSpace < 0.08) return pts;
  if (!rng.chance(0.4 + traits.negativeSpace * 0.5)) return pts;
  // carve a void rectangle somewhere in the area
  const vw = area.w * (0.2 + rng.next() * traits.negativeSpace * 0.6);
  const vh = area.h * (0.2 + rng.next() * traits.negativeSpace * 0.6);
  const vx = area.x + rng.next() * (area.w - vw);
  const vy = area.y + rng.next() * (area.h - vh);
  return pts.filter(
    (p) => !(p.x > vx && p.x < vx + vw && p.y > vy && p.y < vy + vh)
  );
}

/* --- draw a single mark according to the chosen element type --- */
function drawMark(ctx, rng, traits, p, baseSize, col, size, area) {
  const s = baseSize * (0.5 + rng.next());
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle || 0);

  switch (traits.element) {
    case "lines": {
      // a travelling line; in flowing mode it curves along the field
      const len = s * (4 + traits.scale * 10) * (1 + traits.spacing);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.5, s * 0.25);
      ctx.beginPath();
      if (p.field) {
        // walk along the flow field for a flowing polyline
        ctx.rotate(-(p.angle || 0)); // we'll step in world space instead
        let x = 0,
          y = 0;
        ctx.moveTo(0, 0);
        let wx = p.x,
          wy = p.y,
           a = p.angle;
        const step = len / 8;
        for (let k = 0; k < 8; k++) {
          wx += Math.cos(a) * step;
          wy += Math.sin(a) * step;
          a = p.field(wx, wy);
          ctx.lineTo(wx - p.x, wy - p.y);
        }
      } else {
        ctx.moveTo(-len / 2, 0);
        ctx.lineTo(len / 2, 0);
      }
      ctx.stroke();
      break;
    }
    case "shapes": {
      ctx.fillStyle = col;
      const kind = rng.int(0, 2);
      if (kind === 0) {
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 1) {
        ctx.fillRect(-s, -s, s * 2, s * 2);
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s, s);
        ctx.lineTo(-s, s);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "particles": {
      ctx.fillStyle = col;
      const dots = 1 + rng.int(0, 3);
      for (let d = 0; d < dots; d++) {
        ctx.beginPath();
        ctx.arc(rng.gauss(0, s), rng.gauss(0, s), Math.max(0.5, s * 0.25), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "blocks": {
      ctx.fillStyle = col;
      const w = s * (1 + rng.next() * 3);
      const h = s * (1 + rng.next() * 3);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      break;
    }
    case "stroke":
    default: {
      // painterly tapered stroke: a row of shrinking blobs
      ctx.fillStyle = col;
      const len = s * (3 + traits.scale * 8);
      const steps = 10;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const r = s * (1 - t) * 0.9 + 0.3;
        const wob = rng.gauss(0, s * 0.3 * traits.chaos);
        ctx.beginPath();
        ctx.arc(-len / 2 + len * t, wob, Math.max(0.4, r), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/* --- connect behaviour: thin links between marks that are close together --- */
function drawConnections(ctx, rng, traits, pts, pal, size) {
  const maxD = (0.05 + traits.behaviours.connect.strength * 0.15) * size;
  const max2 = maxD * maxD;
  ctx.strokeStyle = pal.ink;
  ctx.globalAlpha = 0.25 + traits.behaviours.connect.strength * 0.4;
  ctx.lineWidth = Math.max(0.4, size * 0.0012);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x,
        dy = pts[i].y - pts[j].y;
      if (dx * dx + dy * dy < max2) {
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
  ctx.globalAlpha = 1;
}

/* ----------------------------------------------------------------------------
 * 5. texture — the surface feel, applied on top of the finished drawing.
 * ------------------------------------------------------------------------- */
function applyTexture(ctx, rng, traits, size, pal) {
  switch (traits.texture) {
    case "rough":
      grain(ctx, rng, size, 0.06, 1);
      break;
    case "organic":
      grain(ctx, rng, size, 0.04, 1);
      vignette(ctx, size, 0.18);
      break;
    case "printed":
      halftone(ctx, rng, size, pal);
      vignette(ctx, size, 0.12);
      break;
    case "clean":
    default:
      break;
  }
}

/** fine film grain via per-pixel noise (cheap at preview sizes) */
function grain(ctx, rng, size, amount, step) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4 * step) {
    const noise = (rng.next() - 0.5) * 255 * amount;
    d[i] += noise;
    d[i + 1] += noise;
    d[i + 2] += noise;
  }
  ctx.putImageData(img, 0, 0);
}

/** soft dark edges */
function vignette(ctx, size, strength) {
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.2,
    size / 2,
    size / 2,
    size * 0.72
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/** halftone dot screen for a printed look */
function halftone(ctx, rng, size, pal) {
  const cell = Math.max(3, size * 0.012);
  ctx.fillStyle = pal.ink;
  ctx.globalAlpha = 0.06;
  for (let y = 0; y < size; y += cell)
    for (let x = 0; x < size; x += cell) {
      const r = cell * 0.18 * (0.6 + rng.next() * 0.8);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.globalAlpha = 1;
}
