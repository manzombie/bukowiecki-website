/* server.js — Babcia Chat backend (Render Web Service).
 * Store-and-forward translating chat. The LLM key lives ONLY in env, never in
 * the browser. Endpoints:
 *   GET  /api/health
 *   POST /api/message    { room, sender, sourceLang, text }
 *   GET  /api/messages?room=..&lang=..   (translate-on-read, cached)
 */

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { initDb, insertMessage, getMessages, cacheTranslation } from "./db.js";
import { translate, usingMock } from "./translate.js";

const PORT = process.env.PORT || 8790;
const MAX_LEN = 2000;          // cap message length
const ROOM_MAX = 64, NAME_MAX = 40, LANG_MAX = 24;

// CORS: lab origin + localhost for dev (+ optional override)
const ALLOWED = [
  "https://lab.bukowiecki.co",
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : []),
];
const corsOpts = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);                       // curl / same-origin
    if (ALLOWED.includes(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
};

const app = express();
app.use(cors(corsOpts));
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, mock: usingMock }));

const postLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.post("/api/message", postLimiter, async (req, res) => {
  try {
    let { room, sender, sourceLang, text } = req.body || {};
    if (!room || !sender || !sourceLang || !text) return res.status(400).json({ error: "missing fields" });
    room = String(room).slice(0, ROOM_MAX); sender = String(sender).slice(0, NAME_MAX);
    sourceLang = String(sourceLang).slice(0, LANG_MAX); text = String(text).trim().slice(0, MAX_LEN);
    if (!text) return res.status(400).json({ error: "empty message" });
    await insertMessage({ room, sender, sourceLang, text });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
});

app.get("/api/messages", async (req, res) => {
  try {
    const room = String(req.query.room || "").slice(0, ROOM_MAX);
    const lang = String(req.query.lang || "").slice(0, LANG_MAX);
    if (!room || !lang) return res.status(400).json({ error: "room and lang required" });
    const rows = await getMessages(room);
    const out = [];
    for (const m of rows) {
      let text = m.translations?.[lang];
      if (text == null) {                                     // translate-on-read + cache
        text = await translate(m.original_text, m.source_lang, lang);
        await cacheTranslation(m.id, lang, text);
      }
      // NOTE: the original source text is deliberately NOT returned — readers only
      // ever see the message in their own language (kept personal, no "machine"
      // showing through). The original stays server-side, used only to translate
      // for the OTHER person's language.
      out.push({
        id: m.id, sender: m.sender, sourceLang: m.source_lang, text,
        createdAt: m.created_at instanceof Date ? m.created_at.toISOString() : m.created_at,
      });
    }
    res.json({ messages: out });
  } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`[babcia] listening on :${PORT} (mock translator: ${usingMock})`));
}).catch((e) => { console.error("DB init failed:", e); process.exit(1); });
