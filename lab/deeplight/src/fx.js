/* fx.js — the submarine model (shown in 3rd-person) and the drifting water
 * particulate ("marine snow") that sells the underwater feel. Both are cheap. */

import * as THREE from "three";

/** a soft round dot sprite so particles aren't ugly squares */
function roundSprite() {
  const s = 64, c = document.createElement("canvas"); c.width = c.height = s;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/** a small submarine, nose pointing -Z (matches camera/lookAt convention) */
export function makeSubmarine() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xb7a23c, emissive: 0x2a2406, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.7, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(3.2, 11, 8, 16), hull);
  body.rotation.x = Math.PI / 2;            // lie along Z
  g.add(body);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 4), dark);
  tower.position.set(0, 3, -1); g.add(tower);
  const finV = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 3), dark); finV.position.set(0, 1, 9); g.add(finV);
  const finH = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 3), dark); finH.position.set(0, 0, 9); g.add(finH);
  // two headlight eyes at the nose (-Z)
  const lamp = new THREE.MeshStandardMaterial({ color: 0xeaffff, emissive: 0xbfe6ff, emissiveIntensity: 0.5 });
  for (const sx of [-1.6, 1.6]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 10), lamp);
    e.position.set(sx, 0, -8.5); g.add(e);
  }
  g.scale.setScalar(0.72);
  return g;
}

/** two headlights: real SpotLights (light the walls) + additive gradient cones
 *  (visible volumetric shafts). Returned as a group to add to the submarine, so
 *  the beams emanate from the sub's nose in both camera modes. */
export function makeHeadlights() {
  const g = new THREE.Group();
  // volumetric cone geometry: apex at origin, widening forward (-Z), brightest
  // at the lamp and fading to nothing down its length (vertex colours + additive)
  const H = 120, R = 20;
  const cone = new THREE.ConeGeometry(R, H, 24, 1, true);
  cone.translate(0, -H / 2, 0); cone.rotateX(Math.PI / 2);   // apex at origin, base at -Z
  const pos = cone.attributes.position, col = [];
  const c0 = new THREE.Color(0x8fd6ff);
  for (let i = 0; i < pos.count; i++) {
    const z = -pos.getZ(i) / H;                  // 0 at lamp -> 1 at far tip
    const k = Math.max(0, 1 - z) * 0.22;         // gentle, fades out along the beam
    col.push(c0.r * k, c0.g * k, c0.b * k);
  }
  cone.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const beamMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });

  g.beams = [];
  for (const sx of [-2.4, 2.4]) {
    const spot = new THREE.SpotLight(0xcfeaff, 300, 340, Math.PI * 0.3, 0.85, 1.2);
    spot.position.set(sx, -0.5, -7);
    spot.target.position.set(sx * 0.3, 0, -95);   // subtle forward accent; ambient does the work now
    g.add(spot); g.add(spot.target);
    const beam = new THREE.Mesh(cone, beamMat);
    beam.position.set(sx, -0.8, -8);
    g.add(beam); g.beams.push(beam);
  }
  return g;
}

/** drifting particulate locked to a box around the camera; wraps as you move so
 *  it streams past — a cheap motion + "this is water" cue. */
export class Particles {
  constructor(scene, count = 700, box = 460) {
    this.B = box;
    this.pos = new Float32Array(count * 3);
    this.count = count;
    let s = 1;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < count * 3; i++) this.pos[i] = (rnd() - 0.5) * box;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fd9dd, size: 2.4, sizeAttenuation: true, map: roundSprite(),
      transparent: true, opacity: 0.55, depthWrite: false, fog: true, alphaTest: 0.02,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(camera, t) {
    const c = camera.position, B = this.B, h = B / 2, p = this.pos;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      // wrap each axis to stay within [cam-h, cam+h] -> streams past as cam moves
      for (let a = 0; a < 3; a++) {
        let d = p[k + a] - c.getComponent(a);
        if (d > h) p[k + a] -= B; else if (d < -h) p[k + a] += B;
      }
      p[k + 1] += Math.sin(t * 0.6 + i) * 0.02;  // faint vertical drift
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
