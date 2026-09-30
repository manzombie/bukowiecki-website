// Expedition-level checks: validity, closed mesh, completability by the test pilot.
import test from "node:test";
import assert from "node:assert/strict";
import expedition from "../src/levels/expedition.js";
import sandbox from "../src/levels/sandbox.js";
import { prepareLevel, buildWorld, validateLevel } from "../src/core/levelgraph.js";
import { GameSim } from "../src/core/game.js";
import { TestPilot } from "../src/core/bot.js";
import { SIM_DT } from "../src/core/tuning.js";
import { meshAll, surfaceStats } from "./meshcheck.mjs";

const L = prepareLevel(expedition);
const W = buildWorld(L);

test("expedition level validates (graph, clearance, poses, entities)", () => {
  const r = validateLevel(L, W);
  assert.ok(r.ok, r.errors.join("\n"));
});

test("cave surface is closed: no cracks or holes at junctions or chunk seams", () => {
  for (const [name, lvl] of [["sandbox", sandbox], ["expedition", expedition]]) {
    const st = surfaceStats(meshAll(buildWorld(prepareLevel(lvl))));
    assert.equal(st.open, 0, `${name}: ${st.open} open edges`);
    assert.ok(st.badWinding / st.tris < 0.001, `${name}: winding disagrees on ${st.badWinding}/${st.tris}`);
  }
});

function runExpedition(variant, maxMinutes = 12) {
  const sim = new GameSim(L, buildWorld(L));
  const bot = new TestPilot(L, variant);
  let minClear = Infinity, steps = 0, damageBySource = {};
  const stages = [];
  while (sim.state === "playing" && steps < maxMinutes * 60 / SIM_DT) {
    sim.step(SIM_DT, bot.input(sim));
    steps++;
    if (steps % 6 === 0) minClear = Math.min(minClear, sim.sub.hullClearance(sim.world));
    for (const e of sim.events.splice(0)) {
      if (e.type === "damage") damageBySource[e.source] = (damageBySource[e.source] || 0) + e.amount;
      if (e.type === "objective") stages.push(`${e.objective.id}@${sim.time.toFixed(0)}s`);
    }
  }
  return { sim, minClear, damageBySource, stages };
}

for (const variant of ["safe", "salvage"]) {
  test(`test pilot completes the expedition via the ${variant} route`, () => {
    const r = runExpedition(variant);
    const info = `state=${r.sim.state} t=${r.sim.time.toFixed(0)}s hull=${r.sim.hull.toFixed(0)} pos=${r.sim.sub.pos.map((v) => v.toFixed(0))} obj=${r.sim.objective?.id} stages=${r.stages.join(" ")} dmg=${JSON.stringify(r.damageBySource)}`;
    assert.equal(r.sim.state, "extracted", info);
    assert.ok(r.minClear > -0.08, `hull stayed out of rock (min ${r.minClear.toFixed(3)}) ${info}`);
    assert.ok(r.sim.flags.has("recorder"), "recovered the flight recorder");
    const s = r.sim.buildSummary(true);
    assert.ok(s.total > 0 && s.lines.length >= 7);
    console.log(`  ${variant}: ${info} score=${s.total} rank=${s.rank}`);
  });
}

test("restarts leave no dynamic colliders or stale state behind", () => {
  const sim = new GameSim(L, W);
  for (let k = 0; k < 5; k++) {
    for (let i = 0; i < 600; i++) sim.step(SIM_DT, { thrust: 1, yaw: 0.3, vert: 0, boost: false, fire: true, sonar: i === 5, aimDir: null });
    sim.reset();
    assert.equal(sim.world.dynamic.length, 1, "only the seal membrane collider");
    assert.equal(sim.state, "playing"); assert.equal(sim.score, 0); assert.equal(sim.hull, 100);
  }
});

test("continue from checkpoint restores a safe, playable state", () => {
  const sim = new GameSim(L, W);
  sim.sub.reset({ pos: [-24, -32, -262], yaw: 0 });
  for (let i = 0; i < 60; i++) sim.step(SIM_DT, { thrust: 0, yaw: 0, vert: 0, boost: false, fire: false, sonar: false, aimDir: null });
  assert.equal(sim.checkpoint.id, "zFork");
  sim.damage(500, "mine");
  assert.equal(sim.state, "failed");
  sim.continueFromCheckpoint();
  assert.equal(sim.state, "playing"); assert.equal(sim.hull, 70); assert.equal(sim.continues, 1);
  assert.ok(sim.sub.hullClearance(W) > 0.5);
});

test("legacy extracted maps are validated and rejected with concrete reasons", async () => {
  const { legacyLevel } = await import("./legacy.mjs");
  for (const f of ["level01.json", "level03.json"]) {
    const lv = prepareLevel(legacyLevel(f));
    const r = validateLevel(lv, buildWorld(lv), { step: 3 });
    const kinds = {};
    for (const e of r.errors) { const k = e.includes("overlap") ? "overlapping unrelated tunnels" : e.includes("turn") ? "impossible turns" : e.includes("clearance") ? "hull clearance" : e.includes("duplicate") ? "duplicate edges" : e.includes("unreachable") ? "disconnected" : "other"; kinds[k] = (kinds[k] || 0) + 1; }
    console.log(`  ${f}: ${lv.nodes.length} nodes, ${lv.edges.length} edges -> ${r.errors.length} errors ${JSON.stringify(kinds)}`);
    assert.equal(r.ok, false);
  }
});
