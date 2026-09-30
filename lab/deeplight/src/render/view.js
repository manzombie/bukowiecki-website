/* view.js — three.js presentation of the simulation.
 * Reads GameSim state (interpolated) and drains its events for effects. Owns
 * no gameplay state. Quality presets and adaptive resolution change only
 * rendering cost, never physics. */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SUB, SONAR, CAMERA } from "../core/tuning.js";
import { axes } from "../core/sub.js";
import { edgePoints } from "../core/levelgraph.js";
import * as models from "./models.js";
import { Fx } from "./fx.js";

export const QUALITY = {
  low:    { dprMax: 1.0, dprMin: 0.5, bloom: false, snow: 350, sparks: 200, flood: false },
  medium: { dprMax: 1.5, dprMin: 0.6, bloom: true,  snow: 700, sparks: 350, flood: true },
  high:   { dprMax: 2.0, dprMin: 0.75, bloom: true, snow: 1100, sparks: 500, flood: true },
};

const FOG = 0x04121c;

export class View {
  constructor(container, level, world, settings) {
    this.level = level; this.world = world; this.settings = settings;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
    if (!gl) throw Object.assign(new Error("WebGL2 is not available"), { code: "nowebgl" });
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(canvas);
    this.canvas = canvas;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener("webglcontextrestored", () => { this.contextLost = false; });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG);
    this.scene.fog = new THREE.FogExp2(FOG, 0.021);
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, 0.08, 420);
    this.clock = 0;

    this._lights();
    this._rockMaterial();
    this.chunkGroup = new THREE.Group(); this.scene.add(this.chunkGroup);
    this.chunks = [];

    this.sub = models.makeSub(); this.scene.add(this.sub);
    this.fx = new Fx(this.scene, this);
    this.entityViews = new Map();
    this.decor = new THREE.Group(); this.scene.add(this.decor);

    this.quality = null;
    this.setQuality(settings.get("quality") || "medium");
    this.resize();
  }

  // ------------------------------------------------------------ lighting ----
  _lights() {
    // faint cold ambience so rock silhouettes read even outside the beams
    this.hemi = new THREE.HemisphereLight(0x3d6f8a, 0x0b1216, 0.55);
    this.scene.add(this.hemi);
    // two tight warm headlights on the gimbal + one wide short flood on the hull axis
    this.heads = [];
    for (const sx of [-1, 1]) {
      const s = new THREE.SpotLight(0xffe0b0, 55, 90, 0.38, 0.6, 1.05);
      s.userData.sx = sx;
      this.scene.add(s, s.target); this.heads.push(s);
    }
    this.flood = new THREE.SpotLight(0xcfe6ff, 7, 30, 1.1, 0.95, 1.1);
    this.scene.add(this.flood, this.flood.target);
    this.hullLight = new THREE.PointLight(0xffb070, 6, 9, 1.6);
    this.scene.add(this.hullLight);
    // soft fill from just behind the camera: reads the hull and nearby clearance
    this.fill = new THREE.PointLight(0x9fc6d8, 5, 24, 1.2);
    this.scene.add(this.fill);
    this.flash = new THREE.PointLight(0xffd0a0, 0, 40, 1.5);
    this.scene.add(this.flash);
    this.flashT = 0;
  }

  _rockMaterial() {
    const u = this.rockUniforms = {
      uTime: { value: 0 }, uSonarO: { value: new THREE.Vector3(0, -1e5, 0) }, uSonarR: { value: 0 }, uSonarA: { value: 0 },
      uSonarRange: { value: SONAR.range }, uGlow: { value: new THREE.Color(0x3ff0d8) },
    };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;\nvarying vec3 vWPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          uniform float uTime, uSonarR, uSonarA, uSonarRange; uniform vec3 uSonarO, uGlow;
          varying float vGlow; varying vec3 vWPos;
          float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
          float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
            return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                       mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          float grain = n3(vWPos*1.9)*0.6 + n3(vWPos*5.3)*0.4;
          diffuseColor.rgb *= 0.78 + 0.42*grain;`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          { vec3 vp = -vViewPosition;
            float hb = n3(vWPos*1.3)*0.6 + n3(vWPos*3.7)*0.4;
            vec3 dpx = dFdx(vp), dpy = dFdy(vp);
            float dhx = dFdx(hb), dhy = dFdy(hb);
            vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
            normal = normalize(abs(det) * normal - grad * 0.3); }`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          float gl = vGlow * (0.7 + 0.3*sin(uTime*1.3 + vWPos.x*0.35 + vWPos.z*0.21));
          totalEmissiveRadiance += uGlow * gl * 1.6;`)
        .replace("#include <fog_fragment>", `#include <fog_fragment>
          float dS = distance(vWPos, uSonarO);
          float ring = exp(-pow((dS - uSonarR) / 1.8, 2.0));
          float inside = step(dS, uSonarR) * (1.0 - smoothstep(uSonarRange*0.4, uSonarRange, dS));
          float lines = smoothstep(0.92, 1.0, fract(dS*0.25 - uTime*0.2));
          float fall = 1.0 - smoothstep(0.0, uSonarRange, dS);
          gl_FragColor.rgb += vec3(0.25, 0.8, 1.0) * uSonarA * fall * (ring*0.6 + inside*(0.015 + 0.05*lines));`);
    };
    this.rockMat = mat;
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.medium;
    this.qualityName = name; this.quality = q;
    this.dpr = Math.min(devicePixelRatio || 1, q.dprMax);
    this.renderer.setPixelRatio(this.dpr);
    this.flood.visible = q.flood;
    this.fx.setQuality(q);
    this._setupPost();
    this.resize();
  }

  _setupPost() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!this.quality.bloom) return;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.82);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) { this.composer.setPixelRatio?.(this.dpr); this.composer.setSize(w, h); }
  }

  /** adaptive resolution: lower pixel ratio under sustained load, recover slowly */
  adapt(frameMs, targetMs) {
    this._ft = (this._ft ?? targetMs) * 0.92 + frameMs * 0.08;
    this._adaptT = (this._adaptT || 0) + frameMs / 1000;
    if (this._adaptT < 1.2) return;
    this._adaptT = 0;
    const q = this.quality, maxD = Math.min(devicePixelRatio || 1, q.dprMax);
    let d = this.dpr;
    if (this._ft > targetMs * 1.12 && d > q.dprMin) d = Math.max(q.dprMin, d - 0.1);
    else if (this._ft < targetMs * 1.03 && d < maxD) { this._good = (this._good || 0) + 1; if (this._good > 3) { d = Math.min(maxD, d + 0.05); this._good = 0; } }
    if (Math.abs(d - this.dpr) > 1e-3) { this.dpr = d; this.renderer.setPixelRatio(d); this.resize(); }
  }

  // --------------------------------------------------------------- world ----
  addChunks(list) {
    for (const c of list) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(c.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(c.normals, 3));
      g.setAttribute("color", new THREE.BufferAttribute(c.colors, 3));
      g.setAttribute("glow", new THREE.BufferAttribute(c.glow, 1));
      g.setIndex(new THREE.BufferAttribute(c.indices, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.rockMat);
      m.matrixAutoUpdate = false;
      this.chunkGroup.add(m); this.chunks.push(m);
    }
  }

  /** place dressing on real surfaces by sphere-tracing to the wall */
  buildDecor() {
    const W = this.world, L = this.level, D = L.decor || {};
    const rng = mulberry(7);
    const toWall = (p, d) => { const t = W.march(p[0], p[1], p[2], d[0], d[1], d[2], 30); return t < 30 ? [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t] : null; };
    const up = new THREE.Vector3(0, 1, 0);
    // kelp on the floors of the galleries (instanced)
    const kelpSpots = [];
    for (const id of D.kelpEdges || []) {
      const e = L.edges.find((x) => x.id === id); if (!e) continue;
      const pts = edgePoints(L, e);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        for (let s = 0; s < len; s += 2.2) {
          const t = s / len; const p = [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
          p[0] += (rng() - 0.5) * a[3] * 1.2; p[2] += (rng() - 0.5) * a[3] * 1.2;
          if (W.clearance(...p) < 1) continue;
          const w = toWall(p, [0, -1, 0]); if (w) kelpSpots.push(w);
        }
      }
    }
    const kelp = new THREE.InstancedMesh(models.kelpGeometry(), models.materials().kelp, kelpSpots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    kelpSpots.forEach((p, i) => {
      q.setFromAxisAngle(up, rng() * 6.28); sc.setScalar(0.6 + rng() * 1.1);
      m4.compose(new THREE.Vector3(p[0], p[1] - 0.3, p[2]), q, sc); kelp.setMatrixAt(i, m4);
    });
    this.kelp = kelp; this.decor.add(kelp);
    // crystal clusters on the cavern walls
    if (D.crystals) {
      const room = L.nodes.find((n) => n.id === D.crystals);
      const spots = [];
      for (let k = 0; k < 90; k++) {
        const th = rng() * 6.28, ph = (rng() - 0.3) * 1.6;
        const d = [Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)];
        const w = toWall([room.p[0], room.p[1] + 6, room.p[2]], d);
        if (w) spots.push([w, d]);
      }
      const cr = new THREE.InstancedMesh(models.crystalGeometry(), models.materials().crystal, spots.length);
      spots.forEach(([p, d], i) => {
        q.setFromUnitVectors(up, new THREE.Vector3(-d[0], -d[1], -d[2]).normalize()); sc.setScalar(0.5 + rng() * 0.9);
        m4.compose(new THREE.Vector3(...p), q, sc); cr.setMatrixAt(i, m4);
      });
      this.decor.add(cr);
    }
    // beacons: hang from the nearest wall below/side of the given point
    const place = (list, danger) => {
      for (const p of list || []) {
        const w = toWall(p, [0, -1, 0]) || toWall(p, [1, 0, 0]);
        const b = models.makeBeacon(danger);
        b.position.set(...(w ? [w[0], w[1] + 2.2, w[2]] : p));
        this.decor.add(b);
        const glow = this.fx.glowSprite(danger ? 0xff3b2f : 0x40e8ff, danger ? 4.5 : 5.5);
        glow.position.copy(b.position); this.decor.add(glow);
      }
    };
    place(D.safeBeacons, false); place(D.dangerBuoys, true);
    for (const p of D.bones || []) {
      const w = toWall(p, [0, -1, 0]); if (!w) continue;
      const b = models.makeBones(); b.position.set(w[0], w[1] + 0.4, w[2]); b.rotation.y = rng() * 6; this.decor.add(b);
    }
    // extraction: bright surface light pouring down the shaft
    const top = L.nodes.find((n) => n.id === "surface");
    if (top) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(12, 40), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, fog: false }));
      disc.rotation.x = Math.PI / 2; disc.position.set(top.p[0], top.p[1] + 5.5, top.p[2]); this.decor.add(disc);
      const shaftLight = new THREE.SpotLight(0xcfeeff, 1800, 110, 0.35, 0.8, 1.2);
      shaftLight.position.set(top.p[0], top.p[1] + 4, top.p[2]); shaftLight.target.position.set(top.p[0], top.p[1] - 80, top.p[2]);
      this.decor.add(shaftLight, shaftLight.target);
      this.fx.addGodRays(new THREE.Vector3(top.p[0], top.p[1] + 5, top.p[2]));
    }
    // the wreck: portholes and a name plate on the metal hull
    const wreck = (L.solids || []).find((s) => s.mat === "metal" && s.type === "capsule");
    if (wreck) {
      const a = new THREE.Vector3(...wreck.a), b = new THREE.Vector3(...wreck.b), ax = b.clone().sub(a).normalize();
      const side = new THREE.Vector3().crossVectors(ax, up).normalize();
      const pm = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
      for (let k = 1; k < 9; k++) {
        const c = a.clone().lerp(b, k / 10);
        for (const s of [-1, 1]) {
          const p = c.clone().addScaledVector(side, s * (wreck.r + 0.05)).addScaledVector(up, 1.2);
          const ph = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12), k % 3 === 0 ? pm : models.materials().trim);
          ph.position.copy(p); ph.lookAt(p.clone().addScaledVector(side, s)); this.decor.add(ph);
        }
      }
      const wl = new THREE.PointLight(0x7fd8ff, 20, 26, 1.6);
      wl.position.copy(a.clone().lerp(b, 0.5)).addScaledVector(up, 8); this.decor.add(wl);
    }
  }

  // ------------------------------------------------------------ entities ----
  buildEntities(sim) {
    for (const [, v] of this.entityViews) this.scene.remove(v.obj);
    this.entityViews.clear();
    for (const e of sim.entities) {
      let obj;
      switch (e.type) {
        case "mine": obj = models.makeMine(); break;
        case "lurker": obj = models.makeEel(false); break;
        case "warden": obj = models.makeEel(true); break;
        case "shade": obj = models.makeShade(); break;
        case "seal": obj = models.makeSealNode(); break;
        case "boulder": obj = models.makeBoulder(); break;
        default: obj = models.makePickup(e.type);
      }
      obj.position.set(...e.pos);
      this.scene.add(obj);
      this.entityViews.set(e.id, { obj, e, deathT: -1, scale: 1 });
    }
    if (this.membrane) this.scene.remove(this.membrane);
    if (this.level.seal) {
      this.membrane = models.makeSealMembrane(this.level.seal.r);
      this.membrane.position.set(...this.level.seal.pos);
      this.scene.add(this.membrane);
      this.membraneFade = 1;
    }
  }

  /** after a restart the sim recreates its entities; reuse the same objects (no GPU churn) */
  rebindEntities(sim) {
    for (const e of sim.entities) {
      const v = this.entityViews.get(e.id);
      if (!v) continue;
      v.e = e; v.deathT = -1; v.obj.visible = true; v.obj.scale.setScalar(1);
    }
    this.membraneFade = 1;
  }

  // --------------------------------------------------------------- frame ----
  /**
   * @param {object} rs  interpolated sub render state {pos,yaw,pitch,roll,vel}
   * @param {GameSim} sim
   * @param {CameraRig} rig
   */
  render(rs, sim, rig, dt, opts) {
    this.clock += dt;
    const t = this.clock;
    this.rockUniforms.uTime.value = t;
    // sub
    this.sub.position.set(...rs.pos);
    this.sub.rotation.set(rs.pitch, rs.yaw, rs.roll, "YXZ");
    this.sub.userData.prop.rotation.z += dt * (4 + 26 * Math.abs(opts.thrust));
    const cockpit = rig.mode === "cockpit";
    // fade the hull when the boom is squeezed very short so it never fills the screen
    const fade = cockpit ? 0 : Math.max(0, Math.min(1, (rig.boom - 1.4) / 2.2));
    this.sub.visible = fade > 0.02;
    if (fade !== this._subFade) {
      this._subFade = fade;
      for (const m of this.sub.userData.mats) { m.transparent = fade < 1 || m.userData.baseTransparent; if (m.userData.baseOpacity === undefined) { m.userData.baseOpacity = m.opacity; m.userData.baseTransparent = m.transparent && fade >= 1; } m.opacity = m.userData.baseOpacity * fade; m.depthWrite = fade >= 1; }
    }

    // lights: headlights on the gimbal direction, flood on the hull axis
    const { axis, right } = axes(rs.yaw, rs.pitch);
    const nose = new THREE.Vector3(...rs.pos).addScaledVector(new THREE.Vector3(...axis), SUB.halfLen + 0.4);
    const aim = new THREE.Vector3(...sim.aimDir);
    for (const s of this.heads) {
      s.position.copy(nose).addScaledVector(new THREE.Vector3(...right), s.userData.sx * 0.9).y -= 0.3;
      s.target.position.copy(s.position).addScaledVector(aim, 30);
    }
    this.flood.position.copy(nose);
    this.flood.target.position.copy(nose).addScaledVector(new THREE.Vector3(...axis), 10);
    this.hullLight.position.set(rs.pos[0], rs.pos[1] + 2.2, rs.pos[2]);
    this.hullLight.intensity = cockpit ? 0 : 6;
    this.fill.position.set(rig.pos[0], rig.pos[1] + 1.5, rig.pos[2]);
    this.fill.intensity = cockpit ? 2 : 5;
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT * 900;

    // sonar ring
    const sa = t - (this._sonarStart ?? -99);
    const R = sa * SONAR.speed;
    this.rockUniforms.uSonarR.value = R;
    this.rockUniforms.uSonarA.value = R < SONAR.range ? 1 : Math.max(0, 1 - (sa - SONAR.range / SONAR.speed) / 1.6);

    // entities
    this._entities(sim, dt, t, rs);
    // membrane dissolves once the seal breaks
    if (this.membrane) {
      if (sim.flags.has("sealBroken")) this.membraneFade = Math.max(0, this.membraneFade - dt * 0.8);
      this.membrane.visible = this.membraneFade > 0.01;
      this.membrane.scale.setScalar(0.3 + 0.7 * this.membraneFade);
      this.membrane.position.y = this.level.seal.pos[1] + Math.sin(t * 1.4) * 0.12;
    }
    // kelp sway (cheap: whole instanced mesh breathes)
    if (this.kelp && !opts.reducedMotion) this.kelp.rotation.y = Math.sin(t * 0.3) * 0.002;

    // camera
    const cam = this.camera;
    cam.position.set(...rig.pos);
    if (rig.shake > 0 && !opts.reducedMotion && opts.shake) {
      const k = rig.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * k; cam.position.y += (Math.random() - 0.5) * k;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(rig.look[0], rig.look[1], rig.look[2]);
    cam.rotateZ(-rig.roll);
    const fov = cockpit ? opts.fov + (CAMERA.cockpitFov - CAMERA.fov) : opts.fov;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.near = cockpit ? 0.05 : 0.08;

    this.fx.update(dt, t, cam, rs, opts);
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, cam);
  }

  _entities(sim, dt, t, rs) {
    const sp = rs.pos;
    let active = 0;
    for (const [, v] of this.entityViews) {
      const { obj, e } = v;
      const d = Math.hypot(e.pos[0] - sp[0], e.pos[1] - sp[1], e.pos[2] - sp[2]);
      const alive = e.alive || e.state === "telling";
      if (!alive) {
        if (v.deathT < 0 && (e.state === "dead" || e.state === "taken")) v.deathT = 0;
        if (v.deathT >= 0) { v.deathT += dt; const k = Math.max(0, 1 - v.deathT * 4); obj.scale.setScalar(k * (e.type === "warden" ? 1 : 1)); obj.visible = k > 0.01; }
        else obj.visible = false;
        continue;
      }
      obj.visible = d < 150;
      if (!obj.visible) continue;
      active++;
      obj.scale.setScalar(1);
      switch (e.type) {
        case "salvage": case "relic": case "repair": case "recorder":
          obj.position.set(e.pos[0], e.pos[1] + Math.sin(t * 1.5 + e.phase) * 0.25, e.pos[2]);
          obj.rotation.y += dt * (e.type === "relic" ? 1.2 : 0.5);
          break;
        case "mine": {
          obj.position.set(e.pos[0], e.pos[1] + Math.sin(t * 0.8 + e.phase) * 0.2, e.pos[2]);
          const core = obj.userData.core;
          const arming = e.state === "arming";
          const blink = arming ? (Math.sin(t * (10 + (1.5 - e.timer) * 18)) > 0 ? 1 : 0.25) : 0.35 + 0.15 * Math.sin(t * 2 + e.phase);
          core.material.color.setRGB(1, arming ? 0.25 : 0.2, 0.08).multiplyScalar(blink * 1.6);
          core.scale.setScalar(arming ? 0.95 + (1.5 - e.timer) * 0.35 : 0.85);
          obj.rotation.y += dt * 0.3;
          break;
        }
        case "lurker": case "warden": this._eelView(v, e, t); break;
        case "shade": {
          obj.position.set(...e.pos);
          const frozen = e.state === "frozen";
          const u = obj.userData;
          const sp2 = [sp[0] - e.pos[0], sp[1] - e.pos[1], sp[2] - e.pos[2]];
          obj.rotation.y = Math.atan2(-sp2[0], -sp2[2]);
          u.veil.scale.set(1 + Math.sin(t * (frozen ? 30 : 3) + e.phase) * (frozen ? 0.05 : 0.18), 1, 1);
          u.veil.material.color.setHex(frozen ? 0xe8dcff : e.state === "stalk" ? 0xb070ff : 0x7c5acc);
          u.veil.material.opacity = frozen ? 0.8 : 0.5;
          u.inner.material.opacity = frozen ? 0.9 : 0.45;
          break;
        }
        case "seal": {
          obj.position.set(...e.pos);
          const k = 1 + Math.sin(t * 3 + e.phase) * 0.08;
          obj.userData.core.scale.setScalar(k * (0.6 + 0.1 * e.hp));
          obj.rotation.y += dt * 0.4;
          break;
        }
        case "boulder":
          obj.position.set(...e.pos); obj.rotation.x += dt * 1.3; obj.rotation.z += dt * 0.7;
          obj.visible = e.state === "falling";
          break;
      }
    }
    this.activeEntities = active;
  }

  _eelView(v, e, t) {
    const { obj } = v, u = obj.userData;
    obj.position.set(0, 0, 0);
    u.head.position.set(...e.pos);
    const d = e.dir;
    u.head.lookAt(e.pos[0] - d[0], e.pos[1] - d[1], e.pos[2] - d[2]);
    const tell = e.state === "tell", rec = e.state === "recover";
    u.jaw.rotation.x = tell ? -0.4 - Math.sin(t * 20) * 0.08 : e.state === "lunge" ? -0.55 : -0.05;
    for (const eye of u.eyes) {
      eye.material.color.setHex(tell || e.state === "lunge" ? 0xff2a10 : rec ? 0x7fffe0 : 0xffb020);
      eye.scale.setScalar(tell ? 1.6 + Math.sin(t * 25) * 0.3 : rec ? 1.3 : 1);
    }
    let prev = e.pos;
    u.segs.forEach((m, k) => {
      const s = e.segs[k];
      const wig = Math.sin(t * 5 - k * 0.7 + e.phase) * 0.25 * (e.state === "patrol" ? 1 : 0.4);
      m.position.set(s[0] + wig * 0.3, s[1] + wig, s[2]);
      m.lookAt(prev[0], prev[1], prev[2]);
      prev = s;
    });
  }

  sonarPulse(pos) { this.rockUniforms.uSonarO.value.set(...pos); this._sonarStart = this.clock; }
  muzzleFlash() { this.flashT = Math.max(this.flashT, 0.08); }
  bigFlash(p) { this.flash.position.set(...p); this.flashT = 0.35; }

  info() {
    const i = this.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, dpr: this.dpr, chunks: this.chunks.length, entities: this.activeEntities || 0 };
  }
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
