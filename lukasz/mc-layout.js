/* Mission Control layout engine — lock/unlock editing, drag (within and across
   columns), width resize, collapse-to-pill, persistence. Vanilla pointer events.
   Keys: mc_layout_v1 {order:{containerId:[ids]}, spans:{id:n}} · mc_collapsed_v1 {id:bool}
   Locked is the default: the morning-use state, nothing accidentally moves. */
(function () {
  "use strict";

  const LAYOUT_KEY = "mc_layout_v1";
  const COLLAPSED_KEY = "mc_collapsed_v1";
  const MOBILE = window.matchMedia("(max-width: 768px)");
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const DEFAULT_COLLAPSED = { operator: true, handoff: true, github: true, tools: true, board: true };

  let editing = false;
  let layout = loadJson(LAYOUT_KEY) || { order: {}, spans: {} };
  let collapsed = loadJson(COLLAPSED_KEY);

  // Migrate the v4 combined shape ({order, collapsed}) into the split keys
  if (!collapsed) {
    collapsed = layout.collapsed || { ...DEFAULT_COLLAPSED };
    delete layout.collapsed;
    saveJson(COLLAPSED_KEY, collapsed);
  }
  if (!layout.order) layout = { order: {}, spans: {} };
  if (!layout.spans) layout.spans = {};

  function loadJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (err) { /* corrupted state falls back to default */ }
    return null;
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function panels() {
    return [...document.querySelectorAll("[data-panel]")];
  }

  function containers() {
    return [...document.querySelectorAll("[data-container]")];
  }

  function itemId(node) {
    return node.dataset.panel || node.dataset.container;
  }

  /* ---- Toast ---------------------------------------------------------------- */

  let toastTimer = null;
  function toast(message) {
    let node = document.getElementById("mcToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "mcToast";
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("is-visible"), 2200);
  }

  /* ---- Restore: order (cross-container aware) + spans ------------------------- */

  function applyOrder() {
    containers().forEach((container) => {
      const saved = layout.order[container.dataset.container];
      if (!saved) return;
      saved.forEach((id) => {
        const node = document.querySelector(`[data-panel="${CSS.escape(id)}"]`)
          || document.querySelector(`[data-container="${CSS.escape(id)}"]`);
        if (node && node !== container && !node.contains(container)) container.appendChild(node);
      });
    });
  }

  function applySpans() {
    Object.entries(layout.spans).forEach(([id, span]) => {
      const node = document.querySelector(`[data-panel="${CSS.escape(id)}"], [data-container="${CSS.escape(id)}"]`);
      if (node && node.parentElement && node.parentElement.dataset.container === "root") {
        node.style.gridColumn = `span ${span}`;
      }
    });
  }

  function saveAllOrders() {
    containers().forEach((container) => {
      layout.order[container.dataset.container] = [...container.children].map(itemId).filter(Boolean);
    });
    saveJson(LAYOUT_KEY, layout);
  }

  /* ---- Collapse to pill (chevron in panel chrome) ------------------------------ */

  function setupCollapse(panel) {
    const id = panel.dataset.panel;
    if (id === "mirror") return;

    const codeEl = panel.querySelector(".panel-code");
    const label = codeEl ? codeEl.textContent.trim() : id.toUpperCase();

    const pillHead = document.createElement("button");
    pillHead.type = "button";
    pillHead.className = "mc-pill-head";
    pillHead.innerHTML = `<span class="panel-code">${MCUI.escapeHtml(label)}</span><span aria-hidden="true">+</span>`;
    pillHead.title = "Expand";
    pillHead.addEventListener("click", () => setCollapsed(panel, false));
    panel.appendChild(pillHead);

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "mc-collapse-btn";
    collapseBtn.textContent = "⌄";
    collapseBtn.title = "Collapse";
    collapseBtn.addEventListener("click", () => setCollapsed(panel, true));
    panel.appendChild(collapseBtn);

    if (collapsed[id]) panel.classList.add("is-collapsed");
  }

  function setCollapsed(panel, value) {
    panel.classList.toggle("is-collapsed", value);
    collapsed[panel.dataset.panel] = value;
    saveJson(COLLAPSED_KEY, collapsed);
  }

  /* ---- Edit mode (lock/unlock) -------------------------------------------------- */

  function setEditing(value) {
    if (MOBILE.matches) value = false;
    editing = value;
    document.body.classList.toggle("is-editing", editing);
    const button = document.getElementById("editLayoutButton");
    if (button) {
      button.textContent = editing ? "Done" : "Edit layout";
      button.classList.toggle("is-active", editing);
    }
  }

  /* ---- Drag: grip handle, free movement across containers ------------------------ */

  function setupDrag(panel) {
    if (panel.dataset.panel === "mirror") return;

    const grip = document.createElement("span");
    grip.className = "mc-grip";
    grip.title = "Drag to move";
    grip.textContent = "⠿";
    panel.appendChild(grip);

    grip.addEventListener("pointerdown", (event) => {
      if (!editing || MOBILE.matches || event.button !== 0) return;
      if (panel.classList.contains("is-collapsed")) return;
      event.preventDefault();

      let dragging = false;
      const startX = event.clientX;
      const startY = event.clientY;

      function onMove(move) {
        if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) < 6) return;
        if (!dragging) {
          dragging = true;
          panel.classList.add("is-lifted");
          panel.style.pointerEvents = "none";
        }
        const under = document.elementFromPoint(move.clientX, move.clientY);
        if (!under) return;
        const target = under.closest("[data-container]");
        if (!target || target.contains(panel) && target !== panel.parentElement && target.dataset.container !== "root") {
          // fallthrough — only meaningful containers accept drops
        }
        const container = target || panel.parentElement;
        const siblings = [...container.children].filter(
          (c) => c !== panel && (c.dataset.panel || c.dataset.container)
        );
        let placed = false;
        for (const sibling of siblings) {
          const box = sibling.getBoundingClientRect();
          const before =
            move.clientY < box.top + box.height / 2 ||
            (move.clientY < box.bottom && move.clientX < box.left + box.width / 2);
          if (before) {
            if (sibling.previousElementSibling !== panel) container.insertBefore(panel, sibling);
            placed = true;
            break;
          }
        }
        if (!placed && container.lastElementChild !== panel) container.appendChild(panel);
      }

      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (dragging) {
          panel.classList.remove("is-lifted");
          panel.style.pointerEvents = "";
          if (!REDUCED_MOTION.matches) {
            panel.classList.add("is-settling");
            setTimeout(() => panel.classList.remove("is-settling"), 260);
          }
          saveAllOrders();
        }
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  /* ---- Resize: width handle on root-level items, snapped to grid columns ---------- */

  function setupResize(node) {
    const handle = document.createElement("span");
    handle.className = "mc-resize";
    handle.title = "Drag to resize";
    node.appendChild(handle);

    handle.addEventListener("pointerdown", (event) => {
      if (!editing || MOBILE.matches || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const root = document.querySelector('[data-container="root"]');
      const colWidth = root.getBoundingClientRect().width / 12;
      const startX = event.clientX;
      const startSpan = currentSpan(node);

      function onMove(move) {
        const delta = Math.round((move.clientX - startX) / colWidth);
        const next = Math.min(12, Math.max(3, startSpan + delta));
        if (next !== currentSpan(node)) {
          node.style.gridColumn = `span ${next}`;
        }
      }

      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        layout.spans[itemId(node)] = currentSpan(node);
        saveJson(LAYOUT_KEY, layout);
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function currentSpan(node) {
    const match = /span (\d+)/.exec(node.style.gridColumn || "");
    if (match) return Number(match[1]);
    if (node.classList.contains("span-12")) return 12;
    if (node.classList.contains("span-8")) return 8;
    if (node.classList.contains("span-3")) return 3;
    return 4;
  }

  /* ---- Nav buttons ------------------------------------------------------------------ */

  function setupNav() {
    const reset = document.getElementById("layoutReset");
    if (reset) {
      reset.addEventListener("click", () => {
        localStorage.removeItem(LAYOUT_KEY);
        localStorage.removeItem(COLLAPSED_KEY);
        toast("Layout reset.");
        setTimeout(() => window.location.reload(), 450);
      });
    }
    const edit = document.getElementById("editLayoutButton");
    if (edit) edit.addEventListener("click", () => setEditing(!editing));
  }

  /* ---- Staggered panel appearance, fired when the app actually becomes visible ------- */

  function setupAppear() {
    if (REDUCED_MOTION.matches || !window.MCUI) return;
    const app = document.getElementById("app");
    if (!app) return;
    const run = () => MCUI.staggerAppear(panels().filter((p) => !p.classList.contains("is-collapsed")));
    if (!app.classList.contains("is-hidden")) {
      run();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!app.classList.contains("is-hidden")) {
        observer.disconnect();
        run();
      }
    });
    observer.observe(app, { attributes: true, attributeFilter: ["class"] });
  }

  /* ---- Boot --------------------------------------------------------------------------- */

  applyOrder();
  applySpans();
  panels().forEach((panel) => {
    setupCollapse(panel);
    setupDrag(panel);
  });
  [...document.querySelector('[data-container="root"]').children]
    .filter((c) => c.dataset.panel || c.dataset.container)
    .forEach(setupResize);
  setupNav();
  setupAppear();
  setEditing(false);

  window.MCLayout = { toast };
})();
