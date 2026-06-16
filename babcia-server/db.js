/* db.js — message storage. Uses Render Postgres when DATABASE_URL is set;
 * falls back to an in-memory store for local dev (no DB needed to run/test).
 * Translations are cached per message in translations_jsonb {lang: text}. */

import pg from "pg";

// Namespaced table name so Babcia can safely SHARE an existing database with
// other apps (e.g. frameshift-db) without colliding with their tables.
const TABLE = "babcia_messages";
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
`;

let pool = null;
const mem = [];          // in-memory fallback rows
let memId = 1;

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
