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
import { initDb, insertMessage, getMessages, cacheTranslation, getCounts, saveSubscription, getFullMessages } from "./db.js";
import { translate, usingMock } from "./translate.js";
import { notifyRoom, usingPush, vapidPublicKey } from "./push.js";

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

// client config — tells the frontend whether push is available + the public key
app.get("/api/config", (_req, res) => res.json({ push: usingPush, vapidPublicKey }));

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
    notifyRoom(room, sender).catch((e) => console.error("[push] notifyRoom", e));  // fire-and-forget
  } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
});

// PRIVATE audit view: original + every cached translation for a room. Locked
// behind ADMIN_KEY (set in env). Disabled entirely if ADMIN_KEY is unset.
app.get("/api/admin/history", async (req, res) => {
  try {
    const ADMIN = process.env.ADMIN_KEY || "";
    if (!ADMIN) return res.status(403).json({ error: "admin disabled (no ADMIN_KEY set)" });
    const key = req.get("x-admin-key") || req.query.key || "";
    if (key !== ADMIN) return res.status(401).json({ error: "bad key" });
    const room = String(req.query.room || "").slice(0, ROOM_MAX);
    if (!room) return res.status(400).json({ error: "room required" });
    res.json({ room, messages: await getFullMessages(room) });
  } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
});

// unread counts for a set of rooms (no translation) — for the conversation list
app.get("/api/counts", async (req, res) => {
  try {
    const rooms = String(req.query.rooms || "").split(",").map((r) => r.slice(0, ROOM_MAX)).filter(Boolean);
    if (!rooms.length) return res.json({ counts: {} });
    res.json({ counts: await getCounts(rooms) });
  } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
});

// register / refresh a push subscription (idempotent, keyed by endpoint)
app.post("/api/subscribe", postLimiter, async (req, res) => {
  try {
    const { subscription, name, lang, rooms } = req.body || {};
    if (!subscription?.endpoint || !name) return res.status(400).json({ error: "missing fields" });
    await saveSubscription({
      subscription,
      name: String(name).slice(0, NAME_MAX),
      lang: String(lang || "English").slice(0, LANG_MAX),
      rooms: Array.isArray(rooms) ? rooms.slice(0, 50).map((r) => String(r).slice(0, ROOM_MAX)) : [],
    });
    res.json({ ok: true, push: usingPush });
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
