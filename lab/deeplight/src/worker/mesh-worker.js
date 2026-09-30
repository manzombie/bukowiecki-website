/* mesh-worker.js — builds the cave surface off the main thread.
 * Receives {levelId}, rebuilds the same World from the same level data, and
 * streams chunk meshes back (transferring the typed arrays, no copies). */

import { prepareLevel, buildWorld } from "../core/levelgraph.js";
import { chunkOrigins, meshChunk } from "../core/mesher.js";
import { LEVELS } from "../levels/index.js";

self.onmessage = async (ev) => {
  try {
    const def = await LEVELS[ev.data.levelId]();
    const world = buildWorld(prepareLevel(def));
    const origins = chunkOrigins(world);
    // mesh near the spawn first so the first frame is complete as early as possible
    const s = def.start.pos;
    origins.sort((a, b) => Math.hypot(a[0] + 8 - s[0], a[1] + 8 - s[1], a[2] + 8 - s[2]) - Math.hypot(b[0] + 8 - s[0], b[1] + 8 - s[1], b[2] + 8 - s[2]));
    let batch = [], transfer = [];
    const flush = (done, i) => {
      self.postMessage({ type: "chunks", chunks: batch, done: i, total: origins.length }, transfer);
      batch = []; transfer = [];
    };
    for (let i = 0; i < origins.length; i++) {
      const m = meshChunk(world, ...origins[i]);
      if (m) { batch.push(m); transfer.push(m.positions.buffer, m.normals.buffer, m.colors.buffer, m.glow.buffer, m.indices.buffer); }
      if (batch.length >= 12 || i === origins.length - 1) flush(false, i + 1);
    }
    self.postMessage({ type: "done" });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message || err) });
  }
};
