/* game.js — the expedition rules, independent of rendering.
 *
 * Owns the sub, the entities (pickups, threats, the seal, rockfalls), the
 * zones (objectives, tutorial prompts, checkpoints, extraction), the weapon,
 * sonar and scoring. The renderer, HUD and audio only read state and drain the
 * `events` queue. Everything advances in fixed SIM_DT steps. */

import { Sub, axes } from "./sub.js";
import { SUB, ENERGY, WEAPON, SONAR, HULL, SCORE } from "./tuning.js";

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// per-type constants
const T = {
  salvage:  { pick: 3.4 },
  relic:    { pick: 3.6 },
  repair:   { pick: 3.4 },
  recorder: { pick: 4.0 },
  mine:     { r: 1.7, hp: 2, sense: 12, arm: 1.5, lose: 17, blast: 9, dmg: 34 },
  lurker:   { r: 1.5, hp: 6, sense: 30, tell: 0.9, lunge: 24, lungeT: 0.75, bite: 20, recover: 1.6, speed: 5, leash: 55, segs: 9, seg: 1.5 },
  warden:   { r: 2.6, hp: 24, sense: 60, tell: 1.25, lunge: 25, lungeT: 0.9, bite: 26, recover: 2.2, speed: 6.5, leash: 60, segs: 14, seg: 2.6 },
  shade:    { r: 1.1, hp: 1, sense: 40, speed: 5.8, cone: 0.42, lightRange: 48, dmg: 11 },
  seal:     { r: 1.3, hp: 4 },
  boulder:  { r: 2.0, hp: 2, fall: 11, dmg: 22, tell: 1.3 },
};

export class GameSim {
  constructor(level, world) {
    this.level = level; this.world = world;
    this.events = [];
    this.sub = new Sub(level.start);
    this.reset();
  }

  reset() {
    const L = this.level;
    this.sub.reset(L.start);
    this.world.dynamic.length = 0;
    this.state = "playing";
    this.time = 0; this.hull = HULL.max;
    this.chain = 0; this.mult = 1; this.score = 0;
    this.tally = { salvage: 0, relics: 0, discovery: 0, kills: 0, killCount: 0, salvageCount: 0, relicCount: 0 };
    this.continues = 0;
    this.checkpoint = { pos: [...L.start.pos], yaw: L.start.yaw || 0, id: "start" };
    this.fireCd = 0; this.sonarCd = 0; this.sonarT = -99; this.lastSonar = null;
    this.aimDir = axes(this.sub.yaw).fwd.slice(); this.aimLimited = false;
    this.flags = new Set();          // zone ids entered, one-shot triggers
    this.objective = L.objectives?.[0] || null;
    this.prompt = null;
    this.damageFlash = 0;
    this.revealed = new Map();       // entity id -> time revealed by sonar
    this.entities = (L.entities || []).map((d, i) => this._makeEntity(d, i));
    // seal membrane: a dynamic solid until its nodes are destroyed
    if (L.seal) {
      this.sealCollider = { kind: "disc", x: L.seal.pos[0], y: L.seal.pos[1], z: L.seal.pos[2], r: L.seal.r, h: 0.5, active: true };
      this.world.dynamic.push(this.sealCollider);
    }
    this.events.push({ type: "reset" });
    this._zones(true);
  }

  _makeEntity(d, i) {
    const e = { ...d, id: d.id || `${d.type}${i}`, pos: [...d.pos], home: [...d.pos], alive: true, t: 0, state: "idle", timer: 0, vel: [0, 0, 0], phase: i * 1.7 };
    const c = T[d.type];
    if (c?.hp) e.hp = d.hp || c.hp;
    if (c?.r) e.r = c.r;
    if (d.type === "lurker" || d.type === "warden") {
      e.state = d.type === "warden" ? "dormant" : "patrol";
      e.dir = [0, 0, -1]; e.pi = 0; e.cd = 0;
      e.segs = Array.from({ length: c.segs }, (_, k) => [e.pos[0], e.pos[1], e.pos[2] + k * c.seg]);
    }
    if (d.type === "shade") e.state = "drift";
    if (d.type === "boulder") { e.alive = false; e.state = "waiting"; }
    return e;
  }

  // ---------------------------------------------------------------- step ----
  /**
   * @param {number} dt
   * @param {{thrust,yaw,vert,boost,fire,sonar,aimDir}} input  aimDir: desired world direction from the muzzle
   */
  step(dt, input) {
    if (this.state !== "playing") return;
    this.time += dt;
    const sub = this.sub;
    sub.step(dt, input, this.world);
    if (sub.pendingDamage > 0) {
      const dmg = sub.pendingDamage; sub.pendingDamage = 0;
      this.damage(dmg, "impact", { impact: sub.lastImpact });
    } else if (sub.lastImpact > 1.2) this.events.push({ type: "bump", impact: sub.lastImpact });

    // ---- gimbal: slew the headlights toward the desired aim, within limits
    this._gimbal(dt, input.aimDir);
    // ---- weapon
    this.fireCd -= dt;
    if (input.fire && this.fireCd <= 0) {
      if (sub.spendEnergy(ENERGY.pulseCost)) { this.fireCd = WEAPON.fireInterval; this._fire(); }
      else if (this.fireCd <= -0.3) { this.fireCd = 0.25; this.events.push({ type: "dry" }); }
    }
    // ---- sonar
    this.sonarCd -= dt;
    if (input.sonar) this.pingSonar();
    // ---- world
    this._entities(dt);
    this._zones(false);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
  }

  muzzle() {
    const { axis } = axes(this.sub.yaw, this.sub.pitch);
    const k = SUB.halfLen + SUB.radius + 0.25;
    return [this.sub.pos[0] + axis[0] * k, this.sub.pos[1] + axis[1] * k, this.sub.pos[2] + axis[2] * k];
  }

  /** clamp a world direction to the headlight gimbal around the hull axis */
  clampAim(dir) {
    const { axis, right } = axes(this.sub.yaw, this.sub.pitch);
    const up = [right[1] * axis[2] - right[2] * axis[1], right[2] * axis[0] - right[0] * axis[2], right[0] * axis[1] - right[1] * axis[0]];
    const x = dot(dir, right), y = dot(dir, up), z = dot(dir, axis);
    let yaw = Math.atan2(x, z), pitch = Math.atan2(y, Math.hypot(x, z));
    const limited = Math.abs(yaw) > WEAPON.gimbalYaw || Math.abs(pitch) > WEAPON.gimbalPitch;
    yaw = Math.max(-WEAPON.gimbalYaw, Math.min(WEAPON.gimbalYaw, yaw));
    pitch = Math.max(-WEAPON.gimbalPitch, Math.min(WEAPON.gimbalPitch, pitch));
    const cp = Math.cos(pitch);
    const out = [0, 1, 2].map((k) => axis[k] * cp * Math.cos(yaw) + right[k] * cp * Math.sin(yaw) + up[k] * Math.sin(pitch));
    return { dir: norm(out), limited };
  }

  _gimbal(dt, desired) {
    const want = desired ? this.clampAim(desired) : { dir: axes(this.sub.yaw, this.sub.pitch).axis, limited: false };
    this.aimLimited = want.limited;
    const k = Math.min(1, WEAPON.aimSlew * dt);
    // re-clamp after slewing so a fast hull turn can't leave the lights outside the gimbal
    const mixed = norm(this.aimDir.map((v, i) => v + (want.dir[i] - v) * k));
    this.aimDir = this.clampAim(mixed).dir;
  }

  /** first thing hit along a ray: rock or an entity. Walls block everything. */
  raycast(o, d, range) {
    const wallT = this.world.march(o[0], o[1], o[2], d[0], d[1], d[2], range);
    let best = null, bestT = wallT;
    for (const e of this.entities) {
      if (!e.alive || !e.hp) continue;
      const hitPts = e.type === "lurker" || e.type === "warden" ? e.segs.slice(0, 5).map((s, k) => [s, k === 0 ? e.r * 1.25 : e.r * 0.9]) : [[e.pos, e.r * 1.2]];
      for (const [c, r] of hitPts) {
        const oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
        const b = dot(oc, d), cc = dot(oc, oc) - r * r, h = b * b - cc;
        if (h < 0) continue;
        const t = -b - Math.sqrt(h);
        if (t > 0 && t < bestT) { bestT = t; best = e; }
      }
    }
    return { t: bestT, entity: best, wall: !best && wallT < range };
  }

  _fire() {
    const o = this.muzzle(), d = this.aimDir;
    const r = this.raycast(o, d, WEAPON.range);
    const to = [o[0] + d[0] * r.t, o[1] + d[1] * r.t, o[2] + d[2] * r.t];
    this.events.push({ type: "shot", from: o, to, hit: r.entity ? r.entity.type : r.wall ? "wall" : null });
    if (r.entity) this.hurtEntity(r.entity, WEAPON.pulseDamage, to);
  }

  hurtEntity(e, amount, at) {
    if (!e.alive) return;
    const vulnerable = (e.type === "lurker" || e.type === "warden") && e.state === "recover";
    e.hp -= amount * (vulnerable ? 2 : 1);
    this.events.push({ type: "enemyHit", entity: e, at, weak: vulnerable });
    if (e.type === "shade" && e.hp > 0) return;
    if (e.hp <= 0) this._kill(e, true);
    else if ((e.type === "lurker" || e.type === "warden") && (e.state === "patrol" || e.state === "dormant")) {
      e.state = "tell"; e.timer = T[e.type].tell; this.events.push({ type: "tell", entity: e });
    } else if (e.type === "mine" && e.state === "idle") { e.state = "arming"; e.timer = 0.6; this.events.push({ type: "arm", entity: e }); }
  }

  _kill(e, byPlayer) {
    if (!e.alive) return;
    e.alive = false; e.state = "dead";
    if (e.type === "mine") this._explode(e);
    this.events.push({ type: "kill", entity: e });
    if (byPlayer) {
      const kind = e.type === "boulder" ? "boulder" : e.type;
      this._award("kills", SCORE.kill[kind] || 50);
      this.tally.killCount++;
    }
    if (e.type === "seal" && this.entities.every((x) => x.type !== "seal" || !x.alive)) {
      if (this.sealCollider) this.sealCollider.active = false;
      this.flags.add("sealBroken");
      this.events.push({ type: "sealBroken" });
      this._setObjective("ascend");
    }
    if (e.type === "boulder") this._removeDynamic(e);
  }

  _explode(m) {
    const sub = this.sub, d = dist3(m.pos, sub.pos), c = T.mine;
    this.events.push({ type: "explode", pos: [...m.pos], radius: c.blast });
    if (d < c.blast && this._los(m.pos, sub.pos)) {
      const f = 1 - Math.max(0, d - 3) / (c.blast - 3);
      this.damage(c.dmg * f, "mine");
      const n = norm([sub.pos[0] - m.pos[0], sub.pos[1] - m.pos[1], sub.pos[2] - m.pos[2]]);
      sub.knock[0] += n[0] * 9 * f; sub.knock[1] += n[1] * 9 * f; sub.knock[2] += n[2] * 9 * f;
    }
    for (const o of this.entities) {   // sympathetic detonation
      if (o !== m && o.alive && o.type === "mine" && dist3(o.pos, m.pos) < 8) {
        if (o.state !== "arming" || o.timer > 0.3) { o.state = "arming"; o.timer = 0.3; o.chain = true; }
      }
    }
  }

  _award(cat, base) {
    this.chain++;
    this.mult = Math.min(SCORE.maxMult, 1 + Math.floor(this.chain / SCORE.chainStep));
    const pts = Math.round(base * this.mult);
    this.tally[cat] += pts; this.score += pts;
    this.events.push({ type: "score", pts, mult: this.mult, cat });
    return pts;
  }

  damage(amount, source, extra = {}) {
    if (this.state !== "playing" || amount <= 0) return;
    this.hull = Math.max(0, this.hull - amount);
    this.damageFlash = 0.5;
    const hadChain = this.mult > 1 || this.chain > 0;
    this.chain = 0; this.mult = 1;
    this.events.push({ type: "damage", amount, source, chainLost: hadChain, ...extra });
    if (this.hull <= 0) { this.state = "failed"; this.events.push({ type: "failed", source }); }
  }

  pingSonar() {
    if (this.sonarCd > 0) { this.events.push({ type: "sonarBusy" }); return false; }
    this.sonarCd = SONAR.cooldown; this.sonarT = this.time;
    this.lastSonar = [...this.sub.pos];
    const found = [];
    for (const e of this.entities) {
      if (!e.alive || e.type === "boulder" || e.hidden) continue;
      const d = dist3(e.pos, this.sub.pos);
      if (d < SONAR.range) { this.revealed.set(e.id, this.time + d / SONAR.speed); found.push(e); }
    }
    this.events.push({ type: "sonar", pos: [...this.sub.pos], found: found.length, threats: found.filter((e) => ["mine", "lurker", "shade", "warden"].includes(e.type)).length });
    return true;
  }

  _los(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
    if (L < 0.01) return true;
    return this.world.march(a[0], a[1], a[2], d[0] / L, d[1] / L, d[2] / L, L) >= L - 1.5;
  }

  _keepInWater(p, r) {
    const c = this.world.clearance(p[0], p[1], p[2]);
    if (c >= r) return false;
    const g = this.world.gradient(p[0], p[1], p[2]);
    p[0] -= g[0] * (r - c); p[1] -= g[1] * (r - c); p[2] -= g[2] * (r - c);
    return true;
  }

  _lit(p) {
    const o = this.muzzle();
    const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], L = Math.hypot(...v);
    if (L > T.shade.lightRange) return false;
    if (dot(v, this.aimDir) / L < Math.cos(T.shade.cone)) return false;
    return this._los(o, p);
  }

  // ------------------------------------------------------------ entities ----
  _entities(dt) {
    const sub = this.sub, sp = sub.pos;
    for (const e of this.entities) {
      if (!e.alive && e.state !== "waiting" && e.state !== "telling") continue;
      const d = dist3(e.pos, sp);
      if (d > 150 && e.type !== "boulder") { e.dormantFar = true; continue; }   // outside the active bubble
      e.dormantFar = false;
      e.t += dt;
      switch (e.type) {
        case "salvage": case "relic": case "repair": case "recorder": this._pickup(e, d); break;
        case "mine": this._mine(e, d, dt); break;
        case "lurker": case "warden": this._eel(e, d, dt); break;
        case "shade": this._shade(e, d, dt); break;
        case "boulder": this._boulder(e, dt); break;
        default: break;
      }
    }
  }

  _pickup(e, d) {
    if (d > T[e.type].pick + SUB.halfLen * 0.6) return;
    // pickup uses the full hull: nearest point on the capsule axis
    const { axis } = axes(this.sub.yaw, this.sub.pitch);
    const rel = [e.pos[0] - this.sub.pos[0], e.pos[1] - this.sub.pos[1], e.pos[2] - this.sub.pos[2]];
    const t = Math.max(-SUB.halfLen, Math.min(SUB.halfLen, dot(rel, axis)));
    const dd = Math.hypot(rel[0] - axis[0] * t, rel[1] - axis[1] * t, rel[2] - axis[2] * t);
    if (dd > T[e.type].pick) return;
    e.alive = false; e.state = "taken";
    let pts = 0;
    if (e.type === "salvage") { pts = this._award("salvage", SCORE.salvage); this.tally.salvageCount++; }
    if (e.type === "relic") { pts = this._award("relics", SCORE.relic); this.tally.relicCount++; }
    if (e.type === "recorder") { pts = this._award("discovery", SCORE.recorder); this.flags.add("recorder"); this._setObjective(this.level.afterRecorder || null); }
    if (e.type === "repair") this.hull = Math.min(HULL.max, this.hull + HULL.repairKit);
    this.events.push({ type: "pickup", entity: e, pts });
  }

  _mine(e, d, dt) {
    const c = T.mine;
    if (e.state === "idle") {
      e.cd = (e.cd || 0) - dt;
      if (d < c.sense && e.cd <= 0 && ((e.losT = (e.losT || 0) - dt) <= 0)) {
        e.losT = 0.1;
        if (this._los(e.pos, this.sub.pos)) { e.state = "arming"; e.timer = c.arm; this.events.push({ type: "arm", entity: e }); }
      }
    } else if (e.state === "arming") {
      e.timer -= dt;
      if (d > c.lose && !e.chain) { e.state = "idle"; e.cd = 1.0; this.events.push({ type: "disarm", entity: e }); }
      else if (e.timer <= 0) this._kill(e, !!e.chain);
    }
    // touching a mine sets it off at once
    if (e.alive && d < c.r + SUB.radius + SUB.halfLen * 0.5 && this._hullNear(e.pos, c.r + 0.1)) this._kill(e, false);
  }

  _hullNear(p, r) {
    const pts = this.sub.hullPoints();
    return pts.some((q) => dist3(q, p) < r + SUB.radius);
  }

  _eel(e, d, dt) {
    const c = T[e.type], sp = this.sub.pos;
    const leashOk = dist3(sp, e.home) < c.leash;
    const moveTo = (target, speed) => {
      const v = [target[0] - e.pos[0], target[1] - e.pos[1], target[2] - e.pos[2]], L = Math.hypot(...v);
      if (L < 0.01) return L;
      const k = Math.min(L, speed * dt) / L;
      e.pos[0] += v[0] * k; e.pos[1] += v[1] * k; e.pos[2] += v[2] * k;
      const nd = norm(v); const s = Math.min(1, 6 * dt);
      e.dir = norm(e.dir.map((x, i) => x + (nd[i] - x) * s));
      return L;
    };
    e.cd -= dt;
    switch (e.state) {
      case "dormant":
        if (this.flags.has(e.wakeFlag || "wardenWake")) { e.state = "patrol"; this.events.push({ type: "roar", entity: e }); }
        break;
      case "patrol": {
        const tgt = e.patrol ? e.patrol[e.pi % e.patrol.length] : e.home;
        if (moveTo(tgt, c.speed) < 2) e.pi++;
        if (leashOk && d < c.sense && e.cd <= 0 && (e.losT = (e.losT || 0) - dt) <= 0) {
          e.losT = 0.12;
          if (this._los(e.pos, sp)) { e.state = "tell"; e.timer = c.tell; this.events.push({ type: "tell", entity: e }); }
        }
        break;
      }
      case "tell": {
        e.timer -= dt;
        const nd = norm([sp[0] - e.pos[0], sp[1] - e.pos[1], sp[2] - e.pos[2]]);
        e.dir = norm(e.dir.map((x, i) => x + (nd[i] - x) * Math.min(1, 8 * dt)));
        // coil back slightly: readable wind-up
        e.pos[0] -= e.dir[0] * dt * 1.5; e.pos[1] -= e.dir[1] * dt * 1.5; e.pos[2] -= e.dir[2] * dt * 1.5;
        if (e.timer <= 0) {
          const lead = [sp[0] + this.sub.vel[0] * 0.25, sp[1] + this.sub.vel[1] * 0.25, sp[2] + this.sub.vel[2] * 0.25];
          e.lungeDir = norm([lead[0] - e.pos[0], lead[1] - e.pos[1], lead[2] - e.pos[2]]);
          e.dir = e.lungeDir; e.state = "lunge"; e.timer = c.lungeT; e.bit = false;
          this.events.push({ type: "lunge", entity: e });
        }
        break;
      }
      case "lunge": {
        e.timer -= dt;
        const k = c.lunge * dt;
        e.pos[0] += e.lungeDir[0] * k; e.pos[1] += e.lungeDir[1] * k; e.pos[2] += e.lungeDir[2] * k;
        if (!e.bit && this._hullNear(e.pos, c.r)) {
          e.bit = true;
          this.damage(c.bite, e.type);
          this.sub.knock[0] += e.lungeDir[0] * 7; this.sub.knock[1] += e.lungeDir[1] * 7; this.sub.knock[2] += e.lungeDir[2] * 7;
          this.events.push({ type: "bite", entity: e });
          e.state = "recover"; e.timer = c.recover;
        } else if (this.world.clearance(...e.pos) < c.r) {
          this._keepInWater(e.pos, c.r);
          e.state = "recover"; e.timer = c.recover; this.events.push({ type: "thud", entity: e });
        } else if (e.timer <= 0) { e.state = "recover"; e.timer = c.recover; }
        break;
      }
      case "recover":
        e.timer -= dt;
        if (e.timer <= 0) { e.state = "patrol"; e.cd = 1.4; }
        break;
    }
    this._keepInWater(e.pos, c.r);
    // body follows the head (rope constraint)
    let prev = e.pos;
    for (let k = 0; k < e.segs.length; k++) {
      const s = e.segs[k];
      const v = [s[0] - prev[0], s[1] - prev[1], s[2] - prev[2]], L = Math.hypot(...v) || 1;
      const want = k === 0 ? c.seg * 0.8 : c.seg;
      s[0] = prev[0] + v[0] / L * want; s[1] = prev[1] + v[1] / L * want; s[2] = prev[2] + v[2] / L * want;
      prev = s;
    }
  }

  _shade(e, d, dt) {
    const c = T.shade, sp = this.sub.pos;
    e.losT = (e.losT || 0) - dt;
    if (e.losT <= 0) { e.losT = 0.08; e.litNow = d < c.lightRange && this._lit(e.pos); }
    if (e.litNow) {
      if (e.state !== "frozen") { e.state = "frozen"; this.events.push({ type: "freeze", entity: e }); }
      e.vel = [0, 0, 0];
    } else if (d < c.sense) {
      if (e.state !== "stalk") { e.state = "stalk"; this.events.push({ type: "stalk", entity: e }); }
      const nd = norm([sp[0] - e.pos[0], sp[1] - e.pos[1], sp[2] - e.pos[2]]);
      for (let i = 0; i < 3; i++) e.vel[i] += (nd[i] * c.speed - e.vel[i]) * Math.min(1, 2.5 * dt);
    } else {
      e.state = "drift";
      const w = [e.home[0] + Math.sin(e.t * 0.4 + e.phase) * 3 - e.pos[0], e.home[1] + Math.sin(e.t * 0.7) * 1.5 - e.pos[1], e.home[2] + Math.cos(e.t * 0.4 + e.phase) * 3 - e.pos[2]];
      for (let i = 0; i < 3; i++) e.vel[i] += (w[i] * 0.6 - e.vel[i]) * Math.min(1, dt);
    }
    e.pos[0] += e.vel[0] * dt; e.pos[1] += e.vel[1] * dt; e.pos[2] += e.vel[2] * dt;
    this._keepInWater(e.pos, c.r);
    if (this._hullNear(e.pos, c.r)) {
      this.damage(c.dmg, "shade");
      e.alive = false; e.state = "dead";
      this.events.push({ type: "shadeBurst", entity: e });
    }
  }

  _boulder(e, dt) {
    const c = T.boulder;
    if (e.state === "waiting") return;
    if (e.state === "telling") {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = "falling"; e.alive = true; e.hp = c.hp;
        e.col = { kind: "sphere", x: e.pos[0], y: e.pos[1], z: e.pos[2], r: c.r, active: true };
        this.world.dynamic.push(e.col);
        this.events.push({ type: "boulderFall", entity: e });
      }
      return;
    }
    if (e.state === "falling") {
      e.pos[1] -= c.fall * dt; e.t += dt;
      e.col.x = e.pos[0]; e.col.y = e.pos[1]; e.col.z = e.pos[2];
      if (!e.hitSub && this._hullNear(e.pos, c.r + 0.15)) {
        e.hitSub = true; this.damage(c.dmg, "rockfall");
        this.sub.knock[1] -= 5;
        this.events.push({ type: "crush", entity: e });
      }
      // stop on the floor or after it has fallen far enough
      if (this.world.sdStatic(e.pos[0], e.pos[1] - c.r - 0.3, e.pos[2]) > 0 || e.t > 7) {
        this.events.push({ type: "boulderLand", entity: e });
        e.alive = false; e.state = "dead"; this._removeDynamic(e);
      }
    }
  }
  _removeDynamic(e) { if (e.col) { e.col.active = false; const i = this.world.dynamic.indexOf(e.col); if (i >= 0) this.world.dynamic.splice(i, 1); e.col = null; } }

  // --------------------------------------------------------------- zones ----
  _zones(initial) {
    const sp = this.sub.pos;
    for (const z of this.level.zones || []) {
      const inside = z.box
        ? Math.abs(sp[0] - z.pos[0]) < z.box[0] && Math.abs(sp[1] - z.pos[1]) < z.box[1] && Math.abs(sp[2] - z.pos[2]) < z.box[2]
        : dist3(sp, z.pos) < z.r;
      if (!inside) continue;
      if (z.requires && !this.flags.has(z.requires)) continue;
      const key = "zone:" + z.id;
      if (this.flags.has(key)) continue;
      this.flags.add(key);
      if (z.flag) this.flags.add(z.flag);
      if (z.objective) this._setObjective(z.objective);
      if (z.prompt) { this.prompt = { id: z.prompt, t: this.time }; this.events.push({ type: "prompt", id: z.prompt }); }
      if (z.checkpoint) {
        this.checkpoint = { id: z.id, pos: [...z.checkpoint.pos], yaw: z.checkpoint.yaw };
        if (!initial) this.events.push({ type: "checkpoint", id: z.id });
      }
      if (z.rockfall) for (const e of this.entities) if (e.type === "boulder" && e.group === z.rockfall && e.state === "waiting") {
        e.state = "telling"; e.timer = T.boulder.tell + (e.delay || 0); e.pos = [...e.home];
        this.events.push({ type: "rumble", entity: e, delay: e.delay || 0 });
      }
      if (z.extract) { this._extract(); return; }
      if (z.event) this.events.push({ type: z.event, zone: z });
    }
  }

  _setObjective(id) {
    if (!id) return;
    const o = (this.level.objectives || []).find((x) => x.id === id);
    if (!o || this.objective?.id === id) return;
    this.objective = o;
    this.events.push({ type: "objective", objective: o });
  }

  _extract() {
    this.state = "extracted";
    this.summary = this.buildSummary(true);
    this.events.push({ type: "extracted", summary: this.summary });
  }

  buildSummary(extracted) {
    const lines = [];
    const add = (label, pts, detail = "") => { lines.push({ label, pts: Math.round(pts), detail }); };
    add("Salvage", this.tally.salvage, `${this.tally.salvageCount} crates`);
    add("Relics", this.tally.relics, `${this.tally.relicCount} found`);
    add("Discovery", this.tally.discovery, this.flags.has("recorder") ? "Halcyon flight recorder" : "not recovered");
    add("Threats neutralised", this.tally.kills, `${this.tally.killCount} kills`);
    if (extracted) {
      add("Extraction", SCORE.extraction);
      add("Hull integrity", this.hull * SCORE.hullBonusPerPoint, `${Math.round(this.hull)}%`);
      add("Time", Math.max(0, SCORE.parTime - this.time) * SCORE.timeBonusPerSec, fmtTime(this.time) + ` (par ${fmtTime(SCORE.parTime)})`);
    }
    if (this.continues) add("Continues", -this.continues * SCORE.continuePenalty, `${this.continues} used`);
    const total = Math.max(0, lines.reduce((s, l) => s + l.pts, 0));
    const rank = !extracted ? "—" : total >= 14000 ? "S" : total >= 10500 ? "A" : total >= 7500 ? "B" : total >= 4500 ? "C" : "D";
    return { lines, total, rank, time: this.time, extracted };
  }

  /** resume at the last checkpoint after hull failure */
  continueFromCheckpoint() {
    if (this.state !== "failed") return;
    this.continues++;
    this.sub.reset({ pos: this.checkpoint.pos, yaw: this.checkpoint.yaw });
    this.hull = HULL.continueHull; this.chain = 0; this.mult = 1;
    this.state = "playing";
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.type === "lurker" || e.type === "warden") { if (e.state !== "dormant") e.state = "patrol"; e.cd = 3; e.pos = [...e.home]; e.segs.forEach((s, k) => { s[0] = e.home[0]; s[1] = e.home[1]; s[2] = e.home[2] + k; }); }
      if (e.type === "shade") { e.pos = [...e.home]; e.vel = [0, 0, 0]; e.state = "drift"; }
      if (e.type === "mine" && e.state === "arming") { e.state = "idle"; e.cd = 2; }
    }
    for (const e of this.entities) if (e.type === "boulder" && e.state !== "dead") { this._removeDynamic(e); e.state = "waiting"; e.alive = false; }
    // allow rockfalls ahead of the checkpoint to trigger again
    for (const z of this.level.zones || []) if (z.rockfall) {
      const pending = this.entities.some((e) => e.type === "boulder" && e.group === z.rockfall && e.state === "waiting");
      if (pending) this.flags.delete("zone:" + z.id);
    }
    this.events.push({ type: "continue" });
  }
}

export function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; }
export { T as ENTITY };
