// ============================================================
//  cake3d.js — procedural 3D cheesecake (Three.js 0.160.0)
//  Public API:
//    const cake = createCake(canvas);
//    cake.update(spec);      // live rebuild (only what changed)
//    cake.resetCamera();
//    cake.snapshot() -> dataURL (PNG)
//    cake.resize();
//    cake.dispose();
//  spec = {
//    shape:'round'|'square'|'heart', view:'whole'|'slice',
//    layers:[ {key, ing, kind, color, height} ],   // active, bottom->top
//    decorations:[ 'strawberries', ... ]
//  }
// ============================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ---- shape constants (cake footprint) ----
const R   = 1.35;          // round radius
const SQ  = 2.45;          // square full side
const PLATE_H = 0.14;
const SLICE_WEDGE = THREE.MathUtils.degToRad(66);  // size of the single slice wedge
const SLICE_BIS   = Math.atan2(3.7, 5.2);          // wedge bisector aimed at default camera azimuth

const isMobile = matchMedia("(max-width:720px)").matches;

// ------------------------------------------------------------
//  Procedural textures (built once, reused)
// ------------------------------------------------------------
function noiseTexture(size, contrast){
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  for(let i=0;i<img.data.length;i+=4){
    let v = Math.random();
    v = 0.5 + (v - 0.5) * contrast;
    const g = Math.max(0, Math.min(255, v*255));
    img.data[i]=img.data[i+1]=img.data[i+2]=g; img.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// chunky crumb texture — scattered grains for a granular, crumbly crust.
// used as BOTH albedo (multiplies crust colour → speckles) and bump (height).
function crumbTexture(size){
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#9a9a9a"; ctx.fillRect(0,0,size,size);   // mid base
  const grains = Math.floor(size*size/14);
  for(let i=0;i<grains;i++){
    const px = Math.random()*size, py = Math.random()*size;
    const r = 0.8 + Math.random()*(size/26);
    const g = Math.floor(95 + Math.random()*150);           // 95..245
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// soft cloud texture — low-frequency mottling so cream isn't a flat plastic disc
function cloudTexture(size){
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#cfcfcf"; ctx.fillRect(0,0,size,size);
  for(let i=0;i<44;i++){
    const px = Math.random()*size, py = Math.random()*size, r = size*(0.08+Math.random()*0.22);
    const g = Math.floor(150 + Math.random()*105);
    const grd = ctx.createRadialGradient(px,py,0,px,py,r);
    grd.addColorStop(0, `rgba(${g},${g},${g},0.5)`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const CRUMB = crumbTexture(256); CRUMB.repeat.set(5,3);
const CLOUD = cloudTexture(256); CLOUD.repeat.set(2,2);
const SILK  = noiseTexture(128, 0.5); SILK.repeat.set(2,2);

// ------------------------------------------------------------
//  Materials (data-driven by layer.kind + layer.color)
// ------------------------------------------------------------
function buildMaterial(kind, colorHex){
  const color = new THREE.Color(colorHex);
  switch(kind){
    case "crust":
      return new THREE.MeshStandardMaterial({
        color, roughness:1.0, metalness:0,
        bumpMap:CRUMB, bumpScale:0.16,   // pronounced crumbly relief
        roughnessMap:CRUMB,              // grains catch light unevenly → granular read
        envMapIntensity:0.3,
      });
    case "cream":
      return new THREE.MeshPhysicalMaterial({
        color, roughness:0.5, metalness:0,
        clearcoat:0.2, clearcoatRoughness:0.4,
        sheen:0.6, sheenRoughness:0.6, sheenColor:new THREE.Color(0xfff6ee),
        bumpMap:CLOUD, bumpScale:0.022,  // soft surface undulation
        roughnessMap:CLOUD,              // mottled sheen → not a flat plastic disc
        envMapIntensity:0.6,
      });
    case "fruit": // glossy fruit topping with berry bumps
      return new THREE.MeshPhysicalMaterial({
        color, roughness:0.16, metalness:0,
        clearcoat:1, clearcoatRoughness:0.08,
        transmission:0.10, thickness:0.6, ior:1.4,
        bumpMap:SILK, bumpScale:0.025,
        envMapIntensity:1.3, attenuationColor:color, attenuationDistance:1.2,
      });
    case "gloss": // jelly / glaze — wet, mirror-ish sheen
    default:
      return new THREE.MeshPhysicalMaterial({
        color, roughness:0.08, metalness:0,
        clearcoat:1, clearcoatRoughness:0.04,
        transmission:0.14, thickness:0.7, ior:1.45,
        specularIntensity:1, envMapIntensity:2.0,
        attenuationColor:color, attenuationDistance:1.0,
      });
  }
}

// ------------------------------------------------------------
//  Geometry helpers
// ------------------------------------------------------------
function heartShape(){
  const s = new THREE.Shape();
  const x=0, y=0;
  s.moveTo(x+0.25, y+0.25);
  s.bezierCurveTo(x+0.25, y+0.25, x+0.20, y,     x,       y);
  s.bezierCurveTo(x-0.30, y,      x-0.30, y+0.35, x-0.30, y+0.35);
  s.bezierCurveTo(x-0.30, y+0.55, x-0.10, y+0.77, x+0.25, y+0.95);
  s.bezierCurveTo(x+0.60, y+0.77, x+0.80, y+0.55, x+0.80, y+0.35);
  s.bezierCurveTo(x+0.80, y+0.35, x+0.80, y,      x+0.50, y);
  s.bezierCurveTo(x+0.30, y,      x+0.25, y+0.25, x+0.25, y+0.25);
  return s;
}

function heartGeometry(h){
  const g = new THREE.ExtrudeGeometry(heartShape(), {
    depth:h, bevelEnabled:true, bevelThickness:0.03, bevelSize:0.03, bevelSegments:2, steps:1,
  });
  g.rotateX(-Math.PI/2);   // lay flat: extrusion along -Y
  g.center();              // center all axes
  const SC = 2.7;          // scale footprint to ~round size
  g.scale(SC, 1, SC);
  return g;
}

// custom flat radial cap for round slice cross-section
function radialCap(theta, h){
  const ex = R*Math.sin(theta), ez = R*Math.cos(theta);
  const yT=h/2, yB=-h/2;
  const pos = new Float32Array([
    0,yB,0,  ex,yB,ez,  ex,yT,ez,
    0,yB,0,  ex,yT,ez,  0,yT,0,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos,3));
  g.computeVertexNormals();
  return g;
}

// returns array of { geom, doubleSided } for one layer
function layerGeometries(shape, view, h){
  const slice = view === "slice";
  const eff = (slice && shape === "heart") ? "round" : shape; // heart slice -> round fallback
  if(!slice){
    if(eff === "square") return [{ geom:new THREE.BoxGeometry(SQ, h, SQ) }];
    if(eff === "heart")  return [{ geom:heartGeometry(h) }];
    return [{ geom:new THREE.CylinderGeometry(R, R, h, 80, 1) }];
  }
  // ---- slice view: render a SINGLE slice sitting on the plate ----
  if(eff === "square"){
    // a single square slice (small block), centred on the plate
    const s = SQ*0.46;
    return [{ geom:new THREE.BoxGeometry(s, h, s) }];
  }
  // round (and heart fallback): one wedge, point toward the camera, both cut faces capped
  const tStart = SLICE_BIS - SLICE_WEDGE/2, tLen = SLICE_WEDGE;
  const cyl = new THREE.CylinderGeometry(R, R, h, 80, 1, false, tStart, tLen);
  return [
    { geom:cyl },
    { geom:radialCap(tStart, h),        doubleSided:true },
    { geom:radialCap(tStart+tLen, h),   doubleSided:true },
  ];
}

// ------------------------------------------------------------
//  Decoration props
// ------------------------------------------------------------
const matCache = {};
function m(key, factory){ return matCache[key] || (matCache[key]=factory()); }

function strawberry(){
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.15, 2),
    m("straw", ()=>new THREE.MeshPhysicalMaterial({
      color:0xe11f3a, roughness:0.22, clearcoat:0.9, clearcoatRoughness:0.1,
      bumpMap:SILK, bumpScale:0.01, envMapIntensity:1.2 })));
  body.scale.set(1, 1.35, 1); body.position.y = 0.16; body.castShadow = true;
  g.add(body);
  const calyx = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.05, 5),
    m("leaf", ()=>new THREE.MeshStandardMaterial({ color:0x3f9b46, roughness:0.6 })));
  calyx.position.y = 0.3; g.add(calyx);
  return g;
}

function raspberries(){
  const g = new THREE.Group();
  const mat = m("rasp", ()=>new THREE.MeshPhysicalMaterial({
    color:0xc23b63, roughness:0.3, clearcoat:0.7, envMapIntensity:1.1 }));
  for(let i=0;i<7;i++){
    const a = i/7*Math.PI*2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat);
    b.position.set(Math.cos(a)*0.07, 0.07+(i%2)*0.03, Math.sin(a)*0.07);
    g.add(b);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.055,10,8), mat);
  cap.position.y = 0.13; g.add(cap);
  g.children.forEach(c=>c.castShadow = true);
  return g;
}

function whippedCream(){
  // piped rosette via lathe of a scalloped profile
  const pts = [];
  for(let i=0;i<=10;i++){
    const t = i/10;
    const r = (1-t)*0.18 * (0.85 + 0.15*Math.cos(t*Math.PI*5));
    pts.push(new THREE.Vector2(Math.max(r,0.001), t*0.42));
  }
  const geo = new THREE.LatheGeometry(pts, 24);
  const mesh = new THREE.Mesh(geo, m("cream-deco", ()=>new THREE.MeshPhysicalMaterial({
    color:0xfff8f0, roughness:0.45, clearcoat:0.25, sheen:0.6, envMapIntensity:0.7 })));
  mesh.castShadow = true;
  return mesh;
}

function mintLeaves(){
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0,0); shape.quadraticCurveTo(0.09,0.06, 0,0.22);
  shape.quadraticCurveTo(-0.09,0.06, 0,0);
  const geo = new THREE.ExtrudeGeometry(shape,{depth:0.02,bevelEnabled:false});
  const mat = m("mint", ()=>new THREE.MeshPhysicalMaterial({
    color:0x3aa14b, roughness:0.35, clearcoat:0.6, envMapIntensity:0.9 }));
  for(let i=0;i<3;i++){
    const leaf = new THREE.Mesh(geo, mat);
    leaf.rotation.x = -Math.PI/2.4; leaf.rotation.z = i*2.1;
    leaf.castShadow = true; g.add(leaf);
  }
  return g;
}

function lemonSlice(){
  const g = new THREE.Group();
  const rind = new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,0.035,28),
    m("lem-r", ()=>new THREE.MeshPhysicalMaterial({ color:0xf2c20e, roughness:0.4, clearcoat:0.7 })));
  const flesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.04,28),
    m("lem-f", ()=>new THREE.MeshPhysicalMaterial({ color:0xfbe27a, roughness:0.25, clearcoat:0.9, transmission:0.2, thickness:0.2 })));
  g.add(rind, flesh);
  g.rotation.x = Math.PI/2.6; g.position.y = 0.1;
  g.children.forEach(c=>c.castShadow = true);
  return g;
}

function nuts(){
  const g = new THREE.Group();
  const mat = m("nut", ()=>new THREE.MeshStandardMaterial({ color:0xb3793f, roughness:0.7, bumpMap:CRUMB, bumpScale:0.01 }));
  for(let i=0;i<4;i++){
    const n = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07,0), mat);
    const a = i/4*Math.PI*2;
    n.position.set(Math.cos(a)*0.1, 0.06, Math.sin(a)*0.1);
    n.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    n.scale.set(1,0.7,1.1); n.castShadow = true; g.add(n);
  }
  return g;
}

function chocCurls(){
  const g = new THREE.Group();
  const mat = m("choc", ()=>new THREE.MeshPhysicalMaterial({
    color:0x4a2c18, roughness:0.25, clearcoat:0.8, metalness:0.05, envMapIntensity:0.9 }));
  for(let k=0;k<2;k++){
    const curve = new THREE.CatmullRomCurve3(
      Array.from({length:8},(_,i)=>{
        const t=i/7, a=t*Math.PI*3;
        return new THREE.Vector3(Math.cos(a)*0.07, t*0.22, Math.sin(a)*0.07);
      }));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.025, 8, false), mat);
    tube.position.x = (k?-0.06:0.06); tube.castShadow = true; g.add(tube);
  }
  return g;
}

const DECO_BUILDERS = {
  strawberries: strawberry, raspberries, whippedCream, mintLeaves,
  lemonSlice, nuts, chocCurls,
};

// ------------------------------------------------------------
//  Main factory
// ------------------------------------------------------------
export function createCake(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const CAM_HOME = new THREE.Vector3(3.7, 3.1, 5.2);   // pulled back so it doesn't fill the frame
  camera.position.copy(CAM_HOME);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 3; controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI*0.52;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
  controls.target.set(0, 1.0, 0);
  let idleTimer = null;
  controls.addEventListener("start", ()=>{ controls.autoRotate=false; clearTimeout(idleTimer); });
  controls.addEventListener("end",   ()=>{ idleTimer=setTimeout(()=>controls.autoRotate=true, 2800); });

  // environment reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // lighting
  const key = new THREE.DirectionalLight(0xfff3e6, 2.3);
  key.position.set(4, 6.5, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024,1024);
  key.shadow.camera.near = 1; key.shadow.camera.far = 20;
  key.shadow.camera.left=-4; key.shadow.camera.right=4; key.shadow.camera.top=4; key.shadow.camera.bottom=-4;
  key.shadow.bias = -0.0005; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe8eeff, 0.7); fill.position.set(-5,2,-1); scene.add(fill);
  const rim  = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-2,3,-5); scene.add(rim);
  // front-top "glint" — lands a specular hotspot on glossy tops toward the camera
  const glint = new THREE.DirectionalLight(0xffffff, 1.4); glint.position.set(1.5, 7, 5.5); scene.add(glint);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xece6f6, 0.55));

  // shadow-catcher ground (transparent except for shadow)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40,40),
    new THREE.ShadowMaterial({ opacity:0.22 }));
  ground.rotation.x = -Math.PI/2; ground.position.y = 0.001; ground.receiveShadow = true;
  scene.add(ground);

  // soft contact-shadow halo — a baked radial gradient disc that grounds the plate
  // with depth even where the directional shadow is faint.
  function haloTexture(){
    const s=256, c=document.createElement("canvas"); c.width=c.height=s;
    const ctx=c.getContext("2d");
    const grd=ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
    grd.addColorStop(0,"rgba(70,50,110,0.32)");
    grd.addColorStop(0.55,"rgba(70,50,110,0.16)");
    grd.addColorStop(1,"rgba(70,50,110,0)");
    ctx.fillStyle=grd; ctx.fillRect(0,0,s,s);
    return new THREE.CanvasTexture(c);
  }
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(R*6, R*6),
    new THREE.MeshBasicMaterial({ map:haloTexture(), transparent:true, depthWrite:false, opacity:0.9 }));
  halo.rotation.x = -Math.PI/2; halo.position.y = 0.002; scene.add(halo);

  // plate (always round, ceramic)
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(R*1.95, R*2.05, PLATE_H, 64),
    new THREE.MeshPhysicalMaterial({ color:0xffffff, roughness:0.28, clearcoat:0.7, clearcoatRoughness:0.2, envMapIntensity:0.8 }));
  plate.position.y = PLATE_H/2; plate.receiveShadow = true; plate.castShadow = true;
  scene.add(plate);
  const PLATE_TOP = PLATE_H;

  // cake root group
  const cakeRoot = new THREE.Group();
  scene.add(cakeRoot);
  let decoGroup = new THREE.Group();
  cakeRoot.add(decoGroup);

  // per-layer registry: key -> { group, sig }
  const layers = {};
  let lastShape = null, lastView = null, lastDecoSig = "";

  function disposeGroup(grp){
    grp.traverse(o=>{
      if(o.geometry) o.geometry.dispose();
      if(o.material){
        const mats = Array.isArray(o.material)?o.material:[o.material];
        // don't dispose shared deco materials (matCache) or shared textures
        mats.forEach(mt=>{ if(!mt.userData.shared) mt.dispose(); });
      }
    });
  }

  function buildLayerGroup(L, shape, view){
    const grp = new THREE.Group();
    const base = buildMaterial(L.kind, L.color);
    const pieces = layerGeometries(shape, view, L.height);
    pieces.forEach(p=>{
      let mat = base;
      if(p.doubleSided){ mat = base.clone(); mat.side = THREE.DoubleSide; }
      const mesh = new THREE.Mesh(p.geom, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      grp.add(mesh);
    });
    return grp;
  }

  // ---------------- public update ----------------
  function update(spec){
    const shape = spec.shape, view = spec.view;
    const structuralChange = (shape!==lastShape) || (view!==lastView);

    const activeKeys = spec.layers.map(l=>l.key);

    // remove layers no longer present
    Object.keys(layers).forEach(k=>{
      if(!activeKeys.includes(k)){
        cakeRoot.remove(layers[k].group); disposeGroup(layers[k].group); delete layers[k];
      }
    });

    // build / rebuild changed layers
    spec.layers.forEach(L=>{
      const sig = `${L.ing}|${L.height.toFixed(3)}|${shape}|${view}`;
      const existing = layers[L.key];
      if(existing && existing.sig===sig && !structuralChange) return;
      if(existing){ cakeRoot.remove(existing.group); disposeGroup(existing.group); }
      const group = buildLayerGroup(L, shape, view);
      cakeRoot.add(group);
      layers[L.key] = { group, sig };
    });

    // stack vertical positioning (bottom -> top)
    let y = PLATE_TOP, total = 0;
    spec.layers.forEach(L=>{
      const grp = layers[L.key].group;
      grp.position.y = y + L.height/2;
      y += L.height; total += L.height;
    });
    const topY = PLATE_TOP + total;

    // decorations: rebuild when set or top position changed
    const decoSig = spec.decorations.slice().sort().join(",") + "|" + topY.toFixed(2) + "|" + shape + "|" + view;
    if(decoSig !== lastDecoSig){
      cakeRoot.remove(decoGroup); disposeGroup(decoGroup);
      decoGroup = buildDecorations(spec.decorations, topY, view);
      cakeRoot.add(decoGroup);
      lastDecoSig = decoSig;
    }

    // reframe target to stack mid-height
    controls.target.y = PLATE_TOP + total*0.5;

    lastShape = shape; lastView = view;
  }

  const DECO_SCALE = 1.85;     // larger props that sit boldly on top
  function buildDecorations(list, topY, view){
    const g = new THREE.Group();
    if(!list.length) return g;
    const sinkY = topY - 0.04;   // nestle slightly into the surface so they rest, not float
    list.forEach((id, i)=>{
      const builder = DECO_BUILDERS[id];
      if(!builder) return;
      const prop = builder();
      prop.scale.setScalar(DECO_SCALE);
      let x, z;
      if(view === "slice"){
        // cluster on top of the single slice, along its bisector (uses cylinder's sin/cos axes)
        const a = SLICE_BIS + (i - (list.length-1)/2) * 0.26;
        const rr = R*0.42;
        x = Math.sin(a)*rr; z = Math.cos(a)*rr;
      } else {
        // ring around the top of the whole cake
        const a = (i - (list.length-1)/2) * 1.05;
        const rr = list.length===1 ? 0 : R*0.5;
        x = Math.cos(a)*rr; z = Math.sin(a)*rr;
      }
      prop.position.set(x, sinkY, z);
      g.add(prop);
    });
    return g;
  }

  // ---------------- camera / sizing ----------------
  function resetCamera(){
    camera.position.copy(CAM_HOME);
    controls.update();
  }

  function resize(){
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w/h; camera.updateProjectionMatrix();
  }

  function snapshot(){
    renderer.render(scene, camera);   // ensure fresh frame
    return canvas.toDataURL("image/png");
  }

  // ---------------- render loop ----------------
  let running = true;
  function loop(){
    if(!running) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  loop();

  function dispose(){
    running = false; ro.disconnect();
    clearTimeout(idleTimer);
    Object.values(layers).forEach(l=>disposeGroup(l.group));
    disposeGroup(decoGroup);
    pmrem.dispose();
    renderer.dispose();
  }

  return { update, resetCamera, resize, snapshot, dispose, get controls(){return controls;} };
}
