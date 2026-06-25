/* render.js — the dot-rendering core + TRANSPARENT PNG/SVG export.
 *
 * The whole point of this tool is dots on real transparency. The canvas is
 * cleared to full alpha-0 and only the dots are painted, so toBlob('image/png')
 * carries a genuine alpha channel (no background baked behind the dots).
 *
 * VALUE-SOURCE SEAM: patterns hand us dots as {x, y, r} already in canvas pixels.
 * Today the radius comes from a math function (patterns.js). A future v2 could
 * size r by sampling a dropped image without touching this module. */

/** Paint dots onto a 2D context. Clears to transparent first. */
export function drawDots(ctx, dots, opts = {}) {
  const { color = "#000000", shape = "circle" } = opts;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = color;
  for (const d of dots) {
    if (!(d.r > 0)) continue;
    if (shape === "square") {
      ctx.fillRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
    } else if (shape === "diamond") {
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-d.r, -d.r, d.r * 2, d.r * 2); ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** Render dots to a fresh offscreen canvas at a scale factor (for crisp export). */
export function renderToCanvas(dots, w, h, opts = {}) {
  const scale = opts.scale || 1;
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext("2d");
  const scaled = scale === 1 ? dots : dots.map((d) => ({ x: d.x * scale, y: d.y * scale, r: d.r * scale }));
  drawDots(ctx, scaled, opts);
  return c;
}

/** Export a transparent PNG Blob via callback. */
export function exportPNG(dots, w, h, opts, cb) {
  renderToCanvas(dots, w, h, opts).toBlob((blob) => cb(blob), "image/png");
}

/** Build a transparent SVG string (vector dots, no background). */
export function buildSVG(dots, w, h, opts = {}) {
  const { color = "#000000", shape = "circle" } = opts;
  const f = (n) => (+n).toFixed(2);
  let body = "";
  for (const d of dots) {
    if (!(d.r > 0)) continue;
    if (shape === "square") {
      body += `<rect x="${f(d.x - d.r)}" y="${f(d.y - d.r)}" width="${f(d.r * 2)}" height="${f(d.r * 2)}"/>`;
    } else if (shape === "diamond") {
      const x = +d.x, y = +d.y, r = +d.r;
      body += `<polygon points="${f(x)},${f(y - r)} ${f(x + r)},${f(y)} ${f(x)},${f(y + r)} ${f(x - r)},${f(y)}"/>`;
    } else {
      body += `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(d.r)}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g fill="${color}">${body}</g></svg>`;
}

/** map an underlying value [0..1] to a dot radius, with a contrast/falloff curve. */
export function sizeFromValue(v, sizeMin, sizeMax, contrast) {
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  const shaped = Math.pow(v, contrast);
  return sizeMin + (sizeMax - sizeMin) * shaped;
}
