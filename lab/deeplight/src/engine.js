/* engine.js — Deeplight boot + main loop.
 * Loads an extracted level graph, builds streamed tunnel geometry, carries the
 * sub forward on the current, lets the player steer at junctions and shoot with
 * the headlight. Glue only — drawing/rules live in the sibling modules. */

import * as THREE from "three";
import { LevelGraph, edgeCurve, toWorld } from "./graph.js";
import { TunnelField, TUNNEL } from "./tunnel.js";
import { setupLighting } from "./lighting.js";
import { Controls } from "./controls.js";
import { PayloadField } from "./weapons.js";
import { Damage } from "./damage.js";
import { Scoring } from "./scoring.js";
import { HUD } from "./hud.js";
import { MiniMap } from "./minimap.js";
import { GameAudio } from "./audio.js";
import { makeSubmarine, Particles, makeHeadlights } from "./fx.js";
import { setupPost } from "./postfx.js";

const WORLD = 1100;        // normalized 0..1 maps to this many world units
const SPEED = 18;          // forward current speed (world units / sec) — readable cruise
const TURN = 1.3;          // how hard steering biases a branch choice (rad)
const UPV = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// --- flight model (heavy, inertial, water-drag) ---
const SUB_R = 10;          // includes the full nose/tail envelope, not just hull width
const VERT_ACCEL = 155;    // responsive rise/dive thrust (u/s^2)
const LAT_DRAG = 3.8;      // quick release without losing the underwater weight
const MAX_LAT_SPEED = 34;  // prevents tunnelling through the collision boundary
const MAX_YAW = 0.62;      // visible heading authority from A/D (rad)
const WALL_SOFT_ZONE = 7;  // forgiving inward pressure before hard contact
const MAX_BANK = 0.6;      // roll into horizontal turns (rad)
const MAX_PITCH = 0.42;    // nose pitch on rise/dive (rad)
const HIT_CD = 1.0;        // seconds between damaging hits (forgiving)
const WALL_HIT_SPEED = 10; // outward speed that counts as a damaging wall hit
const TURNAROUND_TIME = 1.25;

const LEVEL_URL = "levels/level01.json";

class Game {
  constructor() {
    this.dom = document.getElementById("app");
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.dom.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.5, WORLD * 1.4);
    this.scene = new THREE.Scene();
    this.lights = setupLighting(this.scene, this.camera);
    this.controls = new Controls(this.renderer.domElement);
    this.hud = new HUD();
    this.audio = new GameAudio();
    this.clock = new THREE.Clock();

    // submarine model (seen in 3rd person), water particulate, camera mode
    this.sub = makeSubmarine();
    this.sub.visible = false;
    this.scene.add(this.sub);
    // headlights live at scene level (follow the ship each frame) so the hull can
    // be hidden in 1st-person without disabling the spotlights
    this.headlights = makeHeadlights();
    this.scene.add(this.headlights);
    this.particles = new Particles(this.scene);
    this.post = setupPost(this.renderer, this.scene, this.camera);
    this._frameAcc = 0; this._frameN = 0;   // perf auto-scale sampling
    this.thirdPerson = true;
    this.smoothFwd = new THREE.Vector3(0, 0, -1);
    this.shipPos = new THREE.Vector3();
    this.shipQ = new THREE.Quaternion();
    // damped camera (collision-aware in both modes)
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.camRay = new THREE.Raycaster();
    this.camReady = false;

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.post.setSize(innerWidth, innerHeight);
    });
  }

  async load() {
    const data = await (await fetch(LEVEL_URL)).json();
    this.graph = new LevelGraph(data);
    this.tunnels = new TunnelField(this.scene, this.graph, WORLD);
    this.startDist = this.graph.distToExit(this.graph.startNodeId) || 1;
    this.minimap = new MiniMap(this.graph);
    this.hud.hideLoading();
  }

  start() {
    // (re)build per-run state
    if (this.payloads) this.payloads.dispose();
    this.scoring = new Scoring();
    this.damage = new Damage();
    this.running = true;
    this.finished = false;
    this.traveled = 0;
    // flight state
    this.off = new THREE.Vector2(0, 0);   // lateral position in the bore (right, up)
    this.voff = new THREE.Vector2(0, 0);  // lateral velocity (momentum)
    this.bank = 0; this.pitchA = 0;       // roll into turns / nose pitch
    this.yawA = 0;                        // A/D rotates heading instead of strafing
    this.speedMul = 1;                    // temporary speed penalty after a wall hit
    this.hitCd = 0;                       // damage cooldown
    this.turnaround = null;               // automatic dead-end U-turn state
    this.camReady = false;                // snap camera on first frame of the run
    this.payloads = new PayloadField(this.scene, this.graph, WORLD, {
      onKill: (e) => { const g = this.scoring.kill(e.type); this.hud.toast(`+${g}`, this.now, "#3fb7a6"); this.audio.play("kill"); },
      onStar: (e) => { const g = this.scoring.star(); this.hud.toast(`★ +${g}`, this.now, "#ffc83a"); this.audio.play("pickup"); },
      onGate: (e) => { if (this.scoring.gate(e.type)) { this.hud.toast(`${e.type.toUpperCase()} BANKED`, this.now, "#2bb7ff"); this.audio.play("gate"); } },
      onDamage: (e) => this._takeHit(),
    });
    // traversal: from start node along its single edge
    const first = this.graph.neighbors(this.graph.startNodeId)[0];
    this._enterEdge(first.edgeId, this.graph.startNodeId);
    this.audio.setMusicActive(true);   // music plays during gameplay
    this.hud.showGame();
  }

  _enterEdge(edgeId, fromNode) {
    const previousEdgeId = this.cur?.edgeId || null;
    const e = this.graph.edge(edgeId);
    const toNode = e.from === fromNode ? e.to : e.from;
    const curve = edgeCurve(this.graph, edgeId, fromNode, WORLD);
    this.cur = { edgeId, fromNode, toNode, curve, len: curve.getLength() || 1, s: 0, previousEdgeId };
    // A branch changes the local right/up basis abruptly. Bleed the old edge's
    // lateral state toward centre so it cannot be reinterpreted inside rock.
    if (this.off) this.off.multiplyScalar(0.35);
    if (this.voff) this.voff.multiplyScalar(0.2);
    this.camReady = false;
    this._streamAround();
  }

  _streamAround() {
    // BFS depth-2 bubble of edges around the current segment
    const want = new Set();
    const seen = new Set();
    const frontier = [this.cur.fromNode, this.cur.toNode];
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next = [];
      for (const nid of frontier) {
        if (seen.has(nid)) continue; seen.add(nid);
        for (const a of this.graph.neighbors(nid)) { want.add(a.edgeId); next.push(a.other); }
      }
      frontier.length = 0; frontier.push(...next);
    }
    this.tunnels.stream([...want]);
    this.tunnels.focus(this.cur.edgeId);
  }

  _heading(curve, tParam) {
    const tg = curve.getTangentAt(Math.min(1, Math.max(0, tParam)));
    tg.y = 0; return tg.normalize();
  }

  _chooseNext(node, steer) {
    const exits = this.graph.exitsFrom(node, this.cur.edgeId);
    if (exits.length === 0) return null;               // dead end
    const heading = this._heading(this.cur.curve, 1);  // current travel dir
    // desired direction = heading rotated by steer
    const ang = steer * TURN;
    const desired = heading.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    let best = null, bestScore = -Infinity;
    const maxD = this.startDist || 1;
    for (const ex of exits) {
      const c = edgeCurve(this.graph, ex.edgeId, node, WORLD);
      const dir = this._heading(c, 0);
      let sc;
      if (steer === 0) {
        // auto-pilot: greedily head for the exit (closer = better), alignment as tiebreak
        sc = (1 - this.graph.distToExit(ex.other) / maxD) + 0.15 * desired.dot(dir);
      } else {
        // player steering: pick the branch best matching the steer direction
        sc = desired.dot(dir);
      }
      if (sc > bestScore) { bestScore = sc; best = ex; }
    }
    return best;
  }

  _takeHit() {
    if (this.hitCd > 0) return;            // forgiving: ignore rapid repeat contacts
    this.hitCd = HIT_CD;
    const r = this.damage.hit(1);
    this.hud.toast("HIT", this.now, "#c0392b");
    this.audio.play("hit");
    if (r.penalty) this.scoring.penalty(r.penalty);
    if (r.dead) this._finish(false);
  }

  _finish(reachedExit) {
    if (this.finished) return;
    this.finished = true; this.running = false;
    this.audio.setMusicActive(false);   // silence music on the end screen
    this.audio.play(reachedExit ? "win" : "lose");
    this.hud.end(reachedExit, this.scoring.tally(reachedExit));
  }

  _frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this._advance(dt);
    if (this.controls.consumeRestart() && this.finished) this.start();
    // perf auto-scale: if we sustain >~22ms/frame, drop the post stack
    if (this.post.enabled && this.running) {
      this._frameAcc += dt; this._frameN++;
      if (this._frameN >= 60) {
        if (this._frameAcc / this._frameN > 0.026) { this.post.enabled = false; }
        this._frameAcc = 0; this._frameN = 0;
      }
    }
    if (this.post.enabled) this.post.render();
    else this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._frame());
  }

  /** simulation step (no rendering) — used by the loop and by headless tests */
  _advance(dt) {
    this.now = (this.now || 0) + dt;
    this.lights.update(this.now);
    if (this.tunnels) this.tunnels.update(this.now);

    if (this.controls.consumeToggleMap() && this.minimap) this.minimap.toggle();
    if (this.controls.consumeToggleCam()) this.thirdPerson = !this.thirdPerson;

    if (this.running) {
      this.controls.update();
      const steer = this.turnaround ? 0 : this.controls.steer;     // A/D
      const pitchIn = this.turnaround ? 0 : this.controls.lift;    // W/S (+1 = up)

      // --- FLIGHT MODEL: A/D rotates heading; W/S moves vertically ---
      this.yawA += (steer * MAX_YAW - this.yawA) * Math.min(1, dt * 6);
      this.voff.x += -this.off.x * 5 * dt; // gently centre any residual side offset
      this.voff.y += pitchIn * VERT_ACCEL * dt;
      this.voff.multiplyScalar(Math.exp(-LAT_DRAG * dt));
      if (this.voff.length() > MAX_LAT_SPEED) this.voff.setLength(MAX_LAT_SPEED);
      this.off.addScaledVector(this.voff, dt);
      if (this.turnaround) {
        this.off.multiplyScalar(Math.exp(-5 * dt));
        this.voff.multiplyScalar(Math.exp(-7 * dt));
      }

      // --- COLLISION: keep the sub inside the bore; wall contact pushes back ---
      const USABLE_R = TUNNEL.RADIUS - SUB_R;
      const r = this.off.length();
      const softStart = USABLE_R - WALL_SOFT_ZONE;
      if (r > softStart && r > 0) {
        const pressure = (r - softStart) / WALL_SOFT_ZONE;
        this.voff.addScaledVector(this.off, -pressure * 8 * dt);
      }
      if (r > USABLE_R) {
        const nx = this.off.x / r, ny = this.off.y / r;
        const outV = this.voff.x * nx + this.voff.y * ny;   // outward speed
        this.off.set(nx * USABLE_R, ny * USABLE_R);          // resolve penetration
        if (outV > 0) { this.voff.x -= nx * outV * 1.4; this.voff.y -= ny * outV * 1.4; } // bounce off
        if (outV > WALL_HIT_SPEED) { this._takeHit(); this.speedMul = 0.45; }  // solid but forgiving
      }
      this.hitCd = Math.max(0, this.hitCd - dt);
      this.speedMul += (1 - this.speedMul) * Math.min(1, dt * 1.5);

      // eased bank (roll into turns) + nose pitch
      this.bank += (-steer * MAX_BANK - this.bank) * Math.min(1, dt * 4);
      this.pitchA += (pitchIn * MAX_PITCH - this.pitchA) * Math.min(1, dt * 4);

      // --- forward current carries the sub along the edge ---
      if (!this.turnaround) {
        this.cur.s += SPEED * this.speedMul * dt;
        this.traveled += SPEED * this.speedMul * dt;
      } else {
        this.turnaround.elapsed += dt;
      }
      let tp = this.cur.s / this.cur.len;

      if (this.turnaround && this.turnaround.elapsed >= TURNAROUND_TIME) {
        const { edgeId, node } = this.turnaround;
        this.turnaround = null;
        this._enterEdge(edgeId, node);
        this.smoothFwd.copy(this.cur.curve.getTangentAt(0)).normalize();
        tp = 0;
      } else if (!this.turnaround && tp >= 1) {
        const node = this.cur.toNode;
        if (this.graph.isExit(node)) { this._finish(true); }
        else {
          const next = this._chooseNext(node, steer);
          if (!next) {                    // dead end -> penalty + reverse
            this.scoring.deadEnd();
            this.audio.play("deadend");
            this.cur.s = Math.max(0, this.cur.len - 12);
            this.turnaround = {
              edgeId: this.cur.edgeId, node, elapsed: 0,
              startFwd: this.smoothFwd.clone().normalize(),
            };
            this.hud.toast("DEAD END — TURNING AROUND", this.now, "#b07d2b");
          } else {
            this._enterEdge(next.edgeId, node);
          }
          tp = this.turnaround ? this.cur.s / this.cur.len : 0;
        }
      }

      if (this.running) {
        const cl = (v) => Math.min(0.999, Math.max(0.001, v));
        const LA = 38 / this.cur.len;
        const pos = this.cur.curve.getPointAt(cl(tp));
        const ahead = this.cur.curve.getPointAt(cl(tp + LA));
        let fwd = new THREE.Vector3().subVectors(ahead, pos);
        if (fwd.lengthSq() < 1e-4) fwd.copy(this.cur.curve.getTangentAt(cl(tp)));
        fwd.normalize();
        this.smoothFwd.lerp(fwd, Math.min(1, dt * 6)).normalize();
        let pathF = this.smoothFwd;
        if (this.turnaround) {
          const x = Math.min(1, this.turnaround.elapsed / TURNAROUND_TIME);
          const eased = x * x * (3 - 2 * x);
          pathF = this.turnaround.startFwd.clone().applyAxisAngle(UPV, Math.PI * eased).normalize();
        }
        const pathSide = new THREE.Vector3().crossVectors(pathF, UPV).normalize();
        const pathUp = new THREE.Vector3().crossVectors(pathSide, pathF).normalize();
        const f = pathF.clone().applyAxisAngle(pathUp, this.turnaround ? 0 : this.yawA).normalize();
        const side = new THREE.Vector3().crossVectors(f, pathUp).normalize();
        const up = new THREE.Vector3().crossVectors(side, f).normalize();

        // ship position (centerline + collision-bounded lateral offset)
        this.shipPos.copy(pos).addScaledVector(pathSide, this.off.x).addScaledVector(pathUp, this.off.y);
        // ship orientation = path basis, then local pitch + bank
        this.shipQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, f.clone().negate()));
        this.shipQ.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, this.pitchA));
        this.shipQ.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Z, this.bank));
        this.sub.position.copy(this.shipPos);
        this.sub.quaternion.copy(this.shipQ);
        // headlights follow the ship (separate from the hull so it can be hidden)
        this.headlights.position.copy(this.shipPos);
        this.headlights.quaternion.copy(this.shipQ);

        // --- CAMERA: collision-aware targets, damped follow ---
        const camT = new THREE.Vector3();
        const camQT = new THREE.Quaternion();
        if (this.thirdPerson) {
          // Keep the chase camera inside the one active corridor shell. Pulling
          // it into the previous edge exposes junction openings and wall backs.
          const backDistance = 24;
          const traveledOnEdge = tp * this.cur.len;
          camT.copy(this.cur.curve.getPointAt(cl(Math.max(0, traveledOnEdge - backDistance) / this.cur.len)));
          camT.addScaledVector(pathUp, 8);
          camQT.setFromRotationMatrix(new THREE.Matrix4().lookAt(camT, this.shipPos.clone().addScaledVector(f, 8), pathUp));
        } else {
          // cockpit: just above & behind the nose; kept well clear of the bore wall
          camT.copy(this.shipPos).addScaledVector(f, 1).addScaledVector(up, 2.2);
          camQT.copy(this.shipQ);             // banks/pitches with the sub
        }
        // hull + emissive eyes only in 3rd-person (they blob the lens up close);
        // 1st-person is a clean cockpit lit by the spotlights + fog + particles
        this.sub.visible = this.thirdPerson;
        this.headlights.beams.forEach((b) => (b.visible = this.thirdPerson));
        // damped follow (lerp position / slerp orientation) — blends mode switches
        if (!this.camReady) { this.camPos.copy(camT); this.camQuat.copy(camQT); this.camReady = true; }
        else {
          const rr = this.thirdPerson ? dt * 6 : dt * 12;
          // Position stays on a known-safe bore target. Lerp chords across tight
          // bends can pass through rock even when both endpoints are inside.
          this.camPos.copy(camT);
          this.camQuat.slerp(camQT, Math.min(1, rr));
        }
        this.camera.position.copy(this.camPos);
        this.camera.quaternion.copy(this.camQuat);
        // gentle idle sway for weight
        this.camera.position.addScaledVector(side, Math.sin(this.now * 0.7) * 0.5)
          .addScaledVector(up, Math.sin(this.now * 0.9 + 1) * 0.4);

        // fire — visible beam from the sub nose
        if (this.controls.consumeFire()) {
          const gun = this.shipPos.clone().addScaledVector(f, 8);
          this.payloads.fire(this.camera, this.controls.aim, gun);
          this.lights.flash(this.now); this.audio.play("fire", { volume: 0.7 });
        }
        this.payloads.update(this.shipPos, dt, this.now);
        this.particles.update(this.camera, this.now);
        this._streamAround();
        this.minimap.update({ x: this.shipPos.x / WORLD + 0.5, y: this.shipPos.z / WORLD + 0.5 });

        const progress = Math.max(0, Math.min(1, 1 - this.graph.distToExit(this.cur.toNode) / this.startDist));
        const s = this.scoring.summary();
        this.hud.update({ hp: this.damage.hp, score: s.score, mult: s.mult, depth: this.traveled, progress }, this.now);
      }
    }
  }

  run() { this._frame(); }
}

// ---- boot ----
const game = new Game();
window.__game = game;   // headless testing / debugging hook
game.load().then(() => {
  const trkBtns = [...document.querySelectorAll(".ac.trk")];
  const sBtn = document.getElementById("btn-sfx");
  const refreshTrk = () => {
    const avail = game.audio.availableTracks();
    trkBtns.forEach((b) => {
      b.disabled = !avail.includes(b.dataset.trk);
      b.classList.toggle("on", game.audio.currentTrack === b.dataset.trk);
    });
  };
  refreshTrk();
  trkBtns.forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.trk;
    game.audio.selectTrack(game.audio.currentTrack === k ? null : k);   // click active = stop
    refreshTrk();
  }));
  sBtn.addEventListener("click", () => {
    const on = game.audio.toggleSfx();
    sBtn.classList.toggle("on", on); sBtn.textContent = (on ? "►" : "✕") + " SFX";
  });

  const dive = () => { game.audio.unlock().then(refreshTrk); game.audio.play("click"); game.start(); };
  document.getElementById("play-btn").addEventListener("click", dive);
  document.getElementById("again-btn").addEventListener("click", dive);
  game.run();
}).catch((err) => {
  document.getElementById("loading").textContent = "Failed to load level: " + err.message;
  console.error(err);
});
