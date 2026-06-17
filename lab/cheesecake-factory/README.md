# Cheesecake Factory

A visual **cheesecake designer**. Build a layered cheesecake by choosing each
layer's ingredients, watch it render as a rotatable 3D cake in real time, and
get an instant, deterministic recipe generated from your choices.

100% client-side. No backend, no API keys, no tracking, no build step. Open
`index.html` over any static host (or `file://`) and it runs.

---

## ⚠️ PRIVATE / UNLISTED — read before touching hosting

This is a **private research / concept build**. It is **NOT** part of the
public "build-in-public" 10-day sprint.

- It is hosted at `https://lab.bukowiecki.co/cheesecake-factory/` (it lives in
  the repo at `lab/cheesecake-factory/`), but stays **unlisted**.
- **Do NOT** add a card for it to `lab/index.html` (the public lab landing page),
  and **do NOT** mention it in any public post or changelog. Reachable by direct
  URL only — never advertised. (`<meta robots noindex>` is set.)
- It can also simply be run locally.

---

## How it works

```
lab/cheesecake-factory/
├── index.html      # light-theme three-column shell + logo header
├── styles.css      # all styling (light theme, cards, chips, responsive, print)
├── app.js          # state, control rendering, live wiring, summary, save/share
├── cake3d.js       # Three.js scene: procedural geometry, edible materials, slice view
├── recipe.js       # rule-based recipe engine + export helpers
├── assets/
│   └── logo.png    # cheesecake-slice logo mark (see "Logo" below)
└── README.md       # this file
```

### The model

The cake is built bottom-up from up to three layers:

| Tag | Layer  | Role                | Thickness slider |
|-----|--------|---------------------|------------------|
| 1   | Base   | crust               | no (fixed)       |
| 2   | Middle | cheesecake filling  | **yes**          |
| 3   | Top    | finish/topping      | **yes**          |

**Number of layers** selects how many components are present (each count looks
distinctly different and still appetising):

- **1** → Middle only (a crustless baked cheesecake)
- **2** → Base + Middle (crust + filling, bare top)
- **3** → Base + Middle + Top (the full classic)

Everything is live: every control change instantly rebuilds the 3D cake, the
numbered callout tags, the summary card, and the recipe.

### The 3D cake (`cake3d.js`)

- Three.js `0.160.0` via CDN import map (same pin used elsewhere in the repo).
- Procedural geometry rebuilt per layer — only the layer that changed is
  rebuilt; geometries/materials are disposed on replace to avoid leaks.
- Shapes: **round** (cylinder), **square** (box), **heart** (extruded heart).
- **Whole** vs **Slice** view. Slice removes a wedge so the cross-section
  (the layering) is visible.
  - Round → wedge removed, interior cut faces capped so the cross-section reads
    as solid cake.
  - Square → cut in half; the box's own face shows the bands.
  - **Heart + Slice** is geometrically expensive, so it gracefully falls back to
    a round slice (a small note appears in the UI). Heart is fully supported in
    Whole view. *(Acceptable degradation, flagged per brief.)*
- Materials aim for **edible**, not toy: glossy/clearcoat tops, satin cream with
  subtle color variation, crumbly bump-mapped crust, soft key/fill/rim lighting,
  PMREM environment reflections, ACESFilmic tone mapping, and a soft contact
  shadow under the plate.
- Decorations are small 3D props placed on top, toggled live.
- Pixel ratio is capped (≤2 desktop, ≤1.5 mobile); idle auto-slow-spin; orbit +
  touch (drag rotate, pinch zoom) + reset.

### The recipe engine (`recipe.js`)

Pure, rule-based, deterministic — no API. A per-ingredient library of blurbs,
quantities, and steps assembles into a coherent recipe. Quantities scale with
layer thickness and cake shape/size. Outputs a title, an ingredient list with
amounts, a numbered method (crust → filling → topping → decorate → chill), and
prep/chill times. Updates live.

### Save / Share / Export

- **Save (local)** → `localStorage`.
- **Share** → encodes the whole design into the URL hash (`#d=…`) and copies the
  link. Opening that link restores the design. No server involved.
- **Export Design** → PNG of the 3D cake.
- **Print / PDF** (on the recipe) → printable view of recipe + cake snapshot via
  the browser's print dialog.

---

## Logo

The header uses the supplied cheesecake-slice mark at **`assets/logo.png`**
(transparent). The "Cheesecake Factory" wordmark + "Design your perfect
cheesecake" tagline are rendered as header text beside it. The browser tab
favicon is a 🍰 emoji (inline SVG data-URI in `index.html`).

---

## Chip icons

Ingredient/decoration chip icons are inline themeable SVG (they inherit
`currentColor`), kept in `app.js` for crispness and zero extra requests. This
keeps the tool a tiny, trivially-hostable static bundle.

---

## Browser support

Any modern browser with WebGL2 and ES modules (Chrome, Edge, Firefox, Safari).
