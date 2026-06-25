# Dot Studio — Research Studio, Day 09

A generative **halftone dot-field** studio: tune the maths with sliders, get a live
preview on a transparency checkerboard, and export a **transparent PNG** or **SVG**
to drop straight into Canva. It's the tool that makes this sprint's own artwork.

- `index.html` · `styles.css`
- `app.js` — state, controls, live preview, export (ES module)
- `patterns.js` — the four mode functions (spiral / flow / radial / wave)
- `render.js` — the dot-rendering core + true-alpha PNG/SVG export
- Reuses `../shared/prng.js` (the lab's canonical seeded PRNG from Day 01)

## Modes (same dot core, different placement/sizing function)

1. **Phyllotaxis spiral** — golden-angle sunflower seeding; dots grow outward with a
   clear centre void (the "darts coach" card vibe).
2. **Flow field** — a grid warped along flowing curves; dot size maps to the flow value.
3. **Radial burst** — concentric rings from the centre, size falling off with distance,
   optional inner void.
4. **Wave field** — a grid sized by a sine interference function (the waveform feel).

## The generative contract

Same **seed + settings = identical image**, on any machine, forever (via the shared
`makeRng`). Re-roll for a new seed, or type one in; the seed shows in the filename
(e.g. `dotstudio_spiral_seed_dot-1.png`) so any look is reproducible and traceable.

## Transparent export (the whole point)

The canvas is cleared to alpha-0 and only the dots are painted, so the PNG carries a
**genuine alpha channel** with nothing baked behind the dots. Verified by reading the
exported PNG back pixel-by-pixel: gaps are alpha 0, dots are opaque. Export at 1×/2×/4×
for crispness, or SVG for infinite vector scaling (also transparent). The live preview
sits on a transparency checkerboard so you see exactly what you'll get.

## Controls

Pattern mode · density · dot size range (min/max) · contrast/falloff · spread ·
two per-mode params (relabelled per mode) · jitter · dot colour · shape
(circle/square/diamond) · canvas size (square / 16:9 / portrait / custom W×H) · seed.

## Future seam (not built)

v2 "image/shape to halftone": drop a silhouette and sample it to size the dots
(reproducing the shape-filled cards). `render.js` keeps a clean **value-source**
boundary, today = a maths function, future = a sampled image, so v2 slots in without
a rewrite.

## Tech

100% static, client-side. No backend, keys, or tracking. Canvas for preview/PNG,
hand-built SVG string for vector. No build step (ES modules).
