/* input.js — keyboard / mouse / touch -> one input state.
 *
 * - Rebindable keys (saved with settings).
 * - Held inputs are cleared on blur, visibility change, pause and pointer-lock
 *   loss, so nothing stays stuck.
 * - Default browser behaviour (scrolling, space-to-scroll) is prevented only
 *   while the game has control.
 * - Firing is suppressed after menus/resume until the button is released, so
 *   the click that resumes the game never fires a shot.
 * - Aim: with pointer lock, mouse movement moves the reticle; without it, the
 *   reticle follows the cursor. The reticle lives in normalised screen space. */

export const DEFAULT_BINDINGS = {
  thrust: ["KeyW", "ArrowUp"],
  reverse: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  rise: ["Space"],
  dive: ["ControlLeft", "ControlRight", "KeyZ"],
  boost: ["ShiftLeft", "ShiftRight"],
  fire: ["KeyF"],
  sonar: ["KeyQ"],
  camera: ["KeyC"],
  pause: ["Escape", "KeyP"],
  restart: ["KeyR"],
  debug: ["Backquote"],
};
export const ACTION_LABELS = {
  thrust: "Forward thrust", reverse: "Brake / reverse", left: "Turn left", right: "Turn right",
  rise: "Rise", dive: "Descend", boost: "Boost", fire: "Fire (alt)", sonar: "Sonar",
  camera: "Camera view", pause: "Pause", restart: "Restart (failure screen)",
};

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas; this.settings = settings;
    this.bindings = structuredClone(settings.get("bindings") || DEFAULT_BINDINGS);
    for (const k of Object.keys(DEFAULT_BINDINGS)) if (!this.bindings[k]) this.bindings[k] = [...DEFAULT_BINDINGS[k]];
    this.keys = new Set();
    this.mouseFire = false;
    this.fireArmed = false;               // must see a release before firing
    this.fireArmTime = 0;
    this.pressed = new Set();             // edge-triggered actions, consumed per frame
    this.reticle = { x: 0, y: 0 };        // NDC -1..1
    this.active = false;                  // game has control
    this.locked = false;
    this.touch = null;                    // TouchControls instance, when used
    this.lastDevice = "keyboard";
    this.onLockLost = null;
    this.rebinding = null;

    addEventListener("keydown", (e) => this._key(e, true));
    addEventListener("keyup", (e) => this._key(e, false));
    addEventListener("blur", () => this.clear());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.clear(); });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    addEventListener("mousedown", (e) => {
      if (!this.active || e.target !== canvas) return;
      this.lastDevice = "keyboard";
      if (e.button === 0) { this.mouseFire = true; }
      if (e.button === 2) this.pressed.add("sonar");
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) { this.mouseFire = false; if (performance.now() >= this.fireArmTime) this.fireArmed = true; }
    });
    addEventListener("mousemove", (e) => {
      if (!this.active) return;
      const inv = this.settings.get("invertY") ? -1 : 1;
      const sens = this.settings.get("sensitivity") ?? 1;
      if (this.locked) {
        this.reticle.x += (e.movementX / innerWidth) * 2.2 * sens;
        this.reticle.y -= (e.movementY / innerHeight) * 2.2 * sens * inv;
      } else if (e.target === canvas) {
        this.reticle.x = (e.clientX / innerWidth) * 2 - 1;
        const y = -((e.clientY / innerHeight) * 2 - 1);
        this.reticle.y = inv > 0 ? y : -y;
      }
      this.clampReticle();
    });
    document.addEventListener("pointerlockchange", () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) { this.clear(); this.onLockLost?.(); }
    });
    addEventListener("wheel", (e) => { if (this.active) e.preventDefault(); }, { passive: false });
    addEventListener("touchmove", (e) => { if (this.active) e.preventDefault(); }, { passive: false });
  }

  clampReticle() {
    this.reticle.x = Math.max(-0.92, Math.min(0.92, this.reticle.x));
    this.reticle.y = Math.max(-0.85, Math.min(0.85, this.reticle.y));
  }

  _key(e, down) {
    if (this.rebinding && down) { e.preventDefault(); this.rebinding(e.code); this.rebinding = null; return; }
    const act = this.actionFor(e.code);
    if (this.active && act && act !== "debug") e.preventDefault();
    else if (this.active && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.lastDevice = "keyboard";
      if (act && ["sonar", "camera", "pause", "restart", "debug"].includes(act)) this.pressed.add(act);
    } else this.keys.delete(e.code);
  }

  actionFor(code) {
    for (const [a, codes] of Object.entries(this.bindings)) if (codes.includes(code)) return a;
    return null;
  }
  held(action) { return this.bindings[action].some((c) => this.keys.has(c)); }
  consume(action) { const had = this.pressed.has(action); this.pressed.delete(action); return had; }

  /** release everything (blur, pause, lock loss) and require a fresh press to fire */
  clear() {
    this.keys.clear(); this.mouseFire = false; this.pressed.clear();
    this.disarmFire();
    this.touch?.clear();
  }
  disarmFire(ms = 180) { this.fireArmed = false; this.fireArmTime = performance.now() + ms; setTimeout(() => { if (!this.mouseFire) this.fireArmed = true; }, ms); }

  setActive(on) {
    this.active = on;
    if (!on) this.clear();
  }
  requestLock() {
    if (matchMedia("(pointer: coarse)").matches) return;
    try { const p = this.canvas.requestPointerLock?.(); if (p?.catch) p.catch(() => {}); } catch (_) { /* fallback: absolute aim */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** sample the continuous inputs for this frame */
  state() {
    const t = this.touch?.state();
    const ax = (neg, pos) => (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
    let thrust = ax("reverse", "thrust"), yaw = ax("left", "right"), vert = ax("dive", "rise");
    let boost = this.held("boost");
    let fire = (this.mouseFire || this.held("fire")) && this.fireArmed;
    if (t && t.active) {
      if (Math.abs(t.thrust) > Math.abs(thrust)) thrust = t.thrust;
      if (Math.abs(t.yaw) > Math.abs(yaw)) yaw = t.yaw;
      if (Math.abs(t.vert) > Math.abs(vert)) vert = t.vert;
      boost = boost || t.boost;
      fire = fire || t.fire;
      this.lastDevice = "touch";
    }
    return { thrust, yaw, vert, boost, fire };
  }

  saveBindings() { this.settings.set("bindings", this.bindings); }
  resetBindings() { this.bindings = structuredClone(DEFAULT_BINDINGS); this.saveBindings(); }
}

/* ---------------------------------------------------------------- touch ---
 * Left thumb: virtual stick (up/down = thrust/brake, left/right = turn).
 * Right side: drag anywhere free to aim; buttons for fire (hold), boost (hold),
 * rise / descend (hold), sonar, camera. Each finger is tracked by pointerId,
 * so steering, aiming and firing work at the same time. */
export class TouchControls {
  constructor(root, input) {
    this.root = root; this.input = input;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.aim = { id: null, lx: 0, ly: 0 };
    this.btn = new Map();       // name -> pointerId set
    this.active = false;
    const knob = root.querySelector(".t-knob"), base = root.querySelector(".t-stick");
    this.knob = knob; this.base = base;
    const zone = root.querySelector(".t-left");
    zone.addEventListener("pointerdown", (e) => {
      if (this.stick.id !== null) return;
      e.preventDefault(); zone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      base.style.left = e.clientX + "px"; base.style.top = e.clientY + "px"; base.classList.add("on");
      this.active = true;
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.stick.id) return;
      const R = 56;
      let dx = (e.clientX - this.stick.ox) / R, dy = (e.clientY - this.stick.oy) / R;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      this.stick.x = dx; this.stick.y = dy;
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    });
    const endStick = (e) => { if (e.pointerId !== this.stick.id) return; this.stick = { id: null, x: 0, y: 0 }; knob.style.transform = ""; base.classList.remove("on"); };
    zone.addEventListener("pointerup", endStick); zone.addEventListener("pointercancel", endStick);

    const aimZone = root.querySelector(".t-right");
    aimZone.addEventListener("pointerdown", (e) => {
      if (this.aim.id !== null || e.target !== aimZone) return;
      e.preventDefault(); aimZone.setPointerCapture(e.pointerId);
      this.aim = { id: e.pointerId, lx: e.clientX, ly: e.clientY }; this.active = true;
    });
    aimZone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.aim.id) return;
      const s = (input.settings.get("sensitivity") ?? 1) * 2.4;
      const inv = input.settings.get("invertY") ? -1 : 1;
      input.reticle.x += ((e.clientX - this.aim.lx) / innerWidth) * s;
      input.reticle.y -= ((e.clientY - this.aim.ly) / innerHeight) * s * inv;
      input.clampReticle();
      this.aim.lx = e.clientX; this.aim.ly = e.clientY;
    });
    const endAim = (e) => { if (e.pointerId === this.aim.id) this.aim = { id: null }; };
    aimZone.addEventListener("pointerup", endAim); aimZone.addEventListener("pointercancel", endAim);

    for (const b of root.querySelectorAll("[data-t]")) {
      const name = b.dataset.t;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId);
        this.active = true; b.classList.add("down");
        if (!this.btn.has(name)) this.btn.set(name, new Set());
        this.btn.get(name).add(e.pointerId);
        if (["sonar", "camera", "pause"].includes(name)) input.pressed.add(name);
      });
      const release = (n, id) => { this.btn.get(n)?.delete(id); if (!this.btn.get(n)?.size) root.querySelector(`[data-t=${n}]`)?.classList.remove("down"); };
      const up = (e) => { release(name, e.pointerId); if (name === "rise" || name === "dive") release(name === "rise" ? "dive" : "rise", e.pointerId); };
      // rise/descend act as a rocker: sliding the thumb from one to the other switches direction
      if (name === "rise" || name === "dive") b.addEventListener("pointermove", (e) => {
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-t]");
        const other = over && over !== b && (over.dataset.t === "rise" || over.dataset.t === "dive") ? over.dataset.t : null;
        const mine = this.btn.get(name)?.has(e.pointerId);
        if (other && mine) {
          release(name, e.pointerId);
          if (!this.btn.has(other)) this.btn.set(other, new Set());
          this.btn.get(other).add(e.pointerId); over.classList.add("down");
        } else if (!other && over === b && !mine) {
          const o = name === "rise" ? "dive" : "rise";
          if (this.btn.get(o)?.delete(e.pointerId) && !this.btn.get(o).size) root.querySelector(`[data-t=${o}]`).classList.remove("down");
          this.btn.get(name)?.add(e.pointerId) ?? this.btn.set(name, new Set([e.pointerId])); b.classList.add("down");
        }
      });
      b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
    }
  }
  holding(name) { return (this.btn.get(name)?.size || 0) > 0; }
  clear() {
    this.stick = { id: null, x: 0, y: 0 }; this.aim = { id: null };
    this.btn.clear();
    this.knob.style.transform = ""; this.base.classList.remove("on");
    this.root.querySelectorAll(".down").forEach((b) => b.classList.remove("down"));
  }
  state() {
    // dead zone + response curve for fine control near the centre
    const dz = (v) => { const a = Math.abs(v); return a < 0.12 ? 0 : Math.sign(v) * ((a - 0.12) / 0.88) ** 1.4; };
    return {
      active: this.active,
      thrust: -dz(this.stick.y), yaw: dz(this.stick.x),
      vert: (this.holding("rise") ? 1 : 0) - (this.holding("dive") ? 1 : 0),
      boost: this.holding("boost"), fire: this.holding("fire"),
    };
  }
}
