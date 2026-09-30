/* bot.js — a test pilot for the whole expedition, using only player inputs
 * (thrust / yaw / vertical / boost, aim direction, fire, sonar). Used by the
 * completion tests in Node and by `?bot=1` in the browser. */

import { Autopilot, pathWaypoints, wrap } from "./autopilot.js";
import { SIM_DT } from "./tuning.js";

const THREATS = ["mine", "lurker", "warden", "shade", "seal", "boulder"];

export class TestPilot {
  constructor(level, variant = "safe") {
    const route = [...level.route];
    if (variant === "salvage" && level.routeSalvage) {
      const s0 = level.routeSalvage[0], s1 = level.routeSalvage.at(-1);
      const a = route.findIndex((p) => p.join() === s0.join()), b = route.findIndex((p) => p.join() === s1.join());
      if (a >= 0 && b > a) route.splice(a, b - a + 1, ...level.routeSalvage);
    }
    this.ap = new Autopilot(pathWaypoints(route, 5), { reach: 4.5, cruise: 0.85 });
    this.sonarT = 0; this.stuckT = 0; this.lastPos = null; this.unstick = 0;
  }

  input(sim) {
    const s = sim.sub;
    let inp;
    const seals = sim.entities.filter((e) => e.type === "seal" && e.alive);
    const nearGate = Math.hypot(s.pos[0] + 140, s.pos[2] + 663) < 40 && s.pos[1] < -34;
    if (seals.length && nearGate) {
      // hold east of the seal and shoot up at the nodes (gimbal is ±30° vertical)
      const hold = [-121, -50, -663];
      const d = Math.hypot(hold[0] - s.pos[0], hold[2] - s.pos[2]);
      inp = new Autopilot([hold], { reach: 1.5 }).input(s);
      if (d < 3) {
        const want = Math.atan2(-(-140 - s.pos[0]), -(-663 - s.pos[2]));
        inp.yaw = Math.max(-1, Math.min(1, -wrap(want - s.yaw) * 2));
        inp.thrust = s.forwardSpeed() > 0.5 ? -0.5 : 0;
        inp.vert = Math.max(-1, Math.min(1, (hold[1] - s.pos[1]) * 0.5 - s.vel[1] * 0.5));
      }
      // keep the Warden off: follow the autopilot waypoint index through the chamber afterwards
      this.ap.i = Math.max(this.ap.i, this.ap.wps.findIndex((w) => w[1] > -45 && Math.hypot(w[0] + 140, w[2] + 663) < 10) - 1);
    } else inp = this.ap.input(s);

    // unstick: if barely moving for a while, back up and yaw
    if (this.lastPos) {
      const moved = Math.hypot(s.pos[0] - this.lastPos[0], s.pos[1] - this.lastPos[1], s.pos[2] - this.lastPos[2]);
      this.stuckT = moved < 0.01 && !(seals.length && nearGate) ? this.stuckT + SIM_DT : 0;
    }
    this.lastPos = [...s.pos];
    if (this.stuckT > 1.5) this.unstick = 0.8;
    if (this.unstick > 0) { this.unstick -= SIM_DT; inp.thrust = -1; inp.yaw = 0.6; }

    // target the nearest live threat in line of sight
    const m = sim.muzzle();
    let best = null, bd = 60;
    for (const e of sim.entities) {
      if (!e.alive || !THREATS.includes(e.type)) continue;
      const d = Math.hypot(e.pos[0] - m[0], e.pos[1] - m[1], e.pos[2] - m[2]);
      if (d < bd && sim._los(m, e.pos)) { bd = d; best = e; }
    }
    inp.fire = false; inp.aimDir = null;
    if (best) {
      const dir = best.pos.map((v, i) => v - m[i]), L = Math.hypot(...dir);
      inp.aimDir = dir.map((x) => x / L);
      const c = sim.clampAim(inp.aimDir);
      inp.fire = !c.limited && s.energy > 12;
      if (best.type === "mine" && bd < 11) inp.thrust = Math.min(inp.thrust, -1);   // back off armed mines
      if ((best.type === "lurker" || best.type === "warden") && best.state === "tell") { inp.vert = 1; }  // dodge up
    }
    this.sonarT -= SIM_DT;
    inp.sonar = false;
    if (this.sonarT <= 0) { inp.sonar = true; this.sonarT = 4; }
    return inp;
  }
}
