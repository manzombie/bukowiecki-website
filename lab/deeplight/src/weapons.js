/* weapons.js — in-tunnel entities (from level payloads) + the gun.
 * Hostiles are octopuses (shootable, hurt on contact); debris is shootable rock;
 * stars + multiplier gates trigger on pass-through; shipwreck is set-dressing.
 * Firing spawns a visible laser beam (LaserFX), not just a light flash. */

import * as THREE from "three";
import { toWorld, edgeCurve } from "./graph.js";

const HIT_R = { hostile: 13, debris: 8 };   // contact-collision radius per type

function makeOctopus() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x7a1f16, emissive: 0xc0392b, emissiveIntensity: 0.55, roughness: 0.55 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(8, 18, 14), skin);
  head.scale.set(1, 0.85, 1); g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xfff2cc, emissiveIntensity: 0.7 });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 10), eyeMat);
    e.position.set(sx * 3.4, 1.5, 6.4); g.add(e);
  }
  const tents = [];
  const tMat = new THREE.MeshStandardMaterial({ color: 0x5e160f, emissive: 0x8e271b, emissiveIntensity: 0.4, roughness: 0.7 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.ConeGeometry(1.9, 16, 6), tMat);
    t.position.set(Math.cos(a) * 5, -7, Math.sin(a) * 5);
    t.rotation.z = Math.cos(a) * 0.5; t.rotation.x = Math.sin(a) * 0.5;
    g.add(t); tents.push(t);
  }
  g.userData.tentacles = tents;
  return g;
}

function makeMesh(type) {
  switch (type) {
    case "hostile": return makeOctopus();
    case "debris": {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(6, 0),
        new THREE.MeshStandardMaterial({ color: 0x5a4631, emissive: 0x2a1f12, emissiveIntensity: 0.15, roughness: 0.95, flatShading: true }));
      return m;
    }
    case "star": return new THREE.Mesh(new THREE.OctahedronGeometry(4, 0),
      new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffc83a, emissiveIntensity: 1.0, roughness: 0.3 }));
    case "mult2x": case "mult3x": return new THREE.Mesh(new THREE.TorusGeometry(13, 1.6, 10, 30),
      new THREE.MeshStandardMaterial({ color: type === "mult3x" ? 0x6a4fd0 : 0x1670a0, emissive: type === "mult3x" ? 0x9a7bff : 0x2bb7ff, emissiveIntensity: 1.0 }));
    case "shipwreck": return new THREE.Mesh(new THREE.BoxGeometry(34, 16, 60),
      new THREE.MeshStandardMaterial({ color: 0x2a2118, emissive: 0x140d06, emissiveIntensity: 0.1, roughness: 1.0, flatShading: true }));
    default: return new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), new THREE.MeshStandardMaterial({ color: 0x444 }));
  }
}

/* short-lived laser beams */
export class LaserFX {
  constructor(scene) { this.scene = scene; this.beams = []; this.geo = new THREE.CylinderGeometry(0.7, 0.7, 1, 8); this.LIFE = 0.18; }
  spawn(from, to, color = 0xff4a2a) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length() || 1;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    // dual cannons: two parallel beams offset to the sub's sides
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    for (const s of [-2.2, 2.2]) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(this.geo, mat);
      m.position.copy(from).addScaledVector(dir, 0.5).addScaledVector(right, s);
      m.scale.set(1, len, 1); m.quaternion.copy(q);
      this.scene.add(m);
      this.beams.push({ m, life: this.LIFE });
    }
  }
  update(dt) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.life -= dt;
      b.m.material.opacity = Math.max(0, b.life / this.LIFE);
      if (b.life <= 0) { this.scene.remove(b.m); b.m.material.dispose(); this.beams.splice(i, 1); }
    }
  }
}

export class PayloadField {
  constructor(scene, graph, WORLD, hooks) {
    this.scene = scene; this.graph = graph; this.WORLD = WORLD; this.hooks = hooks;
    this.entities = [];
    this.ray = new THREE.Raycaster();
    this.lasers = new LaserFX(scene);
    this._spawn();
  }

  _worldPos(p) {
    if (this.graph.edges.has(p.edgeOrNodeId)) {
      const e = this.graph.edge(p.edgeOrNodeId);
      const curve = edgeCurve(this.graph, p.edgeOrNodeId, e.from, this.WORLD);
      return curve.getPointAt(Math.min(1, Math.max(0, p.t ?? 0.5)));
    }
    const n = this.graph.node(p.edgeOrNodeId);
    return n ? toWorld(n.x, n.y, this.WORLD) : new THREE.Vector3();
  }

  _spawn() {
    for (const p of this.graph.data.payloads || []) {
      const pos = this._worldPos(p);
      const mesh = makeMesh(p.type);
      mesh.position.copy(pos);
      const shootable = p.type === "hostile" || p.type === "debris";
      const trigger = p.type === "star" || p.type === "mult2x" || p.type === "mult3x";
      mesh.userData = { type: p.type, alive: true };
      this.scene.add(mesh);
      this.entities.push({ p, mesh, pos, type: p.type, alive: true, shootable, trigger, done: false, phase: pos.x * 0.1 });
    }
  }

  update(origin, dt, t) {
    const cp = origin;   // the SUB world position (proximity is measured from the sub)
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.type === "hostile") {
        e.mesh.rotation.y += dt * 0.4;
        e.mesh.position.y = e.pos.y + Math.sin(t * 1.4 + e.phase) * 2.5;     // bob
        const tents = e.mesh.userData.tentacles;
        if (tents) for (let i = 0; i < tents.length; i++) tents[i].rotation.x = Math.sin(t * 2 + i) * 0.3 + Math.sin(i) * 0.5;
      } else if (e.type === "star") { e.mesh.rotation.y += dt * 2; }
      else { e.mesh.rotation.y += dt * 0.5; }

      const d = cp.distanceTo(e.pos);
      if (e.trigger && !e.done && d < 14) {
        e.done = true; e.alive = false; e.mesh.visible = false;
        (e.type === "star" ? this.hooks.onStar : this.hooks.onGate)(e);
      } else if (e.shootable && d < (HIT_R[e.type] || 8)) {
        e.alive = false; e.mesh.visible = false; this.hooks.onDamage(e);
      }
    }
    this.lasers.update(dt);
  }

  /** fire from gunFrom through aim; spawn a visible beam; kill nearest target */
  fire(camera, aim, gunFrom) {
    this.ray.setFromCamera(new THREE.Vector2(aim.x, aim.y), camera);
    const roots = this.entities.filter((e) => e.alive && e.shootable).map((e) => e.mesh);
    const hits = this.ray.intersectObjects(roots, true);
    let hitPoint;
    if (hits.length && hits[0].distance < 300) {
      hitPoint = hits[0].point.clone();
      // walk up to the entity root
      let o = hits[0].object;
      const e = this.entities.find((x) => { let p = o; while (p) { if (p === x.mesh) return true; p = p.parent; } return false; });
      if (e) { e.alive = false; e.mesh.visible = false; this.hooks.onKill(e); }
    } else {
      hitPoint = this.ray.ray.origin.clone().addScaledVector(this.ray.ray.direction, 240);
    }
    this.lasers.spawn(gunFrom.clone(), hitPoint);
    return hitPoint;
  }

  dispose() {
    for (const e of this.entities) { this.scene.remove(e.mesh); }
    this.entities.length = 0;
  }
}
