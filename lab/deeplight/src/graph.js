/* graph.js — load an extracted Deeplight level and provide navigation helpers.
 * The level JSON is the contract (see deeplight.level.schema.json). Coordinates
 * are normalized 0..1; this module keeps them normalized and lets the engine map
 * to world space. */

import * as THREE from "three";

export class LevelGraph {
  constructor(data) {
    this.data = data;
    this.nodes = new Map(data.nodes.map((n) => [n.id, n]));
    this.edges = new Map(data.edges.map((e) => [e.id, e]));
    // adjacency: nodeId -> [{edgeId, otherNodeId}]
    this.adj = new Map(data.nodes.map((n) => [n.id, []]));
    for (const e of data.edges) {
      this.adj.get(e.from)?.push({ edgeId: e.id, other: e.to });
      this.adj.get(e.to)?.push({ edgeId: e.id, other: e.from });
    }
    this.startNodeId = data.startNodeId;
    this.exitNodeId = data.exitNodeId;
    // payloads grouped by the edge/node they sit on
    this.payloadsByEdge = new Map();
    this.payloadsByNode = new Map();
    for (const p of data.payloads || []) {
      const m = this.edges.has(p.edgeOrNodeId) ? this.payloadsByEdge : this.payloadsByNode;
      if (!m.has(p.edgeOrNodeId)) m.set(p.edgeOrNodeId, []);
      m.get(p.edgeOrNodeId).push(p);
    }
  }

  node(id) { return this.nodes.get(id); }
  edge(id) { return this.edges.get(id); }
  neighbors(nodeId) { return this.adj.get(nodeId) || []; }

  /** edges leaving a node, excluding the one we arrived on */
  exitsFrom(nodeId, cameEdgeId) {
    return this.neighbors(nodeId).filter((a) => a.edgeId !== cameEdgeId);
  }

  /** polyline of an edge oriented so it STARTS at fromNodeId */
  orientedPolyline(edgeId, fromNodeId) {
    const e = this.edge(edgeId);
    const pts = e.polyline.map((p) => p.slice());
    return e.from === fromNodeId ? pts : pts.reverse();
  }

  isExit(nodeId) { return nodeId === this.exitNodeId; }
  isDeadEnd(nodeId) {
    const n = this.node(nodeId);
    return n && n.kind === "deadend";
  }

  /** straight-line normalized distance from a node to the exit (routing hint) */
  distToExit(nodeId) {
    const a = this.node(nodeId), b = this.node(this.exitNodeId);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

/** map a normalized [x,y] to a world Vector3 on the tunnel spine plane */
export function toWorld(x, y, WORLD, depthY = 0) {
  return new THREE.Vector3((x - 0.5) * WORLD, depthY, (y - 0.5) * WORLD);
}

/** build a smooth 3D curve along an edge polyline (oriented from `fromNodeId`) */
export function edgeCurve(graph, edgeId, fromNodeId, WORLD) {
  const poly = graph.orientedPolyline(edgeId, fromNodeId);
  const pts = poly.map(([x, y]) => toWorld(x, y, WORLD));
  if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0.01, 0, 0)));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
  return curve;
}
