/* =================================================================
   films3d.js — real-time floating 3D film objects (Three.js, vanilla)
   One lightweight WebGL viewer per film node, created lazily when the
   node nears the viewport and rendered only while it's on screen.
   Locked "alien" lighting recipe applied to all (see 3d-recipe.md).
   Graceful fallback: no-WebGL → static poster image.
   ================================================================= */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// --- Locked recipe (from the alien tuning) ------------------------
const RECIPE = {
  rimColor: 0xff4d00,
  rimPower: 2.5,
  rimAz: -39,        // degrees
  rimEl: 27,         // degrees
  bottom: 1,         // bottom kicker intensity
  key: 0.8,          // cool front fill
  metalness: 0.35,
  roughness: 0.45,
  env: 0.7,          // envMapIntensity
  spin: 0.1,         // OrbitControls autoRotateSpeed
  floatAmp: 0.06,
  floatHz: 0.8,
  fit: 1.6,          // model fits to this many world units
};

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglOK() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext &&
      (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (e) { return false; }
}

const nodes = Array.from(document.querySelectorAll(".film[data-glb]"));
if (!nodes.length) { /* nothing to do */ }
else if (!webglOK()) {
  nodes.forEach((n) => n.classList.add("film--poster")); // static image fallback
} else {
  const loader = new GLTFLoader();
  // Draco decoder, in case any GLB ships Draco-compressed geometry.
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/");
  loader.setDRACOLoader(draco);
  const viewers = new Map();   // node -> viewer

  function placeRim(light) {
    const az = RECIPE.rimAz * Math.PI / 180;
    const el = RECIPE.rimEl * Math.PI / 180;
    const R = 3.6;
    light.position.set(
      R * Math.cos(el) * Math.sin(az),
      R * Math.sin(el),
      R * Math.cos(el) * Math.cos(az)
    );
  }

  function makeViewer(node) {
    const mount = node.querySelector(".film__viewer");
    const w = mount.clientWidth || 1, h = mount.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);
    camera.position.set(0, 0, 3.2);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const key = new THREE.DirectionalLight(0xcad6ff, RECIPE.key);
    key.position.set(-2, 2.5, 3);
    const rim = new THREE.DirectionalLight(RECIPE.rimColor, RECIPE.rimPower);
    placeRim(rim);
    const rim2 = new THREE.PointLight(RECIPE.rimColor, RECIPE.bottom, 20, 2);
    rim2.position.set(1.5, -1.2, -2);
    scene.add(key, rim, rim2, new THREE.AmbientLight(0x404048, 0.4));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = RECIPE.spin;

    const v = { node, mount, renderer, scene, camera, controls, pivot: null, ready: false, visible: true };

    loader.load(node.dataset.glb, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.scale.setScalar(RECIPE.fit / Math.max(size.x, size.y, size.z));
      model.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material.metalness = RECIPE.metalness;
          o.material.roughness = RECIPE.roughness;
          o.material.envMapIntensity = RECIPE.env;
        }
      });
      const pivot = new THREE.Group();
      pivot.add(model);
      scene.add(pivot);
      v.pivot = pivot;
      v.ready = true;
      node.classList.add("is-3d-ready");
    }, undefined, (err) => {
      console.error("GLB load failed:", node.dataset.glb, err);
      node.classList.add("film--poster"); // fall back to the still image
    });

    return v;
  }

  function sizeViewer(v) {
    const w = v.mount.clientWidth, h = v.mount.clientHeight;
    if (!w || !h) return;
    v.renderer.setSize(w, h);
    v.camera.aspect = w / h;
    v.camera.updateProjectionMatrix();
  }

  // Create lazily when near; keep alive (5 small contexts is fine), render only visible.
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const node = e.target;
      if (e.isIntersecting && !viewers.has(node)) {
        const v = makeViewer(node);
        viewers.set(node, v);
        sizeViewer(v);
      }
      const v = viewers.get(node);
      if (v) v.visible = e.isIntersecting;
    });
  }, { rootMargin: "300px 0px 300px 0px", threshold: 0 });
  nodes.forEach((n) => io.observe(n));

  // Single render loop drives all visible viewers.
  const clock = new THREE.Clock();
  function tick() {
    const t = clock.getElapsedTime();
    viewers.forEach((v) => {
      if (!v.visible || !v.ready) return;
      if (v.pivot && !reduce) v.pivot.position.y = Math.sin(t * RECIPE.floatHz) * RECIPE.floatAmp;
      v.controls.update();
      v.renderer.render(v.scene, v.camera);
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  let resizeRAF = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => viewers.forEach(sizeViewer));
  }, { passive: true });
}
