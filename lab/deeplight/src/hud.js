/* hud.js — DOM HUD overlay (crosshair, HP, score, multiplier, progress, toasts)
 * and the start/end screens. Kept as plain DOM so it never competes with WebGL. */

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById("hud"),
      hp: document.getElementById("hp"),
      score: document.getElementById("score"),
      mult: document.getElementById("mult"),
      depth: document.getElementById("depthval"),
      bar: document.querySelector("#progress-bar > i"),
      toast: document.getElementById("toast"),
      start: document.getElementById("start-screen"),
      end: document.getElementById("end-screen"),
      endTitle: document.getElementById("end-title"),
      endStats: document.getElementById("end-stats"),
      loading: document.getElementById("loading"),
    };
    this._toastUntil = 0;
  }

  showGame() { this.el.hud.hidden = false; this.el.start.hidden = true; this.el.end.hidden = true; }
  hideLoading() { this.el.loading.style.display = "none"; }

  update(s, t) {
    this.el.hp.textContent = "♥ ".repeat(s.hp).trim() || "—";
    this.el.score.textContent = s.score.toLocaleString();
    this.el.mult.textContent = "×" + s.mult;
    this.el.depth.textContent = Math.round(s.depth);
    this.el.bar.style.width = Math.round(s.progress * 100) + "%";
    if (t > this._toastUntil && this.el.toast.style.opacity !== "0") this.el.toast.style.opacity = "0";
  }

  toast(msg, t, color) {
    this.el.toast.textContent = msg;
    this.el.toast.style.color = color || "#f4f1ea";
    this.el.toast.style.opacity = "1";
    this._toastUntil = t + 1.4;
  }

  end(reachedExit, tally) {
    this.el.hud.hidden = true;
    this.el.endTitle.innerHTML = reachedExit ? "Surfaced" : "Lost to the <em>dark</em>";
    this.el.endStats.innerHTML =
      `final score <b>${tally.total.toLocaleString()}</b><br>` +
      `kills ${tally.kills} · stars ${tally.stars} · multiplier ×${tally.mult}<br>` +
      `dead ends ${tally.deadEnds} · clean-route bonus ${tally.cleanBonus}`;
    this.el.end.hidden = false;
  }
}
