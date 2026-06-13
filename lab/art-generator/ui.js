/* ============================================================================
 * art-generator/ui.js — the studio's wiring.
 *
 * Responsibilities (and nothing else — all drawing lives in engine.js):
 *   • build the Panel-1/2/3 controls from the engine's OPTIONS
 *   • hold the single `config` object the controls write into
 *   • render the live multi-preview, the collection strip, the contact sheet
 *   • curate: favourite / reject / vary, similarity detection, sort
 *   • lightbox stepper
 *   • export: PNG + JSON sidecar, and a whole-collection ZIP (JSZip)
 *
 * The golden thread: a control changes `config` → we re-run the engine
 * (deriveTraits → render). Same config + seed always reproduces the same art.
 * ========================================================================== */

import {
  OPTIONS,
  PALETTES,
  defaultConfig,
  deriveTraits,
  render,
  traitSignature,
  signatureDistance,
} from "./engine.js";

/* ---------- tiny DOM helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
};
const pct = (v) => Math.round(v * 100) + "%";

/* ---------- the one state object ---------- */
const config = defaultConfig();

// the generated collection lives here: array of piece objects
let collection = [];
let previewSalt = 0;
let stripSalt = 0;

/* render resolutions (small for screen; exports re-render large on demand) */
const R_PREVIEW = 300;
const R_STRIP = 220;
const R_TILE = 360;
const R_EXPORT = 1200; // high-DPI export; textures add grain so PNGs stay large

/* ============================================================================
 * Render one piece into a canvas at a given pixel size.
 * tokenSeed encodes (collection seed + token index) — the engine contract.
 * ========================================================================== */
function renderInto(canvas, tokenSeed, size, cfg = config) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const traits = deriveTraits(tokenSeed, cfg);
  render(ctx, traits, size);
  return traits;
}

/* ============================================================================
 * PANEL 1 — build the algorithm-design controls from OPTIONS.
 * ========================================================================== */

/* segmented option picker bound to a config key */
function buildSegmented(mountId, options, key, onChange) {
  const mount = $("#" + mountId);
  mount.innerHTML = "";
  options.forEach((opt) => {
    const b = el(
      "button",
      {
        type: "button",
        title: opt.hint,
        "aria-pressed": config[key] === opt.id ? "true" : "false",
        onclick: () => {
          config[key] = opt.id;
          $$("button", mount).forEach((x) =>
            x.setAttribute("aria-pressed", "false")
          );
          b.setAttribute("aria-pressed", "true");
          onChange();
        },
      },
      opt.label
    );
    mount.append(b);
  });
}

/* a labelled slider (0..1 unless min/max given) writing to config[path] */
function sliderRow(label, hint, getVal, setVal, onChange, opts = {}) {
  const min = opts.min ?? 0,
    max = opts.max ?? 1,
    step = opts.step ?? 0.01;
  const fmt = opts.fmt || pct;
  const valEl = el("span", { class: "val" }, fmt(getVal()));
  const input = el("input", {
    type: "range",
    min,
    max,
    step,
    value: getVal(),
    "aria-label": label,
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      setVal(v);
      valEl.textContent = fmt(v);
      onChange();
    },
  });
  return el(
    "div",
    { class: "ctrl" },
    el("label", {}, document.createTextNode(label), valEl),
    el("p", { class: "hint" }, hint),
    input
  );
}

function buildCompositionSliders(onChange) {
  const mount = $("#composition-sliders");
  mount.innerHTML = "";
  const rows = [
    ["Density", "How many marks fill the canvas — sparse to swarming.", "density"],
    ["Scale", "The size of each individual mark.", "scale"],
    ["Spacing", "How much breathing room marks try to keep.", "spacing"],
    ["Margin", "The empty frame held around the artwork.", "margin"],
    ["Negative space", "How likely a region is left intentionally blank.", "negativeSpace"],
  ];
  rows.forEach(([l, h, key]) =>
    mount.append(
      sliderRow(l, h, () => config[key], (v) => (config[key] = v), onChange)
    )
  );
}

function buildBehaviours(onChange) {
  const mount = $("#behaviours");
  mount.innerHTML = "";
  const defs = [
    ["overlap", "Overlap", "Let marks sit on top of one another."],
    ["avoid", "Avoid", "Thin out marks that crowd each other (needs Overlap off)."],
    ["connect", "Connect", "Draw thin links between nearby marks."],
    ["collide", "Collide", "Push overlapping marks apart like magnets."],
    ["distort", "Distort", "Warp positions for a hand-made wobble."],
  ];
  defs.forEach(([key, name, hint]) => {
    const b = config.behaviours[key];
    const strengthWrap = el("div", { class: "sub" + (b.on ? "" : " dim") });
    strengthWrap.append(
      sliderRow(
        name + " strength",
        "How strong this effect is.",
        () => config.behaviours[key].strength,
        (v) => (config.behaviours[key].strength = v),
        onChange
      )
    );
    const toggle = el("input", {
      type: "checkbox",
      ...(b.on ? { checked: "checked" } : {}),
      "aria-label": name,
      onchange: (e) => {
        config.behaviours[key].on = e.target.checked;
        strengthWrap.classList.toggle("dim", !e.target.checked);
        onChange();
      },
    });
    mount.append(
      el(
        "div",
        { class: "behaviour" },
        el(
          "div",
          { class: "toggle-row" },
          el("label", { class: "sw" }, toggle, el("span")),
          el(
            "span",
            { class: "tname" },
            name,
            el("br"),
            el("span", { class: "thint" }, hint)
          )
        ),
        strengthWrap
      )
    );
  });
}

function buildPalettes(onChange) {
  const mount = $("#palettes");
  mount.innerHTML = "";
  Object.entries(PALETTES).forEach(([id, pal]) => {
    const swRow = el("div", { class: "sw-row" });
    [pal.bg, ...pal.colors].forEach((c) =>
      swRow.append(el("i", { style: `background:${c}` }))
    );
    const card = el(
      "button",
      {
        type: "button",
        class: "pal-card",
        "aria-pressed": config.palette === id ? "true" : "false",
        onclick: () => {
          config.palette = id;
          $$(".pal-card", mount).forEach((x) =>
            x.setAttribute("aria-pressed", "false")
          );
          card.setAttribute("aria-pressed", "true");
          onChange();
        },
      },
      swRow,
      el("span", { class: "pal-name" }, pal.label)
    );
    mount.append(card);
  });
}

function buildRandomness(onChange) {
  const mount = $("#randomness-sliders");
  mount.innerHTML = "";
  mount.append(
    sliderRow(
      "Chaos",
      "The master dial: predictable & orderly ← → wild & unpredictable.",
      () => config.chaos,
      (v) => (config.chaos = v),
      onChange
    ),
    sliderRow(
      "Per-mark jitter",
      "Tiny extra wobble added to every single mark.",
      () => config.jitter,
      (v) => (config.jitter = v),
      onChange
    )
  );
}

/* ============================================================================
 * PANEL 2 — collection rules.
 * ========================================================================== */
function buildLocks(onChange) {
  const mount = $("#locks");
  mount.innerHTML = "";
  const traits = [
    ["element", "Mark type"],
    ["movement", "Movement"],
    ["palette", "Palette"],
    ["colorRule", "Colour rule"],
    ["texture", "Texture"],
    ["density", "Density"],
    ["scale", "Scale"],
    ["spacing", "Spacing"],
  ];
  traits.forEach(([key, label]) => {
    const seg = el("div", { class: "seg", role: "group", "aria-label": label });
    const mk = (val, text) => {
      const b = el(
        "button",
        {
          type: "button",
          "aria-pressed": config.locks[key] === val ? "true" : "false",
          onclick: () => {
            config.locks[key] = val;
            $$("button", seg).forEach((x) =>
              x.setAttribute("aria-pressed", "false")
            );
            b.setAttribute("aria-pressed", "true");
            onChange();
          },
        },
        text
      );
      return b;
    };
    seg.append(mk(true, "consistent"), mk(false, "varies"));
    mount.append(el("div", { class: "lock-row" }, el("span", {}, label), seg));
  });
}

function buildVariation(onChange) {
  const mount = $("#variation-sliders");
  mount.innerHTML = "";
  mount.append(
    sliderRow(
      "Variation range",
      "How far ‘varying’ traits may drift from your base settings.",
      () => config.variation,
      (v) => (config.variation = v),
      onChange
    ),
    sliderRow(
      "Rarity frequency",
      "How often an unusual ‘outlier’ piece appears.",
      () => config.rarity,
      (v) => (config.rarity = v),
      onChange
    ),
    sliderRow(
      "Similarity limit",
      "How alike two pieces may be before they’re flagged as look-alikes (strict ← → loose).",
      () => config.similarity,
      (v) => (config.similarity = v),
      onChange,
      { min: 0.01, max: 0.3 }
    )
  );
}

const FORBID_TRAITS = {
  element: OPTIONS.element,
  movement: OPTIONS.movement,
  palette: Object.keys(PALETTES).map((id) => ({ id, label: PALETTES[id].label })),
  colorRule: OPTIONS.colorRule,
  texture: OPTIONS.texture,
};

function buildForbid(onChange) {
  const mount = $("#forbid-rows");
  mount.innerHTML = "";
  config.forbid.forEach((rule, idx) => {
    const traitSelect = (which) => {
      const s = el("select", {
        "aria-label": which + " trait",
        onchange: (e) => {
          rule[which + "Trait"] = e.target.value;
          rule[which + "Value"] = FORBID_TRAITS[e.target.value][0].id;
          buildForbid(onChange);
          onChange();
        },
      });
      Object.keys(FORBID_TRAITS).forEach((t) =>
        s.append(el("option", { value: t, ...(rule[which + "Trait"] === t ? { selected: "" } : {}) }, t))
      );
      return s;
    };
    const valSelect = (which) => {
      const t = rule[which + "Trait"];
      const s = el("select", {
        "aria-label": which + " value",
        onchange: (e) => {
          rule[which + "Value"] = e.target.value;
          onChange();
        },
      });
      FORBID_TRAITS[t].forEach((o) =>
        s.append(
          el("option", { value: o.id, ...(rule[which + "Value"] === o.id ? { selected: "" } : {}) }, o.label)
        )
      );
      return s;
    };
    mount.append(
      el(
        "div",
        { class: "rule-row" },
        el("div", {}, el("span", { class: "note" }, "if "), traitSelect("if"), valSelect("if")),
        el("div", {}, el("span", { class: "note" }, "never "), traitSelect("never"), valSelect("never")),
        el("button", {
          class: "x",
          type: "button",
          "aria-label": "remove rule",
          title: "remove",
          onclick: () => {
            config.forbid.splice(idx, 1);
            buildForbid(onChange);
            onChange();
          },
        }, "✕")
      )
    );
  });
}

/* ============================================================================
 * STAGE renders
 * ========================================================================== */

/* Panel 1: six pieces from the current algorithm with different seeds */
function renderPreview() {
  const grid = $("#preview-grid");
  grid.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const seed = `${config.seed}:preview:${previewSalt}:${i}`;
    const canvas = el("canvas");
    const traits = renderInto(canvas, seed, R_PREVIEW);
    const cap = el(
      "div",
      { class: "cap" },
      el("span", {}, traits.movement + " · " + traits.element),
      traits.rarityTier !== "common"
        ? el("span", { class: "rare" }, traits.rarityTier)
        : el("span", {}, "")
    );
    grid.append(el("div", { class: "cell" }, canvas, cap));
  }
}

/* Panel 2: twelve samples from the real collection seed space */
function renderStrip() {
  const strip = $("#strip");
  strip.innerHTML = "";
  $("#seed-echo").textContent = config.seed;
  const n = Math.min(12, config.size);
  for (let k = 0; k < n; k++) {
    // evenly spaced token indices, nudged by resample salt
    const idx = Math.floor((k / n) * config.size + stripSalt) % config.size;
    const canvas = el("canvas");
    renderInto(canvas, `${config.seed}:${idx}`, R_STRIP);
    strip.append(canvas);
  }
}

/* ============================================================================
 * Panel 3: build the full collection (deterministic) + progressive render.
 * ========================================================================== */
function buildCollectionModel() {
  const seen = []; // signatures, for uniqueness + similarity
  const pieces = [];
  for (let i = 0; i < config.size; i++) {
    let tokenSeed = `${config.seed}:${i}`;
    let traits = deriveTraits(tokenSeed, config);
    let sig = traitSignature(traits);

    // "must be unique": if byte-identical signature exists, salt and retry.
    if (config.mustBeUnique) {
      let attempt = 0;
      while (
        attempt < 8 &&
        seen.some((s) => signatureDistance(s, sig) < 0.001)
      ) {
        attempt++;
        tokenSeed = `${config.seed}:${i}#${attempt}`;
        traits = deriveTraits(tokenSeed, config);
        sig = traitSignature(traits);
      }
    }
    seen.push(sig);
    pieces.push({
      index: i,
      tokenSeed,
      traits,
      sig,
      status: "normal", // 'normal' | 'fav' | 'rejected'
      cluster: false,
    });
  }
  return pieces;
}

let sheetRenderToken = 0; // cancels a stale progressive render
function generateCollection() {
  collection = buildCollectionModel();
  detectSimilar(false);
  const sheet = $("#sheet");
  sheet.innerHTML = "";
  $("#sheet-count").textContent = `${collection.length} pieces`;
  $("#sheet-sub").textContent = `Seed “${config.seed}” · ${collection.length} pieces · rendering…`;

  const ordered = sortedCollection();
  // build tile shells first (instant), then fill canvases progressively
  const tileFor = new Map();
  ordered.forEach((p) => {
    const tile = makeTile(p);
    tileFor.set(p, tile);
    sheet.append(tile.root);
  });

  const progress = $("#progress");
  progress.hidden = false;
  const bar = $("#progress > i");
  const myToken = ++sheetRenderToken;
  let i = 0;
  const idle =
    window.requestIdleCallback ||
    ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 0));

  const step = (deadline) => {
    if (myToken !== sheetRenderToken) return; // superseded
    while (i < ordered.length && (deadline.timeRemaining() > 4 || deadline.didTimeout)) {
      const p = ordered[i];
      renderInto(tileFor.get(p).canvas, p.tokenSeed, R_TILE);
      i++;
    }
    bar.style.width = pct(i / ordered.length);
    if (i < ordered.length) {
      idle(step);
    } else {
      progress.hidden = true;
      $("#sheet-sub").textContent = `Seed “${config.seed}” · ${collection.length} pieces`;
      updateStats();
    }
  };
  idle(step);
}

function makeTile(p) {
  const canvas = el("canvas");
  const root = el(
    "div",
    {
      class:
        "tile" +
        (p.status === "fav" ? " fav" : "") +
        (p.status === "rejected" ? " rejected" : "") +
        (p.cluster ? " cluster" : ""),
      "data-idx": p.index,
    },
    canvas,
    el(
      "div",
      { class: "meta" },
      el("span", {}, "#" + p.index),
      el("span", {}, p.traits.rarityTier === "common" ? "" : p.traits.rarityTier)
    ),
    el(
      "div",
      { class: "actions" },
      el("button", { type: "button", title: "favourite", onclick: (e) => { e.stopPropagation(); toggleStatus(p, "fav"); } }, "★"),
      el("button", { type: "button", title: "reject", onclick: (e) => { e.stopPropagation(); toggleStatus(p, "rejected"); } }, "✕"),
      el("button", { type: "button", title: "make a variation", onclick: (e) => { e.stopPropagation(); varyPiece(p); } }, "↻"),
      el("button", { type: "button", title: "open", onclick: (e) => { e.stopPropagation(); openLightbox(p); } }, "⤢")
    )
  );
  root.addEventListener("click", () => openLightbox(p));
  p._root = root;
  return { root, canvas };
}

function refreshTileClasses(p) {
  if (!p._root) return;
  p._root.className =
    "tile" +
    (p.status === "fav" ? " fav" : "") +
    (p.status === "rejected" ? " rejected" : "") +
    (p.cluster ? " cluster" : "");
}

function toggleStatus(p, status) {
  p.status = p.status === status ? "normal" : status;
  refreshTileClasses(p);
  updateStats();
}

/* vary: re-roll a piece within the SAME algorithm (its neighbourhood) by
 * salting its seed. Stays inside your rules; just a different draw. */
function varyPiece(p) {
  p._v = (p._v || 0) + 1;
  p.tokenSeed = `${config.seed}:${p.index}~v${p._v}`;
  p.traits = deriveTraits(p.tokenSeed, config);
  p.sig = traitSignature(p.traits);
  if (p._root) {
    renderInto(p._root.querySelector("canvas"), p.tokenSeed, R_TILE);
    p._root.querySelector(".meta span:last-child").textContent =
      p.traits.rarityTier === "common" ? "" : p.traits.rarityTier;
  }
  detectSimilar(true);
}

/* ---------- similarity detection: flag near-duplicate clusters ---------- */
function detectSimilar(rerenderClasses = true) {
  collection.forEach((p) => (p.cluster = false));
  const thr = config.similarity;
  for (let i = 0; i < collection.length; i++) {
    for (let j = i + 1; j < collection.length; j++) {
      if (signatureDistance(collection[i].sig, collection[j].sig) < thr) {
        collection[i].cluster = true;
        collection[j].cluster = true;
      }
    }
  }
  if (rerenderClasses) collection.forEach(refreshTileClasses);
}

/* ---------- sort ---------- */
function sortKey(p, mode) {
  const t = p.traits;
  if (mode === "colour") {
    const palIdx = Object.keys(PALETTES).indexOf(t.palette);
    return palIdx * 10 + (t.colorRule === "gradient" ? 1 : 0);
  }
  if (mode === "composition") return t.density * 2 + t.scale + t.spacing;
  if (mode === "rarity") {
    const rank = { rare: 0, uncommon: 1, common: 2 }[t.rarityTier];
    return rank * 1000 - t.density;
  }
  return p.index;
}
function sortedCollection() {
  const mode = $("#sort").value;
  return [...collection].sort((a, b) => sortKey(a, mode) - sortKey(b, mode));
}
function reorderSheet() {
  if (!collection.length) return;
  generateCollection(); // simplest correct path: rebuild shells in new order
}

/* ---------- stats ---------- */
function updateStats() {
  const fav = collection.filter((p) => p.status === "fav").length;
  const rej = collection.filter((p) => p.status === "rejected").length;
  const clust = collection.filter((p) => p.cluster).length;
  $("#curate-stats").textContent =
    `${collection.length} pieces · ${fav} favourited · ${rej} rejected · ${clust} flagged as look-alikes`;
}

/* ============================================================================
 * LIGHTBOX (fullscreen stepper)
 * ========================================================================== */
let lbList = [];
let lbPos = 0;
function openLightbox(p) {
  lbList = sortedCollection().filter((x) => x.status !== "rejected");
  lbPos = Math.max(0, lbList.indexOf(p));
  if (lbList.length === 0) lbList = [p], (lbPos = 0);
  $("#lightbox").setAttribute("data-open", "true");
  $("#lightbox").setAttribute("aria-hidden", "false");
  drawLightbox();
}
function closeLightbox() {
  $("#lightbox").setAttribute("data-open", "false");
  $("#lightbox").setAttribute("aria-hidden", "true");
}
function drawLightbox() {
  const p = lbList[lbPos];
  if (!p) return;
  renderInto($("#lb-canvas"), p.tokenSeed, 1000);
  $("#lb-title").textContent = `#${p.index} · ${p.traits.movement} · ${p.traits.element}`;
  $("#lb-meta").textContent =
    `seed ${p.tokenSeed} · palette ${p.traits.palette} · ${p.traits.rarityTier} · ` +
    `density ${pct(p.traits.density)} · scale ${pct(p.traits.scale)}`;
  $("#lb-fav").textContent = p.status === "fav" ? "★ Favourited" : "☆ Favourite";
}
function lbStep(d) {
  lbPos = (lbPos + d + lbList.length) % lbList.length;
  drawLightbox();
}

/* ============================================================================
 * EXPORT — PNG + JSON sidecar, and whole-collection ZIP.
 * ========================================================================== */
function pieceJSON(p) {
  return {
    tool: "cipher-01-algorithm-studio",
    researchStudioVersion: 1,
    collectionSeed: config.seed,
    tokenIndex: p.index,
    tokenSeed: p.tokenSeed,
    status: p.status,
    config: configForExport(),
    traits: p.traits,
  };
}
function configForExport() {
  // shallow clone without runtime cruft
  return JSON.parse(JSON.stringify(config));
}

function renderExportCanvas(p) {
  const c = document.createElement("canvas");
  renderInto(c, p.tokenSeed, R_EXPORT);
  return c;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function canvasToBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}

async function exportPiece(p) {
  const canvas = renderExportCanvas(p);
  const blob = await canvasToBlob(canvas);
  const base = `${slug(config.seed)}_${String(p.index).padStart(3, "0")}`;
  downloadBlob(blob, base + ".png");
  downloadBlob(
    new Blob([JSON.stringify(pieceJSON(p), null, 2)], { type: "application/json" }),
    base + ".json"
  );
}

async function exportZip() {
  if (!collection.length) {
    alert("Generate a collection first (Panel 3 → Generate).");
    return;
  }
  if (typeof JSZip === "undefined") {
    alert("ZIP library didn’t load — downloading the first piece individually instead.");
    return exportPiece(collection[0]);
  }
  const btn = $("#btn-zip");
  btn.disabled = true;
  const zip = new JSZip();
  const folder = zip.folder(slug(config.seed));
  // include collection-level manifest
  folder.file(
    "collection.json",
    JSON.stringify(
      {
        tool: "cipher-01-algorithm-studio",
        collectionSeed: config.seed,
        size: collection.length,
        config: configForExport(),
        pieces: collection.map((p) => ({
          tokenIndex: p.index,
          tokenSeed: p.tokenSeed,
          status: p.status,
          rarity: p.traits.rarityTier,
        })),
      },
      null,
      2
    )
  );

  const progress = $("#progress");
  progress.hidden = false;
  const bar = $("#progress > i");

  for (let i = 0; i < collection.length; i++) {
    const p = collection[i];
    const canvas = renderExportCanvas(p);
    const blob = await canvasToBlob(canvas);
    const base = `${String(p.index).padStart(3, "0")}`;
    folder.file(base + ".png", blob);
    folder.file(base + ".json", JSON.stringify(pieceJSON(p), null, 2));
    bar.style.width = pct((i + 1) / collection.length);
    btn.textContent = `Zipping ${i + 1}/${collection.length}…`;
    await new Promise((r) => setTimeout(r)); // let UI breathe
  }

  const out = await zip.generateAsync({ type: "blob" }, (m) => {
    bar.style.width = pct(m.percent / 100);
  });
  downloadBlob(out, `${slug(config.seed)}_collection.zip`);
  progress.hidden = true;
  btn.disabled = false;
  btn.textContent = "Export collection (ZIP)";
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "collection";

/* ============================================================================
 * TABS + stage switching
 * ========================================================================== */
function showPanel(panelId) {
  $$(".tab").forEach((t) =>
    t.setAttribute("aria-selected", t.getAttribute("aria-controls") === panelId ? "true" : "false")
  );
  $$(".panel").forEach((p) => p.setAttribute("data-active", p.id === panelId ? "true" : "false"));
  $$(".stage-view").forEach((s) => (s.hidden = s.getAttribute("data-for") !== panelId));
  if (panelId === "panel-design") renderPreview();
  if (panelId === "panel-rules") renderStrip();
}

/* debounce live re-renders while dragging sliders */
let rafPending = null;
function liveUpdate() {
  const active = $(".panel[data-active='true']").id;
  if (rafPending) cancelAnimationFrame(rafPending);
  rafPending = requestAnimationFrame(() => {
    if (active === "panel-design") renderPreview();
    else if (active === "panel-rules") renderStrip();
  });
}

/* ============================================================================
 * INIT
 * ========================================================================== */
function init() {
  // Panel 1
  buildSegmented("seg-element", OPTIONS.element, "element", liveUpdate);
  buildSegmented("seg-movement", OPTIONS.movement, "movement", liveUpdate);
  buildSegmented("seg-colorRule", OPTIONS.colorRule, "colorRule", liveUpdate);
  buildSegmented("seg-texture", OPTIONS.texture, "texture", liveUpdate);
  buildCompositionSliders(liveUpdate);
  buildBehaviours(liveUpdate);
  buildPalettes(liveUpdate);
  buildRandomness(liveUpdate);

  // Panel 2
  const seedInput = $("#seed");
  seedInput.value = config.seed;
  seedInput.addEventListener("input", (e) => {
    config.seed = e.target.value || "studio-cipher";
    liveUpdate();
  });
  $("#size-slider").append(
    sliderRow(
      "Collection size",
      "How many pieces the collection contains.",
      () => config.size,
      (v) => (config.size = Math.round(v)),
      () => renderStrip(),
      { min: 1, max: 256, step: 1, fmt: (v) => Math.round(v) + " pieces" }
    )
  );
  buildLocks(() => renderStrip());
  buildVariation(() => renderStrip());
  $("#mustBeUnique").checked = config.mustBeUnique;
  $("#mustBeUnique").addEventListener("change", (e) => (config.mustBeUnique = e.target.checked));
  buildForbid(() => renderStrip());
  $("#add-rule").addEventListener("click", () => {
    config.forbid.push({
      ifTrait: "element",
      ifValue: OPTIONS.element[0].id,
      neverTrait: "palette",
      neverValue: Object.keys(PALETTES)[0],
    });
    buildForbid(() => renderStrip());
  });

  // tabs
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => showPanel(t.getAttribute("aria-controls")))
  );

  // Panel 1 stage
  $("#btn-reroll").addEventListener("click", () => {
    previewSalt++;
    renderPreview();
  });
  // Panel 2 stage
  $("#btn-restrip").addEventListener("click", () => {
    stripSalt += 3;
    renderStrip();
  });

  // Panel 3
  $("#btn-generate").addEventListener("click", generateCollection);
  $("#btn-detect").addEventListener("click", () => {
    detectSimilar(true);
    updateStats();
  });
  $("#sort").addEventListener("change", reorderSheet);
  $("#btn-zip").addEventListener("click", exportZip);

  // lightbox
  $("#lb-close").addEventListener("click", closeLightbox);
  $("#lb-prev").addEventListener("click", () => lbStep(-1));
  $("#lb-next").addEventListener("click", () => lbStep(1));
  $("#lb-fav").addEventListener("click", () => {
    const p = lbList[lbPos];
    toggleStatus(p, "fav");
    drawLightbox();
  });
  $("#lb-png").addEventListener("click", () => exportPiece(lbList[lbPos]));
  document.addEventListener("keydown", (e) => {
    if ($("#lightbox").getAttribute("data-open") !== "true") return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") lbStep(-1);
    if (e.key === "ArrowRight") lbStep(1);
  });

  // first paint
  renderPreview();
}

init();
