/* loop.js — fixed-timestep accumulator with bounded catch-up.
 * The simulation always advances in SIM_DT steps; rendering interpolates
 * between the last two states with `alpha`. After a stall (tab switch, GC,
 * breakpoint) at most MAX_CATCHUP_STEPS are run and the remaining time is
 * discarded, so nothing ever jumps. */

import { SIM_DT, MAX_CATCHUP_STEPS } from "./tuning.js";

export class FixedStepper {
  constructor(step, dt = SIM_DT, maxSteps = MAX_CATCHUP_STEPS) {
    this.stepFn = step; this.dt = dt; this.maxSteps = maxSteps;
    this.acc = 0; this.alpha = 0; this.steps = 0; this.dropped = 0;
  }
  /** feed real elapsed seconds; returns number of steps run */
  advance(elapsed) {
    this.acc += Math.max(0, elapsed);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) {
      this.stepFn(this.dt);
      this.acc -= this.dt; n++;
    }
    if (this.acc >= this.dt) { this.dropped += this.acc; this.acc = this.acc % this.dt; }
    this.alpha = this.acc / this.dt;
    this.steps += n;
    return n;
  }
  reset() { this.acc = 0; this.alpha = 0; }
}
