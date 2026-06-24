# Restaurant Review Builder — Research Studio, Day 08

A guided questionnaire turns a meal into a fair, well-written, structured review to
paste into Google, plus a star rating that actually matches the words. People can't
write a good review from a blank box, but they can answer questions about it.

- `index.html` · `styles.css`
- `app.js` — one-step-at-a-time questionnaire, stance, length, the write step
- `rating.js` — client-side, deterministic star rating + plain-English rationale
- Backend: one new route on the **existing Babcia Render service** (`POST /api/review`)

## How it works

1. **Questionnaire** (one screen at a time, mobile-first): basics, arrival, drinks,
   food (the heart), service, atmosphere, value, then **stance** (generous / balanced /
   critical) and the **verdict** (return? recommend?). Quick 1–5 taps plus an optional
   "anything specific?" box per section. The specifics are the gold and get woven into
   the prose verbatim.
2. **Star rating — client-side, free, explained** (`rating.js`). Food weighs most, then
   service, then value/atmosphere/arrival/drinks (renormalised over answered sections).
   Stance nudges the number; the verdict keeps it honest. **The number must match the
   words:** if you scored high but won't return, it pulls toward 3 and says so, so you
   never post a glowing score next to a list of letdowns. You can override; the
   suggestion + reasoning always show.
3. **The write step — one server call.** "Write my review" sends the answers + stance +
   length to `POST /api/review`. The LLM writes the **prose only**. The rating never
   needs the API.

## The Nora test case (the design's origin)

Good steak, but a warm beer glass, missing mayonnaise, stale béarnaise, critical stance,
won't return → suggested **3★** (computed 2.9: "food 4/5 counts most; critical stance"),
NOT a glossy 4.3. Verified in `rating.js`.

## Backend endpoint (added to the Babcia service)

`POST /api/review { answers, stance, length } -> { reviewText, mock }`

- Reuses Babcia's existing LLM adapter + key + CORS. No new service.
- **IP rate-limit** (`REVIEW_PER_HOUR`, default 12/hour) so a public page can't run up
  the bill; oversized payloads rejected (HTTP 413); friendly "limit reached" message,
  never a raw error. The key never reaches the client.
- `GET /api/review/health` for the cold-start check.
- **Mock fallback:** with no LLM key the endpoint returns an assembled mock review, so
  the whole app runs end-to-end in dev.

## The prose rules (server prompt)

Hook open → walk arrival/drinks/food/service/atmosphere/value → honest verdict close.
Weaves in the user's specifics verbatim. Matches stance. No clichés. **No em-dashes or
en-dashes anywhere** (owner preference) — enforced in the prompt and with a post-process
safety net that strips any that slip through. (Ordinary hyphens in words are fine.)

## Cold start

The free Render service sleeps after ~15 min (~40s to wake). The write step hits
`/api/review/health` first and shows a calm "Warming up, one moment…" state, never a
broken-looking error.

## Privacy

Frontend is 100% static. Nothing is saved or shared. The only network call is the final
`/api/review` to write the prose; the questionnaire and rating stay in your browser.
