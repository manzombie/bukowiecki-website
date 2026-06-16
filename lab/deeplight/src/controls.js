/* controls.js — desktop input (v1). Steering (A/D or arrows), aim (mouse),
 * fire (click). Touch is a deliberate later seam: the engine reads the same
 * `steer`, `aim`, `fired` fields, so a touch source can populate them later. */

export class Controls {
  constructor(dom) {
    this.steer = 0;             // -1 (left) .. +1 (right) — also chooses branches
    this.lift = 0;             // -1 (down) .. +1 (up) — vertical dodge
    this.aim = { x: 0, y: 0 };  // normalized device coords -1..1
    this.fired = false;         // consumed by engine each frame
    this.restart = false;
    this.toggleMap = false;
    this._keys = new Set();

    addEventListener("keydown", (e) => {
      this._keys.add(e.code);
      if (e.code === "KeyR") this.restart = true;
      if (e.code === "KeyM") this.toggleMap = true;
      if (e.code === "KeyC") this.toggleCam = true;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this._keys.delete(e.code));

    dom.addEventListener("mousemove", (e) => {
      const r = dom.getBoundingClientRect();
      this.aim.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.aim.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    });
    dom.addEventListener("mousedown", (e) => { if (e.button === 0) this.fired = true; });
  }

  update() {
    const k = this._keys;
    let s = 0, l = 0;
    if (k.has("KeyA") || k.has("ArrowLeft")) s -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) s += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) l += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) l -= 1;
    this.steer = s; this.lift = l;
  }

  consumeFire() { const f = this.fired; this.fired = false; return f; }
  consumeRestart() { const r = this.restart; this.restart = false; return r; }
  consumeToggleMap() { const m = this.toggleMap; this.toggleMap = false; return m; }
  consumeToggleCam() { const c = this.toggleCam; this.toggleCam = false; return c; }
}
