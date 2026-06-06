# Build Brief — bukowiecki.co

**For:** Claude Code
**Project:** Redesign and rebuild the personal site of Lukasz Bukowiecki — VFX Editor & AI tool builder.
**Deliverable:** A single-page, self-contained, statically-hostable site (HTML/CSS/JS, no framework required). Fast, mobile-first, easy to drop onto existing hosting.

---

## 1. Positioning (the one thing this site is)

This site sells **FrameShift** — AI-native editorial/VFX workflow tools — using a 17-year VFX career as the credibility argument.

The spine of the whole site:
> **The AI-native VFX Editor.** 17 years on the biggest films ever made — Avatar, Gravity, Harry Potter, Black Mirror, Alien: Covenant — now building the AI tools and automation post-production doesn't have yet.

Every section serves one goal: convince a post supervisor / VFX producer / fellow editor that the person who built these tools genuinely lives inside their pipeline.

**Hierarchy:** Films (proof) → Expertise (what I do) → FrameShift (the sale) → Current projects → Contact.

Do NOT lead with biography. The personal origin story is deliberately excluded — it lives on LinkedIn, not here.

---

## 2. Visual direction

**Mood:** Minimal but bold. Cinematic. Confident. Think the "Stoicism" editorial aesthetic — photoreal objects floating in black void — applied to the artifacts of a VFX career.

**Palette (CSS tokens):**
```css
:root {
  --void:        #0A0A0A;   /* page background, near-black */
  --void-2:      #121212;   /* raised panels / section shifts */
  --ink:         #F4F2EE;   /* primary text, warm off-white */
  --ink-dim:     #8A8A8A;   /* secondary / captions */
  --line:        #232323;   /* hairline dividers */
  --accent:      #FF4D00;   /* hot orange — RATIONED, used sparingly */
  --accent-dim:  #B23600;   /* darker orange for hovers/edges */
}
```
The orange is the heat. Use it once or twice per viewport max — a single rule, an active nav dot, one CTA, the edge-light already baked into the object renders. Never fill large areas with it.

**Typography — split system (this split IS the concept: serif = human craft, mono = the machine):**
- **Serif display** for the name, section titles, and any prose. Recommend *Fraunces* or *Newsreader* (Google Fonts) — editorial, warm, high-contrast. Large, confident sizes.
- **Monospace** for nav, tool names, data, timecodes, captions, CTAs, film credit strips, EDL snippets. Recommend *JetBrains Mono* or *IBM Plex Mono*.
- Body prose can be the serif at a readable size, or a clean neutral sans (*Inter*) if serif tires the eye — builder's choice, test both.

**Layout:** Single vertical scroll. Generous negative space — let objects breathe in black. Content max-width ~1100px, but objects can break out wider. Mobile: objects stack, motion reduces.

---

## 3. The floating 3D objects (signature element)

Each major node has a **photoreal monochrome 3D object floating in black void**, with a single hot-orange edge-light. These are delivered as **pre-rendered PNGs** (generated separately — see Section 6 for the exact prompts). They are NOT built in Three.js.

**Motion — CSS/JS only, no video:**
- Each object **floats**: a slow vertical drift (translateY, ~12–20px, 6–9s ease-in-out infinite alternate), slightly randomized per object so they don't sync.
- Subtle **parallax** on scroll: objects move slightly slower/faster than the page (intersection-observer or scroll-linked transform).
- **Reveal on scroll**: objects fade + rise into place as their section enters viewport (opacity 0→1, translateY 40px→0).
- Optional very slow rotation (rotateZ ±2deg) for organic life. Keep it calm — weightless museum object, not a spinning logo.
- `prefers-reduced-motion`: disable float/parallax, keep static.

**Asset treatment (IMPORTANT):** Object PNGs are rendered on **solid black**, not transparency. Default every floating-object image to `mix-blend-mode: screen` — on the dark site this makes the black background disappear and lets objects overlap any dark element cleanly, with no matte halos and no need for alpha channels. This is the standard treatment for all object PNGs. Only the rare object placed over a lighter band (e.g. a FrameShift screenshot on `--void-2`) should use a genuinely background-removed PNG instead; flag those individually.

**Performance:** lazy-load object PNGs below the fold. Objects composite seamlessly with `--void` via the blend mode above. Target <1.5s first paint, smooth 60fps scroll on mobile.

---

## 4. Page structure & copy

Copy below is final unless marked [PLACEHOLDER]. Voice: direct, specific, no marketing fluff — match the tone of someone who's spent 17 years making the invisible work.

### 4.1 — Nav (fixed, minimal, mono)
Left: `LB` or `bukowiecki.co` (mono).
Right links: `Work` · `FRAME/SHIFT` · `VFX Tools` · `Now` · `Contact`.
Active section indicated by a small orange dot. Transparent over hero, subtle `--void` background on scroll.

### 4.2 — Hero
- Eyebrow (mono, --ink-dim): `VFX EDITOR · AI TOOL BUILDER`
- Headline (serif, large):
  > **I build the systems behind the scenes.**
- Subhead (serif or sans, --ink-dim):
  > 17 years cutting shots on Avatar, Gravity, Harry Potter, Black Mirror and Alien: Covenant. Now building the AI-native editorial tools post-production still doesn't have.
- Single CTA (mono, orange outline → fills on hover): `→ See the tools`
- **Hero — scroll-scrubbed frame sequence (PRIMARY):** The hero is a B&W "3D bust" of Lukasz holding a chrome award statuette that **animates as the user scrolls** — at the top of the section he holds the statuette down/relaxed; as the user scrolls through the hero, he raises and presents the Oscar toward the camera. The scroll position is the playhead (scroll down = raises, scroll up = lowers). This is the classic scroll-driven image-sequence technique (à la Apple product pages / the Mr Lobster site).
  - **Assets:** a numbered WebP sequence exported from the Runway clip: `hero/frame_001.webp` … `hero/frame_061.webp` (**61 frames**). Zero-padded, identical dimensions, pure black background, ~1280–1440px wide (2× a contained on-screen panel of ~600–720px). **WebP, not PNG** — this is the heaviest asset on the page; a PNG sequence will bloat load time, WebP compresses black-background footage to a fraction of the size.
  - **Implementation:**
    1. Preload the entire frame array into `Image` objects before enabling scrub; show frame 1 (or a subtle loader) until ready — never expose a half-loaded sequence.
    2. Pin a `<canvas>` sticky for the hero section; make the section taller than the viewport so the extra height is the scroll runway.
    3. On scroll, compute progress 0→1 through the section → `frameIndex = Math.round(progress * (frames-1))` → draw that frame. Do the draw inside `requestAnimationFrame`, never directly on the scroll event (prevents stutter).
    4. **Layout — centered figure, text overlaid on the black negative space.** The figure is centered in the frame (not right-weighted), and in the end pose the arm/Oscar swings into the left-center — so do NOT put a text column beside it. Instead: headline sits in the upper-left black void, CTA + proof line in the lower-left/lower area, both overlaid on the frame's empty black regions. Keep text clear of the figure across the *entire* scrub range (check the end frame where the arm extends furthest left). Eyebrow top, headline upper-left, CTA lower.
  - **Mobile + `prefers-reduced-motion`:** do NOT preload all 61 frames on mobile. Fall back to a single static frame — the end pose (Oscar presented) — as a plain image. Same fallback when reduced-motion is set.
  - **Edge compositing:** the exported frames have a subtle vignette/falloff and near-black WebP blocking, so their black is NOT pure `#000`. Two required steps: (a) sample the frame's actual corner black and set `--void` to match it exactly so no rectangular seam shows where canvas meets page; (b) feather the canvas edges — a soft radial/linear mask (CSS `mask-image` or a `radial-gradient` overlay) fading the frame edges into `--void` so the panel dissolves into the page rather than ending on a hard rectangle. The figure is centered, so an aggressive edge feather is safe — it won't clip the subject.
- Below, a thin mono proof line: `17 YEARS · THOUSANDS OF SHOTS · IMDB ↗` (link to IMDb [PLACEHOLDER: IMDb URL])

### 4.3 — The Films (proof layer)
Section title (serif): **The work.**
Intro line (mono/sans, --ink-dim): `A selection from seventeen years in feature & episodic VFX.`

Five film nodes, each = a **looping floating-object video** + minimal mono caption. Alternate object left/right of text as you scroll. Each caption:
- Film title (serif, medium)
- Role + year + studio (mono, --ink-dim)
- One sharp line on the contribution (serif/sans)

**Node object treatment (looping video — applies to ALL five nodes):** Each object is a slow ambient float/rotation loop (NOT scroll-scrubbed — that's the hero only). Implement as a looping `<video autoplay muted loop playsinline>` element, served as **both MP4 (H.264) and WebM (VP9)** source tags for cross-browser support. Use an **IntersectionObserver** to play when the node scrolls into view and pause when it leaves (saves battery/CPU; never autoplay all five at once). Provide a **static poster frame** (first frame of each loop, as WebP) that shows on mobile, on `prefers-reduced-motion`, and before the video loads. The video's pure-black background composites on `--void` via `mix-blend-mode: screen` (no alpha needed). Files: `films/gravity.mp4`+`.webm`+`poster.webp`, etc. Keep each loop small (interframe compression on a near-static black scene is tiny — target well under 1.5MB per clip).

**Avatar** [ASSET: films/avatar — a heavy piloted mech walker, shadowed pilot in an open cockpit, worn metal armor, orange rim raking the left plating; slow float + faint hydraulic life]
`VFX Editor · 2009 · Framestore`
> A year of sixteen-hour days. Every shot through the pipeline, artist to screen.

**Gravity** [ASSET: films/gravity — an empty Russian cosmonaut space helmet, reflective visor, "L. DEMIDOV" name tag, orange glinting on the glass; slow float]
`VFX Editor · 2013 · Framestore`
> [PLACEHOLDER: one line — your specific contribution]

**Harry Potter and the Deathly Hallows** [ASSET: films/hp — round wire-frame eyeglasses, orange catching the thin metal rim and temple arms; slow float]
`Lead VFX Editor · 2010–11 · Framestore`
> The only person who knew the project structure from the earlier films. I ran editorial.

**Black Mirror** [ASSET: films/blackmirror — a switched-off smartphone with a cracked screen, orange glowing faintly through the spiderweb of cracks and pulsing subtly; slow float]
`VFX Editor · Framestore`
> Charlie Brooker demands invisible effects — harder to pull off than the spectacular ones.

**Alien: Covenant** [ASSET: films/alien — a biomechanical facehugger-style creature, bony finger-legs and curled segmented tail, orange raking the spine; slow float + faint twitch]
`VFX Editor · 2017 · Framestore`
> [PLACEHOLDER: one line — your specific contribution]

Close the section with a mono strip of additional credits (no objects, just text, comma-separated): `ALSO: The Dark Crystal · Paddington · Guardians of the Galaxy · Everest · Jupiter Ascending · RoboCop · Geostorm · The Golden Compass`

### 4.4 — What I do (expertise bridge)
Section title (serif): **What I actually do.**
Short prose (serif):
> My job was always the same: make the invisible work. Bridge the creative vision and the technical reality of getting it on screen — thousands of shots, moving cleanly from artist to final.

Then a tight mono capability list (2–3 columns, no fluff):
- `EDL / ALE workflows`
- `Shot tracking & turnover`
- `Editorial–VFX pipeline design`
- `Avid / conform / online`
- `Database & automation tooling`
- `AI integration for post`

This section is the hinge: it converts "famous films" into "understands my pipeline," which sets up the tools.

### 4.5 — FRAME/SHIFT (the database project)
**Spelling is fixed: always "FRAME/SHIFT" — all caps, with the forward slash. Never "Frameshift" / "FrameShift".**
Section title (serif): **FRAME/SHIFT.** (Logo available at `images/` — use it.)
Positioning line (serif):
> [PLACEHOLDER — short line on what FRAME/SHIFT is: an editorial/VFX database project.]

This is a placeholder section for now (real content added later). Build it as a clean, repeatable block. CTA links externally to the constant `FRAMESHIFT_URL` = `https://frameshift.run/` (`→ Visit FRAME/SHIFT ↗`). Don't invent product details. May use `tool-frameshift.png` floating object if generated, otherwise the logo.

### 4.5b — VFX Tools (the tools collection)
Section title (serif): **VFX Tools.**
Positioning line (serif):
> [PLACEHOLDER — short line: a selection of editorial/VFX tools I build and share on LinkedIn.]

Separate from FRAME/SHIFT. A selection of standalone tools, some of which FRAME/SHIFT will eventually absorb, plus new ones added over time. Placeholder block for now. CTA links to the constant `VFXTOOLS_URL` = `/vfxtools/index.html` (an existing page already in the repo — **do not modify the `vfxtools/` directory**, only link to it). `→ Explore the tools ↗`

> **Both `FRAMESHIFT_URL` and `VFXTOOLS_URL` are defined once as commented constants at the top of the JS (or HTML head), so they can be repointed later without hunting through markup. Nav has a separate anchor for each section.**

### 4.6 — Now (current projects)
Section title (serif): **What I'm building now.**
- **AI tools for VFX editorial** (serif blurb): [PLACEHOLDER]
- **Mr. Lobster** — one node [ASSET: `lobster.png` if generated, or the Mr Lobster logo in `images/`]:
  > Proof I ship AI products outside film: an AI WhatsApp automation for local businesses that can't afford to miss an enquiry.
  `→ mrlobster.co.uk ↗`
Frame Mr. Lobster as *evidence I ship*, not a second pitch. One sentence, one link.

### 4.7 — Contact (end card)
Section title (serif): **Let's talk.**
Sub (sans): For AI integration in post pipelines, editorial tooling, or speaking.
Mono links: `EMAIL ↗` [PLACEHOLDER] · `LINKEDIN ↗` [PLACEHOLDER] · `IMDB ↗` [PLACEHOLDER] · `X ↗` [PLACEHOLDER]
Footer (mono, --ink-dim): `© 2026 Lukasz Bukowiecki · bukowiecki.co`

---

## 5. Technical requirements
- Single `index.html` + one CSS file + one JS file (or inlined). No build step required to host.
- Vanilla JS for scroll/float/parallax/reveal. No heavy libs. (Lenis for smooth scroll optional, only if it stays light.)
- Fonts via Google Fonts `<link>` or self-hosted.
- Fully responsive; mobile reduces motion and stacks objects.
- Semantic HTML, accessible (alt text on every object PNG describing the film/tool), `prefers-reduced-motion` respected.
- SEO: title, meta description, OG tags. OG image = the hero end frame (Oscar presented) on black.
- Components/sections structured so copy and tool cards are easy to edit by hand later.
- Leave every [PLACEHOLDER] as an obvious, commented slot.
- **Repo & deploy:** project lives at `https://github.com/manzombie/bukowiecki-website` (a `lukasz.bukowiecki.co` "mission control" already exists there). Build into this repo without breaking existing content.
- **Asset locations (build dir `/Users/lbukowiecki/BUKOWIECKI/BUKOWIECKI_REDESIGN/`):** hero frames in `hero/`, film loops in `films/`, FRAME/SHIFT + Mr Lobster logos in `images/`, existing VFX tools page in `vfxtools/` (link only, do not modify).

---

## 6. Asset status & remaining generation prompts

**Already produced (do not regenerate):**
- **Hero** — 61-frame WebP scroll-scrub sequence (`hero/frame_001.webp`…`frame_061.webp`). Real B&W photo of Lukasz presenting an Oscar, animated relaxed→presenting. See Section 4.2.
- **Five film objects** — each a slow-float looping video (MP4+WebM+poster.webp), monochrome on black with upper-left orange rim:
  - `films/avatar` — piloted mech walker, shadowed pilot in open cockpit
  - `films/gravity` — empty Russian cosmonaut helmet, "L. DEMIDOV" name tag
  - `films/hp` — round wire-frame eyeglasses
  - `films/blackmirror` — switched-off smartphone, cracked screen with orange glow through the cracks
  - `films/alien` — biomechanical facehugger-style creature

**Still to generate** — same recipe for a unified set: **photoreal, monochrome (silver/charcoal), floating in pure black void, single hot-orange (#FF4D00) rim light from the upper left, museum-object presentation, soft rim lighting, shallow depth of field, object centered, empty black background.** Solid black is fine (composited via `mix-blend-mode: screen`).

| Asset | OBJECT prompt |
|---|---|
| `tool-frameshift.png` | floating frosted-glass UI panels stacked in space, thin data ribbons (like film/EDL strips) curling between them, orange highlights on active elements |
| `lobster.png` | a sleek minimalist lobster form rendered in brushed metal, single orange accent, playful but premium |

Keep these two on the same lighting setup as the rendered set so the page feels coherent. Avoid literal copyrighted characters/logos — objects are evocative, not IP reproductions.

---

## 7. Build order (suggested)
1. Scaffold: tokens, fonts, nav, section shells, scroll/float/reveal JS.
2. Hero: build the sticky-canvas scroll-scrub harness with placeholder frames → swap in the exported `hero/frame_###.webp` sequence; wire preload + RAF draw + mobile/reduced-motion static fallback.
3. Films section with the five nodes + alternating layout + reveal.
4. Expertise + FrameShift (the sale) — make tool cards a clean repeatable block.
5. Now + Contact.
6. Polish: motion timing, reduced-motion, mobile, performance pass, lazy-load.
