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
  floatAmp: 0.06,
  floatHz: 0.8,
  fit: 0.8,          // model fits to this many world units (half-size)
  scrollRot: 0.0014, // radians of spin per pixel scrolled (down = +, up = −)
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
    controls.autoRotate = false;   // motion comes from scroll (+ drag), not auto-spin

    const v = { node, mount, renderer, scene, camera, controls, pivot: null, model: null, heroY: 0, ready: false, visible: true };

    loader.load(node.dataset.glb, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      // per-node size override via data-scale (e.g. "0.5" = half size); default 1
      const userScale = parseFloat(node.dataset.scale || "1") || 1;
      model.scale.setScalar((RECIPE.fit * userScale) / Math.max(size.x, size.y, size.z));
      model.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material.metalness = RECIPE.metalness;
          o.material.roughness = RECIPE.roughness;
          o.material.envMapIntensity = RECIPE.env;
        }
      });
      const d2r = Math.PI / 180;
      // static tilt on the pivot (data-rotx / data-rotz); the "hero" facing angle
      // (data-roty) lives on the inner model so scroll can spin from it and we can
      // reset to it each time the node re-enters view (deterministic first sight).
      const heroY = (parseFloat(node.dataset.roty) || 0) * d2r;
      const pivot = new THREE.Group();
      pivot.rotation.set(
        (parseFloat(node.dataset.rotx) || 0) * d2r,
        0,
        (parseFloat(node.dataset.rotz) || 0) * d2r
      );
      model.rotation.y = heroY;
      pivot.add(model);
      scene.add(pivot);
      v.pivot = pivot;
      v.model = model;       // scroll spins the inner model on its own Y axis
      v.heroY = heroY;
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
      if (v) {
        // reset to the hero facing angle each time it (re)enters view
        if (e.isIntersecting && v.ready && v.model) v.model.rotation.y = v.heroY;
        v.visible = e.isIntersecting;
      }
    });
  }, { rootMargin: "300px 0px 300px 0px", threshold: 0 });
  nodes.forEach((n) => io.observe(n));

  // Debug: add ?rot to the URL to show a live "data-roty" readout for the
  // centred object — scroll/drag it to the look you want and read the number.
  const DEBUG_ROT = new URLSearchParams(location.search).has("rot");
  let dbgEl = null;
  if (DEBUG_ROT) {
    dbgEl = document.createElement("div");
    dbgEl.style.cssText = "position:fixed;top:12px;right:12px;z-index:9999;background:rgba(0,0,0,.85);color:#FF4D00;font:12px ui-monospace,monospace;padding:8px 10px;border:1px solid #333;border-radius:6px;white-space:pre;pointer-events:none";
    document.body.appendChild(dbgEl);
  }

  // Single render loop drives all visible viewers.
  const clock = new THREE.Clock();
  let lastScrollY = window.scrollY;
  function tick() {
    const t = clock.getElapsedTime();
    // scroll delta this frame → spin objects (down = one way, up = the other)
    const sy = window.scrollY;
    const scrollDelta = sy - lastScrollY;
    lastScrollY = sy;
    viewers.forEach((v) => {
      if (!v.visible || !v.ready) return;
      if (!reduce) {
        if (v.pivot) v.pivot.position.y = Math.sin(t * RECIPE.floatHz) * RECIPE.floatAmp;
        if (v.model && scrollDelta) v.model.rotation.y += scrollDelta * RECIPE.scrollRot;
      }
      v.controls.update();
      v.renderer.render(v.scene, v.camera);
    });

    if (DEBUG_ROT) {
      // pick the most-centred visible viewer and report its equivalent data-roty
      const vh = window.innerHeight;
      let best = null, bestDist = Infinity;
      viewers.forEach((v) => {
        if (!v.visible || !v.ready) return;
        const r = v.node.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - vh / 2);
        if (d < bestDist) { bestDist = d; best = v; }
      });
      if (best) {
        const deg = Math.round(((best.model.rotation.y + best.controls.getAzimuthalAngle()) * 180 / Math.PI) % 360);
        dbgEl.textContent = best.node.dataset.film + '\ndata-roty="' + deg + '"';
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  let resizeRAF = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => viewers.forEach(sizeViewer));
  }, { passive: true });
}
