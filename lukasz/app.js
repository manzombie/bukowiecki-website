(function () {
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

  let activePhase = "All";
  let state = defaultState();
  let saveTimer = null;
  let lastRenderedDate = "";

  boot();

  async function boot() {
    els.loginForm.addEventListener("submit", onLogin);
    els.lockButton.addEventListener("click", lock);
    els.avatarButton.addEventListener("click", () => els.avatarInput.click());
    els.avatarInput.addEventListener("change", onAvatarSelected);
    els.copyPromptButton.addEventListener("click", copyPrompt);
    els.completeCurrentButton.addEventListener("click", completeCurrent);
    els.putBackButton.addEventListener("click", putBackCurrent);
    els.agentRefresh.addEventListener("click", fetchAgentBriefing);
    els.newTaskButton.addEventListener("click", openNewTaskPrompt);
    els.newStageButton.addEventListener("click", openNewStagePrompt);
    els.conditionsLocation.addEventListener("change", () => {
      state.conditionsLocation = els.conditionsLocation.value;
      saveState();
      fetchConditions();
    });

    state = await loadState();
    if (!state.collapsed) state.collapsed = {};
    if (!state.taskDates) state.taskDates = {};
    if (!state.amendments) state.amendments = {};
    if (!state.customTasks) state.customTasks = {};
    if (!state.customPhases) state.customPhases = [];
    if (!state.conditionsLocation) state.conditionsLocation = "southend";
    if (state.calendarOffset === undefined) state.calendarOffset = 0;
    // Migrate old parked → moved, then unify
    if (!state.moved) {
      state.moved = {};
      if (state.parked) {
        Object.keys(state.parked).forEach(id => { state.moved[id] = "Deferred"; });
      }
    }
    delete state.parked; // no longer used

    // One-time migration: backfill taskDates for done tasks that predate date tracking.
    // Also force-corrects week-1-* dates in case they were wrongly set to today on first run.
    let migrated = false;
    Object.entries(state.tasks).forEach(([id, taskState]) => {
      if (taskState === "done") {
        if (id.startsWith("week-1-") && state.taskDates[id] !== "2026-05-02") {
          state.taskDates[id] = "2026-05-02";
          migrated = true;
        } else if (!state.taskDates[id]) {
          state.taskDates[id] = id.startsWith("week-2-") ? "2026-05-03" : todayStr();
          migrated = true;
        }
      }
    });
    if (migrated) saveState();

    // Collapse all phases by default except Week 1
    if (Object.keys(state.collapsed).length === 0) {
      allPhases().forEach((phase) => {
        state.collapsed[phase.phase] = phase.phase !== "Week 1";
      });
    }

    // Auto-open when no passcode is configured (public build); otherwise honor the session.
    if (!window.MISSION_CONFIG.passcode || sessionStorage.getItem(authKey) === "true") unlock();
    tickClock();
    setInterval(tickClock, 10000);
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
    const phases = ["All"].concat(allPhases().map((phase) => phase.phase));
    els.phaseFilters.innerHTML = phases.map((phase) => (
      `<button type="button" class="${phase === activePhase ? "is-active" : ""}" data-phase="${phase}">${phase}</button>`
    )).join("");
    els.phaseFilters.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        activePhase = button.dataset.phase;
        render();
      });
    });
  }

  function renderTasks() {
    const phasesSource = allPhases();
    const allPhaseNames = phasesSource.map(p => p.phase);
    const phases = activePhase === "All"
      ? phasesSource
      : phasesSource.filter((phase) => phase.phase === activePhase);

    els.tasks.innerHTML = phases.map((phase) => {
      const homePhaseName = phase.phase;

      // Build move dropdown options — every phase except this task's home
      function moveMenu(id, originPhaseName = homePhaseName) {
        const options = allPhaseNames
          .filter(n => n !== originPhaseName)
          .map(n => `<button type="button" class="move-option" data-action="move-to" data-target="${n}">${n}</button>`)
          .join("");
        return `
          <details class="move-wrapper" data-id="${id}">
            <summary>Move</summary>
            <div class="move-menu">${options}</div>
          </details>`;
      }

      // Home tasks — skip any that have been moved elsewhere
      const taskRows = phase.tasks.map((task, index) => {
        const id = taskId(homePhaseName, index);
        if (state.moved[id] && state.moved[id] !== homePhaseName) return "";

        return renderTaskArticle({
          id,
          task,
          phase,
          meta: phase.owner,
          moveMenuHtml: moveMenu(id),
          showAmend: true,
          isMoved: false
        }) + renderAmendmentsFor(id, phase, homePhaseName);
      }).join("");

      // Guest tasks — tasks from other phases moved into this one
      const guestRows = flatTasks()
        .filter(item => state.moved[item.id] === homePhaseName && item.phase.phase !== homePhaseName)
        .map(item => {
          const id = item.id;
          // Move menu for guest tasks — all phases except current host
          const guestOptions = allPhaseNames
            .filter(n => n !== homePhaseName)
            .map(n => `<button type="button" class="move-option" data-action="move-to" data-target="${n}">${n}</button>`)
            .join("");
          const guestMoveMenu = `
            <details class="move-wrapper" data-id="${id}">
              <summary>Move</summary>
              <div class="move-menu">
                <button type="button" class="move-option move-home" data-action="move-home">↩ Back to ${item.phase.phase}</button>
                ${guestOptions}
              </div>
            </details>`;
          return renderTaskArticle({
            id,
            task: item.task,
            phase: item.phase,
            meta: `<span class="moved-from">↩ ${item.phase.phase}</span>`,
            moveMenuHtml: guestMoveMenu,
            showAmend: true,
            isMoved: true
          }) + renderAmendmentsFor(id, item.phase, homePhaseName);
        }).join("");

      const isCollapsed = state.collapsed[homePhaseName] ? "is-collapsed" : "";
      return `
        <section class="phase ${isCollapsed}" data-phase="${homePhaseName}">
          <div class="phase-head" data-toggle="${homePhaseName}">
            <p>${homePhaseName}</p>
            <h2>${phase.title}<span class="phase-toggle">▾</span></h2>
            <span>${phase.outcome}</span>
          </div>
          <div class="task-list">${guestRows}${taskRows}</div>
        </section>`;
    }).join("");

    els.tasks.querySelectorAll("[data-toggle]").forEach((head) => {
      head.addEventListener("click", () => {
        const phase = head.dataset.toggle;
        state.collapsed[phase] = !state.collapsed[phase];
        render();
      });
    });

    els.tasks.querySelectorAll("[data-action]").forEach((control) => {
      control.addEventListener("click", (event) => {
        const card = event.target.closest(".task");
        const id = card.dataset.id;
        const action = event.target.dataset.action;
        let completedTask = false;
        if (action === "done") {
          if (state.tasks[id] === "done") {
            state.tasks[id] = "ready";
            delete state.taskDates[id];
          } else {
            state.tasks[id] = "done";
            state.taskDates[id] = todayStr();
            completedTask = true;
          }
        }
        if (action === "blocked") state.tasks[id] = state.tasks[id] === "blocked" ? "ready" : "blocked";
        if (action === "amend") {
          openAmendPrompt(id);
          return;
        }
        if (action === "move-to") {
          const target = event.target.dataset.target;
          state.moved[id] = target;
          state.collapsed[target] = false; // expand destination so you see it land
          event.target.closest("details").removeAttribute("open");
        }
        if (action === "move-home") {
          delete state.moved[id];
        }
        if (action === "now") {
          state.currentTask = id;
          state.tasks[id] = "active";
        }
        render();
        if (completedTask) refreshAgentAfterTaskDone();
      });
    });
  }

  function renderTaskArticle({ id, task, phase, meta, moveMenuHtml, showAmend, isMoved }) {
    const taskState = state.tasks[id] || "ready";
    const doneDate = taskState === "done" && state.taskDates[id]
      ? `<span class="task-date">${formatDate(state.taskDates[id])}</span>` : "";
    return `
      <article class="task ${taskState}${isMoved ? " is-moved" : ""}" data-id="${id}">
        <button class="check" type="button" data-action="done" aria-label="Mark done">${taskState === "done" ? "✓" : ""}</button>
        <div>
          <h3>${escapeHtml(task)}</h3>
          <p>${meta}${doneDate}</p>
        </div>
        <div class="task-actions">
          <button type="button" data-action="now">Now</button>
          <button type="button" data-action="blocked">Block</button>
          ${showAmend ? `<button type="button" data-action="amend">Amend</button>` : ""}
          ${moveMenuHtml}
          <a href="${githubIssueUrl(phase, task)}" target="_blank" rel="noreferrer">Issue</a>
        </div>
      </article>`;
  }

  function renderAmendmentsFor(parentId, phase, hostPhaseName) {
    const items = state.amendments[parentId] || [];
    if (!items.length) return "";

    return `
      <div class="amendment-list" data-parent="${parentId}">
        ${items.map((item, index) => {
          const id = amendmentId(parentId, index);
          const meta = `<span class="amendment-kind">${item.kind === "done" ? "Tick off" : item.kind === "parked" ? "Park" : "Still to do"}</span>${item.note ? ` ${escapeHtml(item.note)}` : ""}`;
          const moveHtml = item.kind === "parked"
            ? `<details class="move-wrapper" data-id="${id}">
                <summary>Move</summary>
                <div class="move-menu">
                  <button type="button" class="move-option" data-action="move-to" data-target="Deferred">Parked by design</button>
                </div>
              </details>`
            : `<details class="move-wrapper" data-id="${id}">
                <summary>Move</summary>
                <div class="move-menu">
                  <button type="button" class="move-option move-home" data-action="move-to" data-target="${hostPhaseName}">Keep in ${hostPhaseName}</button>
                  <button type="button" class="move-option" data-action="move-to" data-target="Deferred">Parked by design</button>
                </div>
              </details>`;
          return renderTaskArticle({
            id,
            task: item.task,
            phase,
            meta,
            moveMenuHtml: moveHtml,
            showAmend: false,
            isMoved: true
          });
        }).join("")}
      </div>`;
  }

  function openAmendPrompt(parentId) {
    const original = flatTasks().find((item) => item.id === parentId);
    if (!original) return;

    const completed = prompt("What smaller completed task should be ticked off?", suggestedCompletedTask(original.task));
    if (!completed) return;

    const remaining = prompt("What task should remain on the board?", suggestedRemainingTask(original.task));
    if (!remaining) return;

    const park = confirm("Move the remaining task to Parked by design? Press Cancel to keep it in the same week.");
    state.amendments[parentId] = state.amendments[parentId] || [];

    const doneId = amendmentId(parentId, state.amendments[parentId].length);
    state.amendments[parentId].push({
      kind: "done",
      task: completed.trim(),
      note: "split from original task"
    });
    state.tasks[doneId] = "done";
    state.taskDates[doneId] = todayStr();

    const remainingId = amendmentId(parentId, state.amendments[parentId].length);
    state.amendments[parentId].push({
      kind: park ? "parked" : "todo",
      task: remaining.trim(),
      note: park ? "parked by design" : "remaining scope"
    });
    state.tasks[remainingId] = park ? "blocked" : "ready";
    if (park) state.moved[remainingId] = "Deferred";

    render();
    refreshAgentAfterTaskDone();
  }

  function suggestedCompletedTask(task) {
    if (/synthetic test tenant/i.test(task)) return "Create synthetic dry-run end-to-end pipeline check.";
    return `Complete the shipped subset of: ${task}`;
  }

  function suggestedRemainingTask(task) {
    if (/synthetic test tenant/i.test(task)) return "Create dedicated synthetic test tenant that runs end-to-end every 5 minutes.";
    return `Finish remaining scope of: ${task}`;
  }

  function openNewTaskPrompt() {
    const phases = allPhases();
    const phaseNames = phases.map((phase) => phase.phase).join(", ");
    const target = prompt(`Which week or stage should this task go in?\n\nOptions: ${phaseNames}`, activePhase !== "All" ? activePhase : "Week 7");
    if (!target) return;

    const phase = phases.find((item) => item.phase.toLowerCase() === target.trim().toLowerCase());
    if (!phase) {
      alert("I could not find that week or stage. Create the stage first, or use one of the names shown.");
      return;
    }

    const task = prompt("Write the task.", "");
    if (!task || !task.trim()) return;

    state.customTasks[phase.phase] = state.customTasks[phase.phase] || [];
    state.customTasks[phase.phase].push(task.trim());
    state.collapsed[phase.phase] = false;
    activePhase = phase.phase;
    render();
  }

  function openNewStagePrompt() {
    const phase = prompt("Stage name, for example v3.4 or Week 9.", "v3.4");
    if (!phase || !phase.trim()) return;

    const phaseName = phase.trim();
    if (allPhases().some((item) => item.phase.toLowerCase() === phaseName.toLowerCase())) {
      alert("That stage already exists.");
      return;
    }

    const title = prompt("Stage title.", "");
    if (!title || !title.trim()) return;

    const outcome = prompt("What should be true when this stage is complete?", "");
    if (!outcome || !outcome.trim()) return;

    const owner = prompt("Owner / mode.", "Lukasz + Codex");
    if (!owner || !owner.trim()) return;

    state.customPhases.push({
      phase: phaseName,
      title: title.trim(),
      outcome: outcome.trim(),
      owner: owner.trim()
    });
    state.customTasks[phaseName] = state.customTasks[phaseName] || [];
    const firstTask = prompt("First task for this stage? Leave blank if you only want to create the stage.", "");
    if (firstTask && firstTask.trim()) state.customTasks[phaseName].push(firstTask.trim());
    state.collapsed[phaseName] = false;
    activePhase = phaseName;
    render();
  }

  function renderProgress() {
    const allTaskIds = flatTasks().map((item) => item.id);
    const done = allTaskIds.filter((id) => state.tasks[id] === "done").length;
    const active = allTaskIds.filter((id) => state.tasks[id] === "active").length;
    const blocked = allTaskIds.filter((id) => state.tasks[id] === "blocked").length;
    const percent = Math.round((done / allTaskIds.length) * 100);

    els.progressPercent.textContent = `${percent}%`;
    els.progressBar.style.width = `${percent}%`;
    els.doneCount.textContent = done;
    els.activeCount.textContent = active;
    els.blockedCount.textContent = blocked;
    els.focusLabel.textContent = state.currentTask ? "Active" : "Ready";
  }

  async function fetchConditions() {
    const location = conditionLocations[state.conditionsLocation] || conditionLocations.southend;
    const { lat, lon } = location;
    if (els.conditionsUpdated) els.conditionsUpdated.textContent = "Loading";

    try {
      const weatherPromise = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`, { cache: "no-store" });
      const marinePromise = location.marine
        ? fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_level_height_msl&timezone=auto&forecast_days=2`, { cache: "no-store" })
        : Promise.resolve(null);
      const [weatherRes, marineRes] = await Promise.all([weatherPromise, marinePromise]);

      if (!weatherRes.ok) throw new Error("weather unavailable");
      renderWeather(await weatherRes.json());

      if (marineRes?.ok) {
        renderTides(await marineRes.json());
      } else if (location.marine) {
        renderTideFallback();
      } else {
        renderTideNotApplicable(location.label);
      }

      if (els.conditionsUpdated) {
        els.conditionsUpdated.textContent = `Updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
      }
    } catch {
      renderConditionsError();
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
    const current = flatTasks().find((item) => item.id === state.currentTask);
    if (!current) {
      els.currentTask.classList.add("is-hidden");
      els.currentTaskEmpty.classList.remove("is-hidden");
      els.promptBox.value = defaultPrompt();
      return;
    }

    els.currentTask.classList.remove("is-hidden");
    els.currentTaskEmpty.classList.add("is-hidden");
    els.currentPhase.textContent = `${current.phase.phase} // ${current.phase.owner}`;
    els.currentTitle.textContent = current.task;
    els.currentDescription.textContent = current.phase.outcome;
    els.promptBox.value = taskPrompt(current);
  }

  function completeCurrent() {
    if (!state.currentTask) return;
    state.tasks[state.currentTask] = "done";
    state.taskDates[state.currentTask] = todayStr();
    state.currentTask = "";
    render();
    refreshAgentAfterTaskDone();
  }

  function putBackCurrent() {
    if (!state.currentTask) return;
    state.tasks[state.currentTask] = "ready";
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
    els.timeLabel.textContent = now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    });
    const today = todayStr();
    if (today !== lastRenderedDate) {
      lastRenderedDate = today;
      renderCalendar();
    }
  }

  function flatTasks() {
    const base = allPhases().flatMap((phase) => phase.tasks.map((task, index) => ({
      id: taskId(phase.phase, index),
      phase,
      task
    })));
    const amendments = base.flatMap((item) =>
      (state.amendments[item.id] || []).map((amendment, index) => ({
        id: amendmentId(item.id, index),
        phase: item.phase,
        task: amendment.task,
        parentId: item.id,
        amendment
      }))
    );
    return base.concat(amendments);
  }

  function taskId(phase, index) {
    return `${phase.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`;
  }

  function allPhases() {
    const customPhases = (state.customPhases || []).map((phase) => ({
      ...phase,
      tasks: state.customTasks[phase.phase] || []
    }));

    const customOnlyNames = Object.keys(state.customTasks || {})
      .filter((name) => !window.MISSION_TASKS.some((phase) => phase.phase === name))
      .filter((name) => !customPhases.some((phase) => phase.phase === name));

    const orphanedCustomPhases = customOnlyNames.map((name) => ({
      phase: name,
      title: "Custom stage",
      outcome: "Custom tasks added from Mission Control.",
      owner: "Lukasz",
      tasks: state.customTasks[name] || []
    }));

    return window.MISSION_TASKS
      .map((phase) => ({
        ...phase,
        tasks: phase.tasks.concat(state.customTasks[phase.phase] || [])
      }))
      .concat(customPhases, orphanedCustomPhases);
  }

  function amendmentId(parentId, index) {
    return `${parentId}-amend-${index + 1}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function githubIssueUrl(phase, task) {
    const title = encodeURIComponent(`[${phase.phase}] ${task}`);
    const body = encodeURIComponent(`Mission Control task\n\nPhase: ${phase.phase}\nOutcome: ${phase.outcome}\n\nDefinition of done:\n- ${task}`);
    return `https://github.com/${window.MISSION_CONFIG.githubRepo}/issues/new?title=${title}&body=${body}`;
  }

  function taskPrompt(item) {
    return `You are working on Mr. Lobster v3 rebuild.\n\nCurrent Mission Control task:\n${item.task}\n\nPhase:\n${item.phase.phase} - ${item.phase.title}\n\nTarget outcome:\n${item.phase.outcome}\n\nOwner/mode:\n${item.phase.owner}\n\nInstructions:\n1. Read the existing repo before changing files.\n2. Keep the implementation modular and aligned with the v3 master plan.\n3. Add or update tests where the change affects behaviour.\n4. Update BUILD_LOG.md with what shipped, decisions, risks, and the next action.\n5. When done, include the Mission Control task name in the commit or PR description.\n\nDefinition of done:\n- The task above is complete.\n- Tests or smoke checks have run.\n- BUILD_LOG.md has the next action for the following session.`;
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
      const allTasks = flatTasks();
      const done = allTasks.filter((t) => state.tasks[t.id] === "done").length;
      const total = allTasks.length;
      const percent = Math.round((done / total) * 100);
      const activeItem = allTasks.find((t) => state.tasks[t.id] === "active");
      const nextReady = allTasks.find((t) => !state.tasks[t.id] || state.tasks[t.id] === "ready");
      const focus = activeItem || nextReady;

      const phases = allPhases().map((p) =>
        `${p.phase}: ${p.title} — ${p.outcome}`
      ).join("\n");

      const system = `You are the Mission Control AI for Mr. Lobster OS — Lukasz Bukowiecki's private ops dashboard. He is a solo founder building Mr. Lobster v3, an AI receptionist SaaS for UK trade businesses. Build plan:\n${phases}\n\nRespond with exactly 2 sentences separated by a single newline character. No greetings, no labels, no markdown. Sentence 1: sharp motivational line. Sentence 2: specific tactical advice on the next task. Be direct and energising.`;

      const taskSummary = allPhases().map((p) => {
        const rows = p.tasks.map((task, i) => {
          const id = taskId(p.phase, i);
          const s = state.tasks[id] || "ready";
          return `  [${s.toUpperCase()}] ${task}`;
        }).join("\n");
        return `${p.phase}: ${p.title}\n${rows}`;
      }).join("\n\n");

      const userMsg = `Date: ${todayStr()}. Progress: ${percent}% (${done}/${total} tasks done).\n\nFull task board:\n${taskSummary}\n\n${focus ? `Current focus: "${focus.task}" — ${focus.phase.phase}: ${focus.phase.title}.` : "All tasks complete."}`;

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
    const taskLookup = new Map(flatTasks().map((item) => [item.id, item]));
    const grouped = new Map();

    Object.entries(state.taskDates || {}).forEach(([id, date]) => {
      if (state.tasks[id] !== "done" || !date) return;
      const item = taskLookup.get(id);
      const entry = {
        id,
        label: taskLabel(item),
        phase: item?.phase?.phase || "Mission Control"
      };
      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date).push(entry);
    });

    return grouped;
  }

  function taskLabel(item) {
    if (!item) return "Completed task";
    const task = item.task;
    if (typeof task === "string") return task;
    return task?.title || task?.name || task?.label || task?.task || "Completed task";
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
      tasks: {},
      taskDates: {},
      currentTask: "",
      avatar: "",
      collapsed: {},
      calendarOffset: 0,
      moved: {},
      amendments: {},
      customTasks: {},
      customPhases: [],
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
      tasks: { ...(base.tasks || {}), ...(saved.tasks || {}) },
      taskDates: { ...(base.taskDates || {}), ...(saved.taskDates || {}) },
      collapsed: { ...(base.collapsed || {}), ...(saved.collapsed || {}) },
      moved: { ...(base.moved || {}), ...(saved.moved || {}) },
      amendments: { ...(base.amendments || {}), ...(saved.amendments || {}) },
      customTasks: { ...(base.customTasks || {}), ...(saved.customTasks || {}) },
      customPhases: saved.customPhases || base.customPhases || [],
      conditionsLocation: saved.conditionsLocation || base.conditionsLocation || "southend",
      agentBriefing: saved.agentBriefing || base.agentBriefing || [],
      agentBriefingAt: saved.agentBriefingAt || base.agentBriefingAt || "",
      agentBriefingModel: saved.agentBriefingModel || base.agentBriefingModel || "HAIKU 4.5"
    };
  }
})();
