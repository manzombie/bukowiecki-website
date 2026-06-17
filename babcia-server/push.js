/* push.js — Web Push (VAPID). Sends a small, content-free notification to the
 * OTHER people in a room when a message lands, so they know to open the app.
 * The message text is never put in the push payload (kept personal + private);
 * we only say who wrote, localised to each recipient's reading language. */

import webpush from "web-push";
import { getSubsForRoom, deleteSubscription } from "./db.js";

const PUBLIC = process.env.VAPID_PUBLIC || "";
const PRIVATE = process.env.VAPID_PRIVATE || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:lukasz.vfx@gmail.com";

export const usingPush = Boolean(PUBLIC && PRIVATE);
export const vapidPublicKey = PUBLIC;

if (usingPush) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  console.log("[push] Web Push enabled.");
} else {
  console.warn("[push] VAPID keys not set — push notifications disabled.");
}

// "New message from {name}", per reading language (fallback English).
const NEW_MSG = {
  English:    (n) => `New message from ${n}`,
  Polish:     (n) => `Nowa wiadomość od ${n}`,
  Spanish:    (n) => `Nuevo mensaje de ${n}`,
  German:     (n) => `Neue Nachricht von ${n}`,
  French:     (n) => `Nouveau message de ${n}`,
  Ukrainian:  (n) => `Нове повідомлення від ${n}`,
  Italian:    (n) => `Nuovo messaggio da ${n}`,
  Portuguese: (n) => `Nova mensagem de ${n}`,
  Dutch:      (n) => `Nieuw bericht van ${n}`,
  Russian:    (n) => `Новое сообщение от ${n}`,
};
const body = (lang, name) => (NEW_MSG[lang] || NEW_MSG.English)(name);

/** notify everyone subscribed to `room` except the sender. Best-effort. */
export async function notifyRoom(room, sender) {
  if (!usingPush) return;
  let subs = [];
  try { subs = await getSubsForRoom(room, sender); } catch (e) { console.error("[push] sub lookup", e); return; }
  await Promise.all(subs.map(async (s) => {
    const payload = JSON.stringify({ title: "Babcia Chat", body: body(s.lang, sender), room });
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await deleteSubscription(s.endpoint).catch(() => {});  // prune dead endpoint
      } else {
        console.error("[push] send failed", err?.statusCode || err?.message);
      }
    }
  }));
}
