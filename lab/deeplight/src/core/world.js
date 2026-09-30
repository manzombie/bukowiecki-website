/* world.js — the ONE authoritative description of navigable space.
 *
 * A level is a set of water primitives (tubes between graph nodes, chambers)
 * and solid primitives (pillars, boulders, the wreck). Together they define a
 * signed distance field s(p):  s < 0 in water, s > 0 in rock.
 *
 *   - collision samples s(p) directly (available everywhere, no streaming);
 *   - the render mesh is extracted from the same s(p) (mesher.js);
 *   - shots, sonar and the camera boom sphere-trace the same s(p).
 *
 * Junctions are a smooth union of the tubes that meet there, so there is one
 * continuous surface — no overlapping shells or interior walls.
 *
 * Pure JS (no three.js) so it runs in Node tests and in a Web Worker. */

// ---------------------------------------------------------------- noise ----
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 0xffff;           // 0..1
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi);
  const c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1);
  const g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return (y1 + (y2 - y1) * w) * 2 - 1;   // -1..1
}
export function rockNoise(x, y, z) {
  // two octaves: broad lumps + finer knobs. Amplitude ≤ ~0.9 m.
  return vnoise(x * 0.11, y * 0.13, z * 0.11) * 0.62 + vnoise(x * 0.31 + 17, y * 0.33, z * 0.31) * 0.26;
}
export { vnoise };

// ------------------------------------------------------------ smoothing ----
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ----------------------------------------------------------- primitives ----
// Water: tube (round cone a->b, radii ra->rb), room (ellipsoid).
// Solid: capsule, sphere, box. Each prim has an AABB for the spatial hash.
function sdTube(p, x, y, z) {
  const bax = p.bx - p.ax, bay = p.by - p.ay, baz = p.bz - p.az;
  const pax = x - p.ax, pay = y - p.ay, paz = z - p.az;
  let t = (pax * bax + pay * bay + paz * baz) * p.invLen2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p.ra + (p.rb - p.ra) * t);
}
function sdEllipsoid(p, x, y, z) {
  const px = (x - p.cx), py = (y - p.cy), pz = (z - p.cz);
  const k0 = Math.sqrt((px / p.rx) ** 2 + (py / p.ry) ** 2 + (pz / p.rz) ** 2);
  const k1 = Math.sqrt((px / (p.rx * p.rx)) ** 2 + (py / (p.ry * p.ry)) ** 2 + (pz / (p.rz * p.rz)) ** 2);
  return k1 < 1e-9 ? -Math.min(p.rx, p.ry, p.rz) : k0 * (k0 - 1) / k1;
}
function sdSphere(p, x, y, z) {
  return Math.sqrt((x - p.cx) ** 2 + (y - p.cy) ** 2 + (z - p.cz) ** 2) - p.r;
}
function sdBox(p, x, y, z) {
  // oriented by yaw only (enough for wreck parts)
  let dx = x - p.cx, dy = y - p.cy, dz = z - p.cz;
  const lx = dx * p.cos + dz * p.sin, lz = -dx * p.sin + dz * p.cos;
  const qx = Math.abs(lx) - p.hx, qy = Math.abs(dy) - p.hy, qz = Math.abs(lz) - p.hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - p.round;
}

function makePrim(def) {
  const p = { ...def };
  if (def.type === "tube" || def.type === "capsule") {
    [p.ax, p.ay, p.az] = def.a; [p.bx, p.by, p.bz] = def.b;
    if (def.type === "capsule") { p.ra = p.rb = def.r; }
    const l2 = (p.bx - p.ax) ** 2 + (p.by - p.ay) ** 2 + (p.bz - p.az) ** 2;
    p.invLen2 = l2 > 1e-9 ? 1 / l2 : 0;
    const r = Math.max(p.ra, p.rb);
    p.min = [Math.min(p.ax, p.bx) - r, Math.min(p.ay, p.by) - r, Math.min(p.az, p.bz) - r];
    p.max = [Math.max(p.ax, p.bx) + r, Math.max(p.ay, p.by) + r, Math.max(p.az, p.bz) + r];
    p.sd = sdTube;
  } else if (def.type === "room") {
    [p.cx, p.cy, p.cz] = def.c; [p.rx, p.ry, p.rz] = def.r;
    p.min = [p.cx - p.rx, p.cy - p.ry, p.cz - p.rz];
    p.max = [p.cx + p.rx, p.cy + p.ry, p.cz + p.rz];
    p.sd = sdEllipsoid;
  } else if (def.type === "sphere") {
    [p.cx, p.cy, p.cz] = def.c;
    p.min = [p.cx - p.r, p.cy - p.r, p.cz - p.r];
    p.max = [p.cx + p.r, p.cy + p.r, p.cz + p.r];
    p.sd = sdSphere;
  } else if (def.type === "box") {
    [p.cx, p.cy, p.cz] = def.c; [p.hx, p.hy, p.hz] = def.h;
    p.round = def.round || 0;
    const yaw = def.yaw || 0; p.cos = Math.cos(yaw); p.sin = Math.sin(yaw);
    const e = Math.hypot(p.hx, p.hz) + p.round;
    p.min = [p.cx - e, p.cy - p.hy - p.round, p.cz - e];
    p.max = [p.cx + e, p.cy + p.hy + p.round, p.cz + e];
    p.sd = sdBox;
  } else throw new Error("unknown primitive " + def.type);
  p.solid = def.type === "capsule" || def.type === "sphere" || def.type === "box";
  return p;
}

// ----------------------------------------------------------------- world ----
export const WORLD_CONST = {
  blend: 4.5,        // smooth-union radius where tubes and chambers meet
  solidBlend: 1.2,   // smooth-subtract radius for solids
  noiseAmp: 1.0,     // rock displacement is baked into s(p) — mesh and collision agree
  cell: 20,          // spatial hash cell size
  far: 6,            // value returned where no primitive is near (solid)
};

export class World {
  /** @param {{water: object[], solids: object[], currents?: object[]}} def */
  constructor(def) {
    this.prims = [...def.water, ...def.solids].map(makePrim);
    this.currents = (def.currents || []).map((c) => {
      const d = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]];
      const l = Math.hypot(...d) || 1;
      return { ...c, dir: d.map((v) => v / l), len: l };
    });
    this.dynamic = [];                 // runtime solids: {kind:'sphere'|'disc', ...}
    this.bmin = [Infinity, Infinity, Infinity]; this.bmax = [-Infinity, -Infinity, -Infinity];
    for (const p of this.prims) for (let i = 0; i < 3; i++) {
      this.bmin[i] = Math.min(this.bmin[i], p.min[i]); this.bmax[i] = Math.max(this.bmax[i], p.max[i]);
    }
    // spatial hash
    const C = WORLD_CONST.cell, pad = WORLD_CONST.blend + WORLD_CONST.noiseAmp + 2;
    this.cells = new Map();
    this.prims.forEach((p, idx) => {
      const lo = p.min.map((v) => Math.floor((v - pad) / C)), hi = p.max.map((v) => Math.floor((v + pad) / C));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
        const key = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
        let arr = this.cells.get(key);
        if (!arr) { arr = []; this.cells.set(key, arr); }
        arr.push(idx);
      }
    });
    this._lastSolid = -1; this._lastWater = -1;
  }

  _cellList(x, y, z) {
    const C = WORLD_CONST.cell;
    const key = (Math.floor(x / C) * 73856093) ^ (Math.floor(y / C) * 19349663) ^ (Math.floor(z / C) * 83492791);
    return this.cells.get(key);
  }

  /** static signed distance (water < 0). Also records the dominant prims. */
  sdStatic(x, y, z) {
    const list = this._cellList(x, y, z);
    if (!list) { this._lastWater = this._lastSolid = -1; return WORLD_CONST.far; }
    let w = WORLD_CONST.far, s = Infinity, bw = Infinity;
    this._lastWater = -1; this._lastSolid = -1;
    for (let i = 0; i < list.length; i++) {
      const p = this.prims[list[i]];
      const d = p.sd(p, x, y, z);
      if (p.solid) { if (d < s) { s = d; this._lastSolid = list[i]; } }
      else {
        if (d < bw) { bw = d; this._lastWater = list[i]; }
        w = w === WORLD_CONST.far ? d : smin(w, d, WORLD_CONST.blend);
      }
    }
    if (w === WORLD_CONST.far) return w;
    // rock surface displacement (not applied to man-made solids)
    w += rockNoise(x, y, z) * WORLD_CONST.noiseAmp * this._noiseScale(this._lastWater);
    if (s !== Infinity) {
      // smooth subtraction: water minus solid
      const k = WORLD_CONST.solidBlend, a = w, b = -s;
      const h = Math.max(k - Math.abs(a - b), 0) / k;
      return Math.max(a, b) + h * h * k * 0.25;
    }
    return w;
  }
  _noiseScale(i) { return i >= 0 && this.prims[i].smooth ? 0.35 : 1; }

  /** full distance: static rock + runtime dynamic solids */
  sd(x, y, z) {
    let d = this.sdStatic(x, y, z);
    for (let i = 0; i < this.dynamic.length; i++) {
      const o = this.dynamic[i];
      if (!o.active) continue;
      let od;
      if (o.kind === "sphere") od = Math.sqrt((x - o.x) ** 2 + (y - o.y) ** 2 + (z - o.z) ** 2) - o.r;
      else { // horizontal disc (membrane): radius r, half-thickness h
        const rr = Math.hypot(x - o.x, z - o.z) - o.r, yy = Math.abs(y - o.y) - o.h;
        od = Math.min(Math.max(rr, yy), 0) + Math.hypot(Math.max(rr, 0), Math.max(yy, 0));
      }
      if (-od > d) d = -od;   // solid wins
    }
    return d;
  }

  /** clearance = distance from p to the nearest rock (positive in open water) */
  clearance(x, y, z) { return -this.sd(x, y, z); }

  /** outward normal of the water region (points from water into rock) */
  gradient(x, y, z, out = [0, 0, 0], h = 0.08) {
    const gx = this.sd(x + h, y, z) - this.sd(x - h, y, z);
    const gy = this.sd(x, y + h, z) - this.sd(x, y - h, z);
    const gz = this.sd(x, y, z + h) - this.sd(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
    return out;
  }

  /** material/palette under a point (for vertex colours) */
  materialAt(x, y, z) {
    this.sdStatic(x, y, z);
    const water = this._lastWater >= 0 ? this.prims[this._lastWater] : null;
    const solid = this._lastSolid >= 0 ? this.prims[this._lastSolid] : null;
    if (solid) {
      const ds = solid.sd(solid, x, y, z);
      if (ds < 0.6) return { mat: solid.mat || "rock", palette: water?.palette || "base" };
    }
    return { mat: "rock", palette: water?.palette || "base" };
  }

  /**
   * sphere-trace from o along unit dir d. Returns distance to the first point
   * whose clearance < radius (i.e. a sphere of that radius would touch rock),
   * or maxDist if clear.
   */
  march(ox, oy, oz, dx, dy, dz, maxDist, radius = 0) {
    let t = 0;
    const c0 = this.clearance(ox, oy, oz) - radius;
    if (c0 <= 0) return 0;
    for (let i = 0; i < 160 && t < maxDist; i++) {
      const c = this.clearance(ox + dx * t, oy + dy * t, oz + dz * t) - radius;
      if (c < 0.02) return Math.max(0, t);
      t += Math.max(c * 0.7, 0.04);   // 0.7: s(p) is a bound, not exact (noise, blends)
    }
    return Math.min(t, maxDist);
  }

  /** water current velocity at p (m/s) */
  current(x, y, z, out = [0, 0, 0]) {
    out[0] = out[1] = out[2] = 0;
    for (const c of this.currents) {
      const px = x - c.a[0], py = y - c.a[1], pz = z - c.a[2];
      let t = (px * c.dir[0] + py * c.dir[1] + pz * c.dir[2]) / c.len;
      if (t < -0.05 || t > 1.05) continue;
      t = Math.max(0, Math.min(1, t));
      const qx = px - c.dir[0] * t * c.len, qy = py - c.dir[1] * t * c.len, qz = pz - c.dir[2] * t * c.len;
      const d = Math.hypot(qx, qy, qz);
      if (d > c.radius) continue;
      // soft falloff at the edge of the stream and at its ends
      const f = (1 - (d / c.radius) ** 2) * Math.min(1, t * 6, (1 - t) * 6 + 0.2);
      out[0] += c.dir[0] * c.speed * f; out[1] += c.dir[1] * c.speed * f; out[2] += c.dir[2] * c.speed * f;
    }
    return out;
  }
}
