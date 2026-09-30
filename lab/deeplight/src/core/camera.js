/* camera.js — chase / cockpit camera rig (pure math; the renderer copies it).
 *
 * Chase: the boom starts at the hull centre (always open water) and is
 * sphere-traced against the world SDF every frame. It shortens immediately
 * when rock intrudes and recovers slowly. Because the whole boom segment is
 * swept, the camera never sits in rock and the line between camera and sub
 * never cuts through a bend. The horizon stays level (only a small share of
 * the hull roll is passed on). Steering is never delayed: the sub model turns
 * instantly; only the camera's yaw eases behind it. */

import { CAMERA } from "./tuning.js";
import { axes } from "./sub.js";

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  constructor() { this.mode = "chase"; this.reset(); }
  reset() { this.tilt = undefined; this.ready = false; this.boom = CAMERA.boom; this.yaw = 0; this.pos = [0, 0, 0]; this.look = [0, 0, -1]; this.roll = 0; this.clearHit = CAMERA.boom; this.shake = 0; }

  /**
   * @param {object} s  interpolated sub render state {pos, yaw, pitch, roll, vel}
   * @param {World} world
   * @param {number} dt  render-frame dt
   * @param {object} opt {reducedMotion, boomScale}
   */
  update(s, world, dt, opt = {}) {
    if (!this.ready) { this.yaw = s.yaw; this.boom = CAMERA.boom; }
    if (this.mode === "cockpit") return this._cockpit(s, opt);

    // yaw follows the hull (framing only — the hull itself turns instantly)
    const k = this.ready ? Math.min(1, CAMERA.yawFollow * dt) : 1;
    this.yaw += wrap(s.yaw - this.yaw) * k;
    const { fwd } = axes(this.yaw);
    const L = CAMERA.boom * (opt.boomScale || 1);
    const dirFor = (tilt) => { const ct = Math.cos(tilt), st = Math.sin(tilt); return [-fwd[0] * ct, st, -fwd[2] * ct]; };
    // if rock blocks the normal boom, swing up to a steeper boom that has room
    // (e.g. backed against a chamber wall) instead of jamming the lens into the hull
    const sweep = (tilt) => { const d = dirFor(tilt); return world.march(s.pos[0], s.pos[1], s.pos[2], d[0], d[1], d[2], L, CAMERA.clearance); };
    let want = CAMERA.tilt;
    if (sweep(CAMERA.tilt) < L * 0.6) {
      let best = sweep(CAMERA.tilt), bt = CAMERA.tilt;
      for (const t of CAMERA.altTilts) { const h = sweep(t); if (h > best + 0.5) { best = h; bt = t; } }
      want = bt;
    }
    this.tilt = this.ready ? (this.tilt ?? want) + (want - (this.tilt ?? want)) * Math.min(1, 3 * dt) : want;
    const dir = dirFor(this.tilt);
    // sweep a camera-sized sphere along the actual boom from the hull centre
    const hit = world.march(s.pos[0], s.pos[1], s.pos[2], dir[0], dir[1], dir[2], L, CAMERA.clearance);
    this.clearHit = hit;
    const target = Math.max(0.6, Math.min(L, hit - 0.05));
    if (!this.ready || target < this.boom) this.boom += (target - this.boom) * (this.ready ? Math.min(1, CAMERA.shortenRate * dt) : 1);
    else this.boom += (target - this.boom) * Math.min(1, CAMERA.recoverRate * dt);
    if (this.boom > hit) this.boom = Math.max(0.6, hit - 0.02);   // never behind rock, even for one frame
    this.pos = [s.pos[0] + dir[0] * this.boom, s.pos[1] + dir[1] * this.boom, s.pos[2] + dir[2] * this.boom];

    // look ahead of the hull, leading slightly with velocity (clamped so it never swings wildly)
    const lead = CAMERA.velLead;
    const la = [s.pos[0] + fwd[0] * CAMERA.lookAhead + s.vel[0] * lead, s.pos[1] + 0.8 + s.vel[1] * lead * 0.5, s.pos[2] + fwd[2] * CAMERA.lookAhead + s.vel[2] * lead];
    if (!this.ready) this.look = la;
    else { const kk = Math.min(1, 10 * dt); for (let i = 0; i < 3; i++) this.look[i] += (la[i] - this.look[i]) * kk; }
    this.roll = opt.reducedMotion ? 0 : s.roll * CAMERA.rollShare;
    this.ready = true;
    return this;
  }

  _cockpit(s) {
    const { axis } = axes(s.yaw, s.pitch);
    // just behind the nose sphere, inside the hull envelope (always in water)
    this.pos = [s.pos[0] + axis[0] * 1.9, s.pos[1] + axis[1] * 1.9 + 0.25, s.pos[2] + axis[2] * 1.9];
    this.look = [this.pos[0] + axis[0] * 10, this.pos[1] + axis[1] * 10, this.pos[2] + axis[2] * 10];
    this.roll = s.roll * 0.5;
    this.yaw = s.yaw; this.boom = 0; this.ready = true;
    return this;
  }
}
