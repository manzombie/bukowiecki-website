/* tunnel.js — procedural tunnel geometry from the graph + streaming/pooling.
 * Each edge becomes a tube extruded along its centerline curve (the spine), with
 * a procedural rock bump texture and a scatter of bioluminescent vegetation
 * (kelp + glowing specks). Edges far from the sub are returned to a pool so the
 * whole level is never held in memory at once. */

import * as THREE from "three";
import { edgeCurve } from "./graph.js";
import { makeRng } from "../../shared/prng.js";

const TUBE_RADIAL = 14;     // cross-section resolution
const TUBE_RADIUS = 30;     // level 01 bore radius: generous clearance for readable flight

/* ---- procedural rock texture (no image assets): high-contrast stone grain
 *      that remains readable even before the final lighting pass. ---- */
function makeRockTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  // base fill
  ctx.fillStyle = "#778485";
  ctx.fillRect(0, 0, S, S);
  // layered smudgy noise from random grids upscaled (cheap fractal-ish)
  const rng = makeRng("deeplight-rock");
  for (const [grid, alpha] of [[10, 0.5], [24, 0.35], [64, 0.22]]) {
    const t = document.createElement("canvas"); t.width = t.height = grid;
    const tx = t.getContext("2d");
    const img = tx.createImageData(grid, grid);
    for (let i = 0; i < grid * grid; i++) {
      const v = 75 + rng.next() * 145;
      img.data[i*4] = v * 0.78;
      img.data[i*4+1] = v * 0.96;
      img.data[i*4+2] = v;
      img.data[i*4+3] = 255;
    }
    tx.putImageData(img, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(t, 0, 0, S, S);
  }
  // a few dark cracks
  ctx.globalAlpha = 0.48; ctx.strokeStyle = "#213b3f"; ctx.lineWidth = 1.5;
  for (let i = 0; i < 20; i++) {
    ctx.beginPath();
    let x = rng.next()*S, y = rng.next()*S; ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rng.next()-0.5)*70; y += (rng.next()-0.5)*70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(7, 2);
  return tex;
}

/* shared materials (created once) */
let _rockMat, _capMat, _capGeo, _kelpMat, _speckGeo, _kelpGeo, _speckMat;
let _boundaryMat, _activeBoundaryMat;
function ensureAssets() {
  if (_rockMat) return;
  const rock = makeRockTexture();
  // Unlit dark rock makes the complete route readable without deciding the
  // final lighting treatment yet.
  _rockMat = new THREE.MeshBasicMaterial({
    color: 0x8aa0a2, map: rock, side: THREE.BackSide, fog: true,
  });
  // Dead-end faces are hit head-on by both spotlights. An unlit textured cap
  // keeps the rock detail readable instead of blowing out to a white disc.
  _capMat = new THREE.MeshBasicMaterial({
    color: 0x8aa0a2, map: rock, side: THREE.DoubleSide, fog: true,
  });
  _capGeo = new THREE.CircleGeometry(TUBE_RADIUS * 0.985, TUBE_RADIAL);
  _kelpGeo = new THREE.ConeGeometry(1.1, 13, 5, 1, true);
  _kelpGeo.translate(0, 6.5, 0);     // root at origin, grows +Y
  _kelpMat = new THREE.MeshStandardMaterial({
    color: 0x123026, emissive: 0x0e3a2c, emissiveIntensity: 0.35,
    roughness: 1.0, side: THREE.DoubleSide,
  });
  _speckGeo = new THREE.SphereGeometry(0.6, 6, 6);
  _speckMat = new THREE.MeshBasicMaterial({ color: 0x49e6cf }); // bioluminescence (self-lit)
  _boundaryMat = new THREE.LineBasicMaterial({
    color: 0x6c9698, transparent: true, opacity: 0.28,
    depthTest: true, depthWrite: false, fog: true,
  });
  _activeBoundaryMat = _boundaryMat.clone();
  _activeBoundaryMat.color.setHex(0x86acad);
  _activeBoundaryMat.opacity = 0.72;
  _activeBoundaryMat.depthTest = true;
}

export class TunnelField {
  constructor(scene, graph, WORLD) {
    this.scene = scene; this.graph = graph; this.WORLD = WORLD;
    this.active = new Map();     // edgeId -> THREE.Group {tube + vegetation}
    this.veg = [];               // {mesh, base:Quaternion, axis, phase} for sway
    ensureAssets();
  }

  _vegetate(group, curve, edgeId) {
    const rng = makeRng("veg:" + edgeId);
    const len = curve.getLength();
    const up = new THREE.Vector3(0, 1, 0);
    const nKelp = Math.floor(len / 55) + 1;
    const nSpeck = Math.floor(len / 14) + 3;
    const place = (t) => {
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      let radial = new THREE.Vector3().crossVectors(tan, up);
      if (radial.lengthSq() < 1e-4) radial.set(1, 0, 0);
      radial.normalize().applyAxisAngle(tan, rng.range(0, Math.PI * 2));
      const wall = p.clone().addScaledVector(radial, TUBE_RADIUS * 0.93);
      return { p, wall, inward: radial.clone().negate(), tan };
    };
    for (let i = 0; i < nKelp; i++) {
      const { wall, inward, tan } = place(rng.range(0.05, 0.95));
      const k = new THREE.Mesh(_kelpGeo, _kelpMat);
      k.position.copy(wall);
      k.scale.setScalar(rng.range(0.6, 1.5));
      k.quaternion.setFromUnitVectors(up, inward);
      group.add(k);
      this.veg.push({ mesh: k, base: k.quaternion.clone(), axis: tan.clone(), phase: rng.range(0, 6.28) });
    }
    for (let i = 0; i < nSpeck; i++) {
      const { wall } = place(rng.next());
      const s = new THREE.Mesh(_speckGeo, _speckMat);
      s.position.copy(wall).addScaledVector(new THREE.Vector3(rng.gauss(0,1),rng.gauss(0,1),rng.gauss(0,1)).normalize(), 1.5);
      s.scale.setScalar(rng.range(0.5, 1.6));
      group.add(s);
    }
  }

  _build(edgeId) {
    const e = this.graph.edge(edgeId);
    const curve = edgeCurve(this.graph, edgeId, e.from, this.WORLD);
    const len = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, Math.max(8, Math.min(180, Math.round(len / 7))), TUBE_RADIUS, TUBE_RADIAL, false);
    // Nearby routes stay visible for navigation, but stop before junction
    // centres so their wall shells cannot pass through the active submarine.
    const startTrim = this.graph.neighbors(e.from).length > 1 ? Math.min(0.35, 16 / len) : 0;
    const endTrim = this.graph.neighbors(e.to).length > 1 ? Math.min(0.35, 16 / len) : 0;
    const contextPoints = [];
    const contextSamples = Math.max(8, Math.min(48, Math.ceil(len / 8)));
    for (let i = 0; i <= contextSamples; i++) {
      contextPoints.push(curve.getPointAt(startTrim + (1 - startTrim - endTrim) * (i / contextSamples)));
    }
    const contextCurve = new THREE.CatmullRomCurve3(contextPoints, false, "centripetal", 0.5);
    const contextGeo = new THREE.TubeGeometry(
      contextCurve, Math.max(8, Math.min(180, Math.round(contextCurve.getLength() / 7))),
      TUBE_RADIUS, TUBE_RADIAL, false,
    );
    const group = new THREE.Group();
    const tube = new THREE.Mesh(geo, _rockMat);
    const contextTube = new THREE.Mesh(contextGeo, _rockMat);
    const boundaryGeo = this._makeBoundaryGeometry(curve, len);
    const boundary = new THREE.LineSegments(boundaryGeo, _boundaryMat);
    const decor = new THREE.Group();
    group.add(tube, contextTube, boundary, decor);
    const caps = [];
    const addDeadEndCap = (nodeId, t, inward) => {
      if (!this.graph.isDeadEnd(nodeId)) return;
      const cap = new THREE.Mesh(_capGeo, _capMat);
      cap.position.copy(curve.getPointAt(t)).addScaledVector(inward, -0.15);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), inward);
      group.add(cap); caps.push(cap);
    };
    addDeadEndCap(e.from, 0, curve.getTangentAt(0).normalize());
    addDeadEndCap(e.to, 1, curve.getTangentAt(1).normalize().negate());
    group.userData = { edgeId, geo, contextGeo, boundaryGeo, curve, tube, contextTube, boundary, decor, caps };
    this._vegetate(decor, curve, edgeId);
    return group;
  }

  _makeBoundaryGeometry(curve, len) {
    const along = Math.max(8, Math.ceil(len / 14));
    const frames = curve.computeFrenetFrames(along, false);
    const positions = [];
    const point = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const wallPoint = (i, j, out) => {
      const angle = j / TUBE_RADIAL * Math.PI * 2;
      point.copy(curve.getPointAt(i / along));
      out.copy(point)
        .addScaledVector(frames.normals[i], Math.cos(angle) * TUBE_RADIUS * 0.94)
        .addScaledVector(frames.binormals[i], Math.sin(angle) * TUBE_RADIUS * 0.94);
      return out;
    };
    // Cross-section rings make the bore size and bends legible.
    for (let i = 0; i <= along; i++) {
      for (let j = 0; j < TUBE_RADIAL; j++) {
        wallPoint(i, j, a); wallPoint(i, (j + 1) % TUBE_RADIAL, b);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    // Four longitudinal ribs show which way the corridor continues.
    for (let j = 0; j < TUBE_RADIAL; j += Math.floor(TUBE_RADIAL / 4)) {
      for (let i = 0; i < along; i++) {
        wallPoint(i, j, a); wallPoint(i + 1, j, b);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  }

  focus(edgeId) {
    const edge = this.graph.edge(edgeId);
    const connected = new Set([edgeId]);
    for (const nodeId of [edge.from, edge.to]) {
      for (const neighbor of this.graph.neighbors(nodeId)) connected.add(neighbor.edgeId);
    }
    for (const [id, group] of this.active) {
      const current = id === edgeId;
      // Keep all streamed corridor shells visible. Hiding adjacent edges made
      // every branch look like an open black void with no onward route.
      group.userData.tube.visible = current;
      group.userData.contextTube.visible = !current;
      // Show the occupied bore and the immediate junction choices. Drawing the
      // entire streamed graph through walls is informative but visually noisy.
      group.userData.boundary.visible = connected.has(id);
      group.userData.boundary.material = current ? _activeBoundaryMat : _boundaryMat;
      group.userData.decor.visible = current;
      group.userData.caps.forEach((cap) => { cap.visible = true; });
    }
  }

  stream(edgeIds) {
    const want = new Set(edgeIds);
    for (const [id, group] of this.active) {
      if (!want.has(id)) {
        this.scene.remove(group);
        group.userData.geo.dispose();
        group.userData.contextGeo.dispose();
        group.userData.boundaryGeo.dispose();
        this.veg = this.veg.filter((v) => v.mesh.parent !== group);
        this.active.delete(id);
      }
    }
    for (const id of want) {
      if (!this.active.has(id) && this.graph.edges.has(id)) {
        const g = this._build(id);
        this.scene.add(g);
        this.active.set(id, g);
      }
    }
  }

  /** gentle kelp sway */
  update(t) {
    for (const v of this.veg) {
      const a = Math.sin(t * 1.3 + v.phase) * 0.18;
      v.mesh.quaternion.setFromAxisAngle(v.axis, a).multiply(v.base);
    }
  }

  dispose() {
    for (const [, g] of this.active) {
      this.scene.remove(g);
      g.userData.geo.dispose();
      g.userData.contextGeo.dispose();
      g.userData.boundaryGeo.dispose();
    }
    this.active.clear(); this.veg.length = 0;
  }
}

export const TUNNEL = { RADIUS: TUBE_RADIUS };
