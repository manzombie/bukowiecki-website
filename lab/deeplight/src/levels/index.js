/* levels/index.js — level registry (lazy imports so the worker and the game
 * load exactly the same data). */
export const LEVELS = {
  expedition: () => import("./expedition.js").then((m) => m.default),
  sandbox: () => import("./sandbox.js").then((m) => m.default),
};
