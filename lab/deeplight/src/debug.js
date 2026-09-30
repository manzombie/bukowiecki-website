/* debug.js — developer overlay (toggle with ` or ?debug=1).
 * Shows the hull collider spheres, live contact points + normals, the camera
 * boom sweep, the navigable level graph, velocity, frame timing, sim steps,
 * renderer memory and streamed/active object counts. */

import * as THREE from "three";
import { SUB, CAMERA } from "./core/tuning.js";
import { edgePoints } from "./core/levelgraph.js";

export class DebugOverlay {
  constructor(view, level) {
    this.view = view; this.on = false;
    const g = this.group = new THREE.Group(); g.visible = false; view.scene.add(g);
    const wire = (c) => new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: 0.55, depthTest: false });
    this.hull = [];
    const sg = new THREE.SphereGeometry(SUB.radius, 12, 8);
    for (let i = 0; i < SUB.samples; i++) { const m = new THREE.Mesh(sg, wire(0x33ff99)); m.renderOrder = 999; g.add(m); this.hull.push(m); }
    this.contacts = [];
    for (let i = 0; i < 6; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3355, depthTest: false }));
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1.5, 0xff3355, 0.4, 0.2);
      dot.renderOrder = arrow.renderOrder = 999; g.add(dot, arrow); this.contacts.push({ dot, arrow });
    }
    this.vel = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, 0x44aaff, 0.6, 0.3); g.add(this.vel);
    this.aim = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 12, 0xffb45a, 0.8, 0.4); g.add(this.aim);
    // boom sweep (chase camera)
    const bg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.boom = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0xffff66, depthTest: false })); g.add(this.boom);
    this.camBall = new THREE.Mesh(new THREE.SphereGeometry(CAMERA.clearance, 10, 6), wire(0xffff66)); g.add(this.camBall);
    // navigable graph
    const pts = [];
    for (const e of level.edges) {
      const ep = edgePoints(level, e);
      for (let i = 0; i < ep.length - 1; i++) pts.push(new THREE.Vector3(...ep[i].slice(0, 3)), new THREE.Vector3(...ep[i + 1].slice(0, 3)));
    }
    this.graph = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false, transparent: true, opacity: 0.8 }));
    g.add(this.graph);
    for (const n of level.nodes) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: n.room ? 0xff66ff : 0x00e5ff, depthTest: false }));
      s.position.set(...n.p); g.add(s);
      if (n.room) {
        const ring = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), wire(0xff66ff));
        ring.material.opacity = 0.15; ring.scale.set(...n.room); ring.position.set(...(n.roomC || n.p)); g.add(ring);
      }
    }
    this.panel = document.createElement("div"); this.panel.id = "debug"; this.panel.hidden = true; document.body.appendChild(this.panel);
    this.frames = []; this.lastPanel = 0;
  }

  toggle(v = !this.on) {
    this.on = v; this.group.visible = v; this.panel.hidden = !v;
    this.view.rockMat.wireframe = false;
  }

  update(sim, rs, rig, stats) {
    this.frames.push(stats.frameMs); if (this.frames.length > 120) this.frames.shift();
    if (!this.on) return;
    const pts = sim.sub.hullPoints(rs.pos, rs.yaw, rs.pitch, this._pts || (this._pts = []));
    let minC = Infinity;
    pts.forEach((p, i) => {
      this.hull[i].position.set(...p);
      const c = sim.world.clearance(...p) - SUB.radius; minC = Math.min(minC, c);
      this.hull[i].material.color.setHex(c < 0.05 ? 0xff3355 : c < 0.6 ? 0xffcc33 : 0x33ff99);
    });
    this.contacts.forEach((c, i) => {
      const k = sim.sub.contacts[i];
      c.dot.visible = c.arrow.visible = !!k;
      if (k) { c.dot.position.set(...k.p); c.arrow.position.set(...k.p); c.arrow.setDirection(new THREE.Vector3(...k.n)); }
    });
    const v = new THREE.Vector3(...rs.vel), sp = v.length();
    this.vel.position.set(...rs.pos); if (sp > 0.05) this.vel.setDirection(v.clone().normalize()); this.vel.setLength(Math.max(0.5, sp), 0.6, 0.3);
    this.aim.position.set(...sim.muzzle()); this.aim.setDirection(new THREE.Vector3(...sim.aimDir));
    const b = this.boom.geometry.attributes.position;
    b.setXYZ(0, ...rs.pos); b.setXYZ(1, ...rig.pos); b.needsUpdate = true;
    this.camBall.position.set(...rig.pos); this.camBall.visible = rig.mode === "chase";

    const now = performance.now();
    if (now - this.lastPanel < 200) return;
    this.lastPanel = now;
    const avg = this.frames.reduce((a, x) => a + x, 0) / this.frames.length, worst = Math.max(...this.frames);
    const i = this.view.info();
    const heap = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + " MB" : "n/a";
    this.panel.textContent =
`DEBUG (\` to close)
frame   ${avg.toFixed(1)} ms avg  ${worst.toFixed(1)} worst  ${(1000 / avg).toFixed(0)} fps
sim     ${stats.steps} steps/frame  dropped ${stats.dropped.toFixed(2)} s total
render  dpr ${i.dpr.toFixed(2)}  calls ${i.calls}  tris ${(i.tris / 1000).toFixed(0)}k
memory  geo ${i.geos}  tex ${i.tex}  heap ${heap}
world   chunks ${i.chunks}  entities active ${i.entities}  dynamic ${sim.world.dynamic.length}
hull    clearance ${minC.toFixed(2)} m  contacts ${sim.sub.contacts.length}  impact ${sim.sub.lastImpact.toFixed(1)} m/s
motion  speed ${sp.toFixed(1)} m/s  yaw ${(rs.yaw * 57.3).toFixed(0)}°  pitch ${(rs.pitch * 57.3).toFixed(0)}°
camera  ${rig.mode}  boom ${rig.boom.toFixed(1)} / sweep ${rig.clearHit.toFixed(1)} m
pos     ${rs.pos.map((x) => x.toFixed(1)).join(", ")}
state   ${sim.state}  objective ${sim.objective?.id}  t ${sim.time.toFixed(1)} s`;
  }
}
