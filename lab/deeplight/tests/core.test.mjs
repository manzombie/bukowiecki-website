// Regression tests for the simulation core: handling, collision, level validity.
// Run: node --test tests/   (from lab/deeplight)
import test from "node:test";
import assert from "node:assert/strict";
import sandbox from "../src/levels/sandbox.js";
import { prepareLevel, buildWorld, validateLevel, edgePoints, yawTo } from "../src/core/levelgraph.js";
import { Sub, axes } from "../src/core/sub.js";
import { FixedStepper } from "../src/core/loop.js";
import { Autopilot, pathWaypoints } from "../src/core/autopilot.js";
import { SIM_DT, SUB } from "../src/core/tuning.js";

const L = prepareLevel(sandbox);
const W = buildWorld(L);
const idle = { thrust: 0, yaw: 0, vert: 0, boost: false };
const run = (sub, input, secs, world = W, each) => {
  const n = Math.round(secs / SIM_DT);
  for (let i = 0; i < n; i++) { sub.step(SIM_DT, typeof input === "function" ? input(sub, i) : input, world); each?.(sub, i); }
};
const hall = [55, -6, -95];

test("sandbox level validates", () => {
  const r = validateLevel(L, W);
  assert.ok(r.ok, r.errors.join("\n"));
});

test("steering moves the sub in the displayed direction", () => {
  const sub = new Sub({ pos: hall, yaw: 0 });
  run(sub, { thrust: 1, yaw: 0, vert: 0 }, 1.2);
  run(sub, { thrust: 1, yaw: 1, vert: 0 }, 0.9);            // hard right turn at speed
  const { fwd } = axes(sub.yaw);
  const v = sub.vel, sp = Math.hypot(v[0], v[2]);
  const ang = Math.acos((v[0] * fwd[0] + v[2] * fwd[2]) / sp) * 57.3;
  assert.ok(sub.yaw < -0.8, `turned right (yaw ${sub.yaw.toFixed(2)})`);
  assert.ok(ang < 14, `velocity within 14° of heading (was ${ang.toFixed(1)}°)`);
  // displacement over the next half second follows the heading
  const p0 = [...sub.pos]; run(sub, { thrust: 1, yaw: 0, vert: 0 }, 0.5);
  const d = [sub.pos[0] - p0[0], sub.pos[2] - p0[2]], dl = Math.hypot(...d);
  const f2 = axes(sub.yaw).fwd;
  assert.ok((d[0] * f2[0] + d[1] * f2[2]) / dl > 0.97);
});

test("A turns left, D turns right, Space rises, Ctrl descends", () => {
  const s1 = new Sub({ pos: hall }); run(s1, { thrust: 0, yaw: -1, vert: 0 }, 0.5); assert.ok(s1.yaw > 0.3);
  const s2 = new Sub({ pos: hall }); run(s2, { thrust: 0, yaw: 1, vert: 0 }, 0.5); assert.ok(s2.yaw < -0.3);
  const s3 = new Sub({ pos: hall }); run(s3, { thrust: 0, yaw: 0, vert: 1 }, 0.8); assert.ok(s3.pos[1] > hall[1] + 1.5);
  const s4 = new Sub({ pos: hall }); run(s4, { thrust: 0, yaw: 0, vert: -1 }, 0.8); assert.ok(s4.pos[1] < hall[1] - 1.5);
});

test("braking stops quickly; reverse backs away; idle settles", () => {
  const sub = new Sub({ pos: [55, -6, -80], yaw: 0 });
  run(sub, { thrust: 1, yaw: 0, vert: 0 }, 2);
  const v0 = sub.forwardSpeed(); assert.ok(v0 > 8, `cruise ${v0.toFixed(1)}`);
  const p0 = [...sub.pos]; let t = 0;
  run(sub, (s) => { if (s.forwardSpeed() > 0.2) t += SIM_DT; return { thrust: -1, yaw: 0, vert: 0 }; }, 1.0);
  assert.ok(t < 0.75, `stopped in ${t.toFixed(2)} s`);
  const stopDist = Math.hypot(sub.pos[0] - p0[0], sub.pos[2] - p0[2]);
  assert.ok(stopDist < 7, `stopping distance ${stopDist.toFixed(1)} m`);
  run(sub, { thrust: -1, yaw: 0, vert: 0 }, 1.5);
  assert.ok(sub.forwardSpeed() < -3, "reversing");
  run(sub, idle, 4);
  assert.ok(sub.speed() < 0.3, `settles with no input (${sub.speed().toFixed(2)})`);
});

test("boosting straight into rock cannot tunnel through it", () => {
  // face the wall at the end of the narrow passage from 40 m away, full boost
  const start = [70, -6, -96];
  const sub = new Sub({ pos: start, yaw: yawTo(start, [140, -6, -95]) });
  let minC = Infinity, maxX = -Infinity;
  run(sub, { thrust: 1, yaw: 0, vert: 0, boost: true }, 6, W, (s) => { minC = Math.min(minC, s.hullClearance(W)); maxX = Math.max(maxX, s.pos[0]); });
  assert.ok(minC > -0.08, `hull clearance never below -0.08 (min ${minC.toFixed(3)})`);
  assert.ok(maxX < 118, `stopped at the passage end (x=${maxX.toFixed(1)})`);
  assert.ok(sub.hullClearance(W) > -0.02);
});

test("boost through a 1-second frame stall still cannot tunnel", () => {
  const start = [70, -6, -96];
  const sub = new Sub({ pos: start, yaw: yawTo(start, [140, -6, -95]) });
  const stepper = new FixedStepper((dt) => sub.step(dt, { thrust: 1, yaw: 0, vert: 0, boost: true }, W));
  for (let i = 0; i < 30; i++) stepper.advance(1 / 60);
  const n = stepper.advance(1.0);                   // stall
  assert.ok(n <= 10, `bounded catch-up (${n} steps)`);
  for (let i = 0; i < 300; i++) stepper.advance(1 / 60);
  assert.ok(sub.hullClearance(W) > -0.05);
  assert.ok(sub.pos[0] < 118);
});

test("sustained wall contact: no jitter, no repeated damage", () => {
  // drive diagonally into the side of the pillar hall and keep holding
  const sub = new Sub({ pos: [55, -6, -95], yaw: yawTo([55, -6, -95], [55, -6, -130]) });
  let dmgEvents = 0, lastPending = 0;
  const ys = [];
  run(sub, { thrust: 1, yaw: 0, vert: 0 }, 6, W, (s, i) => {
    if (s.pendingDamage > lastPending) { dmgEvents++; lastPending = s.pendingDamage; }
    if (i > 5 * 120) ys.push([...s.pos]);
  });
  assert.ok(sub.contacts.length > 0 || sub.contactTime > 0, "in contact at the end");
  assert.ok(dmgEvents <= 1, `damage events ${dmgEvents}`);
  // jitter: position spread during the final second while pressing into the wall
  const spread = Math.max(...[0, 1, 2].map((k) => Math.max(...ys.map((p) => p[k])) - Math.min(...ys.map((p) => p[k]))));
  assert.ok(spread < 0.6, `spread ${spread.toFixed(3)} m`);
  assert.ok(sub.hullClearance(W) > -0.05);
});

test("gentle scrapes cause no damage; hard hits do, based on impact speed", () => {
  const a = new Sub({ pos: [0, 0, -20], yaw: Math.PI / 2 });     // facing -x toward the run's side wall
  run(a, { thrust: 0.25, yaw: 0, vert: 0 }, 4);
  assert.equal(a.pendingDamage, 0, "slow contact is free");
  const b = new Sub({ pos: [55, -6, -95], yaw: yawTo([55, -6, -95], [55, -6, -130]) });
  run(b, { thrust: 1, yaw: 0, vert: 0, boost: true }, 4);
  assert.ok(b.pendingDamage > 0, "boosted impact damages");
});

test("the whole hull stays clear through the tight S-bend", () => {
  const pts = edgePoints(L, L.edges.find((e) => e.id === "tLeft")).map((p) => p.slice(0, 3));
  const sub = new Sub({ pos: [0, 0, -60], yaw: 0 });
  const ap = new Autopilot(pathWaypoints([[0, 0, -60], ...pts], 5));
  let minC = Infinity;
  run(sub, (s) => ap.input(s), 40, W, (s) => { minC = Math.min(minC, s.hullClearance(W)); });
  assert.ok(ap.done, `reached the end (wp ${ap.i}/${ap.wps.length})`);
  assert.ok(minC > -0.08, `min hull clearance ${minC.toFixed(3)}`);
});

test("every junction is traversable in every direction", () => {
  const failures = [];
  for (const node of L.nodes) {
    const inc = L.adj.get(node.id);
    if (inc.length < 2) continue;
    for (const a of inc) for (const b of inc) {
      if (a === b) continue;
      // approach along edge a toward the node, leave along edge b
      let pa = edgePoints(L, a.edge).map((p) => p.slice(0, 3)); if (a.edge.a === node.id) pa = pa.reverse();
      let pb = edgePoints(L, b.edge).map((p) => p.slice(0, 3)); if (b.edge.b === node.id) pb = pb.reverse();
      const wps = pathWaypoints([...pa, ...pb.slice(1)], 5);
      const iNode = wps.findIndex((w) => Math.hypot(w[0] - node.p[0], w[1] - node.p[1], w[2] - node.p[2]) < 0.01);
      const from = Math.max(0, iNode - 6), to = Math.min(wps.length - 1, iNode + 7);
      const path = wps.slice(from, to + 1);
      const sub = new Sub({ pos: path[0], yaw: yawTo(path[0], path[1]) });
      const ap = new Autopilot(path.slice(1));
      let minC = Infinity;
      run(sub, (s) => ap.input(s), 30, W, (s) => { minC = Math.min(minC, s.hullClearance(W)); });
      if (!ap.done || minC < -0.08) failures.push(`${a.edge.id} -> ${node.id} -> ${b.edge.id}: done=${ap.done} minClear=${minC.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("equivalent input gives the same result at 30, 60 and 120 fps", () => {
  const script = (t) => ({ thrust: t < 2 ? 1 : 0.4, yaw: t > 1 && t < 2.2 ? 0.8 : 0, vert: t > 2.5 ? -0.5 : 0, boost: t > 0.5 && t < 1.2 });
  const res = [30, 60, 120, 144].map((fps) => {
    const sub = new Sub({ pos: [0, 0, -6], yaw: 0 });
    let simT = 0;
    const st = new FixedStepper((dt) => { sub.step(dt, script(simT), W); simT += dt; });
    for (let i = 0; i < 4 * fps; i++) st.advance(1 / fps);
    return { pos: sub.pos, simT };
  });
  for (const r of res.slice(1)) {
    const d = Math.hypot(...r.pos.map((v, k) => v - res[0].pos[k]));
    assert.ok(d < 0.05, `position diff ${d.toFixed(4)} m (simT ${r.simT.toFixed(3)} vs ${res[0].simT.toFixed(3)})`);
  }
});

test("shots and sonar cannot see through rock", () => {
  // from inside the straight run, toward the pillar hall (solid rock between)
  const o = [0, 0, -30], t = [55, -6, -95];
  const d = t.map((v, i) => v - o[i]); const len = Math.hypot(...d); const u = d.map((v) => v / len);
  const hit = W.march(...o, ...u, len);
  assert.ok(hit < len - 1, `blocked at ${hit.toFixed(1)} of ${len.toFixed(1)} m`);
  // clear line inside the hall
  const o2 = [45, -6, -95], t2 = [65, -6, -95];
  assert.ok(W.march(...o2, 1, 0, 0, 20) >= 19.9);
});

test("chase camera never enters rock and always sees the hull (junctions, bends, walls)", async () => {
  const { CameraRig } = await import("../src/core/camera.js");
  const { CAMERA } = await import("../src/core/tuning.js");
  const rig = new CameraRig();
  const pts = edgePoints(L, L.edges.find((e) => e.id === "tLeft")).map((p) => p.slice(0, 3));
  const sub = new Sub({ pos: [0, 0, -60], yaw: 0 });
  const ap = new Autopilot(pathWaypoints([[0, 0, -60], ...pts], 5));
  let worstCam = Infinity, blocked = 0, frames = 0, maxJump = 0, prev = null;
  run(sub, (s) => ap.input(s), 40, W, (s, i) => {
    if (i % 2) return;                                   // 60 Hz camera
    rig.update({ pos: s.pos, yaw: s.yaw, pitch: s.pitch, roll: s.roll, vel: s.vel }, W, 1 / 60);
    frames++;
    worstCam = Math.min(worstCam, W.clearance(...rig.pos));
    const d = rig.pos.map((v, k) => v - s.pos[k]), Lb = Math.hypot(...d);
    if (W.march(...s.pos, ...d.map((v) => v / Lb), Lb) < Lb - 0.05) blocked++;
    if (prev) maxJump = Math.max(maxJump, Math.hypot(...rig.pos.map((v, k) => v - prev[k])));
    prev = [...rig.pos];
  });
  // pressed against a wall: backing into the hall wall must not jam the lens
  const s2 = new Sub({ pos: [74, -6, -95], yaw: yawTo([74, -6, -95], [40, -6, -95]) });
  run(s2, { thrust: -0.6, yaw: 0, vert: 0 }, 3, W);
  const r2 = new CameraRig(); for (let i = 0; i < 120; i++) r2.update({ pos: s2.pos, yaw: s2.yaw, pitch: 0, roll: 0, vel: [0, 0, 0] }, W, 1 / 60);
  assert.ok(worstCam > CAMERA.clearance - 0.08, `camera clearance ${worstCam.toFixed(2)}`);
  assert.equal(blocked, 0, "line from camera to hull never passes through rock");
  assert.ok(maxJump < 1.2, `no camera jumps (max ${maxJump.toFixed(2)} m/frame)`);
  assert.ok(r2.boom > 4, `against a wall the boom swings up instead of collapsing (boom ${r2.boom.toFixed(1)})`);
});
