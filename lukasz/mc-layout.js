/* Mission Control layout engine — collapse-to-pill, drag-to-reorder, persistence.
   Vanilla pointer events, no dependencies. Layout state in localStorage mc_layout_v1:
   { order: {containerId: [panelId,…]}, collapsed: {panelId: bool} }
   The mirror is sacred: never collapsible, never draggable. */
(function () {
  "use strict";

  const KEY = "mc_layout_v1";
  const MOBILE = window.matchMedia("(max-width: 768px)");
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const DEFAULT_COLLAPSED = { operator: true, handoff: true, github: true, tools: true, board: true };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) { /* corrupted state falls back to default */ }
    return { order: {}, collapsed: { ...DEFAULT_COLLAPSED } };
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function panels() {
    return [...document.querySelectorAll("[data-panel]")];
  }

  function containers() {
    return [...document.querySelectorAll("[data-container]")];
  }

  /* ---- Restore saved order ------------------------------------------------ */

  function applyOrder() {
    containers().forEach((container) => {
      const saved = state.order[container.dataset.container];
      if (!saved) return;
      const children = [...container.children].filter((c) => c.dataset.panel || c.dataset.container);
      const byId = new Map(children.map((c) => [c.dataset.panel || c.dataset.container, c]));
      saved.forEach((id) => {
        const node = byId.get(id);
        if (node) container.appendChild(node);
      });
      // anything not in the saved list keeps relative order at the end
      children.forEach((c) => {
        const id = c.dataset.panel || c.dataset.container;
        if (!saved.includes(id)) container.appendChild(c);
      });
    });
  }

  function rememberOrder(container) {
    state.order[container.dataset.container] = [...container.children]
      .map((c) => c.dataset.panel || c.dataset.container)
      .filter(Boolean);
    save();
  }

  /* ---- Collapse to pill ----------------------------------------------------- */

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
    collapseBtn.textContent = "–";
    collapseBtn.title = "Collapse";
    collapseBtn.addEventListener("click", () => setCollapsed(panel, true));
    panel.appendChild(collapseBtn);

    if (state.collapsed[id]) panel.classList.add("is-collapsed");
  }

  function setCollapsed(panel, collapsed) {
    panel.classList.toggle("is-collapsed", collapsed);
    state.collapsed[panel.dataset.panel] = collapsed;
    save();
  }

  /* ---- Drag to reorder (pointer events, grid-snapped via live insertBefore) --- */

  function setupDrag(panel) {
    const id = panel.dataset.panel;
    if (id === "mirror") return;
    const handle = panel.querySelector(".panel-code");
    if (!handle) return;
    handle.classList.add("mc-drag-handle");

    handle.addEventListener("pointerdown", (event) => {
      if (MOBILE.matches || panel.classList.contains("is-collapsed")) return;
      if (event.button !== 0) return;
      event.preventDefault();

      const container = panel.parentElement;
      const startY = event.clientY;
      const startX = event.clientX;
      let dragging = false;

      function onMove(move) {
        if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) < 6) return;
        if (!dragging) {
          dragging = true;
          panel.classList.add("is-lifted");
        }
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
          if (!REDUCED_MOTION.matches) {
            panel.classList.add("is-settling");
            setTimeout(() => panel.classList.remove("is-settling"), 260);
          }
          rememberOrder(container);
        }
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  /* ---- Reset ------------------------------------------------------------------- */

  function setupReset() {
    const button = document.getElementById("layoutReset");
    if (!button) return;
    button.addEventListener("click", () => {
      localStorage.removeItem(KEY);
      window.location.reload();
    });
  }

  /* ---- Boot ----------------------------------------------------------------------- */

  applyOrder();
  panels().forEach((panel) => {
    setupCollapse(panel);
    setupDrag(panel);
  });
  setupReset();
})();
