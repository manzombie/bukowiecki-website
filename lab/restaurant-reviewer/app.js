/* app.js — Restaurant Review Builder. One step at a time, mobile-first.
 * Client-side rating (rating.js). One server call (/api/review on the Babcia
 * service) writes the prose. No secrets in the client. */
(function () {
  "use strict";
  const RENDER_URL = "https://babcia-server.onrender.com";
  const dev = location.search.includes("dev");
  const API = dev ? "http://localhost:8790" : RENDER_URL;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const SCALE = ["Poor", "Meh", "OK", "Good", "Excellent"];
  const FOOD_ISSUES = ["Slow timing", "Served cold", "Missing item", "Not fresh", "Overcooked", "Underseasoned"];

  const state = {
    name: "", cuisine: "", occasion: "", withWho: "", price: "",
    arrivalScore: null, arrivalText: "", drinksScore: null, drinksText: "",
    foodScore: null, foodText: "", standout: "", issues: [],
    serviceScore: null, serviceText: "", atmosphereScore: null, atmosphereText: "",
    valueScore: null, valueText: "",
    stance: "balanced", willReturn: "", willRecommend: "", length: "full",
    override: null, reviewText: "",
  };

  // step ids in order
  const STEPS = ["intro", "basics", "arrival", "drinks", "food", "service", "atmosphere", "value", "stance", "verdict", "result"];
  let step = 0;

  /* ---------- reusable bits ---------- */
  function scaleRow(key) {
    return `<div class="scale" data-key="${key}">` +
      SCALE.map((lbl, i) => `<button type="button" class="dot${state[key] === i + 1 ? " on" : ""}" data-v="${i + 1}"><b>${i + 1}</b><span>${lbl}</span></button>`).join("") +
      `</div>`;
  }
  function textRow(key, ph) {
    return `<textarea class="specifics" data-key="${key}" rows="3" placeholder="${esc(ph)}">${esc(state[key])}</textarea>`;
  }
  function section(key, title, sub, ph, extra) {
    return `<h2>${title}</h2><p class="sub">${sub}</p>${scaleRow(key + "Score")}
      <label class="lbl">Anything specific? <span class="opt">(this is the good stuff)</span></label>
      ${textRow(key + "Text", ph)}${extra || ""}`;
  }

  /* ---------- step renderers ---------- */
  const RENDER = {
    intro() {
      return `<div class="intro">
        <div class="kicker">Research #08 · built in public</div>
        <img class="logo-hero" src="logo.png" alt="Restaurant Reviewer">
        <h1 class="sr-only">Restaurant Review Builder</h1>
        <p>Had a meal worth reviewing? Answer a few quick questions and get a fair,
           well-written review to paste into Google, plus a star rating that actually
           matches your words.</p>
        <p class="fine">A handful of taps, a few optional notes. Two minutes. Works great on your phone.</p>
        <button class="btn primary big" id="start">Start →</button>
        <p class="fine">Nothing is saved or shared. Only the final "write my review" step talks to a server.</p>
      </div>`;
    },
    basics() {
      return `<h2>The basics</h2><p class="sub">Just enough to set the scene.</p>
        <label class="lbl">Restaurant name</label><input class="inp" data-key="name" value="${esc(state.name)}" placeholder="e.g. Nora">
        <label class="lbl">Type / cuisine</label><input class="inp" data-key="cuisine" value="${esc(state.cuisine)}" placeholder="e.g. steak house">
        <label class="lbl">Occasion <span class="opt">(optional)</span></label><input class="inp" data-key="occasion" value="${esc(state.occasion)}" placeholder="e.g. birthday dinner">
        <label class="lbl">Who with <span class="opt">(optional)</span></label><input class="inp" data-key="withWho" value="${esc(state.withWho)}" placeholder="e.g. my partner">
        <label class="lbl">Price ballpark <span class="opt">(optional)</span></label><input class="inp" data-key="price" value="${esc(state.price)}" placeholder="e.g. £45 a head">`;
    },
    arrival() { return section("arrival", "Arrival & booking", "First impression, the welcome, how the booking was handled.", "e.g. booked online easily, but no one greeted us for five minutes"); },
    drinks() { return section("drinks", "Drinks", "Quality and choice, including non-alcoholic options.", "e.g. the beer came in a warm glass; good alcohol-free list"); },
    food() {
      const chips = `<label class="lbl">Any execution issues? <span class="opt">(tap any)</span></label>
        <div class="chips">${FOOD_ISSUES.map((t) => `<button type="button" class="chip${state.issues.includes(t) ? " on" : ""}" data-issue="${esc(t)}">${t}</button>`).join("")}</div>
        <label class="lbl">Standout dish <span class="opt">(optional)</span></label>
        <input class="inp" data-key="standout" value="${esc(state.standout)}" placeholder="e.g. the ribeye">`;
      return section("food", "Food", "The heart of it. Mains, standout dishes, anything off.", "e.g. steak cooked perfectly, but the béarnaise tasted stale", chips);
    },
    service() { return section("service", "Service", "Attentive? Knowledgeable? Pace? How they handled any slip.", "e.g. the mayonnaise never arrived despite asking twice"); },
    atmosphere() { return section("atmosphere", "Atmosphere", "Vibe, noise, comfort, cleanliness.", "e.g. warm room but the ventilation struggled with the grill smoke"); },
    value() { return section("value", "Value", "Did it feel worth the money?", "e.g. fair for the cut of meat, steep for the sides"); },
    stance() {
      const opt = (v, t, d) => `<button type="button" class="stance${state.stance === v ? " on" : ""}" data-stance="${v}"><b>${t}</b><span>${d}</span></button>`;
      return `<h2>Your voice</h2><p class="sub">Same meal, different reviewer. This shapes the tone, not the facts.</p>
        <div class="stances">
          ${opt("generous", "Generous", "Give the benefit of the doubt, lead with the good.")}
          ${opt("balanced", "Balanced", "Even-handed, weigh both sides fairly.")}
          ${opt("critical", "Critical", "Fair chance, but a high bar, the market is saturated.")}
        </div>`;
    },
    verdict() {
      const pick = (key, v, t) => `<button type="button" class="pick${state[key] === v ? " on" : ""}" data-pick="${key}" data-v="${v}">${t}</button>`;
      const len = (v, t, d) => `<button type="button" class="len${state.length === v ? " on" : ""}" data-len="${v}"><b>${t}</b><span>${d}</span></button>`;
      return `<h2>The verdict</h2><p class="sub">This becomes your closing line.</p>
        <label class="lbl">Would you go back?</label>
        <div class="row3">${pick("willReturn", "yes", "Yes")}${pick("willReturn", "maybe", "Maybe")}${pick("willReturn", "no", "No")}</div>
        <label class="lbl">Would you recommend it?</label>
        <div class="row3">${pick("willRecommend", "yes", "Yes")}${pick("willRecommend", "maybe", "Maybe")}${pick("willRecommend", "no", "No")}</div>
        <label class="lbl">How long a review?</label>
        <div class="lens">${len("short", "Short", "3-5 lines for Google")}${len("full", "Full", "a structured piece")}</div>`;
    },
    result() {
      const r = RATING.compute(ratingInput());
      const stars = state.override || r.stars;
      const starHtml = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star${n <= (stars || 0) ? " on" : ""}" data-star="${n}">★</button>`).join("");
      return `<h2>Your rating</h2>
        <div class="stars" id="stars">${starHtml}</div>
        <p class="rationale">${esc(r.rationale)}</p>
        ${state.override ? `<p class="fine">You set ${state.override}★ (suggested ${r.stars}★).</p>` : ``}
        <div class="writebox">
          <button class="btn primary big" id="write">Write my review</button>
          <p class="fine" id="write-note"></p>
        </div>
        <div id="output" hidden>
          <div class="reviewcard"><div class="reviewtext" id="reviewtext"></div></div>
          <div class="outbar">
            <button class="btn" id="copy">Copy review</button>
            <button class="btn ghost" id="copy-stars">Copy "★ x N"</button>
            <span class="fine" id="copy-status"></span>
          </div>
        </div>`;
    },
  };

  function ratingInput() {
    return {
      food: state.foodScore, service: state.serviceScore, value: state.valueScore,
      atmosphere: state.atmosphereScore, arrival: state.arrivalScore, drinks: state.drinksScore,
      stance: state.stance, willReturn: state.willReturn, willRecommend: state.willRecommend,
    };
  }

  /* ---------- render + nav ---------- */
  function render() {
    const id = STEPS[step];
    $("#stage").innerHTML = RENDER[id]();
    wireStage(id);
    const showNav = id !== "intro";
    $("#nav").hidden = !showNav;
    $("#progress").hidden = !showNav;
    $("#logomini").hidden = !showNav;
    if (showNav) {
      $("#bar").style.width = Math.round((step) / (STEPS.length - 1) * 100) + "%";
      $("#stepcount").textContent = (id === "result") ? "Done" : `${step} / ${STEPS.length - 2}`;
      $("#back").disabled = step <= 1;
      $("#next").hidden = (id === "result");
      $("#next").textContent = id === "verdict" ? "See my rating ›" : "Next ›";
    }
    window.scrollTo(0, 0);
  }

  function wireStage(id) {
    if (id === "intro") { $("#start").onclick = () => { step = 1; render(); }; return; }
    // inputs / textareas
    $("#stage").querySelectorAll("[data-key]").forEach((el) => {
      el.addEventListener("input", () => { state[el.dataset.key] = el.value; });
    });
    // scales
    $("#stage").querySelectorAll(".scale").forEach((sc) => {
      sc.querySelectorAll(".dot").forEach((b) => b.onclick = () => {
        const key = sc.dataset.key; state[key] = +b.dataset.v;
        sc.querySelectorAll(".dot").forEach((x) => x.classList.toggle("on", x === b));
      });
    });
    // food issue chips
    $("#stage").querySelectorAll(".chip").forEach((c) => c.onclick = () => {
      const t = c.dataset.issue; const i = state.issues.indexOf(t);
      if (i >= 0) state.issues.splice(i, 1); else state.issues.push(t);
      c.classList.toggle("on");
    });
    // stance
    $("#stage").querySelectorAll(".stance").forEach((b) => b.onclick = () => {
      state.stance = b.dataset.stance;
      $("#stage").querySelectorAll(".stance").forEach((x) => x.classList.toggle("on", x === b));
    });
    // verdict picks + length
    $("#stage").querySelectorAll(".pick").forEach((b) => b.onclick = () => {
      state[b.dataset.pick] = b.dataset.v;
      $("#stage").querySelectorAll(`.pick[data-pick="${b.dataset.pick}"]`).forEach((x) => x.classList.toggle("on", x === b));
    });
    $("#stage").querySelectorAll(".len").forEach((b) => b.onclick = () => {
      state.length = b.dataset.len;
      $("#stage").querySelectorAll(".len").forEach((x) => x.classList.toggle("on", x === b));
    });
    if (id === "result") wireResult();
  }

  /* ---------- result: stars override + write ---------- */
  function wireResult() {
    $("#stars").querySelectorAll(".star").forEach((s) => s.onclick = () => {
      state.override = +s.dataset.star; render();
    });
    $("#write").onclick = writeReview;
  }

  async function writeReview() {
    const btn = $("#write"), note = $("#write-note");
    btn.disabled = true;
    await wakeUp(note);
    note.textContent = "Writing your review…";
    try {
      const res = await fetch(API + "/api/review", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: answersPayload(), stance: state.stance, length: state.length }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) { note.textContent = data.note || "You've hit the limit for now. Try again later."; btn.disabled = false; return; }
      if (!res.ok || !data.reviewText) { note.textContent = data.note || "Something went wrong writing the review. Try again."; btn.disabled = false; return; }
      state.reviewText = data.reviewText;
      $("#reviewtext").textContent = data.reviewText;
      $("#output").hidden = false;
      note.textContent = data.mock ? "(demo text; live writing turns on once the server key is set)" : "";
      btn.textContent = "Rewrite";
      btn.disabled = false;
      wireOutput();
      $("#output").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      note.textContent = "Couldn't reach the writer. Check your connection and try again.";
      btn.disabled = false;
    }
  }
  function wireOutput() {
    $("#copy").onclick = () => navigator.clipboard.writeText(state.reviewText).then(
      () => setStatus("Review copied ✓"), () => setStatus("Press ⌘/Ctrl+C"));
    $("#copy-stars").onclick = () => {
      const n = state.override || RATING.compute(ratingInput()).stars || 0;
      navigator.clipboard.writeText("★".repeat(n) + "☆".repeat(5 - n) + ` (${n}/5)`).then(() => setStatus("Rating copied ✓"));
    };
  }
  function setStatus(t) { $("#copy-status").textContent = t; setTimeout(() => $("#copy-status").textContent = "", 2000); }

  function answersPayload() {
    return {
      name: state.name, cuisine: state.cuisine, occasion: state.occasion, withWho: state.withWho, price: state.price,
      arrivalScore: state.arrivalScore, arrivalText: state.arrivalText,
      drinksScore: state.drinksScore, drinksText: state.drinksText,
      foodScore: state.foodScore, foodText: state.foodText, standout: state.standout, issues: state.issues,
      serviceScore: state.serviceScore, serviceText: state.serviceText,
      atmosphereScore: state.atmosphereScore, atmosphereText: state.atmosphereText,
      valueScore: state.valueScore, valueText: state.valueText,
      willReturn: state.willReturn, willRecommend: state.willRecommend,
    };
  }

  /* ---------- cold start (Render free tier wakes ~40s) ---------- */
  async function wakeUp(note) {
    try {
      const r = await fetch(API + "/api/review/health", { cache: "no-store" });
      if (r.ok) return;
    } catch (_) {}
    note.textContent = "Warming up, one moment…";
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try { const r = await fetch(API + "/api/review/health", { cache: "no-store" }); if (r.ok) return; } catch (_) {}
    }
  }

  /* ---------- nav buttons ---------- */
  let toastT;
  function toast(m) { const t = $("#toast"); t.textContent = m; t.className = "show"; clearTimeout(toastT); toastT = setTimeout(() => t.className = "", 2600); }
  $("#next").onclick = () => { if (step < STEPS.length - 1) { step++; render(); } };
  $("#back").onclick = () => { if (step > 0) { step--; render(); } };

  render();
})();
