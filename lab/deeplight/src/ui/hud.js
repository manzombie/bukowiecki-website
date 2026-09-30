/* hud.js — minimal HUD: hull, energy, sonar readiness, objective, score and
 * chain multiplier, the aim reticle (with gimbal-limit state), sonar/objective
 * markers and context tutorial prompts. Every signal pairs colour with text or
 * shape so it never relies on colour alone. */

import { HULL, ENERGY, SONAR, SCORE } from "../core/tuning.js";

const $ = (id) => document.getElementById(id);

// tutorial prompts: keyboard + touch wording, and a completion test
export const PROMPTS = {
  basics: {
    title: "PILOTING",
    steps: [
      { kb: "<kbd>W</kbd> thrust forward · <kbd>S</kbd> brake / reverse", touch: "Left stick up to thrust, down to brake", done: (c) => c.moved > 10 },
      { kb: "<kbd>A</kbd> / <kbd>D</kbd> turn", touch: "Left stick sideways to turn", done: (c) => c.turned > 1.3 },
      { kb: "<kbd>Space</kbd> rise · <kbd>Ctrl</kbd> or <kbd>Z</kbd> descend", touch: "▲ / ▼ to rise and descend", done: (c) => c.climbed > 3 },
      { kb: "Collect the gold-banded salvage crates, then head north", touch: "Collect the gold-banded crates, then head north", done: (c) => c.salvage >= 3 || c.leftBay },
    ],
  },
  boost: { title: "BOOST", kb: "Hold <kbd>Shift</kbd> to boost. It drains energy — the same energy your light pulses use.", touch: "Hold BOOST to go faster. It drains energy, like firing.", done: (c) => c.boosted > 0.8, timeout: 12 },
  sonar: { title: "SONAR", kb: "It's dark ahead. <kbd>Q</kbd> or right-click pings sonar: rock, threats, loot and your objective light up briefly.", touch: "It's dark ahead. Tap SONAR: rock, threats, loot and your objective light up.", done: (c) => c.pinged, timeout: 20 },
  fire: { title: "THREAT — MINES", kb: "Spiked mines arm when you're near (faster blinking) and blast after ~1.5 s. Aim with the mouse, <b>click</b> to fire from range — or back off to disarm.", touch: "Spiked mines arm when you're close and blast after ~1.5 s. Drag to aim, hold FIRE — or back off to disarm.", done: (c) => c.kills > 0, timeout: 18 },
  fork: { title: "ROUTE CHOICE", kb: "Left, cyan beacons: the <b>safe passage</b> — wide and calm. Right, red buoys: the <b>salvage run</b> — narrow, fast water, an eel, and far more salvage.", done: () => false, timeout: 11 },
  current: { title: "STRONG CURRENT", kb: "Fast water pushes you along. <kbd>S</kbd> brakes against it; the eel's den is ahead.", touch: "Fast water. Pull the stick down to brake; the eel's den is ahead.", done: () => false, timeout: 8 },
  shades: { title: "THREAT — SHADES", kb: "Shades creep toward you in the dark but <b>freeze while lit</b> by your headlights. Keep your aim on them, then fire.", done: (c) => c.shadeKills > 0, timeout: 14 },
  warden: { title: "THE WARDEN", kb: "When its eyes flare <b>red</b> it is about to lunge — dodge sideways. While its eyes are <b>cyan</b> it's stunned and takes double damage. The 3 seal nodes are above: back off and aim up.", done: (c) => c.seals > 0, timeout: 16 },
  ascend: { title: "EXTRACTION", kb: "Seal broken — ascend! A rumble and falling dust mean rock is about to drop: move aside or shoot it.", done: () => false, timeout: 9 },
};

export class HUD {
  constructor(view, settings) {
    this.view = view; this.settings = settings;
    this.el = {
      hud: $("hud"), hullBar: $("hull-bar"), hullVal: $("hull-val"), enBar: $("energy-bar"), enVal: $("energy-val"),
      sonar: $("sonar-val"), obj: $("objective"), objText: $("obj-text"), objDist: $("obj-dist"), score: $("score"),
      mult: $("mult"), depth: $("depth"), speed: $("speed"), cam: $("cam-mode"), reticle: $("reticle"), aimdot: $("aimdot"),
      markers: $("markers"), prompt: $("prompt"), toasts: $("toasts"), banner: $("banner"), vignette: $("vignette"), cockpit: $("cockpit"),
    };
    this.markerEls = new Map();
    this.v3 = view.camera.position.clone();   // Vector3 without importing three here
    this.promptState = null;
  }
  show(on) { this.el.hud.hidden = !on; if (!on) this.el.cockpit.hidden = true; }

  setObjective(o, flash = true) {
    this.el.objText.textContent = o ? o.text : "";
    if (flash) { this.el.obj.classList.remove("flash"); void this.el.obj.offsetWidth; this.el.obj.classList.add("flash"); }
  }

  toast(text, color = "#fff") {
    const d = document.createElement("div"); d.className = "toast"; d.textContent = text; d.style.color = color;
    this.el.toasts.appendChild(d); setTimeout(() => d.remove(), 1150);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }
  banner(text, ms = 1800) {
    const b = this.el.banner; b.textContent = text; b.classList.add("on");
    clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove("on"), ms);
  }

  // ------------------------------------------------------------- prompts ----
  showPrompt(id, ctx) {
    const p = PROMPTS[id]; if (!p) return;
    this.promptState = { id, p, t: 0, step: 0 };
    this.el.prompt.hidden = false;
    this.el.prompt.querySelector(".p-title").textContent = p.title;
    this._renderPrompt(ctx);
  }
  _renderPrompt(ctx) {
    const s = this.promptState, touch = ctx.device === "touch";
    const body = this.el.prompt.querySelector(".p-body");
    if (s.p.steps) {
      body.innerHTML = s.p.steps.map((st, i) => `<div class="step ${i < s.step ? "done" : i === s.step ? "cur" : ""}">${i < s.step ? "✓" : i === s.step ? "▸" : "·"} ${touch ? st.touch : st.kb}</div>`).join("");
    } else body.innerHTML = (touch && s.p.touch) || s.p.kb;
  }
  updatePrompt(dt, ctx) {
    const s = this.promptState; if (!s) return;
    s.t += dt;
    if (s.p.steps) {
      const before = s.step;
      while (s.step < s.p.steps.length && s.p.steps[s.step].done(ctx)) s.step++;
      if (s.step !== before || ctx.deviceChanged) this._renderPrompt(ctx);
      if (s.step >= s.p.steps.length) { if (!s.doneT) s.doneT = s.t; if (s.t - s.doneT > 1.2) this.hidePrompt(); }
    } else {
      if (ctx.deviceChanged) this._renderPrompt(ctx);
      if ((s.p.done && s.p.done(ctx) && s.t > 1.5) || (s.p.timeout && s.t > s.p.timeout)) this.hidePrompt();
    }
  }
  hidePrompt() { this.promptState = null; this.el.prompt.hidden = true; }

  // ---------------------------------------------------------------- frame ----
  update(sim, rs, rig, input, dt, opts) {
    const e = this.el;
    const hullPct = Math.round(sim.hull / HULL.max * 100);
    e.hullBar.style.width = hullPct + "%"; e.hullVal.textContent = hullPct;
    e.hullBar.classList.toggle("low", hullPct <= 30);
    const en = Math.round(sim.sub.energy / ENERGY.max * 100);
    e.enBar.style.width = en + "%"; e.enVal.textContent = en;
    e.enBar.classList.toggle("low", en < ENERGY.pulseCost);
    if (sim.sonarCd <= 0) { e.sonar.textContent = "READY"; e.sonar.className = "ready"; }
    else { e.sonar.textContent = sim.sonarCd.toFixed(1) + " s"; e.sonar.className = "busy"; }
    e.score.textContent = sim.score.toLocaleString("en");
    const into = sim.chain % SCORE.chainStep;
    e.mult.innerHTML = `<b>×${sim.mult}</b> <span id="chain">${sim.mult >= SCORE.maxMult ? "MAX" : "●".repeat(into) + "○".repeat(SCORE.chainStep - into)}</span>`;
    e.depth.textContent = `DEPTH ${Math.max(0, Math.round(-rs.pos[1] + 60))} m`;
    e.speed.textContent = `${Math.hypot(...rs.vel).toFixed(1)} m/s`;
    e.cam.textContent = rig.mode === "cockpit" ? "COCKPIT" : "CHASE";
    e.cockpit.hidden = rig.mode !== "cockpit";
    // reticle
    const W = innerWidth, H = innerHeight;
    e.reticle.style.left = ((input.reticle.x + 1) / 2 * W) + "px";
    e.reticle.style.top = ((1 - input.reticle.y) / 2 * H) + "px";
    e.reticle.classList.toggle("limited", sim.aimLimited);
    // where the beam will actually go (shown when it differs from the reticle)
    if (sim.aimLimited) {
      const m = sim.muzzle(), d = sim.aimDir;
      const p = this._project([m[0] + d[0] * 30, m[1] + d[1] * 30, m[2] + d[2] * 30]);
      if (p) { e.aimdot.style.left = p.x + "px"; e.aimdot.style.top = p.y + "px"; e.aimdot.classList.add("on"); } else e.aimdot.classList.remove("on");
    } else e.aimdot.classList.remove("on");
    // damage vignette
    const dv = Math.max(sim.damageFlash * 1.6, hullPct <= 25 ? 0.35 + 0.15 * Math.sin(performance.now() / 180) : 0);
    e.vignette.style.boxShadow = `inset 0 0 ${120 + dv * 80}px rgba(255, 40, 20, ${Math.min(0.7, dv)})`;
    // objective distance
    const o = sim.objective;
    if (o) e.objDist.textContent = `${Math.round(Math.hypot(o.target[0] - rs.pos[0], o.target[1] - rs.pos[1], o.target[2] - rs.pos[2]))} m`;
    this._markers(sim, rs, opts);
  }

  _project(p) {
    const v = this.v3.set(p[0], p[1], p[2]).project(this.view.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, nx: v.x, ny: v.y };
  }

  _markers(sim, rs, opts) {
    const want = new Map();
    const now = sim.time;
    // sonar contacts fade in as the ring reaches them and fade out after revealTime
    for (const e of sim.entities) {
      const at = sim.revealed.get(e.id);
      if (at === undefined || !e.alive) continue;
      const age = now - at;
      if (age < 0 || age > SONAR.revealTime) continue;
      const kind = ["mine", "lurker", "shade", "warden", "seal"].includes(e.type) ? "threat" : e.type === "recorder" ? "poi" : "loot";
      const icon = kind === "threat" ? "!" : kind === "poi" ? "<span>★</span>" : e.type === "repair" ? "+" : "$";
      want.set(e.id, { p: e.pos, kind, icon, fade: Math.min(1, (SONAR.revealTime - age) / 1.2) });
    }
    // objective marker: always, after sonar, or never (setting)
    const ra = opts.routeAssist;
    const sonarRecent = now - sim.sonarT < 6;
    if (sim.objective && (ra === "always" || (ra === "sonar" && sonarRecent))) {
      want.set("__obj", { p: sim.objective.target, kind: "obj", icon: "<span>◆</span>", fade: ra === "always" ? 1 : Math.min(1, (6 - (now - sim.sonarT)) / 1.5), edge: true });
    }
    for (const [id, el] of this.markerEls) if (!want.has(id)) { el.remove(); this.markerEls.delete(id); }
    for (const [id, m] of want) {
      let el = this.markerEls.get(id);
      if (!el) { el = document.createElement("div"); el.innerHTML = `<span class="ic"></span><span class="d"></span>`; this.el.markers.appendChild(el); this.markerEls.set(id, el); }
      el.className = "mk " + m.kind;
      el.querySelector(".ic").innerHTML = m.icon;
      const d = Math.hypot(m.p[0] - rs.pos[0], m.p[1] - rs.pos[1], m.p[2] - rs.pos[2]);
      el.querySelector(".d").textContent = Math.round(d) + " m";
      let p = this._project(m.p);
      let edge = false;
      // clamp off-screen objective markers to the screen edge so they still guide
      if (!p || p.x < 30 || p.x > innerWidth - 30 || p.y < 60 || p.y > innerHeight - 40) {
        if (!m.edge) { el.style.opacity = 0; continue; }
        const v = this.v3.set(...m.p).applyMatrix4(this.view.camera.matrixWorldInverse);
        let ax = v.x, ay = v.y; if (v.z > 0) { ax = -ax; ay = -ay; }
        const k = Math.min((innerWidth / 2 - 40) / Math.abs(ax || 1e-6), (innerHeight / 2 - 60) / Math.abs(ay || 1e-6));
        p = { x: innerWidth / 2 + ax * k, y: innerHeight / 2 - ay * k }; edge = true;
      }
      el.classList.toggle("edge", edge);
      el.style.left = p.x + "px"; el.style.top = p.y + "px"; el.style.opacity = m.fade;
    }
  }
}
