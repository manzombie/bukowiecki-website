/* minimap.js — a small 2D overlay of the level graph showing where the sub is.
 * (Yes, it slightly undercuts the "you only see what the light hits" idea — it's
 * a readability aid while the 3D art is still rough; toggle with M.) */

const ICON_COL = {
  hostile: "#c0392b", debris: "#8a6a3a", star: "#ffc83a",
  mult2x: "#2bb7ff", mult3x: "#9a7bff", shipwreck: "#6b5640",
};

export class MiniMap {
  constructor(graph) {
    this.graph = graph;
    this.visible = true;
    const W = 150, H = Math.round(150 * 1672 / 941);   // match source aspect
    const c = document.createElement("canvas");
    c.width = W * 2; c.height = H * 2;                  // retina
    c.style.cssText =
      `position:absolute;top:64px;right:20px;width:${W}px;height:${H}px;` +
      `border:1px solid rgba(255,255,255,.12);background:rgba(4,12,18,.55);` +
      `border-radius:2px;pointer-events:none;`;
    document.getElementById("hud").appendChild(c);
    this.canvas = c; this.ctx = c.getContext("2d");
    this.ctx.scale(2, 2); this.W = W; this.H = H;
    this._drawStatic();
  }

  toggle() { this.visible = !this.visible; this.canvas.style.display = this.visible ? "block" : "none"; }

  _xy(nx, ny) { return [6 + nx * (this.W - 12), 6 + ny * (this.H - 12)]; }

  _drawStatic() {
    // cache the unchanging graph layer to an offscreen canvas
    const off = document.createElement("canvas");
    off.width = this.canvas.width; off.height = this.canvas.height;
    const x = off.getContext("2d"); x.scale(2, 2);
    x.lineWidth = 1.2; x.strokeStyle = "rgba(63,183,166,.55)";
    for (const e of this.graph.data.edges) {
      x.beginPath();
      e.polyline.forEach(([nx, ny], i) => {
        const [px, py] = this._xy(nx, ny);
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.stroke();
    }
    // payload dots
    for (const p of this.graph.data.payloads) {
      const ref = this.graph.edges.get(p.edgeOrNodeId);
      let nx, ny;
      if (ref) { const mid = ref.polyline[Math.floor(ref.polyline.length * (p.t ?? 0.5))]; [nx, ny] = mid; }
      else { const n = this.graph.nodes.get(p.edgeOrNodeId); if (!n) continue; nx = n.x; ny = n.y; }
      const [px, py] = this._xy(nx, ny);
      x.fillStyle = ICON_COL[p.type] || "#999";
      x.beginPath(); x.arc(px, py, p.type === "shipwreck" ? 3 : 1.8, 0, 7); x.fill();
    }
    // start / exit
    const s = this.graph.nodes.get(this.graph.startNodeId);
    const ex = this.graph.nodes.get(this.graph.exitNodeId);
    const mark = (n, col, label) => {
      const [px, py] = this._xy(n.x, n.y);
      x.fillStyle = col; x.beginPath(); x.arc(px, py, 3, 0, 7); x.fill();
      x.fillStyle = col; x.font = "7px monospace"; x.fillText(label, px + 5, py + 3);
    };
    mark(s, "#3ad16a", "START"); mark(ex, "#41d6ff", "EXIT");
    this._static = off;
  }

  /** playerN = {x,y} normalized 0..1 */
  update(playerN) {
    if (!this.visible) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.drawImage(this._static, 0, 0, this.W, this.H);
    const [px, py] = this._xy(playerN.x, playerN.y);
    ctx.fillStyle = "#f4f1ea";
    ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill(); ctx.stroke();
  }
}
