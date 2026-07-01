/* sw.js — Babcia Chat service worker.
 * 1) Makes the app installable on Android/desktop (manifest + a fetch handler).
 * 2) Receives Web Push and shows a notification even when the app is closed.
 * 3) On tap, focuses an open tab (or opens one) at the right conversation. */

const CACHE = "babcia-v3";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first for navigations (so updates show), cache fallback when offline.
// Same-origin GETs only — never touch the cross-origin API.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((m) => m || caches.match("./index.html")))
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || "Babcia Chat";
  const room = data.room || "";
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || "New message",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "babcia-" + room,          // collapse repeats per conversation
    renotify: true,
    data: { room },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const room = e.notification.data && e.notification.data.room;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes("/babcia/")) { await c.focus(); c.postMessage({ type: "open-room", room }); return; }
    }
    await self.clients.openWindow(room ? ("./?room=" + encodeURIComponent(room)) : "./");
  })());
});
