/* sub.js — assisted arcade flight model + full-hull collision.
 *
 * Heading, thrust, velocity, the drawn model and the collider all derive from
 * the same state (pos, vel, yaw, pitch). Thrust pushes along the heading;
 * strong lateral drag makes velocity follow the heading, so turning actually
 * carves the sub in the direction it faces.
 *
 * Collision: the hull is a capsule (nose + tail included) sampled as a chain
 * of spheres against the world SDF. At SIM_HZ=120 and max speed ~18 m/s a
 * step moves < 0.16 m, far less than the hull radius, and the SDF is defined
 * everywhere — so the hull cannot tunnel through rock during boosts or stalls
 * (frame stalls are absorbed by dropping time, never by taking a large step). */

import { SUB, ENERGY } from "./tuning.js";

export function axes(yaw, pitch = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return {
    fwd: [fx, 0, fz],                         // horizontal heading
    axis: [fx * cp, sp, fz * cp],             // pitched hull axis (collider + model)
    right: [Math.cos(yaw), 0, -Math.sin(yaw)],
  };
}

export class Sub {
  constructor(pose) { this.reset(pose); }

  reset({ pos, yaw = 0 }) {
    this.pos = [...pos];
    this.vel = [0, 0, 0];
    this.yaw = yaw; this.yawRate = 0;
    this.pitch = 0; this.roll = 0;
    this.energy = ENERGY.max; this.energyDelay = 0;
    this.boosting = false;
    this.contacts = [];                  // [{p:[x,y,z], n:[x,y,z], pen, impact}] last step
    this.contactTime = 0;                // seconds of continuous contact
    this.scrape = 0;                     // tangential speed while touching (audio)
    this.lastImpact = 0;                 // largest normal speed into rock this step
    this.damageCd = 0;
    this.pendingDamage = 0;              // collected by the game each step
    this.knock = [0, 0, 0];
  }

  speed() { return Math.hypot(this.vel[0], this.vel[1], this.vel[2]); }
  forwardSpeed() { const a = axes(this.yaw); return this.vel[0] * a.fwd[0] + this.vel[2] * a.fwd[2]; }

  /** capsule sample points in world space */
  hullPoints(pos = this.pos, yaw = this.yaw, pitch = this.pitch, out = []) {
    const { axis } = axes(yaw, pitch);
    const n = SUB.samples;
    for (let i = 0; i < n; i++) {
      const t = -1 + (2 * i) / (n - 1);
      const p = out[i] || (out[i] = [0, 0, 0]);
      p[0] = pos[0] + axis[0] * SUB.halfLen * t;
      p[1] = pos[1] + axis[1] * SUB.halfLen * t;
      p[2] = pos[2] + axis[2] * SUB.halfLen * t;
    }
    out.length = n;
    return out;
  }

  /** smallest clearance of the hull surface (negative = penetrating) */
  hullClearance(world, pos = this.pos, yaw = this.yaw, pitch = this.pitch) {
    let m = Infinity;
    for (const p of this.hullPoints(pos, yaw, pitch, this._tmpPts || (this._tmpPts = []))) {
      m = Math.min(m, world.clearance(p[0], p[1], p[2]) - SUB.radius);
    }
    return m;
  }

  /**
   * @param {number} dt fixed step
   * @param {{thrust:number, yaw:number, vert:number, boost:boolean}} input  each -1..1
   * @param {import('./world.js').World} world
   */
  step(dt, input, world) {
    const T = SUB;
    // ---- energy / boost
    const wantBoost = input.boost && input.thrust > 0.1;
    if (wantBoost && (this.boosting || this.energy > ENERGY.boostMin) && this.energy > 0) {
      this.boosting = true;
      this.energy = Math.max(0, this.energy - ENERGY.boostDrain * dt);
      this.energyDelay = ENERGY.regenDelay;
    } else this.boosting = false;
    if (this.energyDelay > 0) this.energyDelay -= dt;
    else this.energy = Math.min(ENERGY.max, this.energy + ENERGY.regen * dt);

    // ---- yaw (rate-limited, eased)
    const sp = this.speed();
    const yawMax = T.yawRateMax + (T.yawRateMaxFast - T.yawRateMax) * Math.min(1, sp / 16);
    const yawTarget = -input.yaw * yawMax;             // D (+1) turns right = negative yaw
    this.yawRate += (yawTarget - this.yawRate) * Math.min(1, T.yawResponse * dt);
    const prevYaw = this.yaw;
    this.yaw += this.yawRate * dt;

    // ---- forces in the hull frame
    const { fwd, right } = axes(this.yaw);
    const cur = world.current(this.pos[0], this.pos[1], this.pos[2], this._cur || (this._cur = [0, 0, 0]));
    // velocity relative to the water: drag acts on this, so currents carry the sub
    const rx = this.vel[0] - cur[0], ry = this.vel[1] - cur[1], rz = this.vel[2] - cur[2];
    const vLong = rx * fwd[0] + rz * fwd[2];
    const vLat = rx * right[0] + rz * right[2];
    const vVert = ry;

    let aLong = 0;
    if (input.thrust > 0) {
      aLong = (vLong < -0.5 ? T.brakeAccel : this.boosting ? T.boostAccel : T.thrustAccel) * input.thrust;
    } else if (input.thrust < 0) {
      aLong = (vLong > 0.5 ? T.brakeAccel : T.reverseAccel) * input.thrust;
    }
    const idle = input.thrust === 0 ? T.idleDrag : 0;
    aLong -= vLong * (T.dragLong + idle + T.dragLongQuad * Math.abs(vLong));
    const aLat = -vLat * T.dragLat;
    const aVert = input.vert * T.vertAccel - vVert * (T.dragVert + (input.vert === 0 ? idle : 0));

    this.vel[0] += (fwd[0] * aLong + right[0] * aLat) * dt;
    this.vel[1] += aVert * dt;
    this.vel[2] += (fwd[2] * aLong + right[2] * aLat) * dt;
    // external impulses (explosions, bites) decay through normal drag afterwards
    this.vel[0] += this.knock[0]; this.vel[1] += this.knock[1]; this.vel[2] += this.knock[2];
    this.knock[0] = this.knock[1] = this.knock[2] = 0;
    // hard cap — keeps per-step motion far below the hull radius
    const vmax = 20, v2 = this.vel[0] ** 2 + this.vel[1] ** 2 + this.vel[2] ** 2;
    if (v2 > vmax * vmax) { const k = vmax / Math.sqrt(v2); this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k; }

    // ---- attitude (visual AND collider): pitch follows vertical motion, roll follows turns
    const pitchT = Math.max(-T.pitchMax, Math.min(T.pitchMax, this.vel[1] * T.pitchFromVy + input.vert * T.pitchFromInput));
    const prevPitch = this.pitch;
    this.pitch += (pitchT - this.pitch) * Math.min(1, T.pitchResponse * dt);
    const rollT = Math.max(-T.rollMax, Math.min(T.rollMax, this.yawRate * Math.max(2, sp) * T.rollFromTurn));
    this.roll += (rollT - this.roll) * Math.min(1, T.rollResponse * dt);

    // ---- integrate + resolve
    const prev = [...this.pos];
    this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.pos[2] += this.vel[2] * dt;
    this._resolve(world, dt, prev, prevYaw, prevPitch);
  }

  _resolve(world, dt, prev, prevYaw, prevPitch) {
    const T = SUB, R = T.radius + T.skin;
    const pts = this._pts || (this._pts = []);
    const n = this._n || (this._n = [0, 0, 0]);
    this.contacts.length = 0;
    this.lastImpact = 0;
    const contactNormals = [];

    for (let iter = 0; iter < 6; iter++) {
      this.hullPoints(this.pos, this.yaw, this.pitch, pts);
      let worst = 0, wi = -1;
      for (let i = 0; i < pts.length; i++) {
        const pen = R - world.clearance(pts[i][0], pts[i][1], pts[i][2]);
        if (pen > worst) { worst = pen; wi = i; }
      }
      if (wi < 0) break;
      const p = pts[wi];
      world.gradient(p[0], p[1], p[2], n);           // points into rock
      // push the whole hull back into open water along the surface normal
      this.pos[0] -= n[0] * worst; this.pos[1] -= n[1] * worst; this.pos[2] -= n[2] * worst;
      contactNormals.push([-n[0], -n[1], -n[2]]);
      if (iter === 0 || this.contacts.length < 4) this.contacts.push({ p: [...p], n: [-n[0], -n[1], -n[2]], pen: worst });
    }

    // still stuck (e.g. yawing a long hull inside a tight gap): undo the rotation, then the move
    if (this.hullClearance(world) < -0.05) {
      this.yaw = prevYaw; this.pitch = prevPitch; this.yawRate *= -0.2;
      if (this.hullClearance(world) < -0.05) { this.pos[0] = prev[0]; this.pos[1] = prev[1]; this.pos[2] = prev[2]; }
    }

    // velocity response: kill the into-surface component, gentle slide along it
    if (contactNormals.length) {
      this.contactTime += dt;
      for (const cn of contactNormals) {
        const vn = this.vel[0] * cn[0] + this.vel[1] * cn[1] + this.vel[2] * cn[2];
        if (vn < 0) {
          const impact = -vn;
          this.lastImpact = Math.max(this.lastImpact, impact);
          const e = impact > T.hardImpact ? T.restitution : 0;
          this.vel[0] -= cn[0] * vn * (1 + e); this.vel[1] -= cn[1] * vn * (1 + e); this.vel[2] -= cn[2] * vn * (1 + e);
        }
      }
      const f = Math.max(0, 1 - T.scrapeFriction * dt);
      this.vel[0] *= f; this.vel[1] *= f; this.vel[2] *= f;
      this.scrape = this.speed();
    } else { this.contactTime = 0; this.scrape = 0; }

    // damage from relative velocity into the surface (never from resting contact)
    if (this.damageCd > 0) this.damageCd -= dt;
    if (this.lastImpact > T.damageImpact && this.damageCd <= 0) {
      this.pendingDamage += Math.min(T.damageMax, (this.lastImpact - T.damageImpact) * T.damagePerMs);
      this.damageCd = T.damageCooldown;
    }
  }

  spendEnergy(amount) {
    if (this.energy < amount) return false;
    this.energy -= amount; this.energyDelay = ENERGY.regenDelay;
    return true;
  }
}
