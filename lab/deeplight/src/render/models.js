/* models.js — procedural models (no external assets). Shared geometries and
 * materials are created once and reused by every instance. */

import * as THREE from "three";
import { SUB } from "../core/tuning.js";

const M = {};      // shared materials
const G = {};      // shared geometries
function mats() {
  if (M.paint) return M;
  M.paint = new THREE.MeshStandardMaterial({ color: 0xd88a2c, roughness: 0.42, metalness: 0.35 });
  M.trim = new THREE.MeshStandardMaterial({ color: 0x2c3338, roughness: 0.55, metalness: 0.3 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.4, metalness: 0.3 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x1b2a30, roughness: 0.08, metalness: 0.2, emissive: 0xffa04a, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 });
  M.lamp = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  M.navR = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  M.navG = new THREE.MeshBasicMaterial({ color: 0x33ff8a });
  // threats: danger reads as hot red/amber
  M.mineShell = new THREE.MeshStandardMaterial({ color: 0x3a2622, roughness: 0.7, metalness: 0.2, emissive: 0x2a0500, emissiveIntensity: 1 });
  M.mineCore = new THREE.MeshBasicMaterial({ color: 0xff3a1a });
  M.spike = new THREE.MeshStandardMaterial({ color: 0x6b3f33, roughness: 0.6, emissive: 0x401006, emissiveIntensity: 1 });
  M.eel = new THREE.MeshStandardMaterial({ color: 0x3b3a2c, roughness: 0.55, metalness: 0.1, emissive: 0x100802, emissiveIntensity: 1 });
  M.eelBelly = new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.6 });
  M.eye = new THREE.MeshBasicMaterial({ color: 0xffb020 });
  M.warden = new THREE.MeshStandardMaterial({ color: 0x3a1f1c, roughness: 0.5, metalness: 0.15, emissive: 0x1a0402, emissiveIntensity: 1 });
  M.plate = new THREE.MeshStandardMaterial({ color: 0x5d4a3c, roughness: 0.45, metalness: 0.4 });
  M.shade = new THREE.MeshBasicMaterial({ color: 0x9b6bff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  M.shadeEye = new THREE.MeshBasicMaterial({ color: 0xf2e6ff });
  M.seal = new THREE.MeshStandardMaterial({ color: 0x5a2230, roughness: 0.6, emissive: 0x2a0610, emissiveIntensity: 1, side: THREE.DoubleSide });
  M.sealNode = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
  // salvage reads as warm gold
  M.crate = new THREE.MeshStandardMaterial({ color: 0x7d8a90, roughness: 0.55, metalness: 0.25 });
  M.band = new THREE.MeshBasicMaterial({ color: 0xffc24a });
  M.relic = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.35, emissive: 0x6a4a10, emissiveIntensity: 0.9 });
  M.repair = new THREE.MeshBasicMaterial({ color: 0x6dffb0 });
  M.recorder = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4, metalness: 0.3, emissive: 0xff5a00, emissiveIntensity: 0.5 });
  // navigation
  M.beacon = new THREE.MeshBasicMaterial({ color: 0x4ff0ff });
  M.buoy = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  M.post = new THREE.MeshStandardMaterial({ color: 0x2c3438, roughness: 0.7, metalness: 0.5 });
  M.bone = new THREE.MeshStandardMaterial({ color: 0xb8ae96, roughness: 0.8 });
  M.kelp = new THREE.MeshStandardMaterial({ color: 0x1f4a33, roughness: 0.9, emissive: 0x06170e, emissiveIntensity: 1, side: THREE.DoubleSide });
  M.crystal = new THREE.MeshStandardMaterial({ color: 0x7fb4d8, roughness: 0.25, metalness: 0.1, emissive: 0x1f86b8, emissiveIntensity: 0.55, flatShading: true });
  M.boulder = new THREE.MeshStandardMaterial({ color: 0x5b5e60, roughness: 0.95, flatShading: true });
  return M;
}

/** Submarine. Local -Z is the nose; dimensions match the collider capsule. */
export function makeSub() {
  mats();
  const g = new THREE.Group();
  const L = SUB.halfLen + SUB.radius, R = SUB.radius;
  // hull: lathe profile along the axis, blunt nose, tapered tail
  const prof = [];
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const t = i / n;                       // 0 = tail tip, 1 = nose tip
    let r;
    if (t < 0.22) r = R * (0.35 + 0.65 * Math.sin((t / 0.22) * Math.PI / 2));
    else if (t > 0.8) r = R * Math.cos(((t - 0.8) / 0.2) * Math.PI / 2) ** 0.55;
    else r = R;
    prof.push(new THREE.Vector2(Math.max(0.001, r), (t - 0.5) * 2 * L));
  }
  const hullGeo = new THREE.LatheGeometry(prof, 28);
  hullGeo.rotateX(-Math.PI / 2);           // lathe axis Y -> -Z (nose forward)
  g.add(new THREE.Mesh(hullGeo, M.paint));
  // dark band + keel
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.35, 28, 1, true), M.trim);
  band.rotation.x = Math.PI / 2; band.position.z = 0.9; g.add(band);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, L * 1.2), M.trim);
  keel.position.set(0, -R * 0.98, 0.3); g.add(keel);
  // cockpit dome near the nose
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.72, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  dome.position.set(0, R * 0.72, -L * 0.45); dome.scale.set(1, 0.75, 1.5); g.add(dome);
  // headlamp housings either side of the nose
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 14), M.trim);
    h.rotation.x = Math.PI / 2; h.position.set(sx * R * 0.72, -R * 0.25, -L * 0.72); g.add(h);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.25, 14), M.lamp);
    lens.position.set(sx * R * 0.72, -R * 0.25, -L * 0.72 - 0.26); lens.rotation.y = Math.PI; g.add(lens);
  }
  // side thruster pods
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.2, 4, 10), M.trim);
    pod.rotation.x = Math.PI / 2; pod.position.set(sx * (R + 0.25), -0.2, 0.9); g.add(pod);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), sx < 0 ? M.navR : M.navG);
    nav.position.set(sx * (R + 0.5), -0.2, 0.2); g.add(nav);
  }
  // tail: cross fins + shrouded propeller
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.9), M.trim);
    const a = k * Math.PI / 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * 0.7, Math.sin(a) * 0.7, L * 0.78);
    fin.rotation.z = a - Math.PI / 2; g.add(fin);
  }
  const shroud = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 8, 24), M.steel);
  shroud.position.z = L * 0.98; g.add(shroud);
  const prop = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.05), M.steel);
    b.position.y = 0.26; const pv = new THREE.Group(); pv.rotation.z = k * Math.PI / 2; pv.add(b); prop.add(pv);
  }
  prop.position.z = L * 0.98; g.add(prop);
  g.userData.prop = prop;
  g.rotation.order = "YXZ";
  // own material copies so the hull can fade when the camera is very close
  const own = new Map();
  g.traverse((o) => { if (o.material) { if (!own.has(o.material)) own.set(o.material, o.material.clone()); o.material = own.get(o.material); } });
  g.userData.mats = [...own.values()];
  return g;
}

export function makeMine() {
  mats();
  if (!G.spike) { G.spike = new THREE.ConeGeometry(0.22, 0.9, 6); G.spike.translate(0, 1.6, 0); G.mineBody = new THREE.IcosahedronGeometry(1.25, 1); G.mineCore = new THREE.SphereGeometry(0.75, 12, 8); }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(G.mineBody, M.mineShell));
  const core = new THREE.Mesh(G.mineCore, M.mineCore.clone());
  core.scale.setScalar(0.9); g.add(core);
  const dirs = new THREE.IcosahedronGeometry(1, 0).attributes.position;
  const seen = new Set();
  for (let i = 0; i < dirs.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(dirs, i).normalize();
    const k = v.toArray().map((x) => x.toFixed(2)).join();
    if (seen.has(k)) continue; seen.add(k);
    const s = new THREE.Mesh(G.spike, M.spike);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); g.add(s);
  }
  // tether to the floor
  const teth = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 4), M.post);
  teth.position.y = -4.2; g.add(teth);
  g.userData.core = core;
  return g;
}

/** eel body: head + segments; the view moves them from sim state */
export function makeEel(big = false) {
  mats();
  const g = new THREE.Group();
  const s = big ? 2.4 : 1.35;
  const skin = big ? M.warden : M.eel;
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), skin);
  skull.scale.set(0.85, 0.7, 1.35); head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(s * 0.8, 14, 10), M.eelBelly);
  jaw.scale.set(0.8, 0.35, 1.2); jaw.position.set(0, -s * 0.38, -s * 0.2); head.add(jaw);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(s * 0.17, 10, 8), M.eye.clone());
    e.position.set(sx * s * 0.55, s * 0.25, -s * 0.75); head.add(e); eyes.push(e);
  }
  // teeth
  for (let k = -2; k <= 2; k++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(s * 0.07, s * 0.3, 4), M.bone);
    t.position.set(k * s * 0.18, -s * 0.2, -s * 1.12); t.rotation.x = Math.PI; head.add(t);
  }
  if (big) for (const sx of [-1, 1]) {        // armour crest + lure stalk
    const crest = new THREE.Mesh(new THREE.ConeGeometry(s * 0.35, s * 1.2, 5), M.plate);
    crest.position.set(sx * s * 0.45, s * 0.6, s * 0.3); crest.rotation.x = 0.9; head.add(crest);
  }
  g.add(head);
  const n = big ? 14 : 9, segs = [];
  for (let k = 0; k < n; k++) {
    const r = s * (0.78 - 0.5 * (k / n));
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), skin);
    m.scale.set(1, 0.9, 1.5); g.add(m); segs.push(m);
    if (big && k % 2 === 0) {
      const p = new THREE.Mesh(new THREE.ConeGeometry(r * 0.35, r * 1.1, 4), M.plate);
      p.position.y = r * 0.9; m.add(p);
    }
  }
  g.userData = { head, segs, eyes, jaw };
  return g;
}

export function makeShade() {
  mats();
  const g = new THREE.Group();
  // a ragged manta-like veil
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.2);
  for (let k = 0; k <= 12; k++) {
    const a = Math.PI * 0.5 + (k / 12) * Math.PI * 2;
    const r = 1.4 + (k % 2 ? 0.55 : 0);
    shape.lineTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 0.8);
  }
  const veil = new THREE.Mesh(new THREE.ShapeGeometry(shape), M.shade.clone());
  veil.rotation.x = -Math.PI / 2; g.add(veil);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), M.shade.clone());
  inner.scale.set(1, 0.6, 1.3); g.add(inner);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), M.shadeEye);
    e.position.set(sx * 0.32, 0.25, -0.75); g.add(e); eyes.push(e);
  }
  g.userData = { veil, inner, eyes };
  return g;
}

export function makeSealNode() {
  mats();
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12), M.sealNode.clone());
  g.add(core);
  for (let k = 0; k < 6; k++) {
    const v = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 6, 16, Math.PI * 0.8), M.seal);
    v.rotation.set(Math.PI / 2, 0, k * Math.PI / 3); g.add(v);
  }
  g.userData.core = core;
  return g;
}

export function makeSealMembrane(r) {
  mats();
  const geo = new THREE.CircleGeometry(r, 48, 0, Math.PI * 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {           // organic sag + veins
    const x = pos.getX(i), y = pos.getY(i), d = Math.hypot(x, y) / r;
    pos.setZ(i, -Math.sin(d * Math.PI) * 0.8 + Math.sin(x * 1.3) * Math.cos(y * 1.1) * 0.25);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M.seal);
  m.rotation.x = Math.PI / 2;
  return m;
}

export function makePickup(type) {
  mats();
  const g = new THREE.Group();
  if (type === "salvage") {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.0), M.crate); g.add(box);
    for (const x of [-0.5, 0.5]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.04, 1.04), M.band); b.position.x = x; g.add(b); }
  } else if (type === "relic") {
    const idol = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), M.relic); idol.scale.y = 1.5; g.add(idol);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.08, 6, 30), M.band); ring.rotation.x = Math.PI / 2; g.add(ring);
  } else if (type === "repair") {
    // a wrench-and-cross canister: shape + colour, never colour alone
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 14), M.crate); g.add(can);
    for (const r of [0, Math.PI / 2]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 0.3), M.repair); c.rotation.z = r; c.position.z = 0.56; g.add(c); const c2 = c.clone(); c2.position.z = -0.56; g.add(c2); }
  } else if (type === "recorder") {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.1), M.recorder); g.add(b);
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.14, 1.15), M.band); s.position.y = 0.2; g.add(s);
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.07, 6, 12, Math.PI), M.steel); h.position.y = 0.45; g.add(h);
  }
  return g;
}

export function makeBoulder() {
  mats();
  if (!G.boulder) G.boulder = new THREE.DodecahedronGeometry(2.0, 1);
  return new THREE.Mesh(G.boulder, M.boulder);
}

export function makeBeacon(danger) {
  mats();
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.2, 6), M.post); post.position.y = -1.1; g.add(post);
  if (danger) {   // red buoy with a warning cage (shape differs from the safe beacon)
    const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), M.buoy); g.add(b);
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.05, 4, 12), M.post); cage.rotation.x = Math.PI / 2; g.add(cage);
  } else {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), M.beacon); g.add(b);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 6, 20), M.beacon); g.add(halo);
  }
  return g;
}

export function makeBones() {
  mats();
  const g = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), M.bone); skull.scale.set(1.2, 0.8, 1.6); g.add(skull);
  for (let k = 0; k < 7; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.9 - k * 0.06, 0.08, 4, 12, Math.PI), M.bone);
    rib.position.z = 1.6 + k * 0.55; rib.rotation.y = Math.PI / 2; g.add(rib);
  }
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.06, 5, 5), M.bone); spine.rotation.x = Math.PI / 2; spine.position.z = 3.3; spine.position.y = 0.8; g.add(spine);
  return g;
}

export function kelpGeometry() {
  if (G.kelp) return G.kelp;
  // a few crossed ribbon blades, rooted at y=0
  const geos = [];
  for (let k = 0; k < 3; k++) {
    const p = new THREE.PlaneGeometry(0.5, 5, 1, 6);
    p.translate(0, 2.5, 0);
    const pos = p.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + Math.sin(pos.getY(i) * 0.9 + k) * 0.25);
    p.rotateY(k * Math.PI / 3);
    geos.push(p);
  }
  G.kelp = mergeGeos(geos);
  return G.kelp;
}
export function crystalGeometry() {
  if (G.crystal) return G.crystal;
  // a cluster of elongated hexagonal crystals with pointed tips, rooted at y=0
  const geos = [];
  const rng = (k) => ((Math.sin(k * 91.7) * 43758.5) % 1 + 1) % 1;
  for (let k = 0; k < 6; k++) {
    const h = 1.2 + rng(k) * 2.2, r = 0.18 + rng(k + 9) * 0.22;
    const body = new THREE.CylinderGeometry(r, r * 1.1, h, 6); body.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6); tip.translate(0, h + r * 1.1, 0);
    for (const g of [body, tip]) { g.rotateZ((rng(k + 3) - 0.5) * 0.9); g.rotateX((rng(k + 5) - 0.5) * 0.9); g.translate((rng(k + 7) - 0.5) * 0.8, 0, (rng(k + 11) - 0.5) * 0.8); geos.push(g); }
  }
  G.crystal = mergeGeos(geos);
  return G.crystal;
}
export { mats as materials };

function mergeGeos(list) {
  // minimal non-indexed merge (avoids pulling BufferGeometryUtils)
  const parts = list.map((g) => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { p.computeVertexNormals(); pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}
