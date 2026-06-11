/* Mission Control UI — vanilla render helpers for the glass component library.
   No framework. Each helper returns a DOM element. See design-system.md. */
(function () {
  "use strict";

  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  /* ---- GlassCard ---------------------------------------------------------
     props: { level: 1|2|3, label, hero, collapsible, closeable,
              metric (pill metric when collapsed), onClose, onToggle } */
  function glassCard(props = {}) {
    const level = props.level || 1;
    const card = el("section", `glass-${level} mc-card${props.hero ? " mc-card--hero" : ""}`);

    if (props.label) {
      const head = el("div", "mc-card__head");
      head.appendChild(el("p", "mc-label", escapeHtml(props.label)));
      const controls = el("div", "mc-card__controls");
      if (props.collapsible) {
        const collapse = el("button", "", "–");
        collapse.type = "button";
        collapse.title = "Collapse";
        collapse.addEventListener("click", () => toggleCollapse(card, props));
        controls.appendChild(collapse);
      }
      if (props.closeable) {
        const close = el("button", "", "×");
        close.type = "button";
        close.title = "Close";
        close.addEventListener("click", () => {
          card.remove();
          if (props.onClose) props.onClose();
        });
        controls.appendChild(close);
      }
      if (controls.children.length) head.appendChild(controls);
      card.appendChild(head);
    }

    const body = el("div", "mc-card__body");
    card.appendChild(body);
    card.body = body;
    return card;
  }

  function toggleCollapse(card, props) {
    const pill = el("button", `glass-1 mc-pill`);
    pill.type = "button";
    pill.appendChild(el("span", "mc-label mc-label--bright", escapeHtml(props.label)));
    if (props.metric) pill.appendChild(el("span", "mc-pill__metric", escapeHtml(props.metric())));
    pill.addEventListener("click", () => {
      pill.replaceWith(card);
      if (props.onToggle) props.onToggle(false);
    });
    card.replaceWith(pill);
    if (props.onToggle) props.onToggle(true);
  }

  /* ---- BigNumber ----------------------------------------------------------
     props: { value, label, meta, size: 'md'|'lg'|'xl', tone: ''|'accent'|'danger',
              countUp: boolean } */
  function bigNumber(props = {}) {
    const size = props.size === "xl" ? " mc-bignum--xl" : props.size === "md" ? " mc-bignum--md" : "";
    const tone = props.tone ? ` mc-bignum--${props.tone}` : "";
    const wrap = el("div", `mc-bignum${size}${tone}`);
    const value = el("strong", "mc-bignum__value", escapeHtml(props.value));
    wrap.appendChild(value);
    if (props.label) wrap.appendChild(el("span", "mc-bignum__label", escapeHtml(props.label)));
    if (props.meta) wrap.appendChild(el("span", "mc-bignum__meta", escapeHtml(props.meta)));
    if (props.countUp) countUp(value, Number(props.value) || 0);
    wrap.valueNode = value;
    return wrap;
  }

  /* Count-up animation for streak increments / first paint. Static when reduced motion. */
  function countUp(node, target, duration = 400) {
    if (REDUCED_MOTION.matches || !Number.isFinite(target)) {
      node.textContent = target;
      return;
    }
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = Math.round(target * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---- ProgressArc ----------------------------------------------------------
     props: { value, max, label, size (px, default 120), danger } */
  function progressArc(props = {}) {
    const size = props.size || 120;
    const stroke = Math.max(4, Math.round(size / 20));
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const ratio = props.max > 0 ? Math.min(1, Math.max(0, props.value / props.max)) : 0;

    const wrap = el("div", `mc-arc${props.danger ? " mc-arc--danger" : ""}`);
    wrap.style.width = wrap.style.height = `${size}px`;
    wrap.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle class="mc-arc__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
        <circle class="mc-arc__fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
          stroke-dasharray="${c}" stroke-dashoffset="${c}"/>
      </svg>
      <div class="mc-arc__center">
        <span class="mc-arc__value">${escapeHtml(props.value)}</span>
        ${props.label ? `<span class="mc-arc__label">${escapeHtml(props.label)}</span>` : ""}
      </div>`;

    // Set the real offset on the next frame so the arc sweeps in on first paint.
    const fill = wrap.querySelector(".mc-arc__fill");
    const targetOffset = c * (1 - ratio);
    if (REDUCED_MOTION.matches) {
      fill.style.transition = "none";
      fill.style.strokeDashoffset = targetOffset;
    } else {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fill.style.strokeDashoffset = targetOffset;
      }));
    }
    return wrap;
  }

  /* ---- TaskRow ---------------------------------------------------------------
     props: { title, project, done, onToggle(next) } */
  function taskRow(props = {}) {
    const row = el("div", `mc-task${props.done ? " is-done" : ""}`);
    const toggle = el("button", "mc-task__toggle", "✓");
    toggle.type = "button";
    toggle.setAttribute("aria-label", props.done ? "Mark not done" : "Mark done");
    row.appendChild(toggle);
    row.appendChild(el("span", "mc-task__title", escapeHtml(props.title)));
    if (props.project) row.appendChild(el("span", "mc-task__project", escapeHtml(props.project)));

    toggle.addEventListener("click", () => {
      const next = !row.classList.contains("is-done");
      row.classList.toggle("is-done", next);
      toggle.setAttribute("aria-label", next ? "Mark not done" : "Mark done");
      if (next) pulseCard(row);
      if (props.onToggle) props.onToggle(next);
    });
    return row;
  }

  /* Green border pulse on the nearest containing card when a task is completed. */
  function pulseCard(node) {
    const card = node.closest(".mc-card");
    if (!card || REDUCED_MOTION.matches) return;
    card.classList.remove("is-pulsing");
    void card.offsetWidth; // restart the animation
    card.classList.add("is-pulsing");
  }

  /* ---- StreakBadge -------------------------------------------------------------
     props: { count, activity, lastDone } */
  function streakBadge(props = {}) {
    const wrap = el("div", "mc-streak");
    const count = el("span", "mc-streak__count", escapeHtml(props.count));
    wrap.appendChild(count);
    wrap.appendChild(el("span", "mc-streak__activity", escapeHtml(props.activity)));
    if (props.lastDone) wrap.appendChild(el("span", "mc-streak__meta", escapeHtml(props.lastDone)));
    return wrap;
  }

  /* ---- CalendarStrip --------------------------------------------------------------
     props: { days: [{date: Date, hasLog}], today: Date } */
  function calendarStrip(props = {}) {
    const wrap = el("div", "mc-calstrip");
    const todayKey = (props.today || new Date()).toDateString();
    const dows = ["S", "M", "T", "W", "T", "F", "S"];
    (props.days || []).forEach((day) => {
      const cell = el("div", "mc-calstrip__day");
      if (day.date.toDateString() === todayKey) cell.classList.add("is-today");
      if (day.hasLog) cell.classList.add("has-log");
      cell.appendChild(el("span", "mc-calstrip__dow", dows[day.date.getDay()]));
      cell.appendChild(el("span", "mc-calstrip__num", String(day.date.getDate())));
      cell.appendChild(el("span", "mc-calstrip__dot"));
      wrap.appendChild(cell);
    });
    return wrap;
  }

  /* ---- NewsCard --------------------------------------------------------------------
     props: { headline, summary, source, onVote(direction) } */
  function newsCard(props = {}) {
    const item = el("article", "mc-news-item");
    item.appendChild(el("h3", "mc-news-item__headline", escapeHtml(props.headline)));
    if (props.summary) item.appendChild(el("p", "mc-news-item__summary", escapeHtml(props.summary)));

    const foot = el("div", "mc-news-item__foot");
    foot.appendChild(el("span", "mc-news-item__source", escapeHtml(props.source || "")));
    const votes = el("div", "mc-news-item__votes");
    const up = el("button", "", "👍");
    const down = el("button", "", "👎");
    up.type = down.type = "button";
    up.setAttribute("aria-label", "More like this");
    down.setAttribute("aria-label", "Less like this");
    up.addEventListener("click", () => {
      item.classList.add("is-upvoted");
      if (props.onVote) props.onVote("up");
    });
    down.addEventListener("click", () => {
      item.classList.add("is-downvoted");
      const removeDelay = REDUCED_MOTION.matches ? 0 : 260;
      setTimeout(() => item.remove(), removeDelay);
      if (props.onVote) props.onVote("down");
    });
    votes.appendChild(up);
    votes.appendChild(down);
    foot.appendChild(votes);
    item.appendChild(foot);
    return item;
  }

  /* ---- Skeleton ---------------------------------------------------------------------- */
  function skeleton(width, height) {
    const node = el("div", "mc-skeleton");
    node.style.width = typeof width === "number" ? `${width}px` : width;
    node.style.height = typeof height === "number" ? `${height}px` : height;
    return node;
  }

  /* ---- Clock — seconds tick as an opacity pulse on the separator, not a jump ---------- */
  function clock() {
    const node = el("div", "mc-clock");
    function paint() {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      node.innerHTML = `${hh}<span class="mc-clock__sep">:</span>${mm}`;
      node.classList.toggle("is-tick", now.getSeconds() % 2 === 1);
    }
    paint();
    node.timer = setInterval(paint, 1000);
    return node;
  }

  /* ---- Staggered panel appearance on first load ---------------------------------------- */
  function staggerAppear(panels) {
    if (REDUCED_MOTION.matches) return;
    panels.forEach((panel, index) => {
      panel.classList.add("mc-appear");
      panel.style.animationDelay = `${index * 50}ms`;
    });
  }

  window.MCUI = {
    glassCard,
    bigNumber,
    countUp,
    progressArc,
    taskRow,
    streakBadge,
    calendarStrip,
    newsCard,
    skeleton,
    clock,
    staggerAppear,
    escapeHtml,
  };
})();
