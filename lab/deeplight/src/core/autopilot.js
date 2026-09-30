/* autopilot.js — a test pilot that flies through waypoints using ONLY the
 * player's inputs (thrust / yaw / vertical). Used by regression tests and
 * the in-browser `?bot=1` playtest mode. It never moves the sub directly. */

import { axes } from "./sub.js";

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Autopilot {
  constructor(waypoints, { reach = 4.5, cruise = 1 } = {}) {
    this.wps = waypoints; this.i = 0; this.reach = reach; this.cruise = cruise; this.done = false;
  }
  target() { return this.wps[Math.min(this.i, this.wps.length - 1)]; }
  input(sub) {
    const inp = { thrust: 0, yaw: 0, vert: 0, boost: false };
    if (this.done) return inp;
    let t = this.target();
    const d = Math.hypot(t[0] - sub.pos[0], t[1] - sub.pos[1], t[2] - sub.pos[2]);
    // advance when close, or when the waypoint is already behind us and the next one is ahead
    if (d < this.reach) {
      this.i++;
      if (this.i >= this.wps.length) { this.done = true; return inp; }
      t = this.target();
    }
    const want = Math.atan2(-(t[0] - sub.pos[0]), -(t[2] - sub.pos[2]));
    const err = wrap(want - sub.yaw);
    const horiz = Math.hypot(t[0] - sub.pos[0], t[2] - sub.pos[2]);
    // yaw: + input turns right (yaw decreases)
    inp.yaw = horiz < 1.5 ? 0 : Math.max(-1, Math.min(1, -err * 2.2 + sub.yawRate * 0.25));
    const fwd = sub.forwardSpeed();
    const aligned = Math.abs(err) < 0.5 || horiz < 1.5;
    const vy = t[1] - sub.pos[1];
    inp.vert = Math.max(-1, Math.min(1, vy * 0.45 - sub.vel[1] * 0.5));
    if (!aligned) inp.thrust = fwd > 3 ? -0.6 : 0.15;   // brake into sharp turns
    else inp.thrust = (fwd > 9 * this.cruise ? 0 : 1) * this.cruise;
    // steep climbs: slow down so vertical thrust keeps up
    if (Math.abs(vy) > horiz * 1.2 && Math.abs(vy) > 3) inp.thrust = Math.min(inp.thrust, fwd > 2 ? 0 : 0.3);
    return inp;
  }
}

/** densify an edge polyline into waypoints */
export function pathWaypoints(points, spacing = 6) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.round(L / spacing));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

export { axes, wrap };
