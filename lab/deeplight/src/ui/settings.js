/* settings.js — persisted settings + best results, with safe fallbacks
 * (private mode, blocked storage and corrupt JSON all degrade to defaults). */

const KEY = "deeplight.settings.v2", BEST = "deeplight.best.v2";

function read(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (_) { return false; } }

export class Settings {
  constructor() {
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.defaults = {
      musicVol: 0.45, musicEnabled: true, sfxVol: 0.85, sensitivity: 1, invertY: false, fov: 72,
      reducedMotion: reduce, shake: true, quality: coarse ? "low" : "medium",
      routeAssist: "sonar", bindings: null, seenTutorial: false,
    };
    const saved = read(KEY);
    this.v = { ...this.defaults, ...(saved && typeof saved === "object" ? saved : {}) };
    this.listeners = new Set();
  }
  get(k) { return this.v[k]; }
  set(k, val) { this.v[k] = val; write(KEY, this.v); for (const f of this.listeners) f(k, val); }
  onChange(f) { this.listeners.add(f); }

  best() { return read(BEST) || null; }
  /** returns true if this is a new best */
  submit(summary) {
    const b = this.best();
    const isBest = !b || summary.total > b.score;
    if (isBest) write(BEST, { score: summary.total, rank: summary.rank, time: summary.time, date: Date.now() });
    return isBest;
  }
}
