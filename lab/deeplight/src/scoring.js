/* scoring.js — the scoring rules the maps encode.
 *  - shoot hostiles/debris : points (+ survival)
 *  - star                  : flat score
 *  - mult2x / mult3x gates : bank a multiplier for the rest of the run
 *  - dead end              : penalty (wasted current)
 * End-of-level tally weighs route efficiency vs loot. */

const PTS = { hostile: 150, debris: 60, star: 200 };

export class Scoring {
  constructor() {
    this.score = 0;
    this.mult = 1;
    this.kills = 0;
    this.stars = 0;
    this.deadEnds = 0;
    this.banked = [];     // which multiplier gates passed
  }

  kill(type) {
    const base = PTS[type] || 50;
    this.score += Math.round(base * this.mult);
    this.kills++;
    return base * this.mult;
  }

  star() {
    this.score += Math.round(PTS.star * this.mult);
    this.stars++;
    return PTS.star * this.mult;
  }

  gate(type) {
    const m = type === "mult3x" ? 3 : 2;
    if (m > this.mult) { this.mult = m; this.banked.push(type); return true; }
    return false;
  }

  penalty(amount) { this.score = Math.max(0, this.score - amount); }
  deadEnd() { this.deadEnds++; this.penalty(150); }

  /** final tally with a route-efficiency bonus (fewer dead ends = cleaner run) */
  tally(reachedExit) {
    const cleanBonus = reachedExit ? Math.max(0, 1000 - this.deadEnds * 200) : 0;
    const total = this.score + cleanBonus;
    return { total, cleanBonus, ...this.summary() };
  }
  summary() {
    return { score: this.score, mult: this.mult, kills: this.kills,
             stars: this.stars, deadEnds: this.deadEnds };
  }
}
