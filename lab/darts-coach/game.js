/* game.js — match state for 101/301/501 (straight subtraction) + turn rotation,
 * plus simple session persistence (localStorage; in-page only, no uploads).
 * v1 scoring is deliberately simple: no checkout/doubles-out/legs/sets (later). */

export class Match {
  /** players: [{name}]; gameType: 101|301|501 */
  constructor(gameType, players) {
    this.start = gameType;
    this.players = players.map((p) => ({ name: p.name, score: gameType, turns: [] }));
    this.cur = 0;
    this.turnDarts = [];     // [{score,label,metrics,releaseT}]
    this.winner = null;
  }
  current() { return this.players[this.cur]; }
  dartsThrown() { return this.turnDarts.length; }
  turnTotal() { return this.turnDarts.reduce((s, d) => s + d.score, 0); }

  /** record one dart for the current turn (max 3) */
  addDart(score, label, meta = {}) {
    if (this.turnDarts.length >= 3 || this.winner) return false;
    this.turnDarts.push({ score, label, metrics: meta.metrics || null, releaseT: meta.releaseT || null });
    return true;
  }
  undo() { return this.turnDarts.pop() || null; }

  /** apply the 3-dart turn: subtract, bust below zero, win on exact zero, rotate */
  commitTurn() {
    const p = this.current();
    const total = this.turnTotal();
    const remaining = p.score - total;
    let bust = false, won = false;
    if (remaining < 0) bust = true;              // v1: below zero = bust (no double-out)
    else if (remaining === 0) { won = true; p.score = 0; }
    else p.score = remaining;
    p.turns.push({ darts: [...this.turnDarts], total, bust });
    if (won) this.winner = p;
    const darts = [...this.turnDarts];
    this.turnDarts = [];
    if (!won) this.cur = (this.cur + 1) % this.players.length;
    return { bust, won, total, remaining: p.score, darts };
  }
}

/* ---- session persistence (localStorage) ---- */
const KEY = "deeplight-darts-sessions";   // namespaced key (in-page only)

export function loadSessions() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) { return []; }
}

export function saveSession(s) {
  const all = loadSessions();
  all.unshift(s);                          // newest first
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50))); } catch (_) {}
}
