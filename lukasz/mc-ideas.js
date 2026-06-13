// IDEAS LOG (panel 04) — a tiny localStorage idea tracker for the 10-day lab
// studio project (lab.bukowiecki.co). Frontend-only and dependency-free, like
// the runway date: add, reorder, tick done, edit, delete. Key: mc_ideas_v1.
(function () {
  "use strict";

  const KEY = "mc_ideas_v1";
  const form = document.getElementById("mcIdeaForm");
  const input = document.getElementById("mcIdeaInput");
  const list = document.getElementById("mcIdeasList");
  if (!form || !list) return; // panel not present

  let ideas = load();
  let editingId = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((i) => i && typeof i.text === "string") : [];
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(ideas));
    } catch (err) { /* storage full / blocked — keep the in-memory list */ }
  }

  function newId() {
    return "idea_" + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function render() {
    if (!ideas.length) {
      list.innerHTML = `<div class="mc-empty">No ideas yet — add tomorrow's build.</div>`;
      return;
    }
    list.innerHTML = ideas.map((idea, index) => {
      if (idea.id === editingId) {
        return `
          <div class="mc-idea is-editing" data-id="${idea.id}">
            <form class="mc-idea-edit">
              <input type="text" value="${escapeHtml(idea.text)}" maxlength="200" />
              <button type="submit" data-act="save">Save</button>
              <button type="button" data-act="cancel">Cancel</button>
            </form>
          </div>`;
      }
      return `
        <div class="mc-idea${idea.done ? " is-done" : ""}" data-id="${idea.id}">
          <span class="mc-idea-reorder">
            <button type="button" data-act="up" ${index === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
            <button type="button" data-act="down" ${index === ideas.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
          </span>
          <button type="button" class="mc-idea-tick" data-act="toggle" aria-label="${idea.done ? "Mark not done" : "Mark done"}">✓</button>
          <span class="mc-idea-text" data-act="edit" title="Click to edit">${escapeHtml(idea.text)}</span>
          <span class="mc-idea-actions">
            <button type="button" data-act="edit" aria-label="Edit">✎</button>
            <button type="button" data-act="delete" class="mc-idea-del" aria-label="Delete">✕</button>
          </span>
        </div>`;
    }).join("");
  }

  function indexOf(id) {
    return ideas.findIndex((i) => i.id === id);
  }

  function commit() {
    save();
    render();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    ideas.push({ id: newId(), text, done: false });
    input.value = "";
    commit();
  });

  list.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    const row = btn.closest(".mc-idea");
    if (!row) return;
    const id = row.dataset.id;
    const act = btn.dataset.act;

    if (act === "toggle") {
      const i = indexOf(id);
      if (i >= 0) { ideas[i].done = !ideas[i].done; commit(); }
    } else if (act === "delete") {
      ideas = ideas.filter((idea) => idea.id !== id);
      commit();
    } else if (act === "edit") {
      editingId = id;
      render();
      const field = list.querySelector(".mc-idea.is-editing input");
      if (field) { field.focus(); field.select(); }
    } else if (act === "save") {
      event.preventDefault();
      saveEdit(row);
    } else if (act === "cancel") {
      editingId = null;
      render();
    } else if (act === "up" || act === "down") {
      const i = indexOf(id);
      const j = act === "up" ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < ideas.length) {
        [ideas[i], ideas[j]] = [ideas[j], ideas[i]];
        commit();
      }
    }
  });

  function saveEdit(row) {
    const id = row.dataset.id;
    const text = row.querySelector(".mc-idea-edit input").value.trim();
    const i = indexOf(id);
    if (i >= 0 && text) ideas[i].text = text;
    editingId = null;
    commit();
  }

  // Enter key in the edit field fires a native (bubbling) submit; the Save
  // button is also handled via click-delegation above, so both paths work.
  list.addEventListener("submit", (event) => {
    const editForm = event.target.closest(".mc-idea-edit");
    if (!editForm) return;
    event.preventDefault();
    saveEdit(editForm.closest(".mc-idea"));
  });

  render();
})();
