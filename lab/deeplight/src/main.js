/* main.js — boot, screens, the fixed-step loop and event wiring.
 * URL options: ?level=sandbox (test tank) · ?debug=1 (overlay) · ?bot=1 (test pilot) · ?quality=low|medium|high */

import { LEVELS } from "./levels/index.js";
import { prepareLevel, buildWorld, validateLevel } from "./core/levelgraph.js";
import { GameSim, fmtTime } from "./core/game.js";
import { FixedStepper } from "./core/loop.js";
import { CameraRig } from "./core/camera.js";
import { TestPilot } from "./core/bot.js";
import { SONAR } from "./core/tuning.js";
import { axes } from "./core/sub.js";
import { Settings } from "./ui/settings.js";
import { Input, TouchControls, ACTION_LABELS } from "./ui/input.js";
import { HUD } from "./ui/hud.js";
import { GameAudio } from "./audio/audio.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function fatal(msg) {
  $("loading").hidden = true;
  $("error").hidden = false;
  $("error-msg").textContent = msg;
}

async function boot() {
  const levelId = LEVELS[params.get("level")] ? params.get("level") : "expedition";
  const settings = new Settings();
  if (params.get("quality")) settings.v.quality = params.get("quality");

  // three.js comes from a CDN; fail with a clear message if it can't load
  let View, DebugOverlay;
  try {
    ({ View } = await import("./render/view.js"));
    ({ DebugOverlay } = await import("./debug.js"));
  } catch (err) {
    console.error(err);
    return fatal("Couldn't load the 3D engine (three.js). Check your connection and reload.");
  }

  const def = await LEVELS[levelId]();
  const level = prepareLevel(def);
  const world = buildWorld(level);
  if (params.has("debug")) {
    const v = validateLevel(level, world);
    console.info("[deeplight] level validation", v.ok ? "OK" : "FAILED", v);
  }

  let view;
  try { view = new View($("app"), level, world, settings); }
  catch (err) { console.error(err); return fatal(err.code === "nowebgl" ? "Your browser or device doesn't support WebGL 2, which Deeplight needs. Try a current Chrome, Edge, Firefox or Safari." : "Couldn't start the renderer: " + err.message); }

  // ---- build the cave surface in a worker (fallback: main thread)
  const tMesh = performance.now();
  window.__loadTimes = { boot: Math.round(tMesh - (window.__t0 || 0)) };
  await new Promise((resolve, reject) => {
    const bar = $("ld-bar"), sub = $("ld-sub");
    const onChunks = (m) => { view.addChunks(m.chunks); bar.style.width = (m.done / m.total * 100).toFixed(0) + "%"; sub.textContent = `Building caves… ${m.done}/${m.total}`; };
    let worker;
    try { worker = new Worker(new URL("./worker/mesh-worker.js", import.meta.url), { type: "module" }); }
    catch (_) { worker = null; }
    const mainThread = async () => {
      const { chunkOrigins, meshChunk } = await import("./core/mesher.js");
      const origins = chunkOrigins(world);
      for (let i = 0; i < origins.length; i++) {
        const m = meshChunk(world, ...origins[i]);
        if (m) view.addChunks([m]);
        if (i % 8 === 0) { onChunks({ chunks: [], done: i, total: origins.length }); await new Promise((r) => setTimeout(r)); }
      }
      resolve();
    };
    if (!worker) return mainThread();
    const timeout = setTimeout(() => { worker.terminate(); mainThread(); }, 20000);
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "chunks") onChunks(m);
      else if (m.type === "done") { clearTimeout(timeout); worker.terminate(); resolve(); }
      else if (m.type === "error") { clearTimeout(timeout); worker.terminate(); reject(new Error(m.message)); }
    };
    worker.onerror = () => { clearTimeout(timeout); worker.terminate(); view.chunks.length ? resolve() : mainThread(); };
    worker.postMessage({ levelId });
  }).catch((err) => { fatal("Failed to build the level: " + err.message); throw err; });

  window.__loadTimes.mesh = Math.round(performance.now() - tMesh);
  const tDecor = performance.now();
  view.buildDecor();
  window.__loadTimes.decor = Math.round(performance.now() - tDecor);
  const game = new Game({ level, world, view, settings, DebugOverlay });
  const tWarm = performance.now();
  view.warmup();
  window.__loadTimes.warmup = Math.round(performance.now() - tWarm);
  window.__deeplight = game;
  $("loading").hidden = true;
  game.showTitle();
  game.loop();
}

class Game {
  constructor({ level, world, view, settings, DebugOverlay }) {
    Object.assign(this, { level, world, view, settings });
    this.sim = new GameSim(level, world);
    view.buildEntities(this.sim);
    this.rig = new CameraRig();
    this.input = new Input(view.canvas, settings);
    this.hud = new HUD(view, settings);
    this.audio = new GameAudio(settings);
    this.debug = new DebugOverlay(view, level);
    if (params.has("debug")) this.debug.toggle(true);
    this.mode = "title";                   // title | play | pause | fail | summary | menu
    this.stats = { steps: 0, dropped: 0, frameMs: 16 };
    this.prev = this._snap();
    this.stepper = new FixedStepper((dt) => this._step(dt));
    this.bot = params.has("bot") ? this._makeBot() : null;
    this._frameInput = { thrust: 0, yaw: 0, vert: 0, boost: false, fire: false, sonar: false, aimDir: null };
    this._touchSetup();
    this._menus();
    this._resetTutorialCtx();
    this.input.onLockLost = () => { if (this.mode === "play") this.pause(); };
    addEventListener("blur", () => { if (this.mode === "play") this.pause(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.mode === "play") this.pause(); });
    addEventListener("resize", () => this._resize());
    addEventListener("orientationchange", () => setTimeout(() => this._resize(), 200));
    addEventListener("keydown", (e) => {
      if (this.mode === "fail") {
        if (e.code === "Enter") this.continueRun();
        if (this.input.bindings.restart.includes(e.code)) this.restart();
      } else if (this.mode === "summary" && e.code === "Enter") this.restart();
    });
    this._resize();
  }

  // ------------------------------------------------------------- screens ----
  _screens(show) {
    for (const id of ["title", "pause", "fail", "summary", "controls", "settings"]) $(id).hidden = id !== show;
  }
  showTitle() {
    this.mode = "title"; this._screens("title");
    this.hud.show(false); $("touch").hidden = true;
    this.input.setActive(false); this.input.exitLock();
    this.audio.setMusic(false);
    const b = this.settings.best();
    $("best").textContent = b ? `Best: ${b.score.toLocaleString("en")} · rank ${b.rank} · ${fmtTime(b.time)}` : "";
    this.rig.reset(); this.titleT = 0;
  }
  start() {
    this.audio.unlock(); this.audio.cue("click");
    if (this.sim.state !== "playing" || this.sim.time > 0) this._newRun();
    this._play();
    this.hud.setObjective(this.sim.objective, false);
    if (this.sim.prompt) this.hud.showPrompt(this.sim.prompt.id, this._tutorialCtx());
  }
  _newRun() {
    this.sim.reset();
    this.view.rebindEntities(this.sim);
    this.rig.reset(); this.stepper.reset();
    this.prev = this._snap();
    this._resetTutorialCtx();
    this.hud.hidePrompt();
    this.hud.setObjective(this.sim.objective, false);
    this.sim.events.length = 0;
    if (this.bot) this.bot = this._makeBot();
    this.driver = null;
    const p = this.sim.prompt; if (p) this.hud.showPrompt(p.id, this._tutorialCtx());
  }
  _play() {
    this.mode = "play"; this._screens(null);
    this.hud.show(true);
    $("touch").hidden = !this.touchMode;
    this.input.setActive(true); this.input.disarmFire(250);
    if (!this.touchMode) this.input.requestLock();
    this.audio.setMusic(true);
    this.lastT = performance.now();
    this.stepper.reset();
  }
  pause() {
    if (this.mode !== "play") return;
    this.mode = "pause"; this._screens("pause");
    this.input.setActive(false); this.input.exitLock();
    $("touch").hidden = true;
    $("pause-stats").textContent = `${fmtTime(this.sim.time)} · score ${this.sim.score.toLocaleString("en")} · hull ${Math.round(this.sim.hull)}%`;
  }
  resume() { this.audio.unlock(); this._play(); }
  restart() { this.audio.unlock(); this._newRun(); this._play(); }
  continueRun() {
    if (this.sim.state !== "failed") return;
    this.sim.continueFromCheckpoint();
    this.rig.reset(); this.prev = this._snap(); this.stepper.reset();
    this._play();
    this.hud.banner("CHECKPOINT — HULL 70%");
  }

  _menus() {
    const on = (id, f) => $(id).addEventListener("click", (e) => { e.stopPropagation(); this.audio.unlock(); this.audio.cue("click"); f(); });
    on("btn-dive", () => this.start());
    on("btn-resume", () => this.resume());
    on("btn-restart", () => this.restart());
    on("btn-quit", () => this.showTitle());
    on("btn-continue", () => this.continueRun());
    on("btn-fail-restart", () => this.restart());
    on("btn-fail-quit", () => this.showTitle());
    on("btn-again", () => this.restart());
    on("btn-sum-quit", () => this.showTitle());
    const sheet = (id, from) => { this._screens(id); this.sheetReturn = from; };
    on("btn-controls", () => sheet("controls", "title"));
    on("btn-settings", () => sheet("settings", "title"));
    on("btn-p-controls", () => sheet("controls", "pause"));
    on("btn-p-settings", () => sheet("settings", "pause"));
    for (const b of document.querySelectorAll(".back")) b.addEventListener("click", () => { this.input.rebinding = null; this._screens(this.sheetReturn || "title"); });
    // settings controls
    for (const el of document.querySelectorAll("[data-s]")) {
      const k = el.dataset.s;
      if (el.type === "checkbox") el.checked = !!this.settings.get(k); else el.value = this.settings.get(k);
      el.addEventListener("input", () => {
        const v = el.type === "checkbox" ? el.checked : el.type === "range" ? parseFloat(el.value) : el.value;
        this.settings.set(k, v);
        if (k === "quality") this.view.setQuality(v);
      });
    }
    const musicBtns = [$("btn-music"), $("btn-p-music")];
    this.syncMusicButtons = () => { const on = this.settings.get("musicEnabled") !== false; for (const b of musicBtns) { b.textContent = "♪ Music: " + (on ? "On" : "Off"); b.setAttribute("aria-pressed", String(on)); } };
    this.toggleMusic = () => { this.settings.set("musicEnabled", this.settings.get("musicEnabled") === false); this.syncMusicButtons(); return this.settings.get("musicEnabled"); };
    for (const b of musicBtns) b.addEventListener("click", (e) => { e.stopPropagation(); this.audio.unlock(); this.toggleMusic(); });
    this.syncMusicButtons();
    on("btn-track", () => { const t = this.audio.nextTrack(); $("btn-track").textContent = "Track " + (t + 1); });
    on("btn-reset-keys", () => { this.input.resetBindings(); this._bindTable(); });
    this._bindTable();
    // show the input method actually in use
    const adapt = () => { $("controls-touch").hidden = !this.touchMode && !matchMedia("(pointer: coarse)").matches; };
    adapt();
  }
  _bindTable() {
    const t = $("bind-table"); t.innerHTML = "";
    for (const [act, label] of Object.entries(ACTION_LABELS)) {
      const tr = document.createElement("tr");
      const codes = this.input.bindings[act] || [];
      tr.innerHTML = `<td>${label}</td><td></td>`;
      const b = document.createElement("button"); b.className = "btn small"; b.type = "button";
      b.textContent = codes.map(prettyKey).join(" / ") || "—";
      b.addEventListener("click", () => {
        b.classList.add("wait"); b.textContent = "press a key…";
        this.input.rebinding = (code) => {
          if (code !== "Escape") {
            for (const a of Object.keys(this.input.bindings)) this.input.bindings[a] = this.input.bindings[a].filter((c) => c !== code);
            this.input.bindings[act] = [code, ...codes.filter((c) => c !== code)].slice(0, 2);
            this.input.saveBindings();
          }
          this._bindTable();
        };
      });
      tr.children[1].appendChild(b); t.appendChild(tr);
    }
  }

  _touchSetup() {
    this.touch = new TouchControls($("touch"), this.input);
    this.input.touch = this.touch;
    this.touchMode = matchMedia("(pointer: coarse)").matches;
    addEventListener("touchstart", () => { if (!this.touchMode) { this.touchMode = true; if (this.mode === "play") $("touch").hidden = false; $("controls-touch").hidden = false; } }, { passive: true });
    addEventListener("mousemove", (e) => { if (this.touchMode && e.movementX && !matchMedia("(pointer: coarse)").matches) { this.touchMode = false; $("touch").hidden = true; } });
  }

  _resize() {
    this.view.resize();
    const portrait = this.touchMode && innerHeight > innerWidth * 1.15;
    $("rotate").hidden = !portrait;
    if (portrait && this.mode === "play") this.pause();
  }

  // ----------------------------------------------------------- tutorial ----
  _resetTutorialCtx() { this.tut = { moved: 0, turned: 0, climbed: 0, boosted: 0, pinged: false, shadeKills: 0, seals: 0, lastYaw: this.sim.sub.yaw, start: [...this.sim.sub.pos] }; this._lastDevice = this.input.lastDevice; }
  _tutorialCtx() {
    const s = this.sim, t = this.tut;
    const dev = this.touchMode ? "touch" : "keyboard";
    const changed = dev !== this._lastDevice; this._lastDevice = dev;
    return {
      moved: t.moved, turned: t.turned, climbed: t.climbed, boosted: t.boosted, pinged: t.pinged,
      salvage: s.tally.salvageCount, leftBay: s.sub.pos[2] < -24, kills: s.tally.killCount, shadeKills: t.shadeKills, seals: t.seals,
      device: dev, deviceChanged: changed,
    };
  }

  // --------------------------------------------------------- simulation ----
  _snap() { const s = this.sim.sub; return { pos: [...s.pos], yaw: s.yaw, pitch: s.pitch, roll: s.roll, vel: [...s.vel] }; }

  _step(dt) {
    this.prev = this._snap();
    const inp = this._frameInput;
    this.sim.step(dt, inp);
    inp.sonar = false;                       // edge actions apply to one step only
    this.stats.steps++;
    // tutorial bookkeeping
    const s = this.sim.sub, t = this.tut;
    t.moved = Math.max(t.moved, Math.hypot(s.pos[0] - t.start[0], s.pos[2] - t.start[2]));
    t.turned += Math.abs(wrap(s.yaw - t.lastYaw)); t.lastYaw = s.yaw;
    t.climbed = Math.max(t.climbed, Math.abs(s.pos[1] - t.start[1]));
    if (s.boosting) t.boosted += dt;
  }

  _renderState(alpha) {
    const a = this.prev, s = this.sim.sub;
    const lerp = (x, y) => x + (y - x) * alpha;
    const rs = {
      pos: [lerp(a.pos[0], s.pos[0]), lerp(a.pos[1], s.pos[1]), lerp(a.pos[2], s.pos[2])],
      yaw: a.yaw + wrap(s.yaw - a.yaw) * alpha, pitch: lerp(a.pitch, s.pitch), roll: lerp(a.roll, s.roll),
      vel: [lerp(a.vel[0], s.vel[0]), lerp(a.vel[1], s.vel[1]), lerp(a.vel[2], s.vel[2])],
    };
    const { axis } = axes(rs.yaw, rs.pitch);
    rs.tail = [rs.pos[0] - axis[0] * 3.6, rs.pos[1] - axis[1] * 3.6, rs.pos[2] - axis[2] * 3.6];
    return rs;
  }

  /** desired aim: the point under the reticle (rock or target), seen from the muzzle */
  _aimFromReticle() {
    const cam = this.view.camera;
    const v = this._v || (this._v = cam.position.clone());
    v.set(this.input.reticle.x, this.input.reticle.y, 0.5).unproject(cam).sub(cam.position).normalize();
    const o = [cam.position.x, cam.position.y, cam.position.z], d = [v.x, v.y, v.z];
    const hit = this.sim.raycast(o, d, 110);
    const t = Math.max(hit.t, 4);
    const P = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const m = this.sim.muzzle();
    const dir = [P[0] - m[0], P[1] - m[1], P[2] - m[2]], L = Math.hypot(...dir);
    return L > 1.5 ? dir.map((x) => x / L) : d;
  }

  // ---------------------------------------------------------------- loop ----
  loop() {
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dtReal = Math.min(0.25, Math.max(0, (now - (this.lastT || now)) / 1000));
      this.lastT = now;
      this.stats.frameMs = dtReal * 1000;
      if (this.view.contextLost) return;
      try { this._frame(dtReal); } catch (err) { console.error(err); }
    };
    requestAnimationFrame(frame);
  }

  _frame(dt) {
    const sim = this.sim, inp = this.input;
    const opts = { reducedMotion: this.settings.get("reducedMotion"), shake: this.settings.get("shake"), fov: this.settings.get("fov"), routeAssist: this.settings.get("routeAssist"), thrust: 0 };
    // the developer overlay is only available with ?debug in the URL (so ` can't turn it on by accident)
    if (inp.consume("debug") && params.has("debug")) this.debug.toggle();

    if (this.mode === "play") {
      if (inp.consume("pause")) { this.pause(); return; }
      if (inp.consume("music")) this.hud.toast(this.toggleMusic() ? "MUSIC ON" : "MUSIC OFF", "#9fe8ff");
      if (inp.consume("camera")) this.rig.mode = this.rig.mode === "chase" ? "cockpit" : "chase";
      const st = this.bot ? this._botInput() : inp.state();
      const fi = this._frameInput;
      fi.thrust = st.thrust; fi.yaw = st.yaw; fi.vert = st.vert; fi.boost = st.boost; fi.fire = st.fire;
      if (inp.consume("sonar") || st.sonar) fi.sonar = true;
      fi.aimDir = st.aimDir || this._aimFromReticle();
      const before = this.stats.steps;
      this.stepper.advance(dt);
      this.stats.dropped = this.stepper.dropped;
      this.stats.stepsFrame = this.stats.steps - before;
      opts.thrust = fi.thrust;
      this.hud.updatePrompt(dt, this._tutorialCtx());
      this.view.adapt(dt * 1000, this.touchMode ? 33.4 : 16.9);
    }
    const rs = this._renderState(this.mode === "play" ? this.stepper.alpha : 1);
    if (this.mode === "title") this._titleCamera(dt, rs);
    else if (this.mode === "play") this.rig.update(rs, this.world, dt, opts);
    this.rig.shake = Math.max(0, (this.rig.shake || 0) - dt * 2.5);
    this._events();
    this.view.render(rs, sim, this.rig, this.mode === "play" ? dt : 0.0001, opts);
    if (this.mode !== "title") this.hud.update(sim, rs, this.rig, inp, dt, opts);
    this.audio.update({ active: this.mode === "play", thrust: opts.thrust, speed: Math.hypot(...rs.vel), boost: sim.sub.boosting, scrape: sim.sub.contactTime > 0 ? sim.sub.scrape : 0 });
    this.debug.update(sim, rs, this.rig, { frameMs: this.stats.frameMs, steps: this.stats.stepsFrame || 0, dropped: this.stats.dropped });
  }

  _titleCamera(dt, rs) {
    this.titleT += dt;
    const a = this.titleT * 0.12, r = 9;
    this.rig.mode = "chase";
    this.rig.pos = [rs.pos[0] + Math.sin(a) * r, rs.pos[1] + 2.5, rs.pos[2] + Math.cos(a) * r];
    this.rig.look = [rs.pos[0], rs.pos[1], rs.pos[2]];
    this.rig.roll = 0; this.rig.ready = false;
  }

  // -------------------------------------------------------------- events ----
  _events() {
    const sim = this.sim, fx = this.view.fx, A = this.audio, H = this.hud;
    const ev = sim.events.splice(0);
    for (const e of ev) {
      switch (e.type) {
        case "shot":
          fx.beam(e.from, e.to); this.view.muzzleFlash(); A.cue("fire");
          if (e.hit === "wall") fx.burst(e.to, 0xffb070, 8, 3, 0.4);
          if (e.hit && e.hit !== "wall") { $("reticle").classList.add("hit"); setTimeout(() => $("reticle").classList.remove("hit"), 90); }
          break;
        case "dry": A.cue("dry"); H.toast("NO ENERGY", "#ffb45a"); break;
        case "enemyHit": fx.burst(e.at, e.weak ? 0x7fffe0 : 0xff5a3c, e.weak ? 16 : 10, 4, 0.5); A.cue("enemyHit"); break;
        case "kill": {
          const p = e.entity.pos;
          if (e.entity.type === "seal") { fx.burst(p, 0xff5a3c, 60, 8, 1); fx.shell(p, 4, 0xff5a3c); this.tut.seals++; }
          else if (e.entity.type === "shade") { fx.burst(p, 0xb48cff, 40, 6, 0.9); this.tut.shadeKills++; }
          else if (e.entity.type === "lurker" || e.entity.type === "warden") { fx.burst(p, 0xffb020, 80, 9, 1.2); fx.shell(p, e.entity.type === "warden" ? 10 : 5, 0xffb020); H.banner(e.entity.type === "warden" ? "THE WARDEN FALLS" : "EEL DOWN"); }
          else if (e.entity.type === "boulder") fx.burst(p, 0x9a8a70, 40, 6, 1);
          if (e.entity.type !== "mine") A.cue("kill");
          break;
        }
        case "score": H.toast(`+${e.pts}${e.mult > 1 ? `  ×${e.mult}` : ""}`, e.mult > 1 ? "#ffc24a" : "#e8f1f2"); break;
        case "pickup": {
          const t = e.entity.type;
          fx.burst(e.entity.pos, t === "repair" ? 0x6dffb0 : 0xffc24a, 24, 4, 0.7);
          if (t === "repair") { A.cue("repair"); H.toast("HULL +35%", "#6dffb0"); } else A.cue("pickup");
          if (t === "recorder") { H.banner("FLIGHT RECORDER RECOVERED", 2600); A.cue("objective"); }
          break;
        }
        case "damage":
          A.cue("damage"); this.rig.shake = Math.min(1.2, (this.rig.shake || 0) + e.amount / 18);
          H.toast(`HULL −${Math.round(e.amount)}`, "#ff4a3a");
          if (e.chainLost) H.toast("CHAIN LOST", "#ff8a7a");
          if (e.source === "impact") fx.burst(sim.sub.contacts[0]?.p || sim.sub.pos, 0xffd0a0, 18, 5, 0.5);
          break;
        case "bump": A.cue("bump", e); if (sim.sub.contacts[0]) fx.burst(sim.sub.contacts[0].p, 0x9aa0a0, 6, 2, 0.5); break;
        case "explode": {
          fx.shell(e.pos, e.radius, 0xff7a30, 0.55); fx.burst(e.pos, 0xff7a30, 70, 10, 0.9); this.view.bigFlash(e.pos); A.cue("explode");
          const d = Math.hypot(...e.pos.map((v, i) => v - sim.sub.pos[i])); this.rig.shake = Math.max(this.rig.shake || 0, Math.max(0, 1 - d / 30));
          break;
        }
        case "arm": case "disarm": case "tell": case "lunge": case "freeze": case "stalk": A.cue(e.type); break;
        case "roar": A.cue("roar"); H.banner("THE WARDEN STIRS", 2200); this.rig.shake = 0.8; break;
        case "bite": fx.burst(sim.sub.pos, 0xff4a3a, 30, 5, 0.6); break;
        case "thud": fx.burst(e.entity.pos, 0x9a9080, 20, 4, 0.8); A.cue("bump", { impact: 6 }); break;
        case "shadeBurst": fx.burst(e.entity.pos, 0xb48cff, 40, 6, 0.9); A.cue("shadeBurst"); break;
        case "rumble": A.cue("rumble", e); fx.dustColumn(e.entity.home, 1.3 + (e.delay || 0)); this.rig.shake = Math.max(this.rig.shake || 0, 0.5); break;
        case "boulderLand": fx.burst(e.entity.pos, 0x8a7d66, 30, 5, 1); break;
        case "crush": this.rig.shake = 1.2; break;
        case "sonar": {
          this.view.sonarPulse(e.pos); A.cue("sonar"); this.tut.pinged = true;
          for (const x of sim.entities) {
            const at = sim.revealed.get(x.id);
            if (at !== undefined && Math.abs(at - sim.time - Math.hypot(...x.pos.map((v, i) => v - e.pos[i])) / SONAR.speed) < 0.01)
              A.cue("echo", { threat: ["mine", "lurker", "shade", "warden"].includes(x.type), delay: 0.25 + (at - sim.time) * 2 });
          }
          if (e.threats) H.toast(`SONAR: ${e.threats} THREAT${e.threats > 1 ? "S" : ""}`, "#ff8a7a");
          break;
        }
        case "sonarBusy": A.cue("sonarBusy"); break;
        case "prompt": H.showPrompt(e.id, this._tutorialCtx()); break;
        case "objective": H.setObjective(e.objective); A.cue("objective"); break;
        case "checkpoint": H.banner("CHECKPOINT"); A.cue("checkpoint"); break;
        case "sealBroken": {
          H.banner("SEAL BROKEN — ASCEND", 2600); A.cue("seal"); fx.shell(this.level.seal.pos, 12, 0xff5a3c, 1.2);
          break;
        }
        case "failed":
          A.cue("lose");
          setTimeout(() => this._showFail(e.source), 900);
          this.mode = "dying"; this.input.setActive(false); this.input.exitLock(); $("touch").hidden = true;
          break;
        case "extracted": this._showSummary(e.summary); break;
      }
    }
  }

  _showFail(source) {
    this.mode = "fail"; this._screens("fail");
    const causes = { impact: "You hit the rock too hard. Brake (S) before tight turns.", mine: "Caught in a mine blast. Shoot mines from range, or back away while they blink.", lurker: "An eel got you. Dodge when its eyes flare red; strike while they're cyan.", warden: "The Warden's bite. Watch for the red-eyed wind-up and move sideways.", shade: "Shades reached you. Keep them in your headlight beam — they freeze in the light.", rockfall: "Falling rock. When you hear the rumble, move out from under the dust." };
    $("fail-cause").textContent = causes[source] || "Your hull gave way.";
    this.audio.setMusic(false);
  }

  _showSummary(sum) {
    this.mode = "summary"; this._screens("summary");
    this.hud.show(false); $("touch").hidden = true;
    this.input.setActive(false); this.input.exitLock();
    this.audio.setMusic(false); this.audio.cue("win");
    const isBest = this.settings.submit(sum);
    $("rank").textContent = sum.rank;
    $("sum-table").innerHTML = sum.lines.map((l) => `<tr class="${l.pts < 0 ? "neg" : ""}"><td>${l.label}</td><td class="det">${l.detail}</td><td class="pts">${l.pts.toLocaleString("en")}</td></tr>`).join("")
      + `<tr class="total"><td>Total</td><td class="det">${fmtTime(sum.time)}</td><td class="pts">${sum.total.toLocaleString("en")}</td></tr>`;
    const b = this.settings.best();
    $("sum-best").textContent = isBest ? "NEW BEST!" : b ? `Best: ${b.score.toLocaleString("en")} (${b.rank})` : "";
  }

  // --------------------------------------------------------------- bot ----
  /** ?drive=1: expose the pilot's decision WITHOUT applying it, so an external
   *  harness can play through real keyboard / mouse / touch events */
  decide() {
    this.driver ||= new TestPilot(this.level, params.get("drive") === "salvage" ? "salvage" : "safe");
    const inp = this.driver.input(this.sim);
    let aim = null;
    if (inp.aimDir) {
      const m = this.sim.muzzle(), d = inp.aimDir;
      const v = this.view.camera.position.clone().set(m[0] + d[0] * 25, m[1] + d[1] * 25, m[2] + d[2] * 25).project(this.view.camera);
      if (v.z < 1) aim = { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
    }
    const r = this.input.reticle;
    return { thrust: inp.thrust, yaw: inp.yaw, vert: inp.vert, fire: inp.fire, sonar: inp.sonar, aim,
      reticle: { x: (r.x + 1) / 2 * innerWidth, y: (1 - r.y) / 2 * innerHeight }, mode: this.mode, state: this.sim.state,
      t: this.sim.time, obj: this.sim.objective?.id, hull: Math.round(this.sim.hull), score: this.sim.score, pos: this.sim.sub.pos.map(Math.round) };
  }

  _makeBot() { return new TestPilot(this.level, params.get("bot") === "salvage" ? "salvage" : "safe"); }
  _botInput() { return this.bot.input(this.sim); }
}

function prettyKey(c) {
  return c.replace(/^Key/, "").replace(/^Digit/, "").replace("ArrowUp", "↑").replace("ArrowDown", "↓").replace("ArrowLeft", "←").replace("ArrowRight", "→")
    .replace("ControlLeft", "Ctrl").replace("ControlRight", "Ctrl R").replace("ShiftLeft", "Shift").replace("ShiftRight", "Shift R").replace("Backquote", "`");
}

boot();
