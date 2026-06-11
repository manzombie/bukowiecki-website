(function () {
  const TOOLS_URL = "https://tools.bukowiecki.co";
  const boardVersion = window.MISSION_CONFIG.boardVersion || "default";
  const storageKey = `mr_lobster_mission_control_${boardVersion}`;
  const gistStateFile = `state-${boardVersion}.json`;
  const authKey = "mr_lobster_mission_unlocked";
  const conditionLocations = {
    southend: { label: "Southend-on-Sea", lat: 51.5378, lon: 0.7143, marine: true },
    shepperton: { label: "Shepperton, UK", lat: 51.3969, lon: -0.4489, marine: false },
    "new-york": { label: "New York", lat: 40.7128, lon: -74.0060, marine: false },
    "los-angeles": { label: "Los Angeles", lat: 34.0522, lon: -118.2437, marine: false },
    tokyo: { label: "Tokyo", lat: 35.6762, lon: 139.6503, marine: false },
    wellington: { label: "Wellington", lat: -41.2866, lon: 174.7756, marine: false }
  };

  const els = {
    app: document.getElementById("app"),
    lockscreen: document.getElementById("lockscreen"),
    loginForm: document.getElementById("loginForm"),
    passcodeInput: document.getElementById("passcodeInput"),
    loginError: document.getElementById("loginError"),
    lockButton: document.getElementById("lockButton"),
    avatarButton: document.getElementById("avatarButton"),
    avatarInput: document.getElementById("avatarInput"),
    avatarImage: document.getElementById("avatarImage"),
    avatarInitials: document.getElementById("avatarInitials"),
    todayLabel: document.getElementById("todayLabel"),
    timeLabel: document.getElementById("timeLabel"),
    focusLabel: document.getElementById("focusLabel"),
    progressPercent: document.getElementById("progressPercent"),
    progressBar: document.getElementById("progressBar"),
    doneCount: document.getElementById("doneCount"),
    activeCount: document.getElementById("activeCount"),
    blockedCount: document.getElementById("blockedCount"),
    conditionsUpdated: document.getElementById("conditionsUpdated"),
    conditionsRefresh: document.getElementById("conditionsRefresh"),
    conditionsLocation: document.getElementById("conditionsLocation"),
    weatherSummary: document.getElementById("weatherSummary"),
    weatherDetail: document.getElementById("weatherDetail"),
    sunriseTime: document.getElementById("sunriseTime"),
    sunsetTime: document.getElementById("sunsetTime"),
    tideList: document.getElementById("tideList"),
    tasks: document.getElementById("tasks"),
    phaseFilters: document.getElementById("phaseFilters"),
    newTaskButton: document.getElementById("newTaskButton"),
    newStageButton: document.getElementById("newStageButton"),
    currentTask: document.getElementById("currentTask"),
    currentTaskEmpty: document.getElementById("currentTaskEmpty"),
    currentPhase: document.getElementById("currentPhase"),
    currentTitle: document.getElementById("currentTitle"),
    currentDescription: document.getElementById("currentDescription"),
    promptBox: document.getElementById("promptBox"),
    copyPromptButton: document.getElementById("copyPromptButton"),
    completeCurrentButton: document.getElementById("completeCurrentButton"),
    putBackButton: document.getElementById("putBackButton"),
    agentModule: document.getElementById("agentModule"),
    agentText: document.getElementById("agentText"),
    agentModelLabel: document.getElementById("agentModelLabel"),
    agentRefresh: document.getElementById("agentRefresh")
  };

  let idCounter = 0;
  let state = defaultState();
  let saveTimer = null;
  let lastRenderedDate = "";

  boot();

  async function boot() {
    document.querySelectorAll("[data-tools-link]").forEach((link) => {
      link.href = TOOLS_URL;
    });
    els.loginForm.addEventListener("submit", onLogin);
    els.lockButton.addEventListener("click", lock);
    els.avatarButton.addEventListener("click", () => els.avatarInput.click());
    els.avatarInput.addEventListener("change", onAvatarSelected);
    els.copyPromptButton.addEventListener("click", copyPrompt);
    els.completeCurrentButton.addEventListener("click", completeCurrent);
    els.putBackButton.addEventListener("click", putBackCurrent);
    els.agentRefresh.addEventListener("click", fetchAgentBriefing);
    els.newTaskButton.addEventListener("click", openNewTaskPrompt);
    els.newStageButton.addEventListener("click", openNewProjectPrompt);
    els.conditionsLocation.addEventListener("change", () => {
      state.conditionsLocation = els.conditionsLocation.value;
      saveState();
      fetchConditions();
    });
    if (els.conditionsRefresh) els.conditionsRefresh.addEventListener("click", fetchConditions);

    state = await loadState();
    if (!Array.isArray(state.projects) || state.projects.length === 0) {
      state.projects = seedProjects();
    }
    // Make sure every task has a stable id and a status (guards hand-edited seeds).
    state.projects.forEach((project) => {
      if (!project.id) project.id = newId("p");
      project.tasks = (project.tasks || []).map((task) => ({
        id: task.id || newId("t"),
        title: task.title || "",
        status: task.status || "ready",
        doneDate: task.doneDate || ""
      }));
    });
    if (!state.activeProjectId || !state.projects.some((p) => p.id === state.activeProjectId)) {
      state.activeProjectId = state.projects[0].id;
    }
    if (!state.conditionsLocation) state.conditionsLocation = "southend";
    if (state.calendarOffset === undefined) state.calendarOffset = 0;

    // Auto-open when no passcode is configured (public build); otherwise honor the session.
    if (!window.MISSION_CONFIG.passcode || sessionStorage.getItem(authKey) === "true") unlock();
    tickClock();
    setInterval(tickClock, 10000);
    // Seconds tick as a soft opacity pulse on the separator, never a hard jump
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInterval(() => {
        els.timeLabel.classList.toggle("is-tick", new Date().getSeconds() % 2 === 1);
      }, 1000);
    }
    if (els.conditionsLocation) els.conditionsLocation.value = state.conditionsLocation;
    fetchConditions();
    setInterval(fetchConditions, 60 * 60 * 1000);
    renderAvatar();
    renderStoredAgentBriefing();
    render();
  }

  function onLogin(event) {
    event.preventDefault();
    // When no passcode is configured (e.g. the public GitHub Pages build, where the
    // real passcode lives only in the gitignored mission-config.local.js), the gate
    // opens through. Set a passcode locally to re-enable the prompt on your machine.
    const passcode = window.MISSION_CONFIG.passcode;
    if (!passcode || els.passcodeInput.value === passcode) {
      sessionStorage.setItem(authKey, "true");
      els.passcodeInput.value = "";
      els.loginError.textContent = "";
      unlock();
      return;
    }
    els.loginError.textContent = "Wrong passcode.";
  }

  function unlock() {
    els.lockscreen.classList.add("is-hidden");
    els.app.classList.remove("is-hidden");
  }

  function lock() {
    sessionStorage.removeItem(authKey);
    els.app.classList.add("is-hidden");
    els.lockscreen.classList.remove("is-hidden");
  }

  function render() {
    renderFilters();
    renderTasks();
    renderProgress();
    renderCurrentTask();
    renderCalendar();
    saveState();
  }

  function renderFilters() {
    const tabs = state.projects.map((project) => {
      const isActive = project.id === state.activeProjectId;
      const pill = `<button type="button" class="${isActive ? "is-active" : ""}" data-project="${project.id}">${escapeHtml(project.name)}</button>`;
      // Only the open project shows a delete control, to keep the strip uncluttered.
      const del = isActive && state.projects.length > 1
        ? `<button type="button" class="project-del" data-del-project="${project.id}" aria-label="Delete project" title="Delete this project">✕</button>`
        : "";
      return pill + del;
    }).join("");
    els.phaseFilters.innerHTML = tabs +
      `<button type="button" class="new-project-tab" data-new-project aria-label="New project" title="New project">＋</button>`;
    els.phaseFilters.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.newProject !== undefined) {
          openNewProjectPrompt();
          return;
        }
        if (button.dataset.delProject !== undefined) {
          deleteProject(button.dataset.delProject);
          return;
        }
        state.activeProjectId = button.dataset.project;
        saveState();
        render();
      });
    });
  }

  function deleteProject(id) {
    const project = state.projects.find((p) => p.id === id);
    if (!project) return;
    if (state.projects.length <= 1) {
      alert("You need at least one project. Create another before deleting this one.");
      return;
    }
    const count = project.tasks.length;
    const detail = count ? ` and its ${count} task${count === 1 ? "" : "s"}` : "";
    if (!confirm(`Delete project “${project.name}”${detail}? This cannot be undone.`)) return;
    if (project.tasks.some((t) => t.id === state.currentTask)) state.currentTask = "";
    state.projects = state.projects.filter((p) => p.id !== id);
    if (state.activeProjectId === id) state.activeProjectId = state.projects[0].id;
    render();
  }

  function renderTasks() {
    const project = activeProject();
    if (!project) { els.tasks.innerHTML = ""; return; }
    const tasks = project.tasks;

    if (!tasks.length) {
      els.tasks.innerHTML = `<div class="empty-state board-empty">No tasks yet in “${escapeHtml(project.name)}”. Use “New Task” to add one.</div>`;
      return;
    }

    els.tasks.innerHTML = `<div class="task-list">${
      tasks.map((task, index) => renderTaskArticle(task, index, tasks.length)).join("")
    }</div>`;

    els.tasks.querySelectorAll("[data-action]").forEach((control) => {
      control.addEventListener("click", (event) => {
        const card = event.target.closest(".task");
        if (!card) return;
        const proj = activeProject();
        const idx = proj.tasks.findIndex((t) => t.id === card.dataset.id);
        if (idx === -1) return;
        const task = proj.tasks[idx];
        const action = event.target.dataset.action;
        let completedTask = false;

        if (action === "done") {
          if (task.status === "done") {
            task.status = "ready";
            task.doneDate = "";
          } else {
            task.status = "done";
            task.doneDate = todayStr();
            if (state.currentTask === task.id) state.currentTask = "";
            completedTask = true;
          }
        }
        if (action === "blocked") task.status = task.status === "blocked" ? "ready" : "blocked";
        if (action === "now") {
          state.currentTask = task.id;
          task.status = "active";
        }
        if (action === "edit") { startInlineEdit(card, task); return; }
        if (action === "up" && idx > 0) {
          [proj.tasks[idx - 1], proj.tasks[idx]] = [proj.tasks[idx], proj.tasks[idx - 1]];
        }
        if (action === "down" && idx < proj.tasks.length - 1) {
          [proj.tasks[idx + 1], proj.tasks[idx]] = [proj.tasks[idx], proj.tasks[idx + 1]];
        }
        if (action === "delete") {
          if (!confirm(`Delete this task?\n\n${task.title}`)) return;
          proj.tasks.splice(idx, 1);
          if (state.currentTask === task.id) state.currentTask = "";
        }
        render();
        if (completedTask) refreshAgentAfterTaskDone();
      });
    });
  }

  function renderTaskArticle(task, index, total) {
    const status = task.status || "ready";
    const doneDate = status === "done" && task.doneDate
      ? `<span class="task-date">${formatDate(task.doneDate)}</span>` : "";
    const statusLabel = status === "active" ? "In progress"
      : status === "blocked" ? "Blocked"
      : status === "done" ? "Done" : "Ready";
    return `
      <article class="task ${status}" data-id="${task.id}">
        <button class="check" type="button" data-action="done" aria-label="Mark done">${status === "done" ? "✓" : ""}</button>
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p><span class="task-status">${statusLabel}</span>${doneDate}</p>
        </div>
        <div class="task-actions">
          <button type="button" data-action="up" aria-label="Move up" title="Move up"${index === 0 ? " disabled" : ""}>↑</button>
          <button type="button" data-action="down" aria-label="Move down" title="Move down"${index === total - 1 ? " disabled" : ""}>↓</button>
          <button type="button" data-action="now">Now</button>
          <button type="button" data-action="blocked">Block</button>
          <button type="button" data-action="edit">Edit</button>
          <button type="button" data-action="delete" class="task-delete">Delete</button>
          <a href="${githubIssueUrl(task)}" target="_blank" rel="noreferrer">Issue</a>
        </div>
      </article>`;
  }

  // Inline edit: swap the task title <h3> for an input; Enter/blur saves, Esc cancels.
  function startInlineEdit(card, task) {
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
    const commit = (save) => {
      if (settled) return;
      settled = true;
      if (save) {
        const v = input.value.trim();
        if (v) task.title = v;
      }
      saveState();
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  function openNewTaskPrompt() {
    const project = activeProject();
    if (!project) { openNewProjectPrompt(); return; }
    const title = prompt(`New task in “${project.name}”.`, "");
    if (!title || !title.trim()) return;
    project.tasks.push({ id: newId("t"), title: title.trim(), status: "ready", doneDate: "" });
    render();
  }

  function openNewProjectPrompt() {
    const name = prompt("New project name.", "");
    if (!name || !name.trim()) return;
    const project = { id: newId("p"), name: name.trim(), tasks: [] };
    state.projects.push(project);
    state.activeProjectId = project.id;
    const firstTask = prompt("First task for this project? Leave blank to start empty.", "");
    if (firstTask && firstTask.trim()) {
      project.tasks.push({ id: newId("t"), title: firstTask.trim(), status: "ready", doneDate: "" });
    }
    render();
  }

  // Deep-clone the seed so edits never mutate window.MISSION_PROJECTS.
  function seedProjects() {
    const seed = Array.isArray(window.MISSION_PROJECTS) ? window.MISSION_PROJECTS : [];
    const cloned = seed.map((project) => ({
      id: project.id || newId("p"),
      name: project.name || "Project",
      tasks: (project.tasks || []).map((task) => ({
        id: task.id || newId("t"),
        title: typeof task === "string" ? task : (task.title || ""),
        status: (task && task.status) || "ready",
        doneDate: (task && task.doneDate) || ""
      }))
    }));
    return cloned.length ? cloned : [{ id: newId("p"), name: "Database Work", tasks: [] }];
  }

  function newId(prefix) {
    idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function activeProject() {
    return state.projects.find((p) => p.id === state.activeProjectId) || state.projects[0] || null;
  }

  // Every task across all projects, each tagged with its project (for calendar + current task).
  function allTasks() {
    return state.projects.flatMap((project) =>
      project.tasks.map((task) => ({ task, project }))
    );
  }

  function findTaskRef(taskId) {
    return allTasks().find((ref) => ref.task.id === taskId) || null;
  }

  function renderProgress() {
    const project = activeProject();
    const tasks = project ? project.tasks : [];
    const done = tasks.filter((t) => t.status === "done").length;
    const active = tasks.filter((t) => t.status === "active").length;
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    els.progressPercent.textContent = `${percent}%`;
    els.progressBar.style.width = `${percent}%`;
    els.doneCount.textContent = done;
    els.activeCount.textContent = active;
    els.blockedCount.textContent = blocked;
    els.focusLabel.textContent = state.currentTask ? "Active" : "Ready";
  }

  const CONDITIONS_CACHE_KEY = "mr_lobster_conditions_cache";

  // Open-Meteo's forecast host occasionally returns 503; without this the widget
  // would blank to "Offline". We add a timeout, a few retries, and fall back to the
  // last good reading from localStorage so the panel always shows the latest info it has.
  function fetchJsonWithRetry(url, { tries = 3, timeout = 8000, gap = 1500 } = {}) {
    const attempt = (n) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      return fetch(url, { cache: "no-store", signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .catch((err) => {
          if (n >= tries) throw err;
          return new Promise((r) => setTimeout(r, gap * n)).then(() => attempt(n + 1));
        })
        .finally(() => clearTimeout(timer));
    };
    return attempt(1);
  }

  function readConditionsCache(locationKey) {
    try {
      return JSON.parse(localStorage.getItem(CONDITIONS_CACHE_KEY) || "{}")[locationKey] || null;
    } catch {
      return null;
    }
  }

  function writeConditionsCache(locationKey, payload) {
    try {
      const all = JSON.parse(localStorage.getItem(CONDITIONS_CACHE_KEY) || "{}");
      all[locationKey] = { ...payload, ts: Date.now() };
      localStorage.setItem(CONDITIONS_CACHE_KEY, JSON.stringify(all));
    } catch {
      /* localStorage unavailable — skip caching */
    }
  }

  function relativeTime(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  // Map wttr.in's WWO weather codes onto the WMO codes weatherCodeLabel() understands.
  function wwoToWmo(code) {
    if (code === 113) return 0; // clear
    if (code === 116) return 2; // partly cloudy
    if ([119, 122].includes(code)) return 3; // cloudy / overcast
    if ([143, 248, 260].includes(code)) return 45; // fog/mist
    if ([176, 263, 266, 281, 284, 293, 311, 317, 350, 362, 365].includes(code)) return 51; // drizzle/light
    if ([296, 299, 302, 353, 356].includes(code)) return 61; // rain
    if ([305, 308, 314, 359].includes(code)) return 65; // heavy rain
    if ([179, 227, 230, 320, 323, 326, 329, 332, 335, 338, 368, 371, 374, 377, 392, 395].includes(code)) return 71; // snow
    if ([200, 386, 389].includes(code)) return 95; // thunderstorm
    return -1; // unknown -> generic icon
  }

  // Convert a wttr.in j1 response into the same shape Open-Meteo returns, so
  // renderWeather() can stay unchanged. Used as a fallback when Open-Meteo is down.
  function wttrToConditions(j1) {
    const cur = (j1.current_condition && j1.current_condition[0]) || {};
    const astro = (((j1.weather || [])[0] || {}).astronomy || [])[0] || {};
    const today = new Date().toISOString().slice(0, 10);
    const to24 = (t) => {
      const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const ap = (m[3] || "").toUpperCase();
      if (ap === "PM" && h < 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
      return `${today}T${String(h).padStart(2, "0")}:${m[2]}`;
    };
    return {
      current: {
        temperature_2m: Number(cur.temp_C),
        weather_code: wwoToWmo(Number(cur.weatherCode)),
        wind_speed_10m: Number(cur.windspeedKmph)
      },
      daily: {
        sunrise: [to24(astro.sunrise)].filter(Boolean),
        sunset: [to24(astro.sunset)].filter(Boolean)
      }
    };
  }

  async function fetchConditions() {
    const locationKey = state.conditionsLocation;
    const location = conditionLocations[locationKey] || conditionLocations.southend;
    const { lat, lon } = location;
    if (els.conditionsUpdated) els.conditionsUpdated.textContent = "Loading";
    if (els.conditionsRefresh) els.conditionsRefresh.disabled = true;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_level_height_msl&timezone=auto&forecast_days=2`;

    try {
      let weather;
      try {
        weather = await fetchJsonWithRetry(weatherUrl, { tries: 2 });
      } catch {
        // Open-Meteo forecast host is down — fall back to wttr.in (same data, different shape).
        const j1 = await fetchJsonWithRetry(`https://wttr.in/${lat},${lon}?format=j1`, { tries: 2 });
        weather = wttrToConditions(j1);
      }
      renderWeather(weather);

      let marine = null;
      if (location.marine) {
        try {
          marine = await fetchJsonWithRetry(marineUrl, { tries: 2 });
          renderTides(marine);
        } catch {
          renderTideFallback();
        }
      } else {
        renderTideNotApplicable(location.label);
      }

      writeConditionsCache(locationKey, { weather, marine, marineApplicable: location.marine });
      if (els.conditionsUpdated) {
        els.conditionsUpdated.textContent = `Updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
      }
    } catch {
      // Live fetch failed (e.g. Open-Meteo 503) — show the last good reading if we have one.
      const cached = readConditionsCache(locationKey);
      if (cached?.weather) {
        renderWeather(cached.weather);
        if (cached.marineApplicable && cached.marine) renderTides(cached.marine);
        else if (cached.marineApplicable) renderTideFallback();
        else renderTideNotApplicable(location.label);
        if (els.conditionsUpdated) els.conditionsUpdated.textContent = `Stale · ${relativeTime(cached.ts)}`;
      } else {
        renderConditionsError();
      }
    } finally {
      if (els.conditionsRefresh) els.conditionsRefresh.disabled = false;
    }
  }

  function renderWeather(data) {
    const current = data.current || {};
    const daily = data.daily || {};
    const temp = Math.round(current.temperature_2m);
    const wind = Math.round(current.wind_speed_10m || 0);
    const weather = weatherCodeLabel(Number(current.weather_code));

    if (els.weatherSummary) els.weatherSummary.textContent = `${weather.icon} ${Number.isFinite(temp) ? `${temp}°C` : "--"}`;
    if (els.weatherDetail) els.weatherDetail.textContent = `${weather.label}${wind ? ` · ${wind} km/h` : ""}`;
    if (els.sunriseTime) els.sunriseTime.textContent = timeOnly(daily.sunrise?.[0]);
    if (els.sunsetTime) els.sunsetTime.textContent = timeOnly(daily.sunset?.[0]);
  }

  function renderTides(data) {
    const times = data.hourly?.time || [];
    const heights = data.hourly?.sea_level_height_msl || [];
    const points = [];

    for (let i = 1; i < heights.length - 1; i += 1) {
      const previous = Number(heights[i - 1]);
      const current = Number(heights[i]);
      const next = Number(heights[i + 1]);
      if (![previous, current, next].every(Number.isFinite)) continue;

      if (current > previous && current > next) points.push({ type: "High", time: times[i], height: current });
      if (current < previous && current < next) points.push({ type: "Low", time: times[i], height: current });
    }

    const now = Date.now();
    const upcoming = points
      .filter(point => new Date(point.time).getTime() >= now - 60 * 60 * 1000)
      .slice(0, 4);

    if (!els.tideList) return;
    if (upcoming.length === 0) {
      renderTideFallback();
      return;
    }

    els.tideList.innerHTML = upcoming.map(point => `
      <div class="tide-row">
        <span>${point.type}</span>
        <strong>${timeOnly(point.time)}</strong>
        <small>${point.height.toFixed(1)}m</small>
      </div>
    `).join("");
  }

  function renderTideFallback() {
    if (els.tideList) {
      els.tideList.innerHTML = `<div class="tide-note">Tide curve unavailable. Check official tables before sea work.</div>`;
    }
  }

  function renderTideNotApplicable(locationName) {
    if (els.tideList) {
      els.tideList.innerHTML = `<div class="tide-note">Tide guidance is pinned to Southend-on-Sea. Current weather location: ${escapeHtml(locationName)}.</div>`;
    }
  }

  function renderConditionsError() {
    if (els.conditionsUpdated) els.conditionsUpdated.textContent = "Offline";
    if (els.weatherSummary) els.weatherSummary.textContent = "--";
    if (els.weatherDetail) els.weatherDetail.textContent = "Weather unavailable";
    if (els.sunriseTime) els.sunriseTime.textContent = "--:--";
    if (els.sunsetTime) els.sunsetTime.textContent = "--:--";
    renderTideFallback();
  }

  function timeOnly(value) {
    if (!value) return "--:--";
    return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function weatherCodeLabel(code) {
    if ([0].includes(code)) return { icon: "☀️", label: "Clear" };
    if ([1, 2].includes(code)) return { icon: "🌤️", label: "Partly cloudy" };
    if ([3].includes(code)) return { icon: "☁️", label: "Cloudy" };
    if ([45, 48].includes(code)) return { icon: "🌫️", label: "Fog" };
    if ([51, 53, 55, 56, 57].includes(code)) return { icon: "🌦️", label: "Drizzle" };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: "🌧️", label: "Rain" };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: "🌨️", label: "Snow" };
    if ([95, 96, 99].includes(code)) return { icon: "⛈️", label: "Storm" };
    return { icon: "🌦️", label: "Weather" };
  }

  function renderCurrentTask() {
    const current = state.currentTask ? findTaskRef(state.currentTask) : null;
    if (!current) {
      els.currentTask.classList.add("is-hidden");
      els.currentTaskEmpty.classList.remove("is-hidden");
      els.promptBox.value = defaultPrompt();
      return;
    }

    els.currentTask.classList.remove("is-hidden");
    els.currentTaskEmpty.classList.add("is-hidden");
    els.currentPhase.textContent = current.project.name;
    els.currentTitle.textContent = current.task.title;
    els.currentDescription.textContent = `Project: ${current.project.name}`;
    els.promptBox.value = taskPrompt(current);
  }

  function completeCurrent() {
    const current = state.currentTask ? findTaskRef(state.currentTask) : null;
    if (!current) return;
    current.task.status = "done";
    current.task.doneDate = todayStr();
    state.currentTask = "";
    render();
    refreshAgentAfterTaskDone();
  }

  function putBackCurrent() {
    const current = state.currentTask ? findTaskRef(state.currentTask) : null;
    if (!current) return;
    current.task.status = "ready";
    state.currentTask = "";
    render();
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(els.promptBox.value);
    els.copyPromptButton.textContent = "Copied";
    setTimeout(() => { els.copyPromptButton.textContent = "Copy Codex / Claude Prompt"; }, 1200);
  }

  function onAvatarSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 160;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        state.avatar = canvas.toDataURL("image/jpeg", 0.82);
        renderAvatar();
        saveState();
      };
      img.src = reader.result;
    });
    reader.readAsDataURL(file);
  }

  function renderAvatar() {
    if (!state.avatar) {
      els.avatarImage.classList.add("is-hidden");
      els.avatarInitials.classList.remove("is-hidden");
      return;
    }

    els.avatarImage.src = state.avatar;
    els.avatarImage.classList.remove("is-hidden");
    els.avatarInitials.classList.add("is-hidden");
  }

  function tickClock() {
    const now = new Date();
    els.todayLabel.textContent = now.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).toUpperCase();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    els.timeLabel.innerHTML = `${hh}<span class="mc-clock__sep">:</span>${mm}`;
    renderGreeting(now.getHours());
    const today = todayStr();
    if (today !== lastRenderedDate) {
      lastRenderedDate = today;
      renderCalendar();
    }
  }

  // The greeting tracks the actual time of day — an ambient display that says
  // "Good morning" at 18:35 burns trust in every other number on the page.
  function renderGreeting(hour) {
    const greeting = document.getElementById("greeting");
    if (!greeting) return;
    const part = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 22 ? "Good evening" : "Up late";
    const text = `${part}, Lukasz.`;
    if (greeting.textContent !== text) greeting.textContent = text;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function githubIssueUrl(task) {
    const project = activeProject();
    const projectName = project ? project.name : "Mission Control";
    const title = encodeURIComponent(`[${projectName}] ${task.title}`);
    const body = encodeURIComponent(`Mission Control task\n\nProject: ${projectName}\n\nDefinition of done:\n- ${task.title}`);
    return `https://github.com/${window.MISSION_CONFIG.githubRepo}/issues/new?title=${title}&body=${body}`;
  }

  function taskPrompt(ref) {
    return `Project: ${ref.project.name}\n\nCurrent task:\n${ref.task.title}\n\nInstructions:\n1. Read the existing repo / context before changing files.\n2. Keep the work modular and focused on this task.\n3. Add or update tests where the change affects behaviour.\n4. Note what shipped, decisions, risks, and the next action.\n5. When done, reference this task in the commit or PR description.\n\nDefinition of done:\n- The task above is complete.\n- Checks have run.\n- The next action is recorded.`;
  }

  function defaultPrompt() {
    return "Pick a task with the Now button. Mission Control will generate a Codex / Claude handoff prompt here.";
  }

  // --- Agent ---

  async function fetchAgentBriefing() {
    const { anthropicKey } = window.MISSION_CONFIG;
    if (!anthropicKey) return;

    els.agentText.textContent = "Generating briefing…";
    els.agentModule.classList.add("is-loading");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const tasksRefs = allTasks();
      const done = tasksRefs.filter((r) => r.task.status === "done").length;
      const total = tasksRefs.length || 1;
      const percent = Math.round((done / total) * 100);
      const activeItem = tasksRefs.find((r) => r.task.status === "active");
      const nextReady = tasksRefs.find((r) => r.task.status === "ready" || !r.task.status);
      const focus = activeItem || nextReady;

      const projectsOverview = state.projects.map((p) => `${p.name} (${p.tasks.length} tasks)`).join("\n");

      const system = `You are the Mission Control AI for Lukasz Bukowiecki's private ops dashboard. Active projects:\n${projectsOverview}\n\nRespond with exactly 2 sentences separated by a single newline character. No greetings, no labels, no markdown. Sentence 1: sharp motivational line. Sentence 2: specific tactical advice on the next task. Be direct and energising.`;

      const taskSummary = state.projects.map((p) => {
        const rows = p.tasks.map((task) => `  [${(task.status || "ready").toUpperCase()}] ${task.title}`).join("\n");
        return `${p.name}:\n${rows}`;
      }).join("\n\n");

      const userMsg = `Date: ${todayStr()}. Progress: ${percent}% (${done}/${tasksRefs.length} tasks done).\n\nFull board:\n${taskSummary}\n\n${focus ? `Current focus: "${focus.task.title}" — ${focus.project.name}.` : "All tasks complete."}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 150,
          system,
          messages: [{ role: "user", content: userMsg }]
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const sentences = data.content[0].text.trim().split(/\n+/).filter(Boolean);
      state.agentBriefing = sentences;
      state.agentBriefingAt = new Date().toISOString();
      const m = data.model || "claude-haiku-4-5";
      state.agentBriefingModel = m.includes("haiku") ? "HAIKU 4.5" : m;
      renderStoredAgentBriefing();
      saveState();
    } catch (err) {
      els.agentText.textContent = err.name === "AbortError"
        ? "Briefing timed out — hit ↻ to retry."
        : `Briefing error: ${err.message}`;
    } finally {
      clearTimeout(timeout);
      els.agentModule.classList.remove("is-loading");
    }
  }

  function refreshAgentAfterTaskDone() {
    els.agentText.textContent = "Task complete. Generating the next guide…";
    window.setTimeout(fetchAgentBriefing, 250);
  }

  function renderStoredAgentBriefing() {
    if (Array.isArray(state.agentBriefing) && state.agentBriefing.length) {
      els.agentText.innerHTML = state.agentBriefing.map((s) => `<span>${escapeHtml(s)}</span>`).join("<br><br>");
      if (state.agentBriefingModel) els.agentModelLabel.textContent = state.agentBriefingModel;
      return;
    }

    els.agentText.textContent = "Complete a task to generate the next guide, or press ↻ for a manual refresh.";
  }

  // --- Helpers ---

  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDate(dateStr) {
    const [year, month, day] = dateStr.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
  }

  function renderCalendar() {
    const widget = document.getElementById("calendarWidget");
    if (!widget) return;

    const now = new Date();
    const todayIso = todayStr();

    const baseMonth = new Date(now.getFullYear(), now.getMonth() + state.calendarOffset, 1);

    const completedByDate = completedTasksByDate();
    const completionDates = new Set(completedByDate.keys());

    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const DAY_HEADERS = ["M","T","W","T","F","S","S"];

    const months = [0, 1, 2].map(i => new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1));
    const rangeLabel = `${MONTH_NAMES[months[0].getMonth()]} ${months[0].getFullYear()} – ${MONTH_NAMES[months[2].getMonth()]} ${months[2].getFullYear()}`;

    const monthsHTML = months.map(month => {
      const y = month.getFullYear();
      const m = month.getMonth();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const firstDow = (month.getDay() + 6) % 7; // Mon=0

      let cells = "";
      for (let i = 0; i < firstDow; i++) cells += `<span class="cal-empty"></span>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const tasksForDate = completedByDate.get(dateStr) || [];
        const classes = [
          "cal-day",
          dateStr === todayIso ? "is-today" : "",
          completionDates.has(dateStr) ? "is-done" : "",
          tasksForDate.length ? "has-completions" : ""
        ].filter(Boolean).join(" ");
        cells += `<button type="button" class="${classes}" data-date="${dateStr}" data-task-count="${tasksForDate.length}">${d}</button>`;
      }

      return `
        <div class="cal-month">
          <div class="cal-month-name">${MONTH_NAMES[m]} ${y}</div>
          <div class="cal-grid">
            ${DAY_HEADERS.map(h => `<span class="cal-header">${h}</span>`).join("")}
            ${cells}
          </div>
        </div>`;
    }).join("");

    widget.innerHTML = `
      <div class="cal-nav">
        <button type="button" id="calPrev">◀</button>
        <span>${rangeLabel}</span>
        <button type="button" id="calNext">▶</button>
      </div>
      <div class="cal-months">${monthsHTML}</div>`;

    document.getElementById("calPrev").addEventListener("click", () => {
      state.calendarOffset--;
      saveState();
      renderCalendar();
    });
    document.getElementById("calNext").addEventListener("click", () => {
      state.calendarOffset++;
      saveState();
      renderCalendar();
    });

    widget.querySelectorAll(".cal-day.has-completions").forEach((day) => {
      const dateStr = day.dataset.date;
      const tasksForDate = completedByDate.get(dateStr) || [];
      day.addEventListener("mouseenter", (event) => showCalendarTooltip(dateStr, tasksForDate, event));
      day.addEventListener("mousemove", (event) => positionCalendarTooltip(event));
      day.addEventListener("mouseleave", hideCalendarTooltip);
      day.addEventListener("focus", () => showCalendarTooltip(dateStr, tasksForDate, day));
      day.addEventListener("blur", hideCalendarTooltip);
      day.addEventListener("click", (event) => {
        event.preventDefault();
        showCalendarTooltip(dateStr, tasksForDate, day);
      });
    });
  }

  function completedTasksByDate() {
    const grouped = new Map();
    state.projects.forEach((project) => {
      project.tasks.forEach((task) => {
        if (task.status !== "done" || !task.doneDate) return;
        const entry = { id: task.id, label: task.title || "Completed task", phase: project.name };
        if (!grouped.has(task.doneDate)) grouped.set(task.doneDate, []);
        grouped.get(task.doneDate).push(entry);
      });
    });
    return grouped;
  }

  function getCalendarTooltip() {
    let tooltip = document.getElementById("calendarTooltip");
    if (tooltip) return tooltip;

    tooltip = document.createElement("div");
    tooltip.id = "calendarTooltip";
    tooltip.className = "calendar-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function showCalendarTooltip(dateStr, tasksForDate, anchor) {
    if (!tasksForDate.length) return;
    const tooltip = getCalendarTooltip();
    const visibleTasks = tasksForDate.slice(0, 8);
    const overflow = tasksForDate.length - visibleTasks.length;

    tooltip.innerHTML = `
      <div class="calendar-tooltip__header">
        <span>${formatDate(dateStr)}</span>
        <strong>${tasksForDate.length} done</strong>
      </div>
      <ul class="calendar-tooltip__list">
        ${visibleTasks.map((item) => `
          <li>
            <span class="calendar-tooltip__check">✓</span>
            <div>
              <strong>${escapeHtml(item.label)}</strong>
              <small>${escapeHtml(item.phase)}</small>
            </div>
          </li>
        `).join("")}
      </ul>
      ${overflow > 0 ? `<div class="calendar-tooltip__more">+${overflow} more completed task${overflow === 1 ? "" : "s"}</div>` : ""}
    `;

    tooltip.classList.add("is-visible");
    positionCalendarTooltip(anchor);
  }

  function positionCalendarTooltip(anchor) {
    const tooltip = getCalendarTooltip();
    if (!tooltip.classList.contains("is-visible")) return;

    const gap = 14;
    const rect = typeof anchor?.clientX === "number"
      ? { left: anchor.clientX, top: anchor.clientY, width: 0, height: 0 }
      : anchor.getBoundingClientRect();

    const width = tooltip.offsetWidth || 340;
    const height = tooltip.offsetHeight || 220;
    let left = rect.left + rect.width + gap;
    let top = rect.top - 10;

    if (left + width > window.innerWidth - 12) left = rect.left - width - gap;
    if (left < 12) left = 12;
    if (top + height > window.innerHeight - 12) top = window.innerHeight - height - 12;
    if (top < 12) top = 12;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideCalendarTooltip() {
    const tooltip = document.getElementById("calendarTooltip");
    if (!tooltip) return;
    tooltip.classList.remove("is-visible");
  }

  // --- State: localStorage (fast) + GitHub Gist (sync across machines) ---

  async function loadState() {
    const local = loadLocalState();
    const { gistId, gistToken } = window.MISSION_CONFIG;
    if (!gistId || !gistToken) return local;

    try {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { Authorization: `token ${gistToken}` }
      });
      if (!res.ok) return local;
      const data = await res.json();
      const content = data.files[gistStateFile] && data.files[gistStateFile].content;
      if (!content) return local;
      const gistState = JSON.parse(content);
      if (gistState.version !== boardVersion) return local;
      const merged = mergeState(gistState);
      saveLocalState(merged);
      return merged;
    } catch (_) {
      return local;
    }
  }

  function saveState() {
    saveLocalState(state);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToGist, 1500);
  }

  async function saveToGist() {
    const { gistId, gistToken } = window.MISSION_CONFIG;
    if (!gistId || !gistToken) return;
    try {
      await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: {
          Authorization: `token ${gistToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          files: { [gistStateFile]: { content: JSON.stringify(state) } }
        })
      });
    } catch (_) {}
  }

  function loadLocalState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (!saved || saved.version !== boardVersion) return defaultState();
      return mergeState(saved);
    } catch (_) {
      return defaultState();
    }
  }

  function saveLocalState(s) {
    localStorage.setItem(storageKey, JSON.stringify(s));
  }

  function addProjectWorkDates(dateSet, startIso, endIso) {
    if (!startIso || !endIso) return;
    const start = parseLocalDate(startIso);
    const end = parseLocalDate(endIso);
    if (!start || !end || start > end) return;

    const cursor = new Date(start);
    while (cursor <= end) {
      dateSet.add(toIsoDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  function parseLocalDate(iso) {
    const [year, month, day] = String(iso).split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  function toIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function defaultState() {
    return {
      version: boardVersion,
      projects: seedProjects(),
      activeProjectId: "",
      currentTask: "",
      avatar: "",
      calendarOffset: 0,
      conditionsLocation: "southend",
      agentBriefing: [],
      agentBriefingAt: "",
      agentBriefingModel: "HAIKU 4.5",
      ...(window.MISSION_STATE || {})
    };
  }

  function mergeState(saved) {
    const base = defaultState();
    return {
      ...base,
      ...saved,
      projects: Array.isArray(saved.projects) && saved.projects.length ? saved.projects : base.projects,
      conditionsLocation: saved.conditionsLocation || base.conditionsLocation || "southend",
      agentBriefing: saved.agentBriefing || base.agentBriefing || [],
      agentBriefingAt: saved.agentBriefingAt || base.agentBriefingAt || "",
      agentBriefingModel: saved.agentBriefingModel || base.agentBriefingModel || "HAIKU 4.5"
    };
  }
})();
