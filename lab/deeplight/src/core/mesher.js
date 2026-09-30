/* mesher.js — extract the cave surface from the world SDF (surface nets).
 *
 * The world is split into cubic chunks. Each chunk samples s(p) on a grid
 * with a one-sample apron, places one vertex per sign-changing cell and emits
 * a quad per sign-changing edge it OWNS. Ownership is exclusive and vertex
 * positions depend only on the global field, so neighbouring chunks meet
 * exactly: no cracks, no overlaps, one continuous surface through junctions.
 *
 * Pure JS: runs in a Web Worker in the browser and in Node tests. */

import { vnoise } from "./world.js";

export const MESH = { chunk: 16, voxel: 1.0 };

// palette: base colour, alt colour (strata), cavity colour, glow amount
export const PALETTES = {
  base:    { a: [0.36, 0.40, 0.42], b: [0.25, 0.30, 0.34], glow: 0.0 },
  bay:     { a: [0.46, 0.44, 0.40], b: [0.30, 0.31, 0.33], glow: 0.0 },
  kelp:    { a: [0.30, 0.40, 0.36], b: [0.20, 0.30, 0.28], glow: 0.22 },
  echo:    { a: [0.34, 0.38, 0.48], b: [0.22, 0.25, 0.34], glow: 0.15 },
  rust:    { a: [0.50, 0.33, 0.24], b: [0.32, 0.20, 0.16], glow: 0.05 },
  safe:    { a: [0.34, 0.42, 0.46], b: [0.24, 0.31, 0.36], glow: 0.4 },
  crystal: { a: [0.36, 0.34, 0.48], b: [0.22, 0.22, 0.32], glow: 0.45 },
  basalt:  { a: [0.24, 0.25, 0.28], b: [0.15, 0.15, 0.18], glow: 0.12 },
  warden:  { a: [0.42, 0.26, 0.24], b: [0.24, 0.14, 0.14], glow: 0.08 },
  shaft:   { a: [0.34, 0.38, 0.39], b: [0.24, 0.27, 0.28], glow: 0.1 },
};
const METAL = { a: [0.36, 0.30, 0.24], b: [0.20, 0.17, 0.14] };

/** list chunk origins that can contain surface */
export function chunkOrigins(world) {
  const C = MESH.chunk * MESH.voxel;
  const lo = world.bmin.map((v) => Math.floor((v - 3) / C)), hi = world.bmax.map((v) => Math.floor((v + 3) / C));
  const half = C * 0.866 + 1.5;          // half diagonal + noise/bound slack
  const out = [];
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
    const cx = (i + 0.5) * C, cy = (j + 0.5) * C, cz = (k + 0.5) * C;
    const s = world.sdStatic(cx, cy, cz);
    // s is a conservative-ish bound (blends/noise stretch it by < ~1.4x)
    if (Math.abs(s) > half * 1.4 + 2) continue;
    out.push([i * C, j * C, k * C]);
  }
  return out;
}

export function meshChunk(world, ox, oy, oz) {
  const N = MESH.chunk, v = MESH.voxel, S = N + 2;          // samples -1..N
  const val = new Float32Array(S * S * S);
  let neg = false, pos = false;
  for (let k = 0; k < S; k++) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const d = world.sdStatic(ox + (i - 1) * v, oy + (j - 1) * v, oz + (k - 1) * v);
    val[i + S * (j + S * k)] = d;
    if (d < 0) neg = true; else pos = true;
  }
  if (!neg || !pos) return null;

  const Cn = N + 1;                                          // cells -1..N-1
  const cellV = new Int32Array(Cn * Cn * Cn).fill(-1);
  const P = [], Nn = [], Col = [], Glow = [], Idx = [];
  const g = [0, 0, 0];
  const corner = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const cv = new Float32Array(8);
  const sample = (i, j, k) => val[(i + 1) + S * ((j + 1) + S * (k + 1))];

  for (let k = -1; k < N; k++) for (let j = -1; j < N; j++) for (let i = -1; i < N; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      cv[c] = sample(i + corner[c][0], j + corner[c][1], k + corner[c][2]);
      if (cv[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of edges) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
      sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
      sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
      cnt++;
    }
    const x = ox + (i + sx / cnt) * v, y = oy + (j + sy / cnt) * v, z = oz + (k + sz / cnt) * v;
    world.gradient(x, y, z, g, 0.25);
    const nx = -g[0], ny = -g[1], nz = -g[2];                // normal faces the water
    cellV[(i + 1) + Cn * ((j + 1) + Cn * (k + 1))] = P.length / 3;
    P.push(x, y, z); Nn.push(nx, ny, nz);
    shade(world, x, y, z, nx, ny, nz, Col, Glow);
  }

  const cell = (i, j, k) => cellV[(i + 1) + Cn * ((j + 1) + Cn * (k + 1))];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) Idx.push(a, c, b, a, d, c); else Idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s0 = sample(i, j, k) < 0;
    // x edge: u=y, v=z
    if (s0 !== (sample(i + 1, j, k) < 0)) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), s0);
    // y edge: u=z, v=x
    if (s0 !== (sample(i, j + 1, k) < 0)) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), s0);
    // z edge: u=x, v=y
    if (s0 !== (sample(i, j, k + 1) < 0)) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), s0);
  }
  if (!Idx.length) return null;
  return {
    origin: [ox, oy, oz],
    positions: new Float32Array(P), normals: new Float32Array(Nn),
    colors: new Float32Array(Col), glow: new Float32Array(Glow),
    indices: P.length / 3 > 65535 ? new Uint32Array(Idx) : new Uint16Array(Idx),
  };
}

function shade(world, x, y, z, nx, ny, nz, Col, Glow) {
  const { mat, palette } = world.materialAt(x, y, z);
  const pal = mat === "metal" ? METAL : (PALETTES[palette] || PALETTES.base);
  // strata bands + mottling
  const band = 0.5 + 0.5 * Math.sin(y * 0.55 + vnoise(x * 0.05, y * 0.05, z * 0.05) * 4);
  const mott = 0.5 + 0.5 * vnoise(x * 0.35, y * 0.35, z * 0.35);
  const m = Math.min(1, Math.max(0, band * 0.6 + mott * 0.5 - 0.1));
  let r = pal.a[0] + (pal.b[0] - pal.a[0]) * m, gg = pal.a[1] + (pal.b[1] - pal.a[1]) * m, b = pal.a[2] + (pal.b[2] - pal.a[2]) * m;
  // cavities read darker, exposed ridges lighter (cheap AO from the SDF)
  const open = world.clearance(x + nx * 2.2, y + ny * 2.2, z + nz * 2.2);
  const ao = Math.min(1, Math.max(0.35, open / 2.2));
  // floors catch sediment: slightly warmer and lighter
  const floor = Math.max(0, ny) * 0.12;
  r = (r + floor) * ao; gg = (gg + floor * 0.9) * ao; b = (b + floor * 0.7) * ao;
  if (mat === "metal") {
    const rust = Math.max(0, vnoise(x * 0.6, y * 0.6, z * 0.6));
    r += rust * 0.18; gg += rust * 0.06;
  }
  Col.push(r, gg, b);
  // bioluminescent colonies: a SMOOTH per-vertex mask (where colonies grow);
  // the individual glowing spots are generated per pixel in the rock shader
  let glow = 0;
  if (pal.glow && mat !== "metal") {
    const cl = vnoise(x * 0.07 + 40, y * 0.07, z * 0.07);
    const t = Math.min(1, Math.max(0, (cl - 0.1) / 0.5));
    glow = pal.glow * t * t * (3 - 2 * t) * (0.55 + 0.45 * Math.max(0, -ny + 0.4));
  }
  Glow.push(glow);
}
