/* app.js — Babcia Chat frontend.
 * - One profile (your name + reading language), many conversations (rooms).
 * - Each conversation is a passcode; you give it a private label on your device.
 * - Store-and-forward: polls the backend; unread badges on the chat list.
 * - Real Web Push: a service worker shows notifications even when closed.
 * No build step. */

(function () {
  "use strict";

  // Backend base URL = the live Render service by default (so the page works
  // anywhere — published or run locally). Add ?dev to the URL to target a local
  // backend on :8790 instead (for offline backend development).
  const RENDER_URL = "https://babcia-server.onrender.com";
  const dev = location.search.includes("dev");
  const API = dev ? "http://localhost:8790" : RENDER_URL;

  const LANGS = [
    { name: "Polish", flag: "🇵🇱" }, { name: "English", flag: "🇬🇧" },
    { name: "Spanish", flag: "🇪🇸" }, { name: "German", flag: "🇩🇪" },
    { name: "French", flag: "🇫🇷" }, { name: "Ukrainian", flag: "🇺🇦" },
    { name: "Italian", flag: "🇮🇹" }, { name: "Portuguese", flag: "🇵🇹" },
    { name: "Dutch", flag: "🇳🇱" }, { name: "Russian", flag: "🇷🇺" },
  ];
  const STORE = "babcia-v2";
  const OLD_STORE = "babcia-chat";
  const $ = (s) => document.querySelector(s);

  /* persisted state:
   * { profile:{name,lang}, rooms:[{label,passcode,lastCount}], notify:bool } */
  let store = { profile: { name: "", lang: "" }, rooms: [], notify: false };
  let setupLang = "";                 // language chosen on the entry screen
  let active = null;                  // current room { label, passcode } or null
  let pollTimer = null, countsTimer = null, lastRendered = -1;

  /* ---------- persistence ---------- */
  function load() {
    try {
      const v2 = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v2) { store = v2; store.rooms = store.rooms || []; return; }
      const old = JSON.parse(localStorage.getItem(OLD_STORE) || "null");
      if (old && old.name) {            // migrate single-room → profile + one room
        store.profile = { name: old.name, lang: old.lang || "" };
        if (old.room) store.rooms = [{ label: old.room, passcode: old.room, lastCount: 0 }];
        save();
      }
    } catch (_) {}
  }
  function save() { localStorage.setItem(STORE, JSON.stringify(store)); }

  /* ---------- screens ---------- */
  function show(id) {
    ["entry", "rooms", "chat"].forEach((s) => { $("#" + s).hidden = (s !== id); });
  }

  /* ---------- entry / profile ---------- */
  function buildLangs() {
    const wrap = $("#langs");
    LANGS.forEach((l) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lang"; b.dataset.lang = l.name;
      b.setAttribute("aria-pressed", "false");
      b.innerHTML = `<span class="flag">${l.flag}</span><span>${l.name}</span>`;
      b.addEventListener("click", () => {
        document.querySelectorAll(".lang").forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true"); setupLang = l.name; validateEntry();
      });
      wrap.appendChild(b);
    });
  }
  function fillEntry() {
    $("#name").value = store.profile.name || "";
    setupLang = store.profile.lang || "";
    document.querySelectorAll(".lang").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.lang === setupLang)));
    validateEntry();
  }
  function validateEntry() {
    $("#enter-btn").disabled = !($("#name").value.trim() && setupLang);
  }
  function saveProfile() {
    const name = $("#name").value.trim();
    if (!name || !setupLang) return;
    store.profile = { name, lang: setupLang };
    save();
    syncPush();                         // keep push sub's name/lang current
    openRoomList();
  }

  /* ---------- conversation list ---------- */
  function openRoomList() {
    active = null; stopPolling();
    $("#rooms-you").textContent = `${store.profile.name} · reading in ${store.profile.lang}`;
    reflectNotifyState();
    renderRoomList();
    show("rooms");
    refreshCounts();                    // immediate badge refresh
    startCountsPolling();
  }
  function renderRoomList() {
    const box = $("#room-list");
    box.innerHTML = "";
    if (!store.rooms.length) {
      box.innerHTML = `<p class="empty-hint">No conversations yet.<br>Tap “New conversation”, give it a name and the passcode you agreed with them.</p>`;
      return;
    }
    store.rooms.forEach((r, i) => {
      const unread = Math.max(0, (countsCache[r.passcode] || 0) - (r.lastCount || 0));
      const card = document.createElement("div");
      card.className = "room-card";
      card.innerHTML = `
        <span class="room-avatar">${(r.label || "?").trim().charAt(0).toUpperCase()}</span>
        <span class="room-info">
          <span class="room-label"></span>
          <span class="room-sub">passcode: <b></b></span>
        </span>
        <span class="room-badge"${unread ? "" : " hidden"}>${unread}</span>
        <button class="room-del" type="button" aria-label="Remove conversation">✕</button>`;
      card.querySelector(".room-label").textContent = r.label;
      card.querySelector(".room-sub b").textContent = r.passcode;
      card.addEventListener("click", () => openRoom(i));
      const del = card.querySelector(".room-del");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(`Remove the chat with ${r.label}? (Messages stay on the server — you can re-add it with the same passcode.)`)) {
          store.rooms.splice(i, 1); save(); syncPush(); renderRoomList();
        }
      });
      box.appendChild(card);
    });
  }

  /* ---------- add conversation ---------- */
  function wireAddRoom() {
    $("#add-toggle").addEventListener("click", () => {
      $("#add-form").hidden = false; $("#add-toggle").hidden = true; $("#add-label").focus();
    });
    $("#add-cancel").addEventListener("click", closeAdd);
    $("#add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const label = $("#add-label").value.trim();
      const passcode = $("#add-pass").value.trim();
      if (!label || !passcode) { $("#add-note").textContent = "Give it a name and a passcode."; return; }
      if (store.rooms.some((r) => r.passcode === passcode)) {
        $("#add-note").textContent = "You already have a chat with that passcode."; return;
      }
      store.rooms.push({ label, passcode, lastCount: 0 });
      save(); syncPush(); closeAdd(); renderRoomList(); refreshCounts();
    });
  }
  function closeAdd() {
    $("#add-form").hidden = true; $("#add-toggle").hidden = false;
    $("#add-label").value = ""; $("#add-pass").value = ""; $("#add-note").textContent = "";
  }

  /* ---------- a single conversation ---------- */
  async function openRoom(i) {
    const r = store.rooms[i]; if (!r) return;
    active = r;
    $("#head-room").textContent = r.label;
    $("#head-you").textContent = `${store.profile.name} · reading in ${store.profile.lang}`;
    show("chat");
    $("#messages").innerHTML = "";
    lastRendered = -1;
    await wakeUp();
    await refresh();                    // loads + marks read
    startPolling();
    $("#msg-input").focus();
  }

  /* ---------- cold start ---------- */
  async function wakeUp() {
    $("#waking").hidden = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(API + "/api/health", { cache: "no-store" });
        if (res.ok) { $("#waking").hidden = true; return; }
      } catch (_) { /* still waking */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
    $("#waking").hidden = true;
  }

  /* ---------- polling (active room) ---------- */
  function startPolling() { stopPolling(); pollTimer = setInterval(refresh, 3000); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  async function refresh() {
    if (!active) return;
    try {
      const res = await fetch(`${API}/api/messages?room=${encodeURIComponent(active.passcode)}&lang=${encodeURIComponent(store.profile.lang)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = data.messages || [];
      render(msgs);
      markRead(active.passcode, msgs.length);   // viewing == read
    } catch (_) { /* offline / waking — keep last view */ }
  }
  function markRead(passcode, count) {
    const r = store.rooms.find((x) => x.passcode === passcode);
    if (r && r.lastCount !== count) { r.lastCount = count; countsCache[passcode] = count; save(); }
  }

  /* ---------- polling (unread counts for the list) ---------- */
  let countsCache = {};
  function startCountsPolling() {
    stopCountsPolling();
    countsTimer = setInterval(refreshCounts, 8000);
  }
  function stopCountsPolling() { if (countsTimer) clearInterval(countsTimer); countsTimer = null; }
  async function refreshCounts() {
    if (!store.rooms.length) return;
    try {
      const list = store.rooms.map((r) => r.passcode).join(",");
      const res = await fetch(`${API}/api/counts?rooms=${encodeURIComponent(list)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      countsCache = data.counts || {};
      if (!$("#rooms").hidden) renderRoomList();
    } catch (_) {}
  }

  /* ---------- render messages ---------- */
  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function render(msgs) {
    const box = $("#messages");
    if (!msgs.length) {
      box.innerHTML = `<p class="empty-hint">No messages yet.<br>Say hello — it will wait here for them.</p>`;
      lastRendered = 0; return;
    }
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.innerHTML = "";
    let lastDay = "";
    for (const m of msgs) {
      const day = new Date(m.createdAt).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
      if (day !== lastDay) { lastDay = day; box.appendChild(elDay(day)); }
      box.appendChild(elBubble(m));
    }
    if (nearBottom || msgs.length !== lastRendered) box.scrollTop = box.scrollHeight;
    lastRendered = msgs.length;
  }
  function elDay(t) { const d = document.createElement("div"); d.className = "day-sep"; d.textContent = t; return d; }
  function elBubble(m) {
    const mine = m.sender === store.profile.name;
    const b = document.createElement("div");
    b.className = "bubble" + (mine ? " mine" : "");
    const who = document.createElement("div"); who.className = "who"; who.textContent = mine ? "You" : m.sender;
    const text = document.createElement("div"); text.className = "text"; text.textContent = m.text;
    const meta = document.createElement("div"); meta.className = "meta";
    meta.appendChild(Object.assign(document.createElement("span"), { textContent: fmtTime(m.createdAt) }));
    b.append(who, text, meta);
    // Translations only — the original source text is never shown (kept personal).
    return b;
  }

  /* ---------- send ---------- */
  async function send(e) {
    e && e.preventDefault();
    if (!active) return;
    const ta = $("#msg-input"); const text = ta.value.trim();
    if (!text) return;
    $("#send-btn").disabled = true;
    try {
      await fetch(API + "/api/message", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: active.passcode, sender: store.profile.name, sourceLang: store.profile.lang, text }),
      });
      ta.value = ""; ta.style.height = "auto";
      await refresh();
      $("#messages").scrollTop = $("#messages").scrollHeight;
    } catch (_) {}
    $("#send-btn").disabled = false; ta.focus();
  }

  /* ---------- push notifications ---------- */
  function reflectNotifyState() {
    const btn = $("#notify-btn"); const hint = $("#notify-hint");
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      $("#notify-bar").hidden = true; return;
    }
    if (Notification.permission === "granted" && store.notify) {
      btn.textContent = "🔔 Alerts are on"; btn.classList.add("on"); btn.disabled = true;
      hint.textContent = "You’ll be notified of new messages.";
    } else if (Notification.permission === "denied") {
      btn.textContent = "🔕 Alerts blocked"; btn.disabled = true;
      hint.textContent = "Notifications are blocked in your browser settings.";
    } else {
      btn.textContent = "🔔 Turn on alerts"; btn.classList.remove("on"); btn.disabled = false;
      hint.textContent = "Get notified when someone writes — even when the app is closed.";
    }
  }
  function urlB64ToUint8(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64); const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  async function enableNotifications() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { reflectNotifyState(); return; }
      const cfg = await (await fetch(API + "/api/config", { cache: "no-store" })).json();
      if (!cfg.push || !cfg.vapidPublicKey) {
        $("#notify-hint").textContent = "Alerts aren’t available on the server yet.";
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(cfg.vapidPublicKey),
        });
      }
      await postSubscription(sub);
      store.notify = true; save();
      reflectNotifyState();
    } catch (err) {
      $("#notify-hint").textContent = "Couldn’t turn on alerts. Try again.";
    }
  }
  async function postSubscription(sub) {
    await fetch(API + "/api/subscribe", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: sub, name: store.profile.name, lang: store.profile.lang,
        rooms: store.rooms.map((r) => r.passcode),
      }),
    });
  }
  // keep the server's record of (name, lang, rooms) in step after any change
  async function syncPush() {
    try {
      if (!store.notify || Notification.permission !== "granted") return;
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await postSubscription(sub);
    } catch (_) {}
  }

  /* ---------- service worker + deep-link from a notification ---------- */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "open-room") jumpToRoom(e.data.room);
    });
  }
  function jumpToRoom(passcode) {
    if (!passcode) return;
    const i = store.rooms.findIndex((r) => r.passcode === passcode);
    if (i >= 0) openRoom(i);
  }

  /* ---------- visibility: pause polling when hidden ---------- */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stopPolling(); stopCountsPolling(); return; }
    if (active) { refresh(); startPolling(); }
    else if (!$("#rooms").hidden) { refreshCounts(); startCountsPolling(); }
  });

  /* ---------- wire up ---------- */
  function init() {
    buildLangs();
    load();
    registerSW();

    ["#name"].forEach((s) => $(s).addEventListener("input", validateEntry));
    $("#enter-btn").addEventListener("click", saveProfile);
    $("#edit-profile-btn").addEventListener("click", () => { fillEntry(); show("entry"); });
    $("#back-btn").addEventListener("click", openRoomList);
    $("#notify-btn").addEventListener("click", enableNotifications);
    $("#composer").addEventListener("submit", send);
    wireAddRoom();

    // graceful logo fallback if the PNG isn't placed yet
    document.querySelectorAll("#logo-entry, .logo-sm").forEach((img) =>
      img.addEventListener("error", () => { img.style.visibility = "hidden"; }));

    // textarea auto-grow + Enter-to-send (Shift+Enter = newline)
    const ta = $("#msg-input");
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; });
    ta.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } });
    ta.addEventListener("focus", () => setTimeout(() => { $("#messages").scrollTop = $("#messages").scrollHeight; }, 300));

    // first run → set up profile; returning → straight to the chat list
    if (store.profile.name && store.profile.lang) {
      openRoomList();
      const qp = new URLSearchParams(location.search).get("room");
      if (qp) jumpToRoom(qp);
    } else {
      fillEntry(); show("entry");
    }
  }
  init();
})();
