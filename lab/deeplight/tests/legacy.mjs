// adapter: legacy extracted 2D graph -> level graph (same scale as the old game: 1100 units, bore 30, sub ~12.5)
// rescaled so the old bore (30) matches a 7.5 m tunnel for our 7.1 m hull.
import { readFileSync } from "node:fs";
export function legacyLevel(file) {
  const d = JSON.parse(readFileSync(new URL("../levels/" + file, import.meta.url)));
  const S = 1100 * 0.25, R = 7.5;
  const P = ([x, y]) => [(x - 0.5) * S, 0, (y - 0.5) * S];
  const nodes = d.nodes.map((n) => ({ id: n.id, p: P([n.x, n.y]), r: R }));
  const edges = d.edges.map((e) => ({ id: e.id, a: e.from, b: e.to, via: e.polyline.slice(1, -1).map((q) => [...P(q), R]) }));
  const s = nodes.find((n) => n.id === d.startNodeId);
  return { id: d.id, nodes, edges, start: { node: s.id, pos: s.p, yaw: 0 }, exit: { node: d.exitNodeId, pos: nodes.find((n) => n.id === d.exitNodeId).p }, solids: [], entities: [] };
}
