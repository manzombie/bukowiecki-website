/* fx.js — pooled visual effects: marine snow, light-pulse beams, sparks,
 * explosion shells, dust columns, bubbles, god rays, glow sprites.
 * Every pool is allocated once; nothing is created per shot. */

import * as THREE from "three";

function dotTexture() {
  const s = 64, c = document.createElement("canvas"); c.width = c.height = s;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Fx {
  constructor(scene, view) {
    this.scene = scene; this.view = view;
    this.tex = dotTexture();
    this._beams(); this._sparks(); this._shells();
    this.snow = null; this.dust = [];
    this.bubbleT = 0;
  }

  setQuality(q) {
    this._snow(q.snow);
    this.sparkCap = q.sparks;
  }

  glowSprite(color, size) {
    const m = new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(m); s.scale.setScalar(size); return s;
  }

  // ------------------------------------------------------------- snow ----
  _snow(count) {
    if (this.snow) { this.scene.remove(this.snow); this.snow.geometry.dispose(); }
    this.B = 70;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * this.B;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.snowMat ||= new THREE.PointsMaterial({ color: 0xa9d6dc, size: 0.14, map: this.tex, transparent: true, opacity: 0.7, depthWrite: false, fog: true });
    this.snow = new THREE.Points(g, this.snowMat); this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  // ------------------------------------------------------------ beams ----
  _beams() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); geo.translate(0, 0.5, 0); geo.rotateX(Math.PI / 2);   // unit length along +z
    this.beamPool = [];
    for (let i = 0; i < 8; i++) {
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      const g = new THREE.Group(); g.add(core, halo); g.visible = false; this.scene.add(g);
      this.beamPool.push({ g, core, halo, life: 0 });
    }
    this.beamI = 0;
  }
  beam(from, to) {
    const b = this.beamPool[this.beamI++ % this.beamPool.length];
    const a = new THREE.Vector3(...from), c = new THREE.Vector3(...to);
    const len = a.distanceTo(c);
    b.g.position.copy(a); b.g.lookAt(c);
    b.core.scale.set(0.09, 0.09, len); b.halo.scale.set(0.32, 0.32, len);
    b.life = 0.14; b.g.visible = true;
  }

  // ----------------------------------------------------------- sparks ----
  _sparks() {
    const N = 600;
    this.sp = { N, pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), col: new Float32Array(N * 3), i: 0 };
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.sp.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.sp.col, 3));
    this.sparkPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.2, map: this.tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparkPts.frustumCulled = false; this.scene.add(this.sparkPts);
    this.sparkCap = 350;
  }
  burst(p, color, n = 20, speed = 6, life = 0.7) {
    const s = this.sp, c = new THREE.Color(color);
    n = Math.min(n, this.sparkCap);
    for (let k = 0; k < n; k++) {
      const i = s.i++ % s.N;
      s.pos[i * 3] = p[0]; s.pos[i * 3 + 1] = p[1]; s.pos[i * 3 + 2] = p[2];
      const u = Math.random() * 2 - 1, th = Math.random() * 6.283, r = Math.sqrt(1 - u * u), v = speed * (0.3 + Math.random() * 0.7);
      s.vel[i * 3] = r * Math.cos(th) * v; s.vel[i * 3 + 1] = u * v; s.vel[i * 3 + 2] = r * Math.sin(th) * v;
      s.life[i] = life * (0.5 + Math.random() * 0.5);
      s.col[i * 3] = c.r; s.col[i * 3 + 1] = c.g; s.col[i * 3 + 2] = c.b;
    }
  }
  bubbles(p, n = 2) {
    const s = this.sp;
    for (let k = 0; k < n; k++) {
      const i = s.i++ % s.N;
      s.pos[i * 3] = p[0] + (Math.random() - 0.5) * 0.4; s.pos[i * 3 + 1] = p[1] + (Math.random() - 0.5) * 0.4; s.pos[i * 3 + 2] = p[2] + (Math.random() - 0.5) * 0.4;
      s.vel[i * 3] = (Math.random() - 0.5) * 0.5; s.vel[i * 3 + 1] = 1.2 + Math.random(); s.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      s.life[i] = 1.1; s.col[i * 3] = 0.16; s.col[i * 3 + 1] = 0.22; s.col[i * 3 + 2] = 0.26;
    }
  }

  // ----------------------------------------------------------- shells ----
  _shells() {
    const geo = new THREE.SphereGeometry(1, 20, 14);
    this.shells = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; this.scene.add(m); this.shells.push({ m, t: 1, r: 1, dur: 0.5 });
    }
    this.shellI = 0;
  }
  shell(p, radius, color = 0xff7a30, dur = 0.5) {
    const s = this.shells[this.shellI++ % this.shells.length];
    s.m.position.set(...p); s.m.material.color.setHex(color); s.t = 0; s.r = radius; s.dur = dur; s.m.visible = true;
  }

  // --------------------------------------------- dust (rockfall tells) ----
  dustColumn(p, dur) { this.dust.push({ p: [...p], t: 0, dur }); }

  // -------------------------------------------------------- god rays ----
  addGodRays(top) {
    const geo = new THREE.ConeGeometry(9, 90, 24, 1, true); geo.translate(0, -45, 0);
    const col = [], pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const k = 1 + pos.getY(i) / 90; col.push(k * 0.35, k * 0.45, k * 0.5); }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.copy(top); this.scene.add(m); this.godRays = m;
  }

  // ----------------------------------------------------------- update ----
  update(dt, t, cam, rs, opts) {
    // snow wraps around the camera and drifts
    if (this.snow) {
      const p = this.snow.geometry.attributes.position.array, B = this.B, h = B / 2;
      const c = cam.position;
      for (let i = 0; i < p.length; i += 3) {
        p[i + 1] -= dt * 0.12;
        for (let a = 0; a < 3; a++) {
          const d = p[i + a] - c.getComponent(a);
          if (d > h) p[i + a] -= B; else if (d < -h) p[i + a] += B;
        }
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
    for (const b of this.beamPool) if (b.life > 0) {
      b.life -= dt; const k = Math.max(0, b.life / 0.14);
      b.core.material.opacity = k; b.halo.material.opacity = k * 0.35;
      if (b.life <= 0) b.g.visible = false;
    }
    const s = this.sp;
    let any = false;
    for (let i = 0; i < s.N; i++) {
      if (s.life[i] <= 0) continue;
      any = true;
      s.life[i] -= dt;
      const damp = Math.exp(-3 * dt);
      s.vel[i * 3] *= damp; s.vel[i * 3 + 1] *= damp; s.vel[i * 3 + 2] *= damp;
      s.pos[i * 3] += s.vel[i * 3] * dt; s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt; s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
      if (s.life[i] <= 0) { s.pos[i * 3 + 1] = -1e5; }
      else { const f = Math.min(1, s.life[i] * 2); s.col[i * 3] *= 0.995; s.col[i * 3 + 1] *= 0.99; s.col[i * 3 + 2] *= 0.99; if (f < 0.2) { s.col[i * 3] *= 0.9; s.col[i * 3 + 1] *= 0.9; s.col[i * 3 + 2] *= 0.9; } }
    }
    if (any || this._sparkDirty) {
      this.sparkPts.geometry.attributes.position.needsUpdate = true;
      this.sparkPts.geometry.attributes.color.needsUpdate = true;
      this._sparkDirty = any;
    }
    for (const sh of this.shells) if (sh.m.visible) {
      sh.t += dt / sh.dur;
      sh.m.scale.setScalar(sh.r * (0.2 + 0.8 * Math.sqrt(Math.min(1, sh.t))));
      sh.m.material.opacity = Math.max(0, 1 - sh.t) * 0.6;
      if (sh.t >= 1) sh.m.visible = false;
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i]; d.t += dt;
      if (Math.random() < dt * 40) this.burst([d.p[0] + (Math.random() - 0.5) * 2, d.p[1] - Math.random() * 2, d.p[2] + (Math.random() - 0.5) * 2], 0x8a7d66, 1, 1.5, 1.4);
      if (d.t > d.dur) this.dust.splice(i, 1);
    }
    // propeller wash
    // propeller wash only when the tail is well away from the lens (cockpit view / wide shots)
    this.bubbleT -= dt;
    if (opts.thrust && this.bubbleT <= 0 && rs.tail && cam.position.distanceTo({ x: rs.tail[0], y: rs.tail[1], z: rs.tail[2], isVector3: true }) > 9) { this.bubbles(rs.tail, 1); this.bubbleT = 0.08; }
    if (this.godRays) this.godRays.material.opacity = 0.28 + Math.sin(t * 0.7) * 0.06;
  }
}
