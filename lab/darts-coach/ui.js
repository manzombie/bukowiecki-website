/* ui.js — wiring: setup → play → sessions, the keypad, the camera/placement
 * helper, per-dart pose capture, turn reports, solo practice, session log.
 * Drawing/model live in pose.js; rules in analysis.js + game.js. */

import { PoseTracker } from "./pose.js";
import * as A from "./analysis.js";
import { Match, loadSessions, saveSession } from "./game.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, a = {}, ...k) => { const n = document.createElement(t);
  for (const [key, v] of Object.entries(a)) { if (key === "class") n.className = v; else if (key.startsWith("on")) n.addEventListener(key.slice(2), v); else if (v != null) n.setAttribute(key, v); }
  k.forEach((c) => c != null && n.append(c)); return n; };

const cfg = { game: 301, hand: "right", solo: false, players: ["Player 1"] };
const pose = new PoseTracker();
let match = null, mult = 1, liveTimer = null, cameraOn = false, placementOK = false;
let soloThrows = [];

/* ---------------- screens ---------------- */
function show(id) {
  $$(".screen").forEach((s) => (s.hidden = s.id !== id));
  $("#" + id).setAttribute("data-active", "true");
}

/* ---------------- SETUP ---------------- */
function wireSeg(seg, onPick) {
  $$("button", seg).forEach((b) =>
    b.addEventListener("click", () => {
      $$("button", seg).forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true"); onPick(b.dataset.v);
    }));
}
function renderPlayers() {
  const wrap = $("#players"); wrap.innerHTML = "";
  cfg.players.forEach((name, i) => {
    wrap.append(el("div", { class: "player-row" },
      el("input", { type: "text", value: name, "aria-label": "Player name",
        oninput: (e) => (cfg.players[i] = e.target.value) }),
      cfg.players.length > 1 ? el("button", { class: "x", type: "button", title: "remove",
        onclick: () => { cfg.players.splice(i, 1); renderPlayers(); } }, "✕") : null,
    ));
  });
  $("#players-note").textContent = cfg.solo
    ? "Solo practice = posture feedback only, no score."
    : `${cfg.players.length} player${cfg.players.length > 1 ? "s" : ""} · ${cfg.game} · subtract to zero.`;
}

function setupWiring() {
  wireSeg($("#seg-game"), (v) => { cfg.game = +v; cfg.solo = false; renderPlayers(); });
  wireSeg($("#seg-hand"), (v) => { cfg.hand = v; pose.hand = v; $("#ph-side").textContent = v === "left" ? "right" : "left"; });
  $("#add-player").addEventListener("click", () => { cfg.solo = false; cfg.players.push("Player " + (cfg.players.length + 1)); renderPlayers(); });
  $("#solo").addEventListener("click", () => { cfg.solo = true; cfg.players = ["You"]; renderPlayers(); });
  $("#sessions-link").addEventListener("click", (e) => { e.preventDefault(); renderSessions(); show("sessions"); });
  $("#sessions-back").addEventListener("click", () => show("setup"));
  $("#start-btn").addEventListener("click", startGame);
  renderPlayers();
  buildKeypad();
}

/* ---------------- START + camera + placement ---------------- */
async function startGame() {
  pose.hand = cfg.hand;
  const status = $("#cam-status");
  status.textContent = "Requesting camera…";
  try {
    await pose.start($("#video"), $("#overlay"));
    cameraOn = true; status.textContent = "";
  } catch (e) {
    cameraOn = false;
    status.textContent = "Camera unavailable (" + (e.message || e.name) + ") — playing without posture coaching.";
  }
  // build match (unless solo)
  match = cfg.solo ? null : new Match(cfg.game, cfg.players.map((n) => ({ name: n || "Player" })));
  soloThrows = [];
  show("play");
  if (cameraOn && !placementOK) runPlacement(); else beginPlay();
}

function runPlacement() {
  const ph = $("#placement"); ph.hidden = false;
  const list = $("#joint-list");
  const tick = setInterval(() => {
    const c = pose.jointConfidence();
    list.innerHTML = "";
    let ok = true;
    const need = ["Head", "Shoulders", "Throwing arm"];
    for (const [k, v] of Object.entries(c || {})) {
      const good = v >= 55;
      if (need.includes(k) && !good) ok = false;
      list.append(el("li", { class: good ? "good" : "bad" },
        el("span", {}, k), el("span", { class: "state" }, (v ?? 0) + "% " + (good ? "✓" : "…"))));
    }
    if (!c) { ok = false; list.append(el("li", { class: "bad" }, el("span", {}, "No body detected"), el("span", { class: "state" }, "step into view"))); }
    placementOK = ok;
    $("#placement-done").disabled = !ok;
  }, 250);
  $("#placement-done").onclick = () => { clearInterval(tick); ph.hidden = true; placementOK = true; beginPlay(); };
}

function beginPlay() {
  renderScore(); renderOthers();
  $("#live-tag").textContent = cameraOn ? "● live" : "○ camera off";
  $("#live-tag").className = "tag " + (cameraOn ? "live" : "idle");
  // live coaching cue loop
  if (liveTimer) clearInterval(liveTimer);
  if (cameraOn) liveTimer = setInterval(() => {
    const cue = A.liveCue(pose.recent(700), cfg.hand);
    if (cue) $("#live-cue").textContent = cue;
  }, 250);
  // solo: auto-capture on detected throws
  pose.onThrow = cfg.solo ? onSoloThrow : null;
}

/* ---------------- KEYPAD ---------------- */
function buildKeypad() {
  const nums = $("#nums"); nums.innerHTML = "";
  for (let n = 1; n <= 20; n++) nums.append(el("button", { type: "button", class: "k", "data-n": n }, String(n)));
  $$("button", $("#mult")).forEach((b) => b.addEventListener("click", () => {
    $$("button", $("#mult")).forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true"); mult = +b.dataset.m;
  }));
  $("#keypad").addEventListener("click", (e) => {
    const k = e.target.closest("[data-n]"); if (!k) return;
    enterDart(+k.dataset.n);
  });
  $("#undo").addEventListener("click", () => {
    if (!match) return; match.undo(); renderScore();
  });
  $("#quit-btn").addEventListener("click", endSession);
}

function dartScore(n) {
  if (n === 0) return 0;
  if (n === 25) return mult === 2 ? 50 : 25;     // bull / double-bull
  return mult * n;
}
function dartLabel(n) {
  if (n === 0) return "MISS";
  if (n === 25) return mult === 2 ? "BULL50" : "BULL25";
  return (mult === 3 ? "T" : mult === 2 ? "D" : "") + n;
}

function enterDart(n) {
  if (cfg.solo) { mult = 1; return; }           // solo has no scoring; throws auto-captured
  if (!match || match.winner) return;
  const score = dartScore(n), label = dartLabel(n);
  // capture this dart's posture from the recent window
  let metrics = null, releaseT = null;
  if (cameraOn) { metrics = A.metricsForWindow(pose.recent(1300), cfg.hand); releaseT = performance.now(); }
  if (!match.addDart(score, label, { metrics, releaseT })) return;
  mult = 1; $$("button", $("#mult")).forEach((x, i) => x.setAttribute("aria-pressed", i === 0 ? "true" : "false"));
  renderScore();
  if (match.dartsThrown() === 3) finishTurn();
}

function finishTurn() {
  const darts = [...match.turnDarts];
  const res = match.commitTurn();
  showTurnReport(darts, res);
  renderScore(); renderOthers();
  if (res.won) { setTimeout(() => endSession(true), 400); }
}

/* ---------------- RENDER ---------------- */
function renderScore() {
  if (!match) { $("#big-score").textContent = "PRACTICE"; $("#score-sub").textContent = "no score — just throw"; renderDarts([]); return; }
  const p = match.current();
  $("#active-name").textContent = p.name;
  $("#big-score").textContent = p.score;
  $("#score-sub").textContent = "remaining · " + match.start;
  renderDarts(match.turnDarts);
}
function renderDarts(darts) {
  $$(".dart", $("#darts")).forEach((d, i) => {
    d.querySelector("b").textContent = darts[i] ? darts[i].label : "—";
    d.classList.toggle("active", !cfg.solo && i === (darts.length));
  });
}
function renderOthers() {
  const wrap = $("#others"); wrap.innerHTML = "";
  if (!match) {
    wrap.append(el("div", { class: "opp" }, el("div", { class: "opp-name" }, "Solo practice"),
      el("div", { class: "opp-note" }, `${soloThrows.length} throws analysed. Throw and watch the cue.`)));
    return;
  }
  match.players.forEach((p, i) => {
    const last = p.turns[p.turns.length - 1];
    wrap.append(el("div", { class: "opp" + (i === match.cur ? " active" : "") },
      el("div", { class: "opp-top" }, el("span", { class: "opp-name" }, p.name), el("span", { class: "opp-score" }, String(p.score))),
      el("div", { class: "opp-note" }, last ? `last turn ${last.bust ? "BUST" : "−" + last.total}` : "to throw"),
    ));
  });
}

function showTurnReport(darts, res) {
  const box = $("#turn-report"); box.hidden = false; box.innerHTML = "";
  box.append(el("h3", {}, res.won ? "Checkout!" : res.bust ? "Bust — turn reverted" : `Scored ${res.total}`));
  darts.forEach((d, i) => {
    const g = A.gradeThrow(d.metrics);
    const note = g.notes.find((x) => x && x.ok === false) || g.notes[0];
    box.append(el("div", { class: "tr-dart" },
      el("b", {}, `${i + 1}. ${d.label} `),
      document.createTextNode(typeof note === "string" ? note : (note ? note.text : "—"))));
  });
  const sum = A.summarizeTurn(darts);
  const s = el("div", { class: "tr-summary" }, sum.text);
  if (sum.insight) s.append(el("div", { class: "accent" }, sum.insight));
  box.append(s);
}

/* ---------------- SOLO ---------------- */
function onSoloThrow() {
  const metrics = A.metricsForWindow(pose.recent(1200), cfg.hand);
  if (!metrics) return;
  soloThrows.push({ metrics, releaseT: performance.now() });
  const g = A.gradeThrow(metrics);
  const bad = g.notes.find((x) => x && x.ok === false);
  $("#live-cue").textContent = bad ? bad.text : "Clean throw — repeat it.";
  const box = $("#turn-report"); box.hidden = false; box.innerHTML = "";
  box.append(el("h3", {}, `Throw ${soloThrows.length}`));
  g.notes.forEach((nt) => box.append(el("div", { class: "tr-dart" }, typeof nt === "string" ? nt : nt.text)));
  if (soloThrows.length >= 2) {
    const sum = A.summarizeTurn(soloThrows.slice(-3));
    box.append(el("div", { class: "tr-summary" }, sum.text));
  }
  renderOthers();
}

/* ---------------- SESSIONS ---------------- */
function endSession(won = false) {
  if (liveTimer) clearInterval(liveTimer);
  pose.onThrow = null;
  // persist a session summary
  const rec = {
    ts: Date.now(), game: cfg.solo ? "Solo" : String(cfg.game), mode: cfg.solo ? "practice" : "match",
    players: match ? match.players.map((p) => ({ name: p.name, score: p.score, turns: p.turns.length })) : [{ name: "You", throws: soloThrows.length }],
    winner: match && match.winner ? match.winner.name : null,
  };
  saveSession(rec);
  pose.stop(); cameraOn = false;
  $("#turn-report").hidden = true;
  show("setup");
  $("#cam-status").textContent = won && match && match.winner ? `${match.winner.name} won! Session saved.` : "Session saved.";
}

function renderSessions() {
  const list = $("#sessions-list"); list.innerHTML = "";
  const all = loadSessions();
  if (!all.length) { list.append(el("div", { class: "empty" }, "No sessions yet. Play a game or practise.")); return; }
  for (const s of all) {
    const d = new Date(s.ts);
    list.append(el("div", { class: "sess" },
      el("div", { class: "sess-top" }, el("span", {}, `${s.mode === "practice" ? "Practice" : s.game} · ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`),
        el("span", {}, s.winner ? `🏆 ${s.winner}` : "")),
      el("div", { class: "sess-body" },
        (s.players || []).map((p) => `${p.name}: ${p.score != null ? p.score : (p.throws + " throws")}`).join("  ·  ")),
    ));
  }
}

setupWiring();
