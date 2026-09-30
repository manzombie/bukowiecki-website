/* levelgraph.js — level graph -> world primitives, plus validation.
 *
 * A level is a graph of nodes (points with a bore radius, optionally a chamber)
 * joined by edges (polylines of [x,y,z,r] control points). Every consecutive
 * pair of points becomes a water tube; chambers become ellipsoids. Because the
 * world is a smooth union of these, a junction is ONE open space.
 *
 * validateLevel() checks the graph before geometry is built: duplicate edges,
 * connectivity, turn sharpness vs. bore radius, unintended overlaps between
 * unrelated tunnels, hull clearance along every route and at every pose. */

import { World } from "./world.js";
import { Sub } from "./sub.js";
import { SUB } from "./tuning.js";

export function edgePoints(level, e) {
  const A = level.nodeMap.get(e.a), B = level.nodeMap.get(e.b);
  return [[...A.p, A.r], ...(e.via || []), [...B.p, B.r]];
}

export function prepareLevel(def) {
  const level = { ...def, nodeMap: new Map(def.nodes.map((n) => [n.id, n])) };
  level.adj = new Map(def.nodes.map((n) => [n.id, []]));
  for (const e of def.edges) {
    level.adj.get(e.a)?.push({ edge: e, other: e.b });
    level.adj.get(e.b)?.push({ edge: e, other: e.a });
  }
  return level;
}

export function buildWorld(level) {
  const water = [];
  for (const e of level.edges) {
    const pts = edgePoints(level, e);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      water.push({ type: "tube", a: a.slice(0, 3), b: b.slice(0, 3), ra: a[3], rb: b[3], palette: e.palette, smooth: e.smooth, edge: e.id });
    }
  }
  for (const n of level.nodes) {
    if (n.room) water.push({ type: "room", c: n.roomC || n.p, r: n.room, palette: n.palette, node: n.id });
  }
  for (const r of level.rooms || []) water.push({ type: "room", ...r });
  return new World({ water, solids: level.solids || [], currents: level.currents || [] });
}

// ------------------------------------------------------------ validation ----
function segDist(p1, q1, p2, q2) {
  // closest distance between segments p1q1 and p2q2 (3D)
  const d1 = q1.map((v, i) => v - p1[i]), d2 = q2.map((v, i) => v - p2[i]), r = p1.map((v, i) => v - p2[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
  else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
  const c1 = p1.map((v, i) => v + d1[i] * s), c2 = p2.map((v, i) => v + d2[i] * t);
  return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
}

export function validateLevel(level, world = buildWorld(level), opts = {}) {
  const errors = [], warnings = [];
  const hullR = SUB.radius, hullHalf = SUB.halfLen + SUB.radius;
  // duplicate / self edges
  const seen = new Set();
  for (const e of level.edges) {
    if (e.a === e.b) errors.push(`edge ${e.id}: self loop`);
    const k = [e.a, e.b].sort().join("|") + "|" + (e.via ? JSON.stringify(e.via) : "");
    if (seen.has(k)) errors.push(`edge ${e.id}: duplicate of another edge`);
    seen.add(k);
    for (const id of [e.a, e.b]) if (!level.nodeMap.has(id)) errors.push(`edge ${e.id}: missing node ${id}`);
  }
  // connectivity from start
  const reach = new Set([level.start.node]); const q = [level.start.node];
  while (q.length) for (const a of level.adj.get(q.pop()) || []) if (!reach.has(a.other)) { reach.add(a.other); q.push(a.other); }
  for (const n of level.nodes) if (!reach.has(n.id)) errors.push(`node ${n.id}: unreachable from start`);
  if (level.exit && !reach.has(level.exit.node)) errors.push("exit unreachable");

  // turn sharpness: a bend tighter than the bore allows for a 7 m hull
  for (const e of level.edges) {
    const pts = edgePoints(level, e);
    for (let i = 1; i < pts.length - 1; i++) {
      const u = pts[i].slice(0, 3).map((v, k) => v - pts[i - 1][k]), w = pts[i + 1].slice(0, 3).map((v, k) => v - pts[i][k]);
      const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w));
      const turn = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (turn > 1.75) errors.push(`edge ${e.id} point ${i}: impossible turn ${(turn * 57.3).toFixed(0)}°`);
      else if (turn > 1.2 && pts[i][3] < hullHalf + 1.5) warnings.push(`edge ${e.id} point ${i}: sharp ${(turn * 57.3).toFixed(0)}° turn in a narrow bore`);
    }
    for (const p of pts) if (p[3] < hullHalf + 0.8) errors.push(`edge ${e.id}: bore radius ${p[3]} too small for the hull to turn around`);
  }

  // unintended overlaps: segments of non-adjacent edges that come too close
  const segs = [];
  for (const e of level.edges) {
    const pts = edgePoints(level, e);
    for (let i = 0; i < pts.length - 1; i++) segs.push({ e, a: pts[i], b: pts[i + 1] });
  }
  const touching = (e1, e2) => e1 === e2 || [e1.a, e1.b].some((x) => x === e2.a || x === e2.b);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s1 = segs[i], s2 = segs[j];
    if (touching(s1.e, s2.e)) continue;
    const d = segDist(s1.a.slice(0, 3), s1.b.slice(0, 3), s2.a.slice(0, 3), s2.b.slice(0, 3));
    const need = Math.max(s1.a[3], s1.b[3]) + Math.max(s2.a[3], s2.b[3]) + 3;
    if (d < need) errors.push(`edges ${s1.e.id} & ${s2.e.id}: unrelated tunnels overlap (gap ${d.toFixed(1)} m, need ${need.toFixed(1)} m)`);
  }

  // clearance along every edge centreline: the hull must fit in every heading
  const probe = new Sub({ pos: [0, 0, 0] });
  const step = opts.step || 1.5;
  // inside a chamber the centreline is not a corridor (spires, wrecks stand there);
  // chambers are checked by the traversal tests instead
  const rooms = [...level.nodes.filter((n) => n.room).map((n) => ({ c: n.roomC || n.p, r: n.room })), ...(level.rooms || [])];
  const inRoom = (p) => rooms.some((r) => ((p[0] - r.c[0]) / r.r[0]) ** 2 + ((p[1] - r.c[1]) / r.r[1]) ** 2 + ((p[2] - r.c[2]) / r.r[2]) ** 2 < 0.8 ** 2);
  let minClear = Infinity, where = "";
  for (const e of level.edges) {
    const pts = edgePoints(level, e);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const yaw = Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));
      for (let s = 0; s <= L; s += step) {
        const t = s / L, p = [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
        if (inRoom(p)) continue;
        const c = probe.hullClearance(world, p, yaw, 0);
        if (c < minClear) { minClear = c; where = `${e.id}@${p.map((v) => v.toFixed(0)).join(",")}`; }
        if (c < 0.6) errors.push(`edge ${e.id}: hull clearance ${c.toFixed(2)} m at ${p.map((v) => v.toFixed(1)).join(",")}`);
      }
    }
  }

  // poses: spawn, checkpoints, exit
  const poses = [["start", level.start], ...(level.checkpoints || []).map((c) => ["checkpoint " + c.id, c])];
  if (level.exit) poses.push(["exit", level.exit]);
  for (const [name, pose] of poses) {
    const c = probe.hullClearance(world, pose.pos, pose.yaw || 0, 0);
    if (c < 1.0) errors.push(`${name}: hull clearance ${c.toFixed(2)} m (< 1.0)`);
    for (let a = 0; a < 8; a++) {          // must be able to turn on the spot
      const ca = probe.hullClearance(world, pose.pos, a * Math.PI / 4, 0);
      if (ca < 0.2) { errors.push(`${name}: cannot turn around (clearance ${ca.toFixed(2)} at ${a * 45}°)`); break; }
    }
  }
  // entities must sit in open water
  for (const [i, ent] of (level.entities || []).entries()) {
    const need = ent.clear ?? 1.2;
    const c = world.clearance(...ent.pos);
    if (c < need) errors.push(`entity #${i} ${ent.id || ""} (${ent.type}) at ${ent.pos.join(",")}: clearance ${c.toFixed(2)} < ${need}`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, minClear, minClearAt: where };
}

/** yaw that faces from a to b (yaw 0 = facing -z) */
export function yawTo(a, b) { return Math.atan2(-(b[0] - a[0]), -(b[2] - a[2])); }
