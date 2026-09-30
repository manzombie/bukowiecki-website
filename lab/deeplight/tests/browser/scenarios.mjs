// Browser regression scenarios (real Chrome, real input events).
// Usage: node tests/browser/scenarios.mjs
import { launch, sleep } from "./cdp.mjs";
import { mkdirSync } from "node:fs";

const out = "tests/browser/out/scenarios"; mkdirSync(out, { recursive: true });
const W = 1280, H = 720;
const b = await launch({ width: W, height: H, port: 9334 });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`); };
const state = () => b.eval(`(() => { const g = window.__deeplight, s = g.sim.sub; return { mode: g.mode, t: g.sim.time, pos: s.pos.slice(), speed: s.speed(), keys: [...g.input.keys], fire: g.input.state().fire, boom: g.rig.boom, rig: g.rig.mode, clear: s.hullClearance(g.world), camClear: g.world.clearance(...g.rig.pos), dropped: g.stepper.dropped }; })()`);
const click = async (sel) => { const r = await b.eval(`(() => { const e = document.querySelector('${sel}').getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; })()`); await b.mouse("mouseMoved", r.x, r.y); await b.mouse("mousePressed", r.x, r.y, "left"); await b.mouse("mouseReleased", r.x, r.y, "left"); };
try {
  await b.goto(`http://localhost:8765/deeplight/?t=${Date.now()}`);
  await b.waitFor("!!window.__deeplight", 90000);
  await click("#btn-dive"); await sleep(500);

  // 1) held key + focus loss: nothing stays stuck, no shot fired on resume click
  await b.key("keyDown", "KeyW", "w"); await sleep(1200);
  let s = await state();
  check("W moves the sub forward", s.speed > 5, `speed ${s.speed.toFixed(1)}`);
  await b.eval("window.dispatchEvent(new Event('blur'))"); await sleep(300);
  s = await state();
  check("blur pauses and clears held keys", s.mode === "pause" && s.keys.length === 0, `mode ${s.mode} keys [${s.keys}]`);
  const tPaused = s.t; await sleep(1500); s = await state();
  check("simulation frozen while paused", Math.abs(s.t - tPaused) < 1e-6, `Δt ${(s.t - tPaused).toFixed(4)}`);
  await b.key("keyUp", "KeyW", "w");
  const shotsBefore = await b.eval("window.__deeplight.sim.sub.energy");
  await click("#btn-resume"); await sleep(600);
  s = await state();
  check("resume click does not fire", (await b.eval("window.__deeplight.sim.sub.energy")) >= shotsBefore - 0.01, `energy ${shotsBefore.toFixed(1)} -> ${(await b.eval("window.__deeplight.sim.sub.energy")).toFixed(1)}`);
  check("no stuck thrust after resume", s.keys.length === 0 && !s.fire, `keys [${s.keys}]`);

  // 2) visibility change (tab switch) mid-hold
  await b.key("keyDown", "KeyD", "d"); await sleep(400);
  await b.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))");
  await sleep(300); s = await state();
  check("tab switch pauses and clears keys", s.mode === "pause" && s.keys.length === 0, `mode ${s.mode}`);
  await b.eval("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))");
  await b.key("keyUp", "KeyD", "d");
  await click("#btn-resume"); await sleep(300);

  // 3) frame stall: a 2 s main-thread block must not produce a large sim jump
  s = await state(); const tA = s.t, pA = s.pos;
  await b.eval("(() => { const e = performance.now() + 2000; while (performance.now() < e) {} })()");
  await sleep(100); s = await state();
  const jump = Math.hypot(...s.pos.map((v, i) => v - pA[i]));
  check("2 s stall: bounded catch-up, no teleport", s.t - tA < 0.6 && jump < 8, `sim advanced ${(s.t - tA).toFixed(2)} s, moved ${jump.toFixed(2)} m`);

  // 4) drive into a wall at boost; camera + hull stay clear; screenshots incl. debug overlay
  await b.key("keyDown", "KeyA", "a"); await sleep(900); await b.key("keyUp", "KeyA", "a");
  await b.key("keyDown", "ShiftLeft", "Shift"); await b.key("keyDown", "KeyW", "w"); await sleep(2500);
  s = await state();
  check("boost into the bay wall: hull clear, camera clear", s.clear > -0.08 && s.camClear > 0.4, `hull ${s.clear.toFixed(2)} cam ${s.camClear.toFixed(2)} boom ${s.boom.toFixed(1)}`);
  await b.shot(`${out}/wall-chase.jpg`);
  await b.key("keyDown", "Backquote", "`"); await b.key("keyUp", "Backquote", "`"); await sleep(400);
  await b.shot(`${out}/wall-debug.jpg`);
  await b.key("keyDown", "Backquote", "`"); await b.key("keyUp", "Backquote", "`");
  await b.key("keyDown", "KeyC", "c"); await b.key("keyUp", "KeyC", "c"); await sleep(400);
  s = await state();
  check("cockpit view near the wall is in open water", s.rig === "cockpit" && s.camClear > 0.2, `cam clearance ${s.camClear.toFixed(2)}`);
  await b.shot(`${out}/wall-cockpit.jpg`);
  await b.key("keyUp", "KeyW", "w"); await b.key("keyUp", "ShiftLeft", "Shift");
  await b.key("keyDown", "KeyS", "s"); await sleep(1500); await b.key("keyUp", "KeyS", "s");
  s = await state();
  check("reverse backs away from the wall", s.clear > 0.3, `hull clearance ${s.clear.toFixed(2)}`);
  await b.key("keyDown", "KeyC", "c"); await b.key("keyUp", "KeyC", "c");

  // 5) sonar + firing feedback screenshot
  await b.key("keyDown", "KeyQ", "q"); await b.key("keyUp", "KeyQ", "q"); await sleep(700);
  await b.mouse("mouseMoved", W / 2 + 60, H / 2 - 30); await b.mouse("mousePressed", W / 2 + 60, H / 2 - 30, "left"); await sleep(350);
  await b.shot(`${out}/sonar-fire.jpg`);
  await b.mouse("mouseReleased", W / 2 + 60, H / 2 - 30, "left");

  // 6) repeated restarts: GPU objects and JS heap stay flat
  const mem = [];
  for (let k = 0; k < 8; k++) {
    await b.eval("window.__deeplight.restart()");
    await b.key("keyDown", "KeyW", "w"); await sleep(700); await b.key("keyUp", "KeyW", "w");
    await b.send("HeapProfiler.collectGarbage").catch(() => {});
    mem.push(await b.eval("({ geo: window.__deeplight.view.renderer.info.memory.geometries, tex: window.__deeplight.view.renderer.info.memory.textures, heap: performance.memory.usedJSHeapSize / 1048576, programs: window.__deeplight.view.renderer.info.programs.length })"));
  }
  const g0 = mem[1], gN = mem.at(-1);
  check("8 restarts: geometries/textures/programs flat", gN.geo <= g0.geo + 2 && gN.tex === g0.tex && gN.programs === g0.programs, JSON.stringify({ first: g0, last: gN }));
  check("8 restarts: JS heap not growing", gN.heap < g0.heap + 6, `heap ${g0.heap.toFixed(1)} -> ${gN.heap.toFixed(1)} MB`);

  // 7) failure screen: R restarts, Enter continues
  await b.eval("window.__deeplight.sim.damage(999, 'mine')"); await sleep(1500);
  s = await state(); check("hull breach shows the failure screen", s.mode === "fail", s.mode);
  await b.shot(`${out}/fail.jpg`);
  await b.key("keyDown", "KeyR", "r"); await b.key("keyUp", "KeyR", "r"); await sleep(500);
  s = await state(); check("R restarts immediately", s.mode === "play" && s.t < 1, `mode ${s.mode} t ${s.t.toFixed(2)}`);

  // 8) resize / orientation-like change keeps rendering
  await b.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(500);
  const cw = await b.eval("window.__deeplight.view.canvas.width"); check("resize updates the canvas", cw > 0 && cw !== W, `canvas width ${cw}`);

  const errs = b.logs.filter((l) => /error|exception/i.test(l));
  check("no console errors", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (e) { console.log("ERROR", e.message); } finally { await b.close(); }
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} scenarios passed`);
