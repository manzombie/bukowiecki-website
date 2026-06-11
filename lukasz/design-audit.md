# Mission Control — Design Audit (Phase 1A)

Audited: 2026-06-11, against the live dashboard at desktop width (screenshot + `lukasz/index.html`, `styles.css`, `app.js`, `mc.js`).

The standard applied: this dashboard exists for a 3-second morning glance — *what are my three tasks, am I on streak, what time is it, what does the week look like*. Every point below is judged against that ritual, not against taste.

---

## 1. Thirteen panels, zero hierarchy

**What's wrong:** The grid renders 13 panels (01 TODAY through 13 PROJECT BOARD) at near-equal visual weight. Panel codes imply an order, but the layout doesn't enforce one — VITALS, OPERATOR, GITHUB LINK, and HANDOFF PROMPT occupy the same visual tier as the daily mirror.

**Why it fails:** A morning glance has no landing point. The eye does a full sweep of the page to find the three tasks. Information density became information noise — exactly the calm-technology failure mode.

**Fix direction:** One hero (the mirror), four supporting panels, everything else collapsed to pills or removed from the default view. The z-hierarchy must be visible from across the room.

## 2. The hero panel wastes its own real estate

**What's wrong:** The mirror panel is the largest, but its content hugs the top-left corner: a huge serif date, then "THE THREE" as a small list, then dead space. In the screenshot, roughly 70% of the hero is empty linen. The runway number — meant to be the loudest number on the board — is a small dash with an underline.

**Why it fails:** The date is decoration; the three tasks are the payload. The current proportions are inverted: the thing you already know (today's date) is enormous, the thing you came for (the tasks) is 13px body text.

**Fix direction:** Tasks become the visual mass of the panel. Streaks and runway become `BigNumber` displays inside the hero. Date stays as the signature, but subordinate in scale to the data.

## 3. Three competing calendar metaphors — one of them visibly broken

**What's wrong:** The page shows a "THIS WEEK" 14-day strip (mirror), a 3-month calendar (session panel), and a day-browser (moleskine). Worse, the 3-month calendar is *rendering broken*: month columns collide and numerals overlap ("613", "311", "1025" composites are visible in the screenshot).

**Why it fails:** Three different answers to "what does my week look like," none authoritative — and one is corrupted, which silently teaches the user to ignore that whole panel. A broken widget on a daily dashboard is worse than no widget.

**Fix direction:** One calendar panel, properly laid out, with dot indicators for logged days. The week-strip can live inside it. The moleskine day-browser is navigation, not a calendar — fine as-is.

## 4. The flat linen theme has no material depth

**What's wrong:** Panels are `rgba(248,243,232,0.72)` over a linen grid-paper background — flat paper cards on flat paper. There's no layering: nothing recedes, nothing comes forward, borders are hairlines at 11% black.

**Why it fails:** Depth is hierarchy. With no material difference between a primary and a tertiary panel, every panel shouts at the same volume. (This is also simply the inverse of the stated design target: warm glass with light coming through.)

**Fix direction:** Warm dark ambient background; three glass levels with distinct blur/opacity/border treatments; primary panels visibly closer to the viewer.

## 5. Typography roles leak everywhere

**What's wrong:** JetBrains Mono is used for labels, data values, buttons, meta text, statuses, and the clock. Georgia serif appears on the date, some panel `h2`s, and vitals numbers. Body is Inter at 13px. The most important numerals on the board — streaks, committed/done, runway — render at 14–20px in whatever font the surrounding block happened to use.

**Why it fails:** When everything is mono-uppercase-tracked, nothing is a label anymore. And numbers — the actual heroes of this dashboard — have no dedicated treatment at all. The hierarchy "number first, context second" is unbuildable with the current roles.

**Fix direction:** Three strict roles: Display (numerals, huge, weight ~300), Label (mono, tiny, tracked), Body (clean sans, 14px). No mixing.

## 6. Developer panels masquerade as morning-ritual panels

**What's wrong:** HANDOFF PROMPT is a raw read-only `<textarea>` of an AI prompt. GITHUB LINK is three static links and a "planned for v0.2" note. OPERATOR shows an avatar, "Founder · Builder · Reviewer", and two hardcoded stats ("Mode: Deep Work", "Source: v3 Master Plan").

**Why it fails:** These serve the person who *built* the dashboard, not the person *waking up to it*. They cost a third of the page in attention and answer no morning question. The hardcoded stats are worse than empty — they're fake data wearing a data costume.

**Fix direction:** Demote all three to collapsed pills (functionality preserved, attention reclaimed) or fold them into a single utility drawer.

## 7. Two parallel task systems split the brain

**What's wrong:** Panel 04 VENTURES is the DB-backed Mission Control board (projects/tasks via `/api/mc`). Panel 13 PROJECT BOARD is the legacy localStorage board with its own tabs, its own "New Task" button, and its own active-task flow (panel 03 pulls from it, not from MC).

**Why it fails:** Two places to look for "what should I do," two add buttons, two sources of truth — and the done-states don't talk to each other. The cognitive tax is paid every single glance.

**Fix direction:** MC ventures is the canonical board. The legacy board survives (no functionality removed) but collapsed and clearly marked legacy; the active-task panel should read from the canonical board.

## 8. Color says nothing

**What's wrong:** One coral accent (`#FF6B5B`) does every job: today's highlight, runway underline, refresh hovers, danger-ish moments. The semantic colors (`--ok #637a5d`, `--warn #b58a4e`, `--danger #b96855`) are three muted earth tones nearly indistinguishable at small sizes. Muted text `#9c9488` on linen `#f2ecdf` is ~2.6:1 contrast — well below the 4.5:1 floor — and it's used for real content (labels, dates, streak meta).

**Why it fails:** Color that can't distinguish "on track" from "in danger" at a glance isn't a system, it's a palette. And failing contrast on a daily-use surface is a legibility bug, not a style choice.

**Fix direction:** One warm accent used *only* for "this matters right now," one cool counterpoint, semantic states that read at 10px, all text ≥4.5:1 on its actual surface.

## 9. No spacing rhythm

**What's wrong:** Padding and gaps are ad hoc: 13px base font, 18px page padding, panel padding varies (14/15/18/24/28px observed), gaps of 6/8/10/12/14/18px coexist. The mirror's internal grid and the rail panels don't share a beat.

**Why it fails:** Inconsistent rhythm reads as visual noise even when no single value is "wrong" — it's why the page feels busy despite being mostly empty linen.

**Fix direction:** An 8-step spacing scale (4–64px), applied without exception. Panel padding picks one value per glass level.

## 10. Zero motion design, zero loading states

**What's wrong:** Data pops into the DOM when fetches resolve ("Loading tide curve…" text swaps to a table; news appears as a block). No skeletons, so panels reflow and the page layout shifts during the first seconds — precisely the moment of the morning glance. No transitions exist beyond a 0.18s button background.

**Why it fails:** Layout shift during the glance breaks the 3-second test mechanically — the thing you started reading moves. And a dashboard with no considered motion can't communicate state changes (task done, streak up) except by mute repaints.

**Fix direction:** Skeleton states for every async panel; staggered fade-in on first load; micro-feedback on done-toggles and thumbs; all of it behind `prefers-reduced-motion`.

---

## Summary verdict

The current dashboard is a *builder's console*: it shows everything it knows, all the time, at equal volume, in a flat material. It serves the developer who made it. The redesign must turn it into an *instrument*: one glance, three tasks, two big numbers, and a quiet room of glass behind them.
