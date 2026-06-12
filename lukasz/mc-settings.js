/* Mission Control customisation — mood presets + fine-grained settings drawer.
   All visual values are CSS custom properties on :root; this file only writes
   variables (document.documentElement.style.setProperty) — CSS transitions do
   the rest. Keys: mc_mood, mc_custom_preset, mc_bg_image, mc_bg_blur. */
(function () {
  "use strict";

  const root = document.documentElement;
  const toast = (msg) => window.MCLayout && window.MCLayout.toast(msg);

  /* ---- Token vocabulary ----------------------------------------------------- */

  const VAR_KEYS = [
    "--mc-bg-color", "--mc-glass-opacity",
    "--mc-glass-tint-r", "--mc-glass-tint-g", "--mc-glass-tint-b",
    "--mc-glass-border-opacity", "--mc-backdrop-blur",
    "--mc-light-direction", "--mc-light-color", "--mc-light-intensity",
    "--mc-bg-blur", "--mc-bg-intensity",
  ];

  const MOODS = {
    focus: {
      "--mc-bg-color": "#0a0d14",
      "--mc-glass-opacity": "0.065",
      "--mc-glass-tint-r": "180", "--mc-glass-tint-g": "200", "--mc-glass-tint-b": "255",
      "--mc-glass-border-opacity": "0.09",
      "--mc-backdrop-blur": "20px",
      "--mc-light-color": "150, 180, 255",
      "--mc-light-intensity": "0.12",
    },
    energy: {
      "--mc-bg-color": "#1a140f",
      "--mc-glass-opacity": "0.075",
      "--mc-glass-tint-r": "255", "--mc-glass-tint-g": "248", "--mc-glass-tint-b": "240",
      "--mc-glass-border-opacity": "0.10",
      "--mc-backdrop-blur": "16px",
      "--mc-light-color": "255, 166, 87",
      "--mc-light-intensity": "0.15",
    },
    calm: {
      "--mc-bg-color": "#141210",
      "--mc-glass-opacity": "0.05",
      "--mc-glass-tint-r": "220", "--mc-glass-tint-g": "215", "--mc-glass-tint-b": "205",
      "--mc-glass-border-opacity": "0.06",
      "--mc-backdrop-blur": "24px",
      "--mc-light-color": "220, 210, 190",
      "--mc-light-intensity": "0.08",
    },
  };
  const MOOD_META = { focus: "🌙 Focus", energy: "🔥 Energy", calm: "🌫️ Calm", custom: "✦ Custom" };

  const BG_PALETTE = [
    ["Near-black warm", "#1a140f"], ["Deep navy", "#0d1420"], ["Dark forest", "#0f1a14"],
    ["Deep burgundy", "#1f0f14"], ["Dark slate", "#14161c"], ["Dark cognac", "#1a0f06"],
    ["Charcoal purple", "#171221"], ["Pure black", "#000000"],
  ];
  const TINTS = [
    ["Warm white", [255, 248, 240]], ["Cool white", [235, 242, 255]], ["Amber", [255, 220, 170]],
    ["Blue", [180, 200, 255]], ["Green", [200, 235, 215]], ["Rose", [255, 205, 215]],
  ];
  const LIGHT_COLORS = [
    ["Warm white", "255, 240, 220"], ["Cool white", "220, 235, 255"], ["Amber", "255, 200, 120"],
    ["Sunset orange", "255, 160, 80"], ["Electric blue", "120, 170, 255"], ["Soft green", "160, 220, 180"],
  ];
  const COMPASS = {
    NW: "0% 0%", N: "50% 0%", NE: "100% 0%",
    W: "0% 50%", E: "100% 50%",
    SW: "0% 100%", S: "50% 100%", SE: "100% 100%",
  };

  /* ---- Apply / read state ----------------------------------------------------- */

  function applyVars(tokens) {
    Object.entries(tokens).forEach(([key, value]) => root.style.setProperty(key, value));
    syncDrawer();
  }

  function currentVars() {
    const out = {};
    const computed = getComputedStyle(root);
    VAR_KEYS.forEach((key) => {
      out[key] = (root.style.getPropertyValue(key) || computed.getPropertyValue(key)).trim();
    });
    return out;
  }

  function setMood(name) {
    if (name === "custom") {
      const saved = loadJson("mc_custom_preset");
      if (!saved) return;
      applyVars(saved);
    } else if (MOODS[name]) {
      applyVars(MOODS[name]);
    } else {
      return;
    }
    localStorage.setItem("mc_mood", name);
    document.querySelectorAll("[data-mood]").forEach((pill) => {
      pill.classList.toggle("is-active", pill.dataset.mood === name);
    });
  }

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (err) { return null; }
  }

  /* ---- Background image --------------------------------------------------------- */

  function applyBgImage(dataUrl) {
    let layer = document.querySelector(".mc-ambient-image");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "mc-ambient-image";
      layer.setAttribute("aria-hidden", "true");
      document.body.prepend(layer);
    }
    if (dataUrl) {
      layer.style.backgroundImage = `url(${dataUrl})`;
      document.body.classList.add("has-bg-image");
    } else {
      layer.style.backgroundImage = "";
      document.body.classList.remove("has-bg-image");
    }
  }

  function onImageUpload(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast("JPG, PNG or WebP only.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("Image too large — 5MB max.");
      return;
    }
    // Downscale + re-encode before storing: raw base64 of a multi-MB photo
    // exceeds the localStorage quota and the save silently fails. 2200px is
    // plenty behind a blur layer; JPEG q0.85 keeps it well under 1MB.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      try {
        localStorage.setItem("mc_bg_image", dataUrl);
        applyBgImage(dataUrl);
        toast("Background set.");
      } catch (err) {
        toast("Image too large to store — try a smaller file.");
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast("Could not read that image.");
    };
    img.src = url;
  }

  /* ---- Drawer ---------------------------------------------------------------------- */

  function swatches(items, attr, render) {
    return items.map(([label, value], index) =>
      `<button type="button" class="mc-swatch" data-${attr}="${index}" title="${label}" style="${render(value)}"></button>`
    ).join("");
  }

  function buildDrawer() {
    const drawer = document.createElement("aside");
    drawer.id = "mcSettings";
    drawer.innerHTML = `
      <div class="mc-settings__head">
        <p class="panel-code">CUSTOMISE</p>
        <button type="button" class="mc-settings__close" aria-label="Close">×</button>
      </div>

      <p class="mc-label">Background</p>
      <div class="mc-settings__row mc-settings__swatches">
        ${swatches(BG_PALETTE, "bg", (v) => `background:${v}`)}
      </div>
      <div class="mc-settings__upload">
        <label>
          <input id="mcBgUpload" type="file" accept="image/jpeg,image/png,image/webp" hidden />
          <span class="ghost-button">Upload image…</span>
        </label>
        <button type="button" id="mcBgClear" class="ghost-button">Clear</button>
      </div>
      <label class="mc-settings__slider">
        <span>Image blur</span>
        <input id="mcBgBlur" type="range" min="0" max="20" step="1" />
      </label>
      <label class="mc-settings__slider">
        <span>Image intensity</span>
        <input id="mcBgIntensity" type="range" min="0.1" max="1" step="0.01" />
      </label>

      <p class="mc-label">Glass</p>
      <label class="mc-settings__slider">
        <span>Glass opacity</span>
        <input id="mcGlassOpacity" type="range" min="0" max="0.8" step="0.005" />
      </label>
      <div class="mc-settings__row mc-settings__swatches">
        ${swatches(TINTS, "tint", (v) => `background:rgb(${v.join(",")})`)}
      </div>
      <label class="mc-settings__slider">
        <span>Edge glow</span>
        <input id="mcEdgeGlow" type="range" min="0" max="1" step="0.01" />
      </label>
      <label class="mc-settings__slider">
        <span>Blur depth</span>
        <input id="mcBlurDepth" type="range" min="4" max="40" step="1" />
      </label>

      <p class="mc-label">Lighting</p>
      <div class="mc-settings__compass">
        ${["NW", "N", "NE", "W", "", "E", "SW", "S", "SE"].map((dir) =>
          dir ? `<button type="button" data-dir="${dir}">${dir}</button>` : `<span></span>`
        ).join("")}
      </div>
      <div class="mc-settings__row mc-settings__swatches">
        ${swatches(LIGHT_COLORS, "light", (v) => `background:rgb(${v})`)}
      </div>
      <label class="mc-settings__slider">
        <span>Light intensity</span>
        <input id="mcLightIntensity" type="range" min="0" max="0.6" step="0.01" />
      </label>

      <div class="mc-settings__actions">
        <button type="button" id="mcSavePreset" class="ghost-button">Save as custom preset</button>
        <button type="button" id="mcResetTheme" class="ghost-button">Reset to defaults</button>
      </div>
    `;
    document.body.appendChild(drawer);

    drawer.querySelector(".mc-settings__close").addEventListener("click", closeDrawer);

    drawer.querySelectorAll("[data-bg]").forEach((b) =>
      b.addEventListener("click", () => applyVars({ "--mc-bg-color": BG_PALETTE[b.dataset.bg][1] })));
    drawer.querySelectorAll("[data-tint]").forEach((b) =>
      b.addEventListener("click", () => {
        const [r, g, bch] = TINTS[b.dataset.tint][1];
        applyVars({ "--mc-glass-tint-r": r, "--mc-glass-tint-g": g, "--mc-glass-tint-b": bch });
      }));
    drawer.querySelectorAll("[data-light]").forEach((b) =>
      b.addEventListener("click", () => applyVars({ "--mc-light-color": LIGHT_COLORS[b.dataset.light][1] })));
    drawer.querySelectorAll("[data-dir]").forEach((b) =>
      b.addEventListener("click", () => {
        applyVars({ "--mc-light-direction": COMPASS[b.dataset.dir] });
        drawer.querySelectorAll("[data-dir]").forEach((x) => x.classList.toggle("is-active", x === b));
      }));

    bindSlider("mcGlassOpacity", "--mc-glass-opacity", (v) => v);
    bindSlider("mcEdgeGlow", "--mc-glass-border-opacity", (v) => v);
    bindSlider("mcBlurDepth", "--mc-backdrop-blur", (v) => `${v}px`);
    bindSlider("mcLightIntensity", "--mc-light-intensity", (v) => v);
    bindSlider("mcBgBlur", "--mc-bg-blur", (v) => {
      localStorage.setItem("mc_bg_blur", `${v}px`);
      return `${v}px`;
    });
    bindSlider("mcBgIntensity", "--mc-bg-intensity", (v) => {
      localStorage.setItem("mc_bg_intensity", v);
      return v;
    });

    drawer.querySelector("#mcBgUpload").addEventListener("change", (e) => onImageUpload(e.target.files[0]));
    drawer.querySelector(".mc-settings__upload .ghost-button").addEventListener("click", (e) => {
      e.preventDefault();
      drawer.querySelector("#mcBgUpload").click();
    });
    drawer.querySelector("#mcBgClear").addEventListener("click", () => {
      localStorage.removeItem("mc_bg_image");
      applyBgImage(null);
      toast("Background image cleared.");
    });

    drawer.querySelector("#mcSavePreset").addEventListener("click", () => {
      localStorage.setItem("mc_custom_preset", JSON.stringify(currentVars()));
      localStorage.setItem("mc_mood", "custom");
      ensureCustomPill();
      setMood("custom");
      toast("Custom preset saved.");
    });
    drawer.querySelector("#mcResetTheme").addEventListener("click", () => {
      ["mc_mood", "mc_custom_preset", "mc_bg_image", "mc_bg_blur", "mc_bg_intensity"].forEach((k) => localStorage.removeItem(k));
      VAR_KEYS.forEach((k) => root.style.removeProperty(k));
      applyBgImage(null);
      const customPill = document.querySelector('[data-mood="custom"]');
      if (customPill) customPill.remove();
      setMood("energy");
      toast("Theme reset to defaults.");
    });

    return drawer;
  }

  function bindSlider(id, varName, format) {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
      root.style.setProperty(varName, format(input.value));
    });
  }

  /* Reflect the live variable values back into the drawer controls */
  function syncDrawer() {
    const drawer = document.getElementById("mcSettings");
    if (!drawer) return;
    const vars = currentVars();
    const num = (v) => parseFloat(v) || 0;
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    set("mcGlassOpacity", num(vars["--mc-glass-opacity"]));
    set("mcEdgeGlow", num(vars["--mc-glass-border-opacity"]));
    set("mcBlurDepth", num(vars["--mc-backdrop-blur"]));
    set("mcLightIntensity", num(vars["--mc-light-intensity"]));
    set("mcBgBlur", num(vars["--mc-bg-blur"]));
    set("mcBgIntensity", vars["--mc-bg-intensity"] === "" ? 1 : num(vars["--mc-bg-intensity"]));
    const dir = vars["--mc-light-direction"];
    drawer.querySelectorAll("[data-dir]").forEach((b) =>
      b.classList.toggle("is-active", COMPASS[b.dataset.dir] === dir));
  }

  let drawerEl = null;
  function openDrawer() {
    if (!drawerEl) drawerEl = buildDrawer();
    syncDrawer();
    requestAnimationFrame(() => drawerEl.classList.add("is-open"));
  }
  function closeDrawer() {
    if (drawerEl) drawerEl.classList.remove("is-open");
  }

  /* ---- Nav: mood pills + customise button --------------------------------------------- */

  function pill(mood) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button mc-mood-pill";
    button.dataset.mood = mood;
    button.textContent = MOOD_META[mood];
    button.addEventListener("click", () => setMood(mood));
    return button;
  }

  function ensureCustomPill() {
    if (!document.querySelector('[data-mood="custom"]') && loadJson("mc_custom_preset")) {
      document.querySelector('[data-mood="calm"]').after(pill("custom"));
    }
  }

  function setupNav() {
    const meta = document.querySelector(".top-meta");
    const anchor = meta.querySelector("[data-tools-link]");
    ["focus", "energy", "calm"].forEach((mood) => meta.insertBefore(pill(mood), anchor));
    ensureCustomPill();

    const customise = document.createElement("button");
    customise.type = "button";
    customise.id = "customiseButton";
    customise.className = "ghost-button";
    customise.textContent = "Customise";
    customise.addEventListener("click", () => {
      if (drawerEl && drawerEl.classList.contains("is-open")) closeDrawer();
      else openDrawer();
    });
    document.getElementById("lockButton").before(customise);
  }

  /* ---- Boot ------------------------------------------------------------------------------ */

  setupNav();
  const storedBlur = localStorage.getItem("mc_bg_blur");
  if (storedBlur) root.style.setProperty("--mc-bg-blur", storedBlur);
  const storedIntensity = localStorage.getItem("mc_bg_intensity");
  if (storedIntensity) root.style.setProperty("--mc-bg-intensity", storedIntensity);
  setMood(localStorage.getItem("mc_mood") || "energy");
  const storedImage = localStorage.getItem("mc_bg_image");
  if (storedImage) applyBgImage(storedImage);
})();
