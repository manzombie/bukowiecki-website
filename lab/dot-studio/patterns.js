/* patterns.js — the four placement/sizing functions. Each takes (p, rng, w, h)
 * and returns an array of dots {x, y, r} in canvas pixels. The dot-rendering
 * core (render.js) is shared; modes only decide where dots go and how big.
 *
 * p = { density, sizeMin, sizeMax, contrast, spread, p1, p2, jitter }
 *   density  ~ how many dots / grid resolution
 *   contrast = falloff curve mapping value -> radius
 *   spread   = how far the field extends (0..1 of half-min-dimension)
 *   p1, p2   = per-mode params (see each mode)
 *   jitter   = small seeded randomness so re-roll varies a look */

import { sizeFromValue } from "./render.js";

const TAU = Math.PI * 2;

function jit(rng, amt) { return amt ? rng.range(-amt, amt) : 0; }

/* 1) PHYLLOTAXIS SPIRAL — golden-angle sunflower; dots grow outward, centre void.
 *    p1 = angle nudge (spiral tightness), p2 = centre void size (0..1) */
export function phyllotaxis(p, rng, w, h) {
  const cx = w / 2, cy = h / 2;
  const n = Math.max(200, Math.round(p.density * 650));
  const angle = 2.399963229728653 + (p.p1 || 0);      // golden angle + nudge
  const maxR = (Math.min(w, h) / 2) * p.spread;
  const c = maxR / Math.sqrt(n);
  const voidFrac = p.p2 || 0;
  const dots = [];
  for (let i = 0; i < n; i++) {
    const r = c * Math.sqrt(i);
    const a = i * angle;
    const t = Math.sqrt(i / n);                        // 0 centre -> 1 edge
    if (t < voidFrac) continue;                        // clear centre void
    const tt = (t - voidFrac) / (1 - voidFrac || 1);
    const rad = sizeFromValue(tt, p.sizeMin, p.sizeMax, p.contrast);
    dots.push({ x: cx + r * Math.cos(a) + jit(rng, p.jitter), y: cy + r * Math.sin(a) + jit(rng, p.jitter), r: rad });
  }
  return dots;
}

/* smooth pseudo-noise (no lib): layered sines, seeded offsets */
function field(x, y, s) { return (Math.sin(x * 1.7 + s) + Math.sin(y * 1.9 - s) + Math.sin((x + y) * 1.1 + s * 2)) / 3; }

/* 2) FLOW FIELD — grid warped along flowing curves; size maps to flow value.
 *    p1 = flow frequency, p2 = warp amount */
export function flow(p, rng, w, h) {
  const cols = Math.max(8, Math.round(p.density * 22));
  const sx = w / cols, sy = sx;
  const rows = Math.ceil(h / sy);
  const freq = (0.004 + (p.p1 || 0) * 0.02);
  const warp = (p.p2 || 0) * sx * 2.2;
  const s = rng.range(0, 100);
  const dots = [];
  for (let gy = 0; gy <= rows; gy++) {
    for (let gx = 0; gx <= cols; gx++) {
      const bx = gx * sx, by = gy * sy;
      const ang = field(bx * freq, by * freq, s) * TAU;
      const v = (field(bx * freq * 1.3, by * freq * 1.3, s + 9) + 1) / 2;   // 0..1
      const x = bx + Math.cos(ang) * warp + jit(rng, p.jitter);
      const y = by + Math.sin(ang) * warp + jit(rng, p.jitter);
      dots.push({ x, y, r: sizeFromValue(v, p.sizeMin, p.sizeMax, p.contrast) });
    }
  }
  return dots;
}

/* 3) RADIAL BURST — concentric rings from centre; size falls off with distance.
 *    p1 = ring tightness, p2 = inner void (0..1) */
export function radial(p, rng, w, h) {
  const cx = w / 2, cy = h / 2;
  const maxR = (Math.min(w, h) / 2) * p.spread;
  const rings = Math.max(6, Math.round(p.density * 26));
  const ringGap = maxR / rings;
  const voidFrac = p.p2 || 0;
  const tight = 0.7 + (p.p1 || 0) * 1.8;               // dots-per-circumference factor
  const dots = [];
  for (let ri = 1; ri <= rings; ri++) {
    const rr = ri * ringGap;
    const t = rr / maxR;                                // 0..1
    if (t < voidFrac) continue;
    const count = Math.max(1, Math.round(TAU * rr / (ringGap) * tight));
    const phase = rng.range(0, TAU);
    const tt = (t - voidFrac) / (1 - voidFrac || 1);
    const rad = sizeFromValue(1 - tt, p.sizeMin, p.sizeMax, p.contrast);   // big centre, fade out
    for (let k = 0; k < count; k++) {
      const a = phase + (k / count) * TAU;
      dots.push({ x: cx + rr * Math.cos(a) + jit(rng, p.jitter), y: cy + rr * Math.sin(a) + jit(rng, p.jitter), r: rad });
    }
  }
  return dots;
}

/* 4) WAVE FIELD — grid sized by an interference function (sine).
 *    p1 = wave frequency, p2 = second-axis frequency / interference */
export function wave(p, rng, w, h) {
  const cols = Math.max(10, Math.round(p.density * 30));
  const sx = w / cols, sy = sx;
  const rows = Math.ceil(h / sy);
  const fx = (0.01 + (p.p1 || 0) * 0.06);
  const fy = (0.01 + (p.p2 || 0) * 0.06);
  const s = rng.range(0, 10);
  const dots = [];
  for (let gy = 0; gy <= rows; gy++) {
    for (let gx = 0; gx <= cols; gx++) {
      const x = gx * sx, y = gy * sy;
      const v = (Math.sin(x * fx + s) + Math.sin(y * fy - s) + Math.sin((x + y) * fx * 0.6)) / 3;
      dots.push({ x: x + jit(rng, p.jitter), y: y + jit(rng, p.jitter), r: sizeFromValue((v + 1) / 2, p.sizeMin, p.sizeMax, p.contrast) });
    }
  }
  return dots;
}

export const MODES = {
  spiral: { fn: phyllotaxis, label: "Phyllotaxis spiral", p1: "Spiral nudge", p2: "Centre void" },
  flow: { fn: flow, label: "Flow field", p1: "Flow frequency", p2: "Warp amount" },
  radial: { fn: radial, label: "Radial burst", p1: "Ring tightness", p2: "Inner void" },
  wave: { fn: wave, label: "Wave field", p1: "Wave frequency", p2: "Interference" },
};
