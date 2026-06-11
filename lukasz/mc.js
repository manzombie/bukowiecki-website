// Mission Control — daily mirror, moleskine, ventures. Talks to the /api/mc
// backend (FastAPI app behind tools.bukowiecki.co) with a bearer token.
// Deliberately separate from app.js so the original board stays untouched.
(function () {
  const CFG = window.MISSION_CONFIG || {};
  const API_URL = (CFG.mcApiUrl || "https://tools.bukowiecki.co").replace(/\/$/, "");
  const TOKEN_KEY = "mc_api_token";

  const els = {
    connect: document.getElementById("mcConnect"),
    connectForm: document.getElementById("mcConnectForm"),
    connectInput: document.getElementById("mcConnectInput"),
    connectError: document.getElementById("mcConnectError"),
    mirrorBody: document.getElementById("mcMirrorBody"),
    mirrorDate: document.getElementById("mcMirrorDate"),
    mirrorSub: document.getElementById("mcMirrorSub"),
    mirrorScore: document.getElementById("mcMirrorScore"),
    mirrorRefresh: document.getElementById("mcMirrorRefresh"),
    commitList: document.getElementById("mcCommitList"),
    inbox: document.getElementById("mcInbox"),
    streaks: document.getElementById("mcStreaks"),
    strip: document.getElementById("mcStrip"),
    mirrorStatus: document.getElementById("mcMirrorStatus"),
    molPrev: document.getElementById("mcMolPrev"),
    molNext: document.getElementById("mcMolNext"),
    molDate: document.getElementById("mcMolDate"),
    molCommitted: document.getElementById("mcMolCommitted"),
    molExtras: document.getElementById("mcMolExtras"),
    extraForm: document.getElementById("mcExtraForm"),
    extraInput: document.getElementById("mcExtraInput"),
    molStatus: document.getElementById("mcMolStatus"),
    ventureTabs: document.getElementById("mcVentureTabs"),
    ventureBody: document.getElementById("mcVentureBody"),
    ventureStatus: document.getElementById("mcVentureStatus"),
    runway: document.getElementById("mcRunway"),
    runwayDays: document.getElementById("mcRunwayDays"),
    news: document.getElementById("mcNews"),
    weekRange: document.getElementById("mcWeekRange"),
    weekBody: document.getElementById("mcWeekBody"),
    wins: document.getElementById("mcWins"),
    winReplay: document.getElementById("mcWinReplay"),
    weekStatus: document.getElementById("mcWeekStatus")
  };

  const RUNWAY_KEY = "mc_runway_end";

  let token = CFG.mcToken || localStorage.getItem(TOKEN_KEY) || "";
  let streaksAnimated = false;
  let lastRefreshAt = 0;
  let briefing = null;
  let molDate = todayStr();
  let ventures = [];
  let activeVentureId = null;
  let ventureDetail = null;
  let dragTaskId = null;

  boot();

  function boot() {
    // Capture phase so we read the passcode before app.js clears the input —
    // the lockscreen passcode doubles as the MC API token.
    const loginForm = document.getElementById("loginForm");
    const passcodeInput = document.getElementById("passcodeInput");
    if (loginForm && passcodeInput) {
      loginForm.addEventListener("submit", () => {
        const candidate = passcodeInput.value.trim();
        if (candidate && candidate !== token) tryToken(candidate, { silent: true });
      }, true);
    }

    if (els.connectForm) {
      els.connectForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const candidate = els.connectInput.value.trim();
        if (candidate) tryToken(candidate, { silent: false });
      });
    }
    if (els.mirrorRefresh) els.mirrorRefresh.addEventListener("click", refreshAll);
    if (els.runway) els.runway.addEventListener("click", onRunwayClick);
    if (els.winReplay) els.winReplay.addEventListener("click", onWinReplay);
    renderRunway();
    if (els.molPrev) els.molPrev.addEventListener("click", () => shiftMoleskine(-1));
    if (els.molNext) els.molNext.addEventListener("click", () => shiftMoleskine(1));
    if (els.extraForm) els.extraForm.addEventListener("submit", onAddExtra);

    if (token) refreshAll();
    else showConnect("");

    // Freshness: a morning glance at a stale tab still shows today. Refetch on
    // return to the tab when the data is more than 60s old.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && token && Date.now() - lastRefreshAt > 60000) {
        refreshAll();
      }
    });
  }

  // --- API client ---

  class AuthError extends Error {}

  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method: options.method || "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (err) {
      throw new Error(`API unreachable (${API_URL})`);
    }
    if (res.status === 401 || res.status === 503) {
      const detail = await errorDetail(res);
      throw new AuthError(detail);
    }
    if (!res.ok) throw new Error(await errorDetail(res));
    return res.json();
  }

  async function errorDetail(res) {
    const data = await res.json().catch(() => ({}));
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg || "").join("; ");
    return `HTTP ${res.status}`;
  }

  async function tryToken(candidate, { silent }) {
    const previous = token;
    token = candidate;
    try {
      await api("/api/mc/projects");
      localStorage.setItem(TOKEN_KEY, candidate);
      if (els.connectError) els.connectError.textContent = "";
      if (els.connectInput) els.connectInput.value = "";
      refreshAll();
    } catch (err) {
      token = previous;
      if (!silent) {
        if (els.connectError) els.connectError.textContent = err.message;
      }
    }
  }

  function showConnect(message) {
    if (els.connect) els.connect.classList.remove("is-hidden");
    if (els.mirrorBody) els.mirrorBody.classList.add("is-hidden");
    if (els.connectError) els.connectError.textContent = message || "";
    if (els.molCommitted) els.molCommitted.innerHTML = `<div class="mc-empty">Connect Mission Control above.</div>`;
    if (els.molExtras) els.molExtras.innerHTML = "";
    if (els.ventureTabs) els.ventureTabs.innerHTML = "";
    if (els.ventureBody) els.ventureBody.innerHTML = `<div class="mc-empty">Connect Mission Control above.</div>`;
  }

  // Completion celebrates: a green border pulse on the containing panel.
  function pulsePanel(node) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const panel = node && node.closest ? node.closest(".panel") : null;
    if (!panel) return;
    panel.classList.remove("is-pulsing");
    void panel.offsetWidth; // restart the animation
    panel.classList.add("is-pulsing");
  }

  function handleFailure(statusEl, err) {
    if (err instanceof AuthError) {
      showConnect(err.message);
      return;
    }
    if (statusEl) statusEl.textContent = `⚠ ${err.message}`;
  }

  async function refreshAll() {
    if (els.mirrorStatus) els.mirrorStatus.textContent = "";
    lastRefreshAt = Date.now();
    try {
      briefing = await api("/api/mc/briefing/today");
      if (els.connect) els.connect.classList.add("is-hidden");
      if (els.mirrorBody) els.mirrorBody.classList.remove("is-hidden");
      renderMirror();
      if (molDate > briefing.date) molDate = briefing.date;
      await loadInbox();
      await loadMoleskine();
      await loadVentures();
      loadNews();
      loadReflection();
    } catch (err) {
      handleFailure(els.mirrorStatus, err);
    }
  }

  // --- Daily mirror ---

  function renderMirror() {
    const committed = briefing.today.committed;
    const done = committed.filter((row) => row.done).length;
    els.mirrorDate.textContent = longDate(briefing.date);
    els.mirrorSub.textContent = mirrorSubline(done, committed.length);
    els.mirrorScore.innerHTML = `${done}<small>/${committed.length}</small>`;
    renderCommitList(committed);
    renderStreaks(briefing.streaks);
    renderStrip(briefing.date);
  }

  function mirrorSubline(done, total) {
    if (!total) return "No commitments yet — add tasks to your ventures below.";
    if (done === total) return "All commitments done. Anything else is a bonus.";
    if (done === 0) return `${total} thing${total === 1 ? "" : "s"}. Start with one.`;
    return `${total - done} to go.`;
  }

  function renderCommitList(committed) {
    if (!committed.length) {
      els.commitList.innerHTML = `<div class="mc-empty">Nothing committed today. The 06:00 pull takes the top task of each active venture.</div>`;
      return;
    }
    els.commitList.innerHTML = committed.map((row) => `
      <div class="mc-commit ${row.done ? "is-done" : ""}" data-log-id="${row.id}">
        <button class="mc-check" type="button" aria-label="Toggle done">${row.done ? "✓" : ""}</button>
        <div>
          <h3>${escapeHtml(row.task_title || row.note || "Untitled")}</h3>
          <p>${escapeHtml(row.project_name || "")}${row.rolled ? " · rolled" : ""}</p>
        </div>
      </div>
    `).join("");
    els.commitList.querySelectorAll(".mc-commit .mc-check").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.closest(".mc-commit").dataset.logId);
        toggleLog(id, briefing.today.committed, els.mirrorStatus);
      });
    });
  }

  function renderStreaks(streaks) {
    if (!streaks.length) {
      els.streaks.innerHTML = `<div class="mc-empty">No streaks yet — they start counting with capture (jiu jitsu, gym…).</div>`;
      return;
    }
    els.streaks.innerHTML = streaks.map((s) => `
      <div class="mc-streak">
        <strong>${s.current}</strong>
        <div><span>${escapeHtml(s.activity.toUpperCase())}</span><small>${s.total} total · last ${shortDate(s.last_date)}</small></div>
      </div>
    `).join("");
    if (!streaksAnimated && window.MCUI) {
      streaksAnimated = true;
      els.streaks.querySelectorAll(".mc-streak strong").forEach((node) => {
        MCUI.countUp(node, Number(node.textContent) || 0);
      });
    }
  }

  function renderStrip(todayIso) {
    const cells = [];
    const base = parseDate(todayIso);
    for (let offset = -7; offset <= 6; offset += 1) {
      const day = new Date(base);
      day.setDate(day.getDate() + offset);
      const iso = toIso(day);
      const classes = ["mc-strip-day", offset === 0 ? "is-today" : "", offset < 0 ? "is-past" : ""].filter(Boolean).join(" ");
      cells.push(`
        <button type="button" class="${classes}" data-date="${iso}" title="Open in moleskine">
          <small>${"MTWTFSS"[(day.getDay() + 6) % 7]}</small>
          <span>${day.getDate()}</span>
        </button>
      `);
    }
    els.strip.innerHTML = cells.join("");
    els.strip.querySelectorAll(".mc-strip-day").forEach((cell) => {
      cell.addEventListener("click", () => {
        const target = cell.dataset.date;
        if (target > briefing.date) return; // the future is unwritten
        molDate = target;
        loadMoleskine();
        document.querySelector(".mc-moleskine").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // --- Runway countdown (localStorage; the loudest number on the mirror) ---

  function renderRunway() {
    if (!els.runwayDays) return;
    const end = localStorage.getItem(RUNWAY_KEY);
    if (!end) {
      els.runwayDays.textContent = "—";
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((parseDate(end) - today) / 86400000);
    els.runwayDays.textContent = days;
    els.runway.classList.toggle("is-low", days <= 60);
  }

  function onRunwayClick() {
    const current = localStorage.getItem(RUNWAY_KEY) || "";
    const value = prompt("Runway end date (YYYY-MM-DD). Leave empty to clear.", current);
    if (value === null) return;
    const trimmed = value.trim();
    if (!trimmed) {
      localStorage.removeItem(RUNWAY_KEY);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      alert("Use YYYY-MM-DD.");
      return;
    } else {
      localStorage.setItem(RUNWAY_KEY, trimmed);
    }
    renderRunway();
  }

  // --- News with thumbs (votes tune topic weights) ---

  async function loadNews() {
    if (!els.news) return;
    try {
      const data = await api("/api/mc/news/briefing");
      renderNews(data.groups);
    } catch (err) {
      handleFailure(els.mirrorStatus, err);
    }
  }

  function renderNews(groups) {
    const items = groups.flatMap((g) => g.headlines);
    if (!items.length) {
      els.news.innerHTML = `<div class="mc-empty">No headlines right now.</div>`;
      return;
    }
    // Show the top stories only; the rest stay behind "View all news"
    const NEWS_VISIBLE = 8;
    els.news.innerHTML = items.map((h, i) => `
      <div class="mc-news-item${i >= NEWS_VISIBLE ? " mc-news-overflow is-hidden" : ""}" data-topic="${escapeHtml(h.topic)}">
        <a href="${escapeHtml(h.link)}" target="_blank" rel="noreferrer">${escapeHtml(h.title)}</a>
        ${h.summary ? `<p>${escapeHtml(h.summary)}</p>` : ""}
        <div class="mc-news-meta">
          <small>${escapeHtml(h.source)}</small>
          <span>
            <button type="button" data-vote="up" title="More ${escapeHtml(h.topic)}">👍</button>
            <button type="button" data-vote="down" title="Less ${escapeHtml(h.topic)}">👎</button>
          </span>
        </div>
      </div>
    `).join("") + (items.length > NEWS_VISIBLE
      ? `<button type="button" class="mc-news-more" data-news-more>View all news (${items.length})</button>`
      : "");
    const moreButton = els.news.querySelector("[data-news-more]");
    if (moreButton) {
      moreButton.addEventListener("click", () => {
        const expanded = moreButton.classList.toggle("is-open");
        els.news.querySelectorAll(".mc-news-overflow").forEach((item) => {
          item.classList.toggle("is-hidden", !expanded);
        });
        moreButton.textContent = expanded ? "Show top stories only" : `View all news (${items.length})`;
      });
    }
    els.news.querySelectorAll("[data-vote]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = button.closest(".mc-news-item");
        const small = item.querySelector("small");
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Immediate feedback: thumbs-down slides the card out, thumbs-up dims it
        if (button.dataset.vote === "down") {
          item.classList.add("is-downvoted");
          setTimeout(() => item.remove(), reduced ? 0 : 260);
        } else {
          item.classList.add("is-upvoted");
        }
        try {
          const result = await api("/api/mc/news/feedback", {
            method: "POST",
            body: { topic: item.dataset.topic, vote: button.dataset.vote },
          });
          if (button.dataset.vote === "up") small.textContent = `${result.topic} → ${result.weight}`;
        } catch (err) {
          handleFailure(els.mirrorStatus, err);
        }
      });
    });
  }

  // --- Week in review + win replay ---

  async function loadReflection() {
    if (!els.weekBody) return;
    try {
      const data = await api("/api/mc/reflections/latest");
      renderReflection(data.reflection);
    } catch (err) {
      handleFailure(els.weekStatus, err);
    }
  }

  function renderReflection(r) {
    if (!r) {
      els.weekRange.textContent = "No reflection yet";
      els.weekBody.innerHTML = `<div class="mc-empty">Generated every Sunday evening from the week's log.</div>`;
      return;
    }
    els.weekRange.textContent = `${shortDate(r.week_start)} – ${shortDate(r.week_end)}`;
    const list = (items, mark) => items.length
      ? items.map((i) => `<div class="mc-week-item">${mark} ${escapeHtml(i)}</div>`).join("")
      : `<div class="mc-empty">Nothing.</div>`;
    els.weekBody.innerHTML = `
      <div class="mc-week-grid">
        <div><p class="mc-label">Shipped</p>${list(r.what_shipped, "✓")}</div>
        <div><p class="mc-label">Slipped</p>${list(r.what_slipped, "✗")}</div>
        <div><p class="mc-label">Pattern</p><p class="mc-week-prose">${escapeHtml(r.pattern)}</p></div>
        <div><p class="mc-label">Next week</p><p class="mc-week-prose">${escapeHtml(r.suggestion)}</p></div>
      </div>
    `;
  }

  async function onWinReplay() {
    if (!els.wins.classList.contains("is-hidden")) {
      els.wins.classList.add("is-hidden");
      return;
    }
    try {
      const data = await api("/api/mc/wins");
      els.wins.innerHTML = data.days.length
        ? data.days.map((d) => `
            <div class="mc-win">
              <strong>${escapeHtml(d.weekday)} ${shortDate(d.date)}</strong>
              <p>${d.done.length} done · ${d.extras.length} extras</p>
              <small>${d.done.concat(d.extras).slice(0, 5).map(escapeHtml).join(" · ")}</small>
            </div>
          `).join("")
        : `<div class="mc-empty">No standout days yet — go make some.</div>`;
      els.wins.classList.remove("is-hidden");
    } catch (err) {
      handleFailure(els.weekStatus, err);
    }
  }

  // --- Inbox (unclear captures awaiting one-tap resolution) ---

  async function loadInbox() {
    if (!els.inbox) return;
    try {
      const captures = await api("/api/mc/captures?unresolved=true");
      renderInbox(captures);
    } catch (err) {
      handleFailure(els.mirrorStatus, err);
    }
  }

  function renderInbox(captures) {
    if (!captures.length) {
      els.inbox.innerHTML = "";
      return;
    }
    const commitOptions = briefing.today.committed
      .filter((row) => row.task_id && !row.done)
      .map((row) => `<option value="${row.task_id}">${escapeHtml(row.task_title)}</option>`)
      .join("");
    els.inbox.innerHTML = `
      <p class="mc-label">Inbox — needs a call</p>
      ${captures.map((c) => `
        <div class="mc-inbox-item" data-capture-id="${c.id}">
          <h3>${escapeHtml(c.raw_text)}</h3>
          <div class="mc-inbox-actions">
            <button type="button" data-resolve="extra">Extra</button>
            ${commitOptions ? `
              <span class="mc-inbox-done">
                <select aria-label="Which commitment">${commitOptions}</select>
                <button type="button" data-resolve="task_done">Done</button>
              </span>` : ""}
            <button type="button" data-resolve="dismissed" class="task-delete">Dismiss</button>
          </div>
        </div>
      `).join("")}
    `;
    els.inbox.querySelectorAll("[data-resolve]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = button.closest(".mc-inbox-item");
        const captureId = Number(item.dataset.captureId);
        const classification = button.dataset.resolve;
        const body = { classification };
        if (classification === "task_done") {
          body.task_id = Number(item.querySelector("select").value);
        }
        item.classList.add("is-pending");
        try {
          await api(`/api/mc/captures/${captureId}/resolve`, { method: "POST", body });
          await refreshDay();
          await loadInbox();
        } catch (err) {
          item.classList.remove("is-pending");
          handleFailure(els.mirrorStatus, err);
        }
      });
    });
  }

  // --- Moleskine ---

  function shiftMoleskine(direction) {
    const day = parseDate(molDate);
    day.setDate(day.getDate() + direction);
    const iso = toIso(day);
    if (iso > todayStr()) return;
    molDate = iso;
    loadMoleskine();
  }

  async function loadMoleskine() {
    if (els.molStatus) els.molStatus.textContent = "";
    try {
      const page = await api(`/api/mc/moleskine/${molDate}`);
      renderMoleskine(page);
    } catch (err) {
      handleFailure(els.molStatus, err);
    }
  }

  function renderMoleskine(page) {
    const isToday = page.date === todayStr();
    els.molDate.textContent = longDate(page.date);
    els.molNext.disabled = isToday;

    els.molCommitted.innerHTML = page.committed.length
      ? page.committed.map((row) => `
          <div class="mc-commit mc-commit--page ${row.done ? "is-done" : ""}" data-log-id="${row.id}">
            <button class="mc-check" type="button" aria-label="Toggle done">${row.done ? "✓" : ""}</button>
            <div>
              <h3>${escapeHtml(row.task_title || row.note || "Untitled")}</h3>
              <p>${escapeHtml(row.project_name || "")}${row.rolled ? " · rolled forward" : ""}</p>
            </div>
          </div>
        `).join("")
      : `<div class="mc-empty">Nothing committed.</div>`;

    els.molExtras.innerHTML = page.extras.length
      ? page.extras.map((row) => `
          <div class="mc-extra" data-log-id="${row.id}">
            <span>+</span>
            <div class="mc-extra-body">
              <h3>${escapeHtml(row.note || row.task_title || "")}</h3>
              <p>${row.created_at ? timeOnly(row.created_at) : ""}</p>
            </div>
            <div class="mc-extra-actions">
              <button type="button" data-action="edit">Edit</button>
              <button type="button" data-action="delete" class="task-delete">Delete</button>
            </div>
          </div>
        `).join("")
      : `<div class="mc-empty">No extras${isToday ? " yet" : ""}.</div>`;

    els.extraForm.classList.toggle("is-hidden", !isToday);

    els.molCommitted.querySelectorAll(".mc-commit .mc-check").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.closest(".mc-commit").dataset.logId);
        toggleLog(id, page.committed, els.molStatus, () => renderMoleskine(page));
      });
    });

    els.molExtras.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = button.closest(".mc-extra");
        const logId = Number(item.dataset.logId);
        const row = page.extras.find((r) => r.id === logId);
        if (!row) return;

        if (button.dataset.action === "edit") {
          startExtraEdit(item, row);
          return;
        }
        if (button.dataset.action === "delete") {
          if (!confirm(`Delete this extra?\n\n${row.note || row.task_title || ""}`)) return;
          item.classList.add("is-pending");
          try {
            await api(`/api/mc/daily-log/${logId}`, { method: "DELETE" });
            await loadMoleskine();
          } catch (err) {
            item.classList.remove("is-pending");
            handleFailure(els.molStatus, err);
          }
        }
      });
    });
  }

  function startExtraEdit(item, row) {
    const titleEl = item.querySelector("h3");
    if (!titleEl || item.querySelector(".task-edit-input")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "task-edit-input";
    input.maxLength = 500;
    input.value = row.note || row.task_title || "";
    titleEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    let settled = false;
    const commit = async (save) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      if (save && value && value !== (row.note || "")) {
        try {
          await api(`/api/mc/daily-log/${row.id}`, { method: "PATCH", body: { note: value } });
        } catch (err) {
          handleFailure(els.molStatus, err);
        }
      }
      await loadMoleskine();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  async function onAddExtra(event) {
    event.preventDefault();
    const note = els.extraInput.value.trim();
    if (!note) return;
    els.extraInput.value = "";
    // Optimistic append; reconciled by the reload on success / error message on failure.
    els.molExtras.insertAdjacentHTML("beforeend", `
      <div class="mc-extra is-pending"><span>+</span><div><h3>${escapeHtml(note)}</h3><p>saving…</p></div></div>
    `);
    try {
      await api("/api/mc/daily-log", { method: "POST", body: { type: "extra", note } });
      await loadMoleskine();
    } catch (err) {
      els.extraInput.value = note;
      handleFailure(els.molStatus, err);
      loadMoleskine();
    }
  }

  // Shared optimistic done-toggle for committed rows (mirror + moleskine).
  // The two panels hold separate copies of the same log rows, so writes are
  // mirrored into the briefing copy as well.
  async function toggleLog(logId, rows, statusEl, rerender) {
    const row = rows.find((r) => r.id === logId);
    if (!row) return;
    const next = !row.done;
    const setBoth = (value) => {
      row.done = value;
      const mirrorRow = briefing && briefing.today.committed.find((r) => r.id === logId);
      if (mirrorRow && mirrorRow !== row) mirrorRow.done = value;
    };
    setBoth(next);
    renderMirror();
    if (rerender) rerender();
    if (next) pulsePanel(statusEl);
    try {
      const updated = await api(`/api/mc/daily-log/${logId}`, { method: "PATCH", body: { done: next } });
      setBoth(updated.done);
      if (ventureDetail) loadVentureDetail(activeVentureId, { quiet: true });
      if (!rerender && molDate === briefing.date) loadMoleskine();
    } catch (err) {
      setBoth(!next);
      renderMirror();
      if (rerender) rerender();
      handleFailure(statusEl, err);
    }
  }

  // --- Ventures ---

  async function loadVentures() {
    try {
      ventures = await api("/api/mc/projects");
      if (!activeVentureId || !ventures.some((v) => v.id === activeVentureId)) {
        const firstActive = ventures.find((v) => v.status === "active") || ventures[0];
        activeVentureId = firstActive ? firstActive.id : null;
      }
      renderVentureTabs();
      if (activeVentureId) await loadVentureDetail(activeVentureId, { quiet: false });
      else els.ventureBody.innerHTML = `<div class="mc-empty">No ventures yet.</div>`;
    } catch (err) {
      handleFailure(els.ventureStatus, err);
    }
  }

  function renderVentureTabs() {
    els.ventureTabs.innerHTML = ventures.map((v) => `
      <button type="button" class="${v.id === activeVentureId ? "is-active" : ""}" data-venture="${v.id}">
        ${escapeHtml(v.name)}${v.status !== "active" ? ` · ${v.status}` : ""}
        <em>${v.open_tasks}</em>
      </button>
    `).join("");
    els.ventureTabs.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        activeVentureId = Number(button.dataset.venture);
        renderVentureTabs();
        loadVentureDetail(activeVentureId, { quiet: false });
      });
    });
  }

  async function loadVentureDetail(ventureId, { quiet }) {
    if (els.ventureStatus) els.ventureStatus.textContent = "";
    if (!quiet) els.ventureBody.innerHTML = `<div class="mc-empty">Loading…</div>`;
    try {
      ventureDetail = await api(`/api/mc/projects/${ventureId}`);
      renderVentureDetail();
    } catch (err) {
      handleFailure(els.ventureStatus, err);
    }
  }

  function renderVentureDetail() {
    const open = ventureDetail.tasks.filter((t) => t.status !== "done");
    const closed = ventureDetail.tasks.filter((t) => t.status === "done");
    els.ventureBody.innerHTML = `
      <div class="mc-task-list" data-venture="${ventureDetail.id}">
        ${open.length ? open.map((t, i) => ventureTaskRow(t, i, open.length)).join("") : `<div class="mc-empty">No open tasks. Add one below — the top task is tomorrow's commitment.</div>`}
      </div>
      <form id="mcNewTaskForm" class="mc-extra-form mc-newtask-form">
        <input id="mcNewTaskInput" type="text" placeholder="Add a task to ${escapeHtml(ventureDetail.name)}" maxlength="500" />
        <button type="submit">Add</button>
      </form>
      ${closed.length ? `
        <details class="mc-done-tasks">
          <summary>${closed.length} done</summary>
          ${closed.map((t) => `<div class="mc-done-task"><span>✓</span> ${escapeHtml(t.title)}</div>`).join("")}
        </details>` : ""}
    `;

    document.getElementById("mcNewTaskForm").addEventListener("submit", onAddTask);
    bindTaskRowEvents(open);
  }

  function ventureTaskRow(task, index, total) {
    return `
      <article class="mc-task ${task.status}" data-task-id="${task.id}" draggable="true">
        <span class="mc-drag" title="Drag to reorder">⋮⋮</span>
        <button class="mc-check" type="button" data-action="done" aria-label="Mark done"></button>
        <div class="mc-task-body">
          <h3>${escapeHtml(task.title)}</h3>
          <p>#${index + 1}${index === 0 ? " · next commitment" : ""}${task.status === "doing" ? " · in progress" : ""}</p>
        </div>
        <div class="mc-task-actions">
          <button type="button" data-action="up"${index === 0 ? " disabled" : ""} aria-label="Move up">↑</button>
          <button type="button" data-action="down"${index === total - 1 ? " disabled" : ""} aria-label="Move down">↓</button>
          <button type="button" data-action="edit">Edit</button>
          <button type="button" data-action="delete" class="task-delete">Delete</button>
        </div>
      </article>
    `;
  }

  function bindTaskRowEvents(openTasks) {
    const list = els.ventureBody.querySelector(".mc-task-list");
    if (!list) return;

    list.querySelectorAll("[data-action]").forEach((control) => {
      control.addEventListener("click", async (event) => {
        const card = event.target.closest(".mc-task");
        if (!card) return;
        const taskId = Number(card.dataset.taskId);
        const task = openTasks.find((t) => t.id === taskId);
        if (!task) return;
        const action = event.target.dataset.action;

        if (action === "done") return completeTask(task);
        if (action === "edit") return startTaskEdit(card, task);
        if (action === "delete") {
          if (!confirm(`Delete this task?\n\n${task.title}`)) return;
          try {
            await api(`/api/mc/tasks/${taskId}`, { method: "DELETE" });
            await loadVentureDetail(activeVentureId, { quiet: true });
            refreshDay();
          } catch (err) {
            handleFailure(els.ventureStatus, err);
          }
          return;
        }
        if (action === "up" || action === "down") {
          const ids = openTasks.map((t) => t.id);
          const idx = ids.indexOf(taskId);
          const swap = action === "up" ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= ids.length) return;
          [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
          reorder(ids);
        }
      });
    });

    // Drag to reorder — position drives what the 06:00 pull commits next.
    list.querySelectorAll(".mc-task").forEach((card) => {
      card.addEventListener("dragstart", (event) => {
        dragTaskId = Number(card.dataset.taskId);
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        dragTaskId = null;
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (dragTaskId === null || Number(card.dataset.taskId) === dragTaskId) return;
        card.classList.add("is-drop-target");
      });
      card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        card.classList.remove("is-drop-target");
        const targetId = Number(card.dataset.taskId);
        if (dragTaskId === null || targetId === dragTaskId) return;
        const ids = openTasks.map((t) => t.id);
        const from = ids.indexOf(dragTaskId);
        const to = ids.indexOf(targetId);
        ids.splice(from, 1);
        ids.splice(to, 0, dragTaskId);
        reorder(ids);
      });
    });
  }

  async function reorder(ids) {
    // Optimistic: re-render in the new order immediately.
    const byId = Object.fromEntries(ventureDetail.tasks.map((t) => [t.id, t]));
    const done = ventureDetail.tasks.filter((t) => t.status === "done");
    ventureDetail.tasks = ids.map((id) => byId[id]).concat(done);
    renderVentureDetail();
    try {
      await api(`/api/mc/projects/${activeVentureId}/tasks/reorder`, { method: "POST", body: { task_ids: ids } });
    } catch (err) {
      handleFailure(els.ventureStatus, err);
      loadVentureDetail(activeVentureId, { quiet: true });
    }
  }

  async function completeTask(task) {
    try {
      await api(`/api/mc/tasks/${task.id}`, { method: "PATCH", body: { status: "done" } });
      await loadVentureDetail(activeVentureId, { quiet: true });
      refreshDay();
    } catch (err) {
      handleFailure(els.ventureStatus, err);
    }
  }

  function startTaskEdit(card, task) {
    const titleEl = card.querySelector("h3");
    if (!titleEl || card.querySelector(".task-edit-input")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "task-edit-input";
    input.value = task.title;
    titleEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    let settled = false;
    const commit = async (save) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      if (save && value && value !== task.title) {
        try {
          await api(`/api/mc/tasks/${task.id}`, { method: "PATCH", body: { title: value } });
        } catch (err) {
          handleFailure(els.ventureStatus, err);
        }
      }
      await loadVentureDetail(activeVentureId, { quiet: true });
      refreshDay();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  async function onAddTask(event) {
    event.preventDefault();
    const input = document.getElementById("mcNewTaskInput");
    const title = input.value.trim();
    if (!title) return;
    input.value = "";
    try {
      await api(`/api/mc/projects/${activeVentureId}/tasks`, { method: "POST", body: { title } });
      await loadVentureDetail(activeVentureId, { quiet: true });
    } catch (err) {
      input.value = title;
      handleFailure(els.ventureStatus, err);
    }
  }

  // Refresh today's mirror + moleskine after venture changes (titles, deletes).
  async function refreshDay() {
    try {
      briefing = await api("/api/mc/briefing/today");
      renderMirror();
      if (molDate === briefing.date) await loadMoleskine();
    } catch (err) {
      handleFailure(els.mirrorStatus, err);
    }
  }

  // --- Helpers ---

  function todayStr() {
    return toIso(new Date());
  }

  function toIso(day) {
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, "0");
    const d = String(day.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseDate(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function longDate(iso) {
    return parseDate(iso).toLocaleDateString("en-GB", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric"
    });
  }

  function shortDate(iso) {
    return parseDate(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  }

  function timeOnly(value) {
    // API timestamps are UTC but come back without a zone suffix.
    const iso = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
