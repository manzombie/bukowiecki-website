/* damage.js — the damage model, deliberately isolated so it can be swapped in
 * ONE file. v1 default = 3 HP + fail-and-restart (arcade tension).
 *
 * To switch to "score-penalty, no-fail": set MODE = "penalty". Then hits never
 * end the run; instead the engine reads onHit() return {penalty} and docks score.
 */

const MODE = "fail";   // "fail" (3HP, restart)  |  "penalty" (no-fail, score hit)
const MAX_HP = 3;

export class Damage {
  constructor() { this.hp = MAX_HP; this.max = MAX_HP; this.dead = false; this.mode = MODE; }

  /** apply a hit. returns {dead, penalty} */
  hit(amount = 1) {
    if (MODE === "penalty") return { dead: false, penalty: 250 * amount };
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.dead = true;
    return { dead: this.dead, penalty: 0 };
  }

  reset() { this.hp = this.max; this.dead = false; }
}
