/* server.js — Babcia Chat backend (Render Web Service).
 * Store-and-forward translating chat. The LLM key lives ONLY in env, never in
 * the browser. Endpoints:
 *   GET  /api/health
 *   POST /api/message    { room, sender, sourceLang, text }
 *   GET  /api/messages?room=..&lang=..   (translate-on-read, cached)
 */

import express from "express";
import cors from "cors";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { initDb, insertMessage, getMessages, cacheTranslation, getCounts, saveSubscription, getFullMessages, clearTranslations } from "./db.js";
import { translate, usingMock } from "./translate.js";
import { notifyRoom, usingPush, vapidPublicKey } from "./push.js";
import { writeReview, usingMock as reviewMock } from "./review.js";

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

/* ---- Restaurant Review Builder (Research #08) ---- */
// One LLM call per finished review. IP-rate-limited so a public page can't run up
// the API bill; input length capped. The star rating is computed CLIENT-SIDE.
const REVIEW_PER_HOUR = Number(process.env.REVIEW_PER_HOUR || 12);
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: REVIEW_PER_HOUR, standardHeaders: true, legacyHeaders: false,
  message: { error: "limit", reviewText: "", note: `You've reached the review limit for now (${REVIEW_PER_HOUR}/hour). Please try again later.` },
});

function sizeOfAnswers(a) {
  try { return JSON.stringify(a || {}).length; } catch (_) { return Infinity; }
}

// GET /api/messages triggers a paid translate-on-read for any language not yet
// cached. Cap requests per IP so it can't be polled to burn the API bill.
const messagesLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false });

// Per-room ceiling on how many distinct translation languages we'll ever pay to
// generate. A real family uses a handful; this bounds worst-case spend even if an
// attacker rotates IPs and cycles fake language names. Tune via env if needed.
const LANG_CAP = Number(process.env.LANG_CAP || 12);

// Timing-safe admin key check + per-IP brute-force guard. Key is accepted ONLY in
// the x-admin-key header now (never the query string, which leaks into logs/history).
const adminFails = new Map();
function safeEq(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function adminOk(req, res) {
  const ADMIN = process.env.ADMIN_KEY || "";
  if (!ADMIN) { res.status(403).json({ error: "admin disabled (no ADMIN_KEY set)" }); return false; }
  const ipk = req.ip || "?"; const now = Date.now();
  const fails = (adminFails.get(ipk) || []).filter((t) => now - t < 600_000);
  if (fails.length >= 5) { res.status(429).json({ error: "too many attempts, try later" }); return false; }
  if (!safeEq(req.get("x-admin-key") || "", ADMIN)) {
    fails.push(now); adminFails.set(ipk, fails);
    res.status(401).json({ error: "bad key" }); return false;
  }
  adminFails.delete(ipk); return true;
}

app.get("/api/review/health", (_req, res) => res.json({ ok: true, mock: reviewMock }));

app.post("/api/review", reviewLimiter, async (req, res) => {
  try {
    const { answers, stance, length } = req.body || {};
    if (!answers || typeof answers !== "object") return res.status(400).json({ error: "missing answers" });
    if (sizeOfAnswers(answers) > 6000) return res.status(413).json({ error: "too long", note: "That's a lot of detail — please trim your notes a little." });
    const reviewText = await writeReview({
      answers,
      stance: String(stance || "balanced").slice(0, 12),
      length: length === "short" ? "short" : "full",
    });
    res.json({ reviewText, mock: reviewMock });
  } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
});

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
    if (!adminOk(req, res)) return;
    const room = String(req.query.room || "").slice(0, ROOM_MAX);
    if (!room) return res.status(400).json({ error: "room required" });
    res.json({ room, messages: await getFullMessages(room) });
  } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
});

// PRIVATE: clear cached translations for a room AND regenerate them now, for the
// languages already in use (so the fix shows immediately, not on next read).
app.post("/api/admin/retranslate", async (req, res) => {
  try {
    if (!adminOk(req, res)) return;
    const room = String(req.query.room || "").slice(0, ROOM_MAX);
    if (!room) return res.status(400).json({ error: "room required" });

    // Target languages = every language anyone WRITES in here (each message's
    // source) plus any previously-cached target — i.e. all reader languages.
    // Robust even when the cache was already cleared.
    const before = await getFullMessages(room);
    const langs = new Set();
    for (const m of before) {
      if (m.sourceLang) langs.add(m.sourceLang);
      for (const l of Object.keys(m.translations || {})) langs.add(l);
    }
    if (req.query.langs) String(req.query.langs).split(",").map((s) => s.trim()).filter(Boolean).forEach((l) => langs.add(l));

    await clearTranslations(room);

    let regenerated = 0;
    const rows = await getMessages(room);
    for (const m of rows) {
      for (const lang of langs) {
        if (lang === m.source_lang) continue;
        const text = await translate(m.original_text, m.source_lang, lang);
        await cacheTranslation(m.id, lang, text);
        regenerated++;
      }
    }
    res.json({ ok: true, cleared: rows.length, languages: [...langs], regenerated });
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

app.get("/api/messages", messagesLimiter, async (req, res) => {
  try {
    const room = String(req.query.room || "").slice(0, ROOM_MAX);
    const lang = String(req.query.lang || "").slice(0, LANG_MAX);
    if (!room || !lang) return res.status(400).json({ error: "room and lang required" });
    const rows = await getMessages(room);
    // Distinct languages already paid-for in this room. A new language is only
    // translated while the room is under LANG_CAP — bounding total spend per room.
    const known = new Set();
    for (const m of rows) for (const k of Object.keys(m.translations || {})) known.add(k);
    if (!known.has(lang) && known.size >= LANG_CAP) {
      return res.status(429).json({ error: "language-limit",
        note: "This room has reached its translation-language limit." });
    }
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
