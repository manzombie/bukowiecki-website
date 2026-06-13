# Research Studio — lab.bukowiecki.co

A 10-day "tool a day" generative-art lab. Each day ships one self-contained,
client-side tool. No backend, no build step, no tracking. Pure HTML/CSS/JS +
canvas. Everything is statically deployable.

> **Naming note:** the umbrella project is **Research Studio**. (Do not use
> "Handmade by Robots" — it's a live trademark.)

---

## File tree

```
lab/
├── index.html                 # landing page  →  lab.bukowiecki.co/
├── assets/
│   └── css/
│       └── site.css           # landing-page styles (shared design tokens)
├── art-generator/             # DAY 1 — "Cipher 01 — Algorithm Studio"
│   ├── index.html             #   →  lab.bukowiecki.co/art-generator/
│   ├── engine.js              #   PRNG · deriveTraits · render  (pure, framework-free)
│   ├── ui.js                  #   panel wiring, state, export
│   └── styles.css             #   tool styles
├── shared/                    # reused by every future tool
│   └── prng.js                #   the canonical deterministic PRNG + hashing
└── README.md                  # this file
```

---

## Routing convention

Each tool lives at its own slug directory and is reached as a clean URL:

```
lab.bukowiecki.co/<tool-slug>/      →  lab/<tool-slug>/index.html
```

- The **landing page** is `lab/index.html` (site root).
- **Day 1** = `art-generator` → `lab/art-generator/`.
- Future days add a new sibling folder, e.g. `lab/<tool-slug>/`. Never nest
  tools inside each other; every tool is an independent static page so it can be
  copied, archived, or linked on its own.

### Adding tool N+1

1. `mkdir lab/<new-slug>/` and copy the Day-1 file set as a starting point
   (`index.html`, `engine.js`, `ui.js`, `styles.css`).
2. Reuse `shared/prng.js` — do **not** fork the PRNG (determinism must be
   identical across tools so seeds are portable).
3. Add a card to the **days grid** in `lab/index.html`. Cards are only shown
   once a tool is ready (no "coming soon" placeholders). Copy the commented
   template inside `<div class="days">`, fill in the day number, title
   (`Research #0N — …`), one-line description, and `href="/<new-slug>/"`.
   Bump the `01 / 10 live` counter.
4. That's it — no router, no config, no rebuild.

---

## The engine contract (every tool must follow this)

This separation is the whole product. Keep it clean for all 10 tools.

### 1. One deterministic PRNG — `shared/prng.js`

```
makeRng(seedString)  →  rng()      // returns a function; each call → float in [0,1)
```

- Built from a **string seed** hashed with a 32-bit FNV-1a-style mixer
  (`hashString`) feeding a **Mulberry32** generator.
- **Per-token seeding:** a single artwork's RNG is seeded by
  `makeRng(collectionSeed + ":" + tokenIndex)`. Same `(collectionSeed,
  tokenIndex)` → identical stream → byte-identical artwork, forever, on any
  machine. This is non-negotiable: it's what makes export/repro meaningful.
- No `Math.random()`, no `Date.now()`, no time-based entropy anywhere in the
  render path.

### 2. One pure trait function — `deriveTraits(seed, config) → traits`

- Input: a token seed string + the studio `config` (all Panel-1/Panel-2
  settings). Output: a plain `traits` object (numbers, strings, colors).
- Pure: no DOM, no canvas, no globals. Given the same inputs it always returns
  the same traits. This is where sliders become trait values
  (**slider → trait**).

### 3. One pure render function — `render(ctx, traits, size)`

- Input: a 2D canvas context, a `traits` object, and a pixel size. Draws the
  artwork. No reference to UI state — only `traits`.
- Same `traits` + same `size` → identical pixels (**trait → pixel**).

The full chain is therefore:

```
slider/toggle (UI)
   → config
      → deriveTraits(seed, config)
         → traits
            → render(ctx, traits, size)
               → pixels
```

A non-coder can follow that chain end to end; the engine is commented in those
terms.

---

## Deploy / sync

The lab is a **subdomain of the main site**, shipped from this same repo over
SFTP to one.com (mirrors how `bukowiecki.co` itself deploys; `lukasz/` is the
GitHub-Pages exception).

- Workflow: `.github/workflows/deploy-lab.yml` uploads `lab/**` to the
  `lab.bukowiecki.co` web root on every push to `main` that touches `lab/`.
- **One-time setup (DNS / hosting, done by the site owner):**
  1. Create the `lab` subdomain in one.com and point it at its own web root.
  2. Add the repo secret `SFTP_LAB_REMOTE_PATH` = that web root's absolute path
     (SFTP host/user/password reuse the existing `SFTP_*` secrets).
- GitHub Pages is **not** used for the lab (the repo's single Pages custom
  domain is already `lukasz.bukowiecki.co`).

Because the lab is served from its own subdomain root, in-page links use
root-relative paths (`/art-generator/`).
