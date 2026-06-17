# Babcia Chat — Research Studio, Day 04

A store-and-forward chat for families who speak different languages. Each person
reads the **whole** conversation in **their own** language. Named for *babcia*
(Polish: grandmother) — built so a grandparent and grandchild can text across a
language gap, on a phone, like a real app.

- **Frontend:** `lab/babcia-chat/` — static, ships on the lab site sync → `lab.bukowiecki.co/babcia-chat/` (published UNLISTED — live, but not linked from the landing page).
- **Backend:** `babcia-server/` — Node/Express **Render Web Service** (holds the LLM key; the key never reaches the browser).

---

## How it works

```
phone (lab/babcia, static)  ──fetch──►  Render Web Service (babcia-server)
  · pick name + passcode + language        · POST /api/message  → store original
  · poll every 3s (pauses when hidden)      · GET  /api/messages?lang=  → translate-on-read (cached)
  · "waking up…" during cold start          · translate via Claude/GPT (warmth-preserving prompt)
                                            · Render Postgres (free)  messages + translations cache
```

- **A room = a passcode.** Type your name + the passcode you agreed offline → you're in.
  - **PUBLIC demo room:** passcode **`DEMO`** (anyone can open it on the lab page).
  - **PRIVATE family room:** a secret passcode only mum + grandchild know. Rooms are
    isolated by passcode, so the demo never exposes private messages.
- **Translate-on-read:** the original is stored once; each reader's language is rendered
  on demand and **cached** per message (`translations` JSONB) so we don't re-call the LLM
  on every poll.
- **Store-and-forward:** messages persist; the other person can be offline and read later.

---

## Run locally

```bash
# backend
cd babcia-server
npm install
node server.js            # → http://localhost:8790  (in-memory store + MOCK translator if no key)

# frontend (from repo root, any static server)
python3 -m http.server 8080 --directory lab
# open http://localhost:8080/babcia/   (use localhost; the frontend auto-targets :8790 in dev)
```

With no `LLM_API_KEY` the server uses a **mock translator** (`[Lang] …`) and an
**in-memory** store — perfect for testing the flow. Set the env vars below for the real thing.

Two-user test: open two tabs, both passcode `DEMO`, one Polish + one English; send from each.

---

## LIVE STATUS (2026-06-16)

- **Backend: LIVE** at `https://babcia-server.onrender.com` (Render free, Oregon),
  real Claude key set (`/api/health` → `{"ok":true,"mock":false}`), connected to
  the existing **`frameshift-db`** Postgres via its own `babcia_messages` table.
- Verified: real Polish↔English round-trip reads warmly; messages persist; CORS
  allows `https://lab.bukowiecki.co` (preflight 204).
- **Frontend: ready but NOT published** — `app.js` already points `RENDER_URL` at
  the live service. Publishing waits on (a) the logo PNG for icons, (b) owner go-ahead.
- The public `DEMO` room currently holds a seeded sample exchange (easy to ignore/replace).

## Deploy to Render (human steps — see NEEDS)

`babcia-server/render.yaml` is a blueprint: **New → Blueprint → this repo**. It creates
the Web Service (rootDir `babcia-server`) + a free Postgres and wires `DATABASE_URL`.
Then in the service's **Environment** tab set:

| var | value |
|---|---|
| `LLM_PROVIDER` | `anthropic` (or `openai`) |
| `LLM_API_KEY` | your key (never in the repo) |
| `LLM_MODEL` | *(optional override)* |
| `CORS_ORIGIN` | `https://lab.bukowiecki.co` |
| `DATABASE_URL` | *(auto from the Render Postgres)* |

Then set the frontend's backend URL: in `lab/babcia/app.js`, `RENDER_URL` →
your `https://<service>.onrender.com`.

**Cold start:** Render free services sleep after ~15 min and take ~30–60s to wake.
The frontend shows a calm "Waking up, one moment…" overlay (polls `/api/health`),
never a blank/error screen.

**⚠️ Free Postgres expires after 90 days** — fine for the public demo; mum's private
room needs a paid DB or periodic export for long-term history (decision flagged in NEEDS).

---

## Icons / Add-to-Home-Screen

Place the transparent logo at `lab/babcia/icons/source/babcia_Chat_logo.png`, then:

```bash
cd lab/babcia/icons
python3 gen-icons.py        # needs Pillow:  pip install pillow
```

This generates `apple-touch-icon.png` (180, **flattened on brand teal** — iOS fills
transparency with black otherwise), `icon-192/512.png`, `icon-512-maskable.png`
(extra safe padding for Android's mask) and `favicon-32.png`. `manifest.webmanifest`
+ the `<head>` tags are already wired, so iOS "Add to Home Screen" and Android install
both show the logo on teal and open full-screen.

---

## Notes
- No accounts, no tracking. LLM key + DB URL live **only** in Render env vars; `.env` is gitignored; `.env.example` lists what's needed.
- CORS locked to `lab.bukowiecki.co` + localhost. POST is rate-limited per IP; messages capped at 2000 chars.
- Mobile-first: 16px+ inputs (no iOS zoom), 44px+ taps, safe-area insets, keyboard-safe layout, polling pauses when the tab is hidden.
- The private family passcode is **set by the owner, never committed**.
