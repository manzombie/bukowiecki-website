/* app.js — Dot Studio. Controls -> seeded pattern -> live transparent preview ->
 * PNG/SVG export. Deterministic: same seed + settings = identical image. */
import { makeRng } from "../shared/prng.js";
import { MODES } from "./patterns.js";
import { drawDots, exportPNG, buildSVG } from "./render.js";

const $ = (s) => document.querySelector(s);

const state = {
  mode: "spiral",
  density: 1.2, sizeMin: 1, sizeMax: 16, contrast: 1.4, spread: 0.92,
  p1: 0, p2: 0.12, jitter: 0, fade: 0.55,
  color: "#16130f", shape: "circle",
  w: 1080, h: 1080,
  seed: "dot-1",
};

/* ---------- mode buttons ---------- */
function buildModes() {
  const box = $("#modes");
  box.innerHTML = Object.entries(MODES).map(([k, m]) =>
    `<button class="mode${k === state.mode ? " on" : ""}" data-mode="${k}">${m.label}</button>`).join("");
  box.querySelectorAll(".mode").forEach((b) => b.onclick = () => {
    state.mode = b.dataset.mode;
    box.querySelectorAll(".mode").forEach((x) => x.classList.toggle("on", x === b));
    syncModeLabels(); render();
  });
}
function syncModeLabels() {
  const m = MODES[state.mode];
  $("#l-p1").textContent = m.p1; $("#l-p2").textContent = m.p2;
}

/* ---------- controls ---------- */
const SLIDERS = ["density", "sizeMin", "sizeMax", "contrast", "spread", "p1", "p2", "jitter", "fade"];
function hydrate() {
  SLIDERS.forEach((k) => { $("#" + k).value = state[k]; });
  $("#color").value = state.color; $("#shape").value = state.shape; $("#seed").value = state.seed;
  syncOutputs();
}
function syncOutputs() {
  SLIDERS.forEach((k) => { const o = $("#o-" + k); if (o) o.textContent = (+state[k]).toFixed(2).replace(/\.00$/, ""); });
}
function wire() {
  SLIDERS.forEach((k) => $("#" + k).addEventListener("input", (e) => { state[k] = +e.target.value; syncOutputs(); render(); }));
  $("#color").addEventListener("input", (e) => { state.color = e.target.value; render(); });
  $("#shape").addEventListener("change", (e) => { state.shape = e.target.value; render(); });
  $("#seed").addEventListener("input", (e) => { state.seed = e.target.value; render(); });
  $("#reroll").onclick = () => { state.seed = "dot-" + Math.floor(performance.now() % 1e6) + "-" + (Math.floor(performance.timeOrigin) % 997); $("#seed").value = state.seed; render(); };
  $("#aspect").addEventListener("change", (e) => {
    const v = e.target.value;
    $("#customwh").hidden = v !== "custom";
    if (v !== "custom") { const [w, h] = v.split("x").map(Number); state.w = w; state.h = h; render(); }
  });
  $("#cw").addEventListener("input", (e) => { state.w = clamp(+e.target.value, 64, 6000); render(); });
  $("#ch").addEventListener("input", (e) => { state.h = clamp(+e.target.value, 64, 6000); render(); });
  document.querySelectorAll("[data-png]").forEach((b) => b.onclick = () => doExportPNG(+b.dataset.png));
  $("#svg").onclick = doExportSVG;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* ---------- compute dots (deterministic) ---------- */
function computeDots() {
  const rng = makeRng(state.seed + ":" + state.mode);
  const p = {
    density: state.density, sizeMin: state.sizeMin, sizeMax: state.sizeMax,
    contrast: state.contrast, spread: state.spread, p1: state.p1, p2: state.p2, jitter: state.jitter,
  };
  const dots = MODES[state.mode].fn(p, rng, state.w, state.h);
  return applyEnvelope(dots, state.w, state.h, state.fade);
}

/* Edge-fade envelope: dot radius falls to zero toward the frame so the field
 * forms a contained, floating shape instead of filling the square. Elliptical
 * by canvas aspect, so wide canvases give a band (waveform) and square gives a
 * blob. fade=0 means no containment (can reach the spread extent). */
function applyEnvelope(dots, w, h, fade) {
  if (!(fade > 0)) return dots;
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
  const inner = 1 - fade;                 // core (full-size) radius, relative
  const out = [];
  for (const d of dots) {
    const nx = (d.x - cx) / rx, ny = (d.y - cy) / ry;
    const dist = Math.sqrt(nx * nx + ny * ny);   // 0 centre .. 1 at frame midpoint
    let m;
    if (dist <= inner) m = 1;
    else m = 1 - (dist - inner) / (1 - inner);
    if (m <= 0) continue;
    m = m * m * (3 - 2 * m);              // smoothstep for a soft edge
    const r = d.r * m;
    if (r > 0.35) out.push({ x: d.x, y: d.y, r });
  }
  return out;
}

/* ---------- live preview (transparent) ---------- */
let lastDots = [];
function render() {
  const dots = computeDots(); lastDots = dots;
  const cv = $("#cv");
  cv.width = state.w; cv.height = state.h;             // canvas backing = true output px
  drawDots(cv.getContext("2d"), dots, { color: state.color, shape: state.shape });
  $("#stagenote").textContent = `${MODES[state.mode].label} · ${dots.length} dots · ${state.w}×${state.h} · seed "${state.seed}"`;
}

/* ---------- export ---------- */
function fileBase(ext, scale) {
  const sc = scale && scale > 1 ? `_${scale}x` : "";
  return `dotstudio_${state.mode}_seed_${String(state.seed).replace(/[^a-z0-9_-]/gi, "")}${sc}.${ext}`;
}
function download(blobOrUrl, name) {
  const url = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  if (typeof blobOrUrl !== "string") setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function doExportPNG(scale) {
  exportPNG(lastDots, state.w, state.h, { color: state.color, shape: state.shape, scale }, (blob) => {
    download(blob, fileBase("png", scale));
    $("#exphint").textContent = `Saved ${state.w * scale}×${state.h * scale} transparent PNG`;
  });
}
function doExportSVG() {
  const svg = buildSVG(lastDots, state.w, state.h, { color: state.color, shape: state.shape });
  download(new Blob([svg], { type: "image/svg+xml" }), fileBase("svg"));
  $("#exphint").textContent = "Saved transparent SVG (vector)";
}

let toastT;
export function toast(m) { const t = $("#toast"); t.textContent = m; t.className = "show"; clearTimeout(toastT); toastT = setTimeout(() => t.className = "", 2400); }

buildModes(); syncModeLabels(); hydrate(); wire(); render();
