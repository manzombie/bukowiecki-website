// ============================================================
//  app.js — state, controls, live wiring, summary, save/share
// ============================================================
import { createCake } from "./cake3d.js";
import * as Recipe from "./recipe.js";

// ---- inline themeable SVG chip icons (inherit currentColor) ----
const I = (inner) => `<svg class="ico" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  graham:    I(`<rect x="6" y="10" width="20" height="12" rx="3"/><circle cx="12" cy="16" r="1"/><circle cx="20" cy="16" r="1"/><circle cx="16" cy="14" r="1"/>`),
  biscuit:   I(`<circle cx="16" cy="16" r="9"/><circle cx="13" cy="14" r="1"/><circle cx="19" cy="15" r="1"/><circle cx="16" cy="19" r="1"/>`),
  oreo:      I(`<circle cx="16" cy="16" r="9"/><line x1="7" y1="16" x2="25" y2="16"/>`),
  brownie:   I(`<rect x="7" y="9" width="18" height="14" rx="2"/><line x1="11" y1="9" x2="11" y2="23"/><line x1="16" y1="9" x2="16" y2="23"/>`),
  nut:       I(`<path d="M16 7c5 3 5 15 0 18-5-3-5-15 0-18z"/>`),
  vanilla:   I(`<path d="M16 6v20"/><path d="M16 11c-3-2-6 0-6 0M16 16c3-2 6 0 6 0M16 21c-3-2-6 0-6 0"/>`),
  strawberry:I(`<path d="M16 27c-5-2-8-7-8-11 4-2 12-2 16 0 0 4-3 9-8 11z"/><path d="M12 13l4-5 4 5"/>`),
  lemon:     I(`<ellipse cx="16" cy="16" rx="10" ry="7"/><line x1="16" y1="9" x2="16" y2="23"/><line x1="9" y1="16" x2="23" y2="16"/>`),
  chocolate: I(`<rect x="7" y="10" width="18" height="12" rx="2"/><line x1="13" y1="10" x2="13" y2="22"/><line x1="19" y1="10" x2="19" y2="22"/><line x1="7" y1="16" x2="25" y2="16"/>`),
  raspberry: I(`<circle cx="13" cy="15" r="3"/><circle cx="19" cy="15" r="3"/><circle cx="16" cy="20" r="3"/><path d="M16 12l-2-4 2 1 2-1z"/>`),
  none:      I(`<circle cx="16" cy="16" r="9"/><line x1="10" y1="22" x2="22" y2="10"/>`),
  jelly:     I(`<path d="M16 6c4 6 7 9 7 13a7 7 0 1 1-14 0c0-4 3-7 7-13z"/>`),
  mousse:    I(`<path d="M8 18c0-4 4-7 8-7s8 3 8 7"/><path d="M8 18c2 4 14 4 16 0"/><path d="M14 11c0-2 4-2 4 0"/>`),
  glaze:     I(`<path d="M7 12h18v3c-2 2-4 0-6 2s-4 0-6 2-4 0-6-2z"/>`),
  fruit:     I(`<circle cx="12" cy="19" r="4"/><circle cx="20" cy="19" r="4"/><path d="M12 15c0-5 4-7 8-8"/>`),
  // decorations
  whippedCream:I(`<path d="M11 22c-2 0-3-3 0-4-1-3 3-4 4-2 2-2 6 0 4 3 2 1 1 4-1 4z"/><path d="M12 22l4 5 4-5"/>`),
  mintLeaves:I(`<path d="M16 24c-6 0-9-5-8-12 7-1 9 4 8 12z"/><path d="M16 24c6 0 9-5 8-12-7-1-9 4-8 12z"/>`),
  lemonSlice:I(`<circle cx="16" cy="16" r="9"/><line x1="16" y1="7" x2="16" y2="25"/><line x1="7" y1="16" x2="25" y2="16"/><line x1="10" y1="10" x2="22" y2="22"/><line x1="22" y1="10" x2="10" y2="22"/>`),
  nuts:      I(`<path d="M11 9c4 2 4 12 0 14-4-2-4-12 0-14z"/><path d="M21 9c4 2 4 12 0 14-4-2-4-12 0-14z"/>`),
  chocCurls: I(`<path d="M9 11c4-3 10-3 14 0-3 4-3 7 0 11-4 3-10 3-14 0"/>`),
};

// ---- layer definitions ----
const LAYER_DEFS = {
  base: { role:"Crust", slider:false, options:[
    { id:"graham",  label:"Graham",  kind:"crust", color:0xc89a55 },
    { id:"biscuit", label:"Biscuit", kind:"crust", color:0xd6ac68 },
    { id:"oreo",    label:"Oreo",    kind:"crust", color:0x2c2528 },
    { id:"brownie", label:"Brownie", kind:"crust", color:0x4a2c1d },
    { id:"nut",     label:"Nut",     kind:"crust", color:0xb3793f },
  ]},
  middle: { role:"Cheesecake", slider:true, options:[
    { id:"vanilla",    label:"Vanilla",    kind:"cream", color:0xf3e6c0 },
    { id:"strawberry", label:"Strawberry", kind:"cream", color:0xf2afbd },
    { id:"lemon",      label:"Lemon",      kind:"cream", color:0xf6e784 },
    { id:"chocolate",  label:"Chocolate",  kind:"cream", color:0x6e4a2f },
    { id:"raspberry",  label:"Raspberry",  kind:"cream", color:0xd96a8f },
  ]},
  top: { role:"Finish", slider:true, options:[
    { id:"none",   label:"None",   kind:null,    color:0x000000 },
    { id:"jelly",  label:"Jelly",  kind:"gloss",  color:0xe2354b },
    { id:"mousse", label:"Mousse", kind:"cream",  color:0xf1e3d2 },
    { id:"glaze",  label:"Glaze",  kind:"gloss",  color:0xf2b134 },
    { id:"fruit",  label:"Fruit",  kind:"fruit",  color:0xd8324a },
  ]},
};
const DECOR_DEFS = [
  { id:"strawberries", label:"Strawberries" },
  { id:"whippedCream", label:"Whipped Cream" },
  { id:"mintLeaves",   label:"Mint Leaves" },
  { id:"raspberries",  label:"Raspberries" },
  { id:"lemonSlice",   label:"Lemon Slice" },
  { id:"nuts",         label:"Nuts" },
  { id:"chocCurls",    label:"Chocolate Curls" },
];

const LAYER_ORDER = ["base","middle","top"]; // bottom -> top
const ROLE_LABEL = { base:"Base", middle:"Middle", top:"Top" };

// ---- default state ----
function defaultState(){
  return {
    shape:"round", view:"whole", count:3,
    layers:{
      base:{ ing:"graham" },
      middle:{ ing:"strawberry", thickness:0.5 },
      top:{ ing:"jelly", thickness:0.5 },
    },
    decorations:["strawberries","mintLeaves"],
  };
}
let state = defaultState();

// ---- which layer slots are active for a given count ----
function activeKeys(count){
  if(count === 1) return ["middle"];
  if(count === 2) return ["base","middle"];
  return ["base","middle","top"];
}
function isActive(key){ return activeKeys(state.count).includes(key); }

// ---- height mapping (3D units) ----
function heightFor(key, thickness){
  if(key === "base")   return 0.42;
  if(key === "middle") return 0.6 + thickness*1.4;
  return 0.16 + thickness*0.46; // top
}

// ---- option lookup ----
function opt(key, id){ return LAYER_DEFS[key].options.find(o=>o.id===id); }

// ============================================================
//  Build specs
// ============================================================
function build3DSpec(){
  const keys = activeKeys(state.count);
  const layers = [];
  LAYER_ORDER.forEach(key=>{
    if(!keys.includes(key)) return;
    const id = state.layers[key].ing;
    const o = opt(key, id);
    if(key === "top" && id === "none") return;      // top:none renders nothing
    const thickness = LAYER_DEFS[key].slider ? state.layers[key].thickness : 0.5;
    layers.push({ key, ing:id, kind:o.kind, color:o.color, height:heightFor(key, thickness) });
  });
  return { shape:state.shape, view:state.view, layers, decorations:state.decorations.slice() };
}

function recipeDesign(){
  const keys = activeKeys(state.count);
  return {
    shape: state.shape,
    layers:{
      base:   { ing:state.layers.base.ing,   on:keys.includes("base") },
      middle: { ing:state.layers.middle.ing, thickness:state.layers.middle.thickness, on:keys.includes("middle") },
      top:    { ing:state.layers.top.ing,    thickness:state.layers.top.thickness,
                on:keys.includes("top") && state.layers.top.ing !== "none" },
    },
    decorations: state.decorations.slice(),
  };
}

// ============================================================
//  DOM refs
// ============================================================
const $ = s => document.querySelector(s);
const canvas = $("#cake-canvas");
const cake = createCake(canvas);

// ============================================================
//  Render controls
// ============================================================
function renderLayerCards(){
  const wrap = $("#layer-cards");
  wrap.innerHTML = LAYER_ORDER.map(key=>{
    const def = LAYER_DEFS[key];
    const chips = def.options.map(o=>chipHTML(key, o)).join("");
    const slider = def.slider ? sliderHTML(key) : "";
    return `<div class="card layer" data-layer="${key}">
      <div class="layer-head">
        <span class="layer-num" data-num>•</span>
        <span><span class="layer-name">${ROLE_LABEL[key]}</span>
          <span class="layer-role">· ${def.role}</span></span>
      </div>
      <div class="chips">${chips}</div>
      ${slider}
    </div>`;
  }).join("");
  // wire chips
  wrap.querySelectorAll(".chip").forEach(ch=>{
    ch.addEventListener("click", ()=>{
      const { layer, id } = ch.dataset;
      state.layers[layer].ing = id;
      refresh();
    });
  });
  // wire sliders
  wrap.querySelectorAll("input[type=range]").forEach(sl=>{
    sl.addEventListener("input", ()=>{
      const key = sl.dataset.layer;
      const pct = +sl.value;
      state.layers[key].thickness = (pct-30)/40;
      refresh();
    });
  });
}

function chipHTML(key, o){
  return `<button class="chip accent" type="button" role="radio"
      data-layer="${key}" data-id="${o.id}" aria-label="${o.label}">
    ${ICONS[o.id] || ""}
    <span class="lbl">${o.label}</span>
    <span class="check" aria-hidden="true">✓</span>
  </button>`;
}

function sliderHTML(key){
  return `<div class="thick">
    <div class="thick-row">
      <label for="thk-${key}">Thickness</label>
      <output id="out-${key}">50%</output>
    </div>
    <input type="range" id="thk-${key}" data-layer="${key}" min="30" max="70" step="1" value="50"
      aria-label="${ROLE_LABEL[key]} thickness percent" />
  </div>`;
}

function renderDecor(){
  $("#decor-list").innerHTML = DECOR_DEFS.map(d=>
    `<button class="decor" type="button" role="checkbox" data-id="${d.id}" aria-checked="false">
      ${ICONS[d.id] || ""}<span>${d.label}</span>
    </button>`).join("");
  $("#decor-list").querySelectorAll(".decor").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.id;
      const i = state.decorations.indexOf(id);
      if(i>=0) state.decorations.splice(i,1); else state.decorations.push(id);
      refresh();
    });
  });
}

// ============================================================
//  Reflect state -> control UI
// ============================================================
function syncControls(){
  // segmented controls
  setSeg("#shape-seg", state.shape);
  setSeg("#count-seg", String(state.count));
  setSeg("#view-seg", state.view);

  // layer cards: active dimming + numbering + chip selection + sliders
  const keys = activeKeys(state.count);
  let num = 0;
  LAYER_ORDER.forEach(key=>{
    const cardEl = document.querySelector(`.layer[data-layer="${key}"]`);
    if(!cardEl) return;
    const on = keys.includes(key);
    cardEl.classList.toggle("is-off", !on);
    const numEl = cardEl.querySelector("[data-num]");
    if(on){ num++; numEl.textContent = num; } else { numEl.textContent = "–"; }
    // chips
    cardEl.querySelectorAll(".chip").forEach(ch=>{
      const sel = ch.dataset.id === state.layers[key].ing;
      ch.classList.toggle("is-sel", sel);
      ch.setAttribute("aria-checked", sel ? "true":"false");
    });
    // slider
    const sl = cardEl.querySelector("input[type=range]");
    if(sl){
      const pct = Math.round(state.layers[key].thickness*40 + 30);
      sl.value = pct; sl.style.setProperty("--pct", `${(pct-30)/40*100}%`);
      cardEl.querySelector("output").textContent = `${pct}%`;
    }
  });

  // decorations
  document.querySelectorAll("#decor-list .decor").forEach(b=>{
    const sel = state.decorations.includes(b.dataset.id);
    b.classList.toggle("is-sel", sel);
    b.setAttribute("aria-checked", sel?"true":"false");
  });
}

function setSeg(sel, val){
  document.querySelectorAll(`${sel} .seg-btn`).forEach(b=>{
    const on = b.dataset.val === val;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-checked", on?"true":"false");
  });
}

// ============================================================
//  Callouts (right-side exploded legend, ordered top -> bottom)
// ============================================================
function renderCallouts(spec){
  const host = $("#callouts");
  const list = spec.layers.slice().reverse(); // top first
  const n = list.length;
  host.innerHTML = list.map((L, i)=>{
    const topPct = n===1 ? 44 : 20 + i*(48/(n-1));
    const o = opt(L.key, L.ing);
    const num = LAYER_ORDER.filter(k=>spec.layers.some(s=>s.key===k)).indexOf(L.key)+1;
    return `<div class="callout" style="right:6px; top:${topPct}%">
      <span class="dot">${num}</span>
      <span>${ROLE_LABEL[L.key]} <span class="c-role">· ${o.label}</span></span>
    </div>`;
  }).join("");
}

// ============================================================
//  Summary card + cross-section thumbnail
// ============================================================
function renderSummary(spec){
  const keys = activeKeys(state.count);
  const shapeWord = { round:"Round", square:"Square", heart:"Heart" }[state.shape];
  $("#summary-meta").innerHTML =
    `<dt>Shape</dt><dd>${shapeWord}</dd>
     <dt>Layers</dt><dd>${keys.length}</dd>
     <dt>View</dt><dd>${state.view==="slice"?"Slice":"Whole"}</dd>`;

  // layer list (top -> bottom for visual match)
  const rows = LAYER_ORDER.filter(k=>keys.includes(k)).reverse().map(key=>{
    const o = opt(key, state.layers[key].ing);
    const hex = "#"+o.color.toString(16).padStart(6,"0");
    const sw = o.kind ? `background:${hex}` : "background:repeating-linear-gradient(45deg,#eee,#eee 3px,#fff 3px,#fff 6px)";
    return `<li><span class="sw" style="${sw}"></span>
      <span>${o.label}</span><span class="s-role">${ROLE_LABEL[key]}</span></li>`;
  }).join("");
  $("#summary-layers").innerHTML = rows;

  const decoNames = state.decorations.map(id=>DECOR_DEFS.find(d=>d.id===id)?.label).filter(Boolean);
  $("#summary-decor").innerHTML = `<b>Decorations:</b> ${decoNames.length?decoNames.join(", "):"none"}`;

  drawThumb(spec);
}

function drawThumb(spec){
  const cv = $("#slice-thumb"), ctx = cv.getContext("2d");
  const W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);
  if(!spec.layers.length) return;
  const pad=14, w=W-pad*2;
  const total = spec.layers.reduce((s,L)=>s+L.height,0);
  let y = H-pad;
  spec.layers.forEach(L=>{
    const h = (L.height/total)*(H-pad*2);
    const o = opt(L.key, L.ing);
    ctx.fillStyle = "#"+o.color.toString(16).padStart(6,"0");
    roundRect(ctx, pad, y-h, w, h, 4); ctx.fill();
    // subtle top sheen
    ctx.fillStyle = "rgba(255,255,255,.18)";
    roundRect(ctx, pad, y-h, w, Math.min(6,h*0.4), 4); ctx.fill();
    y -= h;
  });
}
function roundRect(ctx,x,y,w,h,r){
  r=Math.min(r,h/2,w/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// ============================================================
//  Recipe
// ============================================================
function renderRecipe(){
  const r = Recipe.generate(recipeDesign());
  $("#recipe").innerHTML = Recipe.renderHTML(r);
  return r;
}

// ============================================================
//  Master refresh (live)
// ============================================================
function refresh(){
  const spec = build3DSpec();
  cake.update(spec);
  syncControls();
  renderCallouts(spec);
  renderSummary(spec);
  renderRecipe();
  updateStageNote();
  persistHash();
}

// ============================================================
//  Save / Share / Export / persistence
// ============================================================
function encodeState(){
  try{ return btoa(unescape(encodeURIComponent(JSON.stringify(state)))); }
  catch(e){ return ""; }
}
function decodeState(str){
  try{ return JSON.parse(decodeURIComponent(escape(atob(str)))); }
  catch(e){ return null; }
}
let hashTimer=null;
function persistHash(){
  clearTimeout(hashTimer);
  hashTimer = setTimeout(()=>{ history.replaceState(null,"","#d="+encodeState()); }, 250);
}
function loadFromURLorStorage(){
  const m = location.hash.match(/d=([^&]+)/);
  let loaded = m ? decodeState(m[1]) : null;
  if(!loaded){ const ls = localStorage.getItem("cf.design"); if(ls) loaded = decodeState(ls); }
  if(loaded) state = mergeState(loaded);
}
function mergeState(loaded){
  const s = defaultState();
  if(loaded.shape) s.shape = loaded.shape;
  if(loaded.view) s.view = loaded.view;
  if([1,2,3].includes(loaded.count)) s.count = loaded.count;
  if(loaded.layers){
    ["base","middle","top"].forEach(k=>{
      if(loaded.layers[k]?.ing && opt(k, loaded.layers[k].ing)) s.layers[k].ing = loaded.layers[k].ing;
      if(typeof loaded.layers[k]?.thickness === "number" && s.layers[k].thickness!==undefined)
        s.layers[k].thickness = Math.max(0,Math.min(1,loaded.layers[k].thickness));
    });
  }
  if(Array.isArray(loaded.decorations))
    s.decorations = loaded.decorations.filter(id=>DECOR_DEFS.some(d=>d.id===id));
  return s;
}

function toast(msg){
  const t=$("#toast"); t.textContent=msg; t.hidden=false; requestAnimationFrame(()=>t.classList.add("show"));
  clearTimeout(toast._t); toast._t=setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.hidden=true,200); },2000);
}

function cakeName(){
  const t = Recipe.generate(recipeDesign()).title || "Cheesecake";
  return t.replace(/[\\/:*?"<>|]/g, "").trim() || "Cheesecake";   // strip filename-illegal chars
}

function exportPNG(){
  const a=document.createElement("a"); a.href=cake.snapshot(); a.download=cakeName()+".png"; a.click();
}

function printRecipe(){
  let img = document.querySelector(".print-shot");
  if(!img){ img=document.createElement("img"); img.className="print-shot"; $("#recipe").prepend(img); }
  img.src = cake.snapshot();
  const prevTitle = document.title;
  document.title = cakeName();           // becomes the default "Save as PDF" filename
  const restore = ()=>{ document.title = prevTitle; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  setTimeout(()=>window.print(), 140);
}

// ============================================================
//  Wire top bar + segmented + view + tabs
// ============================================================
function wireUI(){
  // segmented: shape / count / view
  $("#shape-seg").addEventListener("click", e=>segClick(e, v=>{ state.shape=v; refresh(); }));
  $("#count-seg").addEventListener("click", e=>segClick(e, v=>{ state.count=+v; refresh(); }));
  $("#view-seg").addEventListener("click",  e=>segClick(e, v=>{ state.view=v; refresh(); updateStageNote(); }));

  $("#act-reset-cam").addEventListener("click", ()=>cake.resetCamera());
  $("#act-export").addEventListener("click", exportPNG);
  $("#act-print").addEventListener("click", printRecipe);
  $("#act-recipe").addEventListener("click", ()=>{
    renderRecipe();
    $("#recipe").scrollIntoView({behavior:"smooth", block:"nearest"});
    if(matchMedia("(max-width:720px)").matches) switchTab("decor");
  });

  $("#act-save").addEventListener("click", ()=>{
    localStorage.setItem("cf.design", encodeState()); toast("Design saved to this browser");
  });
  $("#act-new").addEventListener("click", ()=>{
    state = defaultState(); history.replaceState(null,"",location.pathname); refresh(); toast("New design");
  });
  $("#act-share").addEventListener("click", async ()=>{
    persistHash();
    const url = location.origin+location.pathname+"#d="+encodeState();
    try{ await navigator.clipboard.writeText(url); toast("Share link copied"); }
    catch(e){ history.replaceState(null,"","#d="+encodeState()); toast("Share link is in the address bar"); }
  });

  // mobile tabs
  document.querySelectorAll(".tab").forEach(t=>
    t.addEventListener("click", ()=>switchTab(t.dataset.tab)));
}

function segClick(e, cb){
  const btn = e.target.closest(".seg-btn"); if(!btn) return;
  cb(btn.dataset.val);
}

function updateStageNote(){
  const note=$("#stage-note");
  if(state.view==="slice" && state.shape==="heart"){
    note.hidden=false; note.textContent="Heart shows as a round slice in cross-section view.";
  } else note.hidden=true;
}

function switchTab(name){
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("is-active", t.dataset.tab===name));
  $(".col-left").classList.toggle("is-shown", name==="layers");
  $(".col-center").classList.toggle("is-shown", name==="preview");
  $(".col-right").classList.toggle("is-shown", name==="decor");
}

// ============================================================
//  Boot
// ============================================================
loadFromURLorStorage();
renderLayerCards();
renderDecor();
wireUI();
switchTab("preview");          // mobile default pane
updateStageNote();
refresh();
window.addEventListener("hashchange", ()=>{ /* allow external link load */ });

// expose for debugging
window.__cf = { get state(){return state;}, cake };
