# Mission Control — Design System (Phase 1C + 1D)

Direction: **warm glass instrument**. Not a SaaS dashboard, not cold Vision Pro blue — the glass of a well-lit room at dusk. Light comes from *behind* the panels. Numbers are the heroes. The mirror panel is sacred.

References: warm glassmorphism (inspo images 2–3), enormous data typography (image 4), modular one-job cards (image 5). Lineage kept from the current brand: the coral accent and the mono labels survive; the linen daylight theme retires.

---

## 1. Color tokens

```css
:root {
  /* Background world */
  --bg-base:        #1A140F;                       /* warm near-black, amber undertone */
  --bg-glow-amber:  rgba(255, 166,  87, 0.15);     /* radial blob, top-left */
  --bg-glow-coral:  rgba(255, 107,  91, 0.08);     /* radial blob, right */
  --bg-glow-teal:   rgba( 64, 130, 120, 0.10);     /* radial blob, bottom */

  /* Glass surfaces (see §3 for full recipes) */
  --glass-1:        rgba(255, 248, 240, 0.045);    /* background panels */
  --glass-2:        rgba(255, 248, 240, 0.075);    /* interactive cards */
  --glass-3:        rgba(255, 248, 240, 0.115);    /* active / focused */
  --glass-border:   rgba(255, 255, 255, 0.10);
  --glass-border-hover:  rgba(255, 255, 255, 0.16);
  --glass-border-active: rgba(255, 255, 255, 0.24);

  /* Accents */
  --accent:         #FF6B5B;    /* coral — "this matters right now", used sparingly */
  --accent-soft:    rgba(255, 107, 91, 0.14);
  --accent-2:       #7FB8A4;    /* sage-teal counterpoint — done states, positive deltas */

  /* Text */
  --text-1:         #F4EDE3;    /* warm white — data, titles      (≥12:1 on glass)  */
  --text-2:         #B9AC9B;    /* warm gray — body, secondary    (≥5.5:1 on glass) */
  --text-3:         #8A7E6F;    /* faint — tertiary labels only, never content      */

  /* Semantic */
  --ok:             #8FBC8B;
  --warn:           #E0B05E;
  --danger:         #E0564A;    /* streak-broken red, runway ≤ 60 days */
}
```

Rules:
- `--accent` appears at most **three times** per viewport (today marker, runway when low, one CTA). If it appears more, it stops meaning anything.
- `--text-3` is for labels of labels. Anything a user must *read* uses `--text-2` or brighter.
- All text/surface pairs hold ≥4.5:1; `--text-1` on any glass level clears 12:1 against `--bg-base`.

## 2. Typography

Three roles. No mixing — display font only on numerals/date, label font only on headers/meta, body font only on content.

| Role | Font | Weight | Usage |
|---|---|---|---|
| **Display** | Space Grotesk | 300 | The enormous numbers: clock, streaks, runway days, committed/done score, and the date headline. Tabular figures (`font-variant-numeric: tabular-nums`). Sizes 40–96px. |
| **Label** | JetBrains Mono | 500 | Panel headers, category names, units. 10–11px, uppercase, `letter-spacing: 0.14em`, `--text-3`/`--text-2`. |
| **Body** | Inter | 400/600 | Task titles, notes, news headlines. 14px / 1.45. |

Why Space Grotesk for display: geometric with instrument-panel character, excellent light weights at huge sizes, true tabular numerals (the clock and count-up animations don't jitter), free via Google Fonts (no account/key). It reads "cockpit", not "fintech".

Loading: Google Fonts `<link>` for Space Grotesk 300 + Inter 400/600; JetBrains Mono stays on the existing system-fallback stack. `font-display: swap`.

## 3. Glass recipe — three levels

Glass is a material, not an effect: each level differs in blur, opacity, *and* border luminosity, so depth reads even in screenshots.

```css
/* Level 1 — background panels (calendar, news, conditions) */
.glass-1 {
  background: var(--glass-1);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);   /* top-edge light catch */
}

/* Level 2 — interactive cards (task rows, hero mirror, session) */
.glass-2 {
  background: var(--glass-2);
  backdrop-filter: blur(20px) saturate(1.25);
  -webkit-backdrop-filter: blur(20px) saturate(1.25);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.glass-2:hover {
  border-color: var(--glass-border-hover);
  transform: translateY(-2px);
}

/* Level 3 — active / focused / dragging */
.glass-3 {
  background: var(--glass-3);
  backdrop-filter: blur(26px) saturate(1.35);
  -webkit-backdrop-filter: blur(26px) saturate(1.35);
  border: 1px solid var(--glass-border-active);
  border-radius: 20px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.09),
    0 0 0 1px rgba(255, 255, 255, 0.03);
}
```

No drop shadows anywhere — glass catches light; it does not cast darkness.

## 4. Ambient background

A fixed layer behind everything. This is what makes glass read as glass.

```css
.ambient {
  position: fixed; inset: 0; z-index: -1;
  background:
    radial-gradient(46rem 34rem at 12% 8%,  var(--bg-glow-amber), transparent 70%),
    radial-gradient(40rem 30rem at 88% 30%, var(--bg-glow-coral), transparent 70%),
    radial-gradient(50rem 38rem at 50% 100%, var(--bg-glow-teal), transparent 70%),
    var(--bg-base);
}
.ambient::after {       /* grain: SVG feTurbulence data-URI, ~4% opacity */
  content: ""; position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,..."); opacity: 0.04;
}
```

Static. No animation in the background, ever (calm technology).

## 5. Spacing scale

`4, 8, 12, 16, 24, 32, 48, 64` px — as `--s1`…`--s8`. Panel padding: Level 1 panels use `--s5` (24px), the hero uses `--s6` (32px). Grid gap: `--s4` (16px). No other values permitted.

## 6. Motion tokens

```css
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1);     /* panel appear, fades   */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* drag settle, toggles  */
--dur-fast:    150ms;   /* hover lift, border brighten        */
--dur-med:     250ms;   /* done-toggle, collapse, drag settle */
--dur-slow:    400ms;   /* panel appear (staggered 50ms/panel), count-up */
```

All motion inside `@media (prefers-reduced-motion: no-preference)`. Data refresh never moves layout — values cross-fade in place; skeletons reserve exact final dimensions.

## 7. Panel architecture (Phase 1D)

Canvas: the existing 12-column grid, gap `--s4`, max-width 1760px. Grid units: small **1×1** (4 cols), medium **2×1** (8 cols × 1 row), large **2×2** (8 cols × 2 rows).

| Panel | Type | Size | Default position | Glass | Z |
|---|---|---|---|---|---|
| **Mirror** (date, the three, streaks, runway arc) | `mirror` | **2×2 hero** | top-left | 2 | 30 |
| Session / AI coach (greeting, clock, Haiku output) | `session` | 1×1 | top-right | 2 | 20 |
| Calendar (3-month, fixed layout, day dots) | `calendar` | 1×1 | mid-right | 1 | 10 |
| Active task | `active-task` | 2×1 | below mirror | 2 | 20 |
| Ventures board (3 venture columns, reorder → `mc_tasks.position`) | `board` | 2×2 | below active task | 1 | 10 |
| News (4–5 weighted headlines, 👍/👎 → DB) | `news` | 1×1 | bottom-right | 1 | 10 |
| Conditions (weather / sun / tides) | `conditions` | 1×1 | rail | 1 | 10 |
| Week in review + wins | `week` | 1×1 | rail | 1 | 10 |
| Moleskine (day browser) | `moleskine` | 1×1 | rail | 1 | 10 |
| Operator / Handoff / GitHub / legacy board / Tools link | `utility` | **pill (collapsed)** | bottom drawer row | 1 | 5 |

Hierarchy law: **the mirror is sacred** — largest panel, top-left, glass level 2, never collapsible, never closeable, never out-glowed by anything else.

Panel behaviors (all panels except the mirror):
- **Draggable** — custom pointer-event drag (no React on this page; `react-grid-layout` is off the table per the standing no-React decision). Grid-snapped; layout persisted to `localStorage["mc_layout_v1"]` as `{panelId: {col,row,w,h,collapsed}}`. "Reset layout" button restores the default constant.
- **Collapsible** → pill: label + one key metric (e.g. `NEWS · 5`, `WEEK · 4 shipped`).
- **Closeable** → removed from layout, restorable from a "+ panels" menu.
- Mobile <768px: single column in the table's order, drag disabled, utilities stay collapsed.

Panel chrome: mono label top-left (`--text-3`), optional one-glyph icon, collapse `–` and close `×` controls at top-right visible on hover, drag handle = the header strip (`cursor: grab`).

## 8. Component inventory (built in Phase 2)

`GlassCard` (level, size, draggable, collapsible) · `BigNumber` (display 300, tiny mono label below) · `ProgressArc` (SVG circular arc — runway, streaks) · `TaskRow` (title, venture pill, done toggle; done = strikethrough + 0.45 opacity fade) · `StreakBadge` · `CalendarStrip` (7-day, today in accent) · `NewsCard` (headline, source, thumbs) · `SkeletonBlock` · ambient background layer.

Each implemented as a CSS class + small vanilla render helper in `mc-ui.js`, demoed on `lukasz/design-test.html` against the ambient background.

---

## Phase 1E — Design review gate

**Three words:** Warm. Instrumental. Calm.

**Most important color:** `#1A140F` — the warm near-black base. Every glass surface is just light passing through toward it; if this color is wrong (too cold, too pure-black), no amount of blur saves the material.

**Display font:** Space Grotesk 300 — geometric instrument-panel character at huge sizes, true tabular numerals so the clock and count-ups don't jitter, free, no account needed.

**Default layout wireframe:**

```
┌──────────────────────────────────────┬───────────────────┐
│  01 MIRROR  (hero 2×2, glass-2)      │ 02 SESSION  (1×1) │
│                                      │  Good morning.    │
│  Thursday, 11 June          ◠ 312    │  18:48   HAIKU ●  │
│                            RUNWAY    ├───────────────────┤
│  ● Task one            [LAB]    ☐    │ 03 CALENDAR (1×1) │
│  ● Task two            [FS]     ☐    │  JUN JUL AUG      │
│  ● Task three          [VFX]    ☐    │  · · · ▣ · · ·    │
│                                      ├───────────────────┤
│   4        2/3       12              │ 04 CONDITIONS     │
│  GYM      DONE      STREAK           │  12° ☁  ↑04:38    │
├──────────────────────────────────────┤  tides ▂▅▇▅▂      │
│  05 ACTIVE TASK (2×1)                ├───────────────────┤
├──────────────────────────────────────┤ 06 WEEK IN REVIEW │
│  07 VENTURES BOARD (2×2)             ├───────────────────┤
│  FrameShift │ VFX Tools │ Decent     │ 08 MOLESKINE      │
│             │           │            ├───────────────────┤
├─────────────┴───────────┴────────────┤ 09 NEWS (1×1)     │
│ (OPERATOR)(HANDOFF)(GITHUB)(LEGACY)  │                   │
└──────────────────────────────────────┴───────────────────┘
   ↑ collapsed utility pills
```

**The one thing that makes it unlike every other dashboard:** it's a *mirror, not a feed*. The hero never shows more than the three things you committed to — no scroll, no overflow, no "view all." Everything else on the page physically recedes behind dimmer glass. Dashboards compete to show more; this one is built to show less, lit from behind.

---

## Standing decisions

- **No React.** The page is vanilla JS (`app.js`/`mc.js`) per the original MC build decision ("match existing conventions over ideal ones"). The redesign is the skin; the data layer and rendering model stay. Drag is custom pointer-events, ~80 lines, no dependency.
- **The coral survives.** `#FF6B5B` is the one thread of brand continuity between the linen daylight theme and the dusk glass theme — and between this dashboard and the Tools app.
- **tools.bukowiecki.co divergence.** The Tools app was styled to match the *linen* MC. After this redesign they diverge; restyling Tools is explicitly out of scope for this loop (future loop candidate).
