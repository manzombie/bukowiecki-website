/* db.js — message storage. Uses Render Postgres when DATABASE_URL is set;
 * falls back to an in-memory store for local dev (no DB needed to run/test).
 * Translations are cached per message in translations_jsonb {lang: text}. */

import pg from "pg";

// Namespaced table name so Babcia can safely SHARE an existing database with
// other apps (e.g. frameshift-db) without colliding with their tables.
const TABLE = "babcia_messages";
const SUBS = "babcia_push_subs";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  id            BIGSERIAL PRIMARY KEY,
  room          TEXT NOT NULL,
  sender        TEXT NOT NULL,
  source_lang   TEXT NOT NULL,
  original_text TEXT NOT NULL,
  translations  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS babcia_messages_room_idx ON ${TABLE} (room, created_at);

CREATE TABLE IF NOT EXISTS ${SUBS} (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  name       TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'English',
  rooms      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let pool = null;
const mem = [];          // in-memory fallback rows
let memId = 1;
const memSubs = [];      // in-memory fallback push subscriptions

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[db] No DATABASE_URL — using IN-MEMORY store (dev only, not persistent).");
    return { mode: "memory" };
  }
  pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false }, // Render needs SSL
  });
  await pool.query(SCHEMA);
  console.log("[db] Postgres connected, schema ready.");
  return { mode: "postgres" };
}

/** insert a message; returns the stored row */
export async function insertMessage({ room, sender, sourceLang, text }) {
  if (!pool) {
    const row = { id: memId++, room, sender, source_lang: sourceLang, original_text: text,
      translations: { [sourceLang]: text }, created_at: new Date().toISOString() };
    mem.push(row); return row;
  }
  const seed = JSON.stringify({ [sourceLang]: text });
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (room, sender, source_lang, original_text, translations)
     VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
    [room, sender, sourceLang, text, seed]
  );
  return rows[0];
}

/** all messages for a room, oldest first */
export async function getMessages(room) {
  if (!pool) return mem.filter((m) => m.room === room).sort((a, b) => a.id - b.id);
  const { rows } = await pool.query(
    `SELECT * FROM ${TABLE} WHERE room=$1 ORDER BY created_at ASC, id ASC`, [room]);
  return rows;
}

/** persist a freshly-computed translation into a message's cache */
export async function cacheTranslation(id, lang, text) {
  if (!pool) {
    const row = mem.find((m) => m.id === id); if (row) row.translations[lang] = text; return;
  }
  await pool.query(
    `UPDATE ${TABLE} SET translations = jsonb_set(translations, $2, $3::jsonb, true) WHERE id=$1`,
    [id, `{${lang}}`, JSON.stringify(text)]
  );
}

/** message count per room (no translation) — for unread badges */
export async function getCounts(rooms) {
  const out = {};
  if (!pool) {
    for (const r of rooms) out[r] = mem.filter((m) => m.room === r).length;
    return out;
  }
  const { rows } = await pool.query(
    `SELECT room, COUNT(*)::int AS n FROM ${TABLE} WHERE room = ANY($1) GROUP BY room`, [rooms]);
  for (const r of rooms) out[r] = 0;
  for (const row of rows) out[row.room] = row.n;
  return out;
}

/* ---------------- push subscriptions ---------------- */

/** upsert a push subscription, keyed by its endpoint */
export async function saveSubscription({ subscription, name, lang, rooms }) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error("bad subscription");
  if (!pool) {
    const i = memSubs.findIndex((s) => s.endpoint === endpoint);
    const row = { endpoint, p256dh: keys.p256dh, auth: keys.auth, name, lang, rooms };
    if (i >= 0) memSubs[i] = row; else memSubs.push(row);
    return;
  }
  await pool.query(
    `INSERT INTO ${SUBS} (endpoint, p256dh, auth, name, lang, rooms)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (endpoint) DO UPDATE
       SET name=$4, lang=$5, rooms=$6::jsonb`,
    [endpoint, keys.p256dh, keys.auth, name, lang, JSON.stringify(rooms || [])]
  );
}

/** every subscription that listens to `room`, except those owned by `exceptName` */
export async function getSubsForRoom(room, exceptName) {
  if (!pool) {
    return memSubs.filter((s) => (s.rooms || []).includes(room) && s.name !== exceptName);
  }
  const { rows } = await pool.query(
    `SELECT endpoint, p256dh, auth, name, lang FROM ${SUBS}
      WHERE rooms @> $1::jsonb AND name <> $2`,
    [JSON.stringify([room]), exceptName || ""]
  );
  return rows;
}

/** drop a dead subscription (endpoint returned 404/410) */
export async function deleteSubscription(endpoint) {
  if (!pool) {
    const i = memSubs.findIndex((s) => s.endpoint === endpoint);
    if (i >= 0) memSubs.splice(i, 1);
    return;
  }
  await pool.query(`DELETE FROM ${SUBS} WHERE endpoint=$1`, [endpoint]);
}
