# Deeplight — Research Studio, Day 02

A first-person 3D **submarine tunnel-runner**. You are carried forward by a
current through a flooded cave network. **Your headlights are the only light —
and your only weapon.** The dark hides the geometry and is the real antagonist.

Part of the Research Studio 10-day lab (lab.bukowiecki.co). Client-side, static,
no backend. Route: `lab.bukowiecki.co/deeplight/`.

---

## The big idea: image → graph → 3D (automatic)

The 10 levels are **hand-drawn top-down PNGs** (`levels/source/levelNN.png`).
A local Python tool reads each map, extracts its tunnel topology + placed icons,
and emits a **level graph JSON**. The shipped game builds 3D tunnels procedurally
from that JSON — **it never loads the image**.

```
levelNN.png ──(tools/extract_level.py)──▶ levels/levelNN.json ──(src/*.js)──▶ 3D level
            └─ also writes levelNN.debug.png (skeleton + nodes + classified icons)
```

- **Python = local authoring only.** The website ships only the committed JSON +
  Three.js. The source PNGs and the Python venv are **excluded from deploy**.
- Coordinates in the JSON are **normalized 0..1** (resolution-independent).

### Extraction stages (see `tools/extract_level.py`)
1. **Mask UI** — title (top-left), design-notes (bottom-left), legend (bottom-right)
   are blanked so they can't pollute the graph. Teal found inside a UI box → warning.
2. **Tunnel mask** — threshold the bright teal paths (≈RGB 40,130,127 over a
   dark ≈1,23,43 background), morphological close/open to clean.
3. **Skeletonize** → 1px centerline (`skimage.morphology.skeletonize`).
4. **Graph** — neighbour-count the skeleton: endpoints (1 nbr) + junctions (≥3 nbr)
   become **nodes**; traced pixel paths between them become **edge polylines**.
   Cluster-merge junction pixel blobs; Douglas–Peucker simplify polylines.
5. **Start/Exit** — the bottom-most central endpoint = `start`, top-most = `exit`
   (corroborated by the green START/EXIT markers). Other endpoints = `deadend`.
6. **Icons** — the legend is self-calibrated (row grid fit from the saturated
   swatches; 7-vs-8 rows = 2x-only vs 2x+3x) to label each icon type, then placed
   icons are found by **colour-blob detection** (red=hostile, yellow=star,
   blue=mult — 2x/3x split by matching the two legend swatches; brown via RGB
   R>G>B near the tunnels, large central blob = shipwreck, rest = debris).
7. **Snap** each icon to its nearest edge (→ `edgeOrNodeId` + `t`) or node.
8. **Emit** `levelNN.json` (validated against the schema) + `levelNN.debug.png`.

The extractor uses **shared thresholds for all 10 maps** — no per-map hand-tuning.
If a map needs special handling it is **logged** (and recorded in `meta.warnings`),
never silently mis-extracted.

### Run the extractor
```bash
cd lab/deeplight
python3 -m venv tools/.venv && source tools/.venv/bin/activate   # first time
pip install numpy pillow scipy scikit-image opencv-python-headless # first time

# one map (with debug overlay):
python tools/extract_level.py levels/source/level01.png --out levels --debug
# all maps:
python tools/extract_level.py levels/source/*.png --out levels --debug
```

---

## Level schema

`deeplight.level.schema.json` (JSON Schema draft-07). Shape:

```jsonc
{
  "id": "level01", "name": "Level 1", "difficulty": 1,
  "startNodeId": "n_start", "exitNodeId": "n_exit",
  "nodes":   [ { "id":"n3", "x":0.42, "y":0.61, "kind":"junction" }, ... ],
  "edges":   [ { "id":"e7", "from":"n3", "to":"n8",
                 "polyline":[[0.42,0.61],[0.45,0.58], ...], "lengthN":0.13 }, ... ],
  "payloads":[ { "id":"p2", "type":"mult3x", "edgeOrNodeId":"e7", "t":0.5 }, ... ]
}
```

- `node.kind`: `start | exit | junction | deadend`
- `payload.type`: `debris | hostile | shipwreck | star | mult2x | mult3x`
- `t` = position along an edge (0 = `from`, 1 = `to`).

**Does the schema express Level 3 (the densest map)?** Yes — `nodes`, `edges`,
and `payloads` are unbounded arrays, so an arbitrarily branchy graph with many
loops, reconnecting routes, several dead ends, and 2x/3x gates on long branches
is fully representable. Level 3's big central shipwreck is a `shipwreck` payload
(plus nearby debris/hostiles); its 3x branches are `mult3x` payloads on the
longer edges. No structural limit is hit.

---

## Game design (locked for v1)

- **First-person**, inside the sub, **carried forward by the current** — the player
  does **not** control speed in v1.
- **Controls:** steer left/right (pick a branch at junctions; dodge within a
  tunnel) + aim/fire the headlight guns. Desktop: `A`/`D` or `←`/`→` steer,
  mouse aim, click fire. (Touch = a later seam.)
- **Headlights = only light + only weapon.** You see only what the cone lights;
  aim convergence under the crosshair is where shots land. v1 = a single aimed
  light/gun pair, with a clean seam to split into independent left/right later.
- **Streaming tunnels** with object pooling — never hold a whole level in memory.

### Damage (isolated in `src/damage.js`)
Default: **3 HP + fail-and-restart** (arcade tension). Switching to
"score-penalty, no-fail" is a one-file change. *(Awaiting confirmation — see
NEEDS in the review build.)*

### Scoring (`src/scoring.js`, encoded by the maps)
- Shoot **hostiles/debris** → points + survival.
- **star** → flat score. **mult2x / mult3x** zones → bank a multiplier; the maps
  place them on riskier/longer branches.
- **Dead ends** punish greedy routing (wasted current; optional damage / one-way
  commit).
- End-of-level tally weighs **route efficiency vs loot**. A clean run of the
  dangerous 3x route = high score.

---

## Code structure

```
deeplight/
├── index.html
├── src/
│   ├── engine.js     # boot, loop, camera, current-driven forward motion
│   ├── graph.js      # load level JSON, helpers (edges, neighbours, routing)
│   ├── tunnel.js     # procedural tunnel geometry from edge polylines; stream+pool
│   ├── lighting.js   # the dark + headlight cone (the signature hook)
│   ├── weapons.js    # aim/fire, hit detection on hostiles/debris
│   ├── damage.js     # HP/fail model (isolated, swappable)
│   ├── scoring.js    # stars, 2x/3x banking, dead-end penalty, tally
│   ├── hud.js        # crosshair, HP, score, multiplier, progress
│   └── controls.js   # desktop input (steer/aim/fire); touch seam
├── tools/extract_level.py
├── levels/
│   ├── level01.json + level01.debug.png   (committed outputs)
│   └── source/levelNN.png                 (authoring input; NOT deployed)
├── deeplight.level.schema.json
└── README.md
```

Three.js is pinned (loaded from a pinned CDN URL / import map). No build step.

---

## Deploy

Ships via the lab's existing SFTP pipeline (`.github/workflows/deploy-lab.yml`)
on push to `main`. The workflow **excludes** `tools/.venv` and `levels/source/`
from the upload (authoring-only). Push is **gated on Level-1 look approval**.

---

## LEVEL 1 — REVIEW BUILD (awaiting approval)

**Status:** playable end-to-end on the **extracted** `levels/level01.json`. Do not
push until the look + extraction are approved.

### Run it
```bash
# from the repo root (bukowiecki-website/)
python3 -m http.server 4173 --directory lab
# then open:  http://localhost:4173/deeplight/
```
Click **Dive**. `A`/`D` (or `←`/`→`) steer & choose branches at junctions;
mouse aims; click fires; `R` restarts after an end screen.

### Implemented
- **image → graph → 3D pipeline** (`tools/extract_level.py`): teal-tunnel mask →
  skeleton → `sknw` graph (nodes/edges/polylines); self-calibrating legend;
  colour-blob icon detection (hostile/star/mult2x/mult3x) + RGB brown
  (debris/shipwreck); snap-to-graph; **debug overlay** per map. Shared thresholds,
  ~2s/map. Validated on `level01` + `level03` (densest).
- **3D engine** builds streamed tube geometry from the **graph** (not the image),
  pooled to a 2-hop bubble around the sub.
- **Current-driven** forward motion; **junction steering** (player picks branches;
  auto-pilot greedily heads for the exit); **dead-end** detect → penalty + reverse.
- **Headlight = only light** (spotlight cone + thick fog; the dark hides geometry).
- **Weapons** (aim/fire raycast kills hostiles/debris), **damage** (3 HP + fail,
  isolated in `damage.js`), **scoring** (stars, 2x/3x banked gates, dead-end
  penalty, end tally), **HUD** (crosshair, HP, score, multiplier, depth, progress).
- Verified: routing reaches the EXIT; pickups/gates fire; collisions damage; fail
  + win tally screens; firing kills; no console errors.

### Stubbed / deferred (by design for v1)
- **Art:** walls now carry a **procedural rock bump texture** and streamed
  **bioluminescent vegetation** (kelp + glowing specks); hazards/pickups are still
  primitive emissive shapes (no character models yet). **Audio** not started.
- **Touch controls:** desktop only (clean seam in `controls.js`).
- **Dual independent left/right headlights:** single light/gun pair for now
  (seam in `lighting.js` / `weapons.js`).
- **Extraction polish:** dead-end stubs are slightly over-counted (short alcoves
  in 3D); hostiles render generic at point-blank (headlight blow-out).
- Levels 02–10 JSON are **not** generated yet (gated on approval).

### Approval package
- In-engine captures shared in chat: lit bore in the dark · a junction · a hazard
  in the cone (all with HUD).
- Extraction read of the map: **`levels/level01.debug.png`** (skeleton + nodes +
  classified icons over the source) and **`levels/level03.debug.png`** (dense).

### Audio assets (drop-in)
The audio engine (`src/audio.js`) is wired and **gracefully no-ops** until files
exist. Drop **`.mp3`** files into **`lab/deeplight/audio/`** with these exact names:

| file | when it plays | feel |
|---|---|---|
| `ambient.mp3` | loops the whole dive | deep-sea drone / room tone, **seamless loop**, calm |
| `fire.mp3`    | headlight gun fires | short pulse / sonar zap (~0.2s) |
| `kill.mp3`    | hostile/debris destroyed | short crunch / burst |
| `pickup.mp3`  | star collected | bright chime |
| `gate.mp3`    | 2x/3x multiplier banked | rising shimmer / power-up |
| `hit.mp3`     | sub takes damage | dull metallic thud |
| `deadend.mp3` | hit a dead end | low ominous groan |
| `win.mp3`     | reached the exit | uplifting swell |
| `lose.mp3`    | lost to the dark | sinking / fail tone |
| `click.mp3`   | UI button (Dive) | soft click *(optional)* |

Specs: mono is fine, 44.1 kHz, normalized (don't clip); SFX short (<1s); `ambient`
a seamless loop (~20–60s). Missing files are simply skipped — add them anytime.
