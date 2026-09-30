// Play the expedition through REAL input events (keyboard+mouse or multi-touch).
// The page's test pilot only decides; this harness presses keys / moves the mouse /
// places fingers, so the whole input -> reticle -> aim -> sim path is exercised.
// Usage: node tests/browser/drive.mjs --input=keyboard|touch [--route=safe|salvage]
import { launch, sleep } from "./cdp.mjs";
import { mkdirSync, rmSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const mode = opt("input", "keyboard"), route = opt("route", "safe");
const touch = mode === "touch";
const [W, H] = touch ? [844, 390] : [1280, 720];
const out = `tests/browser/out/drive-${mode}-${route}`; rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

let this_aim = { x: 0, y: 0, reset: false }, active = new Map();
const b = await launch({ width: W, height: H });
try {
  if (touch) {
    await b.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await b.send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
  }
  await b.goto(`http://localhost:8765/deeplight/?drive=${route}&quality=${touch ? "low" : "medium"}&t=${Date.now()}`);
  await b.waitFor("!!window.__deeplight", 90000);
  const R = await b.eval(`(() => { const r = (s) => { const e = document.querySelector(s).getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; };
    return { dive: r('#btn-dive') }; })()`);
  // start with a real tap / click on "Dive"
  if (touch) { await b.touch("touchStart", [{ x: R.dive.x, y: R.dive.y, id: 9 }]); await b.touch("touchEnd", []); }
  else { await b.mouse("mouseMoved", R.dive.x, R.dive.y); await b.mouse("mousePressed", R.dive.x, R.dive.y, "left"); await b.mouse("mouseReleased", R.dive.x, R.dive.y, "left"); }
  await sleep(400);
  const btn = touch ? await b.eval(`(() => { const r = (s) => { const e = document.querySelector(s).getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; };
    return { fire: r('[data-t=fire]'), rise: r('[data-t=rise]'), dive: r('[data-t=dive]'), sonar: r('[data-t=sonar]'), touchVisible: !document.getElementById('touch').hidden }; })()`) : null;
  if (touch) { globalThis.__btn = btn; console.log("touch layout visible:", btn.touchVisible); }

  const held = new Set();
  const setKey = async (code, on, key) => { if (on && !held.has(code)) { held.add(code); await b.key("keyDown", code, key); } else if (!on && held.has(code)) { held.delete(code); await b.key("keyUp", code, key); } };
  let mouseDown = false, cursor = { x: W / 2, y: H / 2 };
  const stickC = { x: 130, y: H * 0.72 };
  let t0 = Date.now(), lastShot = -99, shots = 0, lastObj = "", d, continues = 0;
  while (Date.now() - t0 < 10 * 60 * 1000) {
    d = await b.eval("window.__deeplight.decide()");
    if (d.mode === "fail" || d.mode === "dying") {
      if (d.mode === "dying") { await sleep(300); continue; }
      continues++; console.log(`  hull breached at ${d.obj} — continuing from checkpoint (${continues})`);
      if (touch) await touchFrame([], false);
      else for (const c of [...held]) await setKey(c, false);
      const r = await b.eval("(() => { const e = document.querySelector('#btn-continue').getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; })()");
      if (touch) { await b.touch("touchStart", [{ x: r.x, y: r.y, id: 9 }]); await b.touch("touchEnd", []); }
      else { await b.mouse("mouseMoved", r.x, r.y); await b.mouse("mousePressed", r.x, r.y, "left"); await b.mouse("mouseReleased", r.x, r.y, "left"); }
      await sleep(600); mouseDown = false; continue;
    }
    if (d.state !== "playing" || !["play"].includes(d.mode)) break;
    const el = (Date.now() - t0) / 1000;
    if (d.obj !== lastObj || el - lastShot > 20) { await b.shot(`${out}/${String(shots++).padStart(2, "0")}-${d.obj}.jpg`); lastShot = el; lastObj = d.obj; console.log(`${el.toFixed(0).padStart(4)}s sim ${d.t.toFixed(0)}s ${d.obj} hull ${d.hull} score ${d.score} pos ${d.pos}`); }
    if (!touch) {
      await setKey("KeyW", d.thrust > 0.3, "w"); await setKey("KeyS", d.thrust < -0.3, "s");
      await setKey("KeyA", d.yaw < -0.3, "a"); await setKey("KeyD", d.yaw > 0.3, "d");
      await setKey("Space", d.vert > 0.3, " "); await setKey("KeyZ", d.vert < -0.3, "z");
      if (d.sonar) { await b.key("keyDown", "KeyQ", "q"); await b.key("keyUp", "KeyQ", "q"); }
      const aim = d.aim || { x: W / 2, y: H * 0.47 };
      cursor = { x: Math.max(2, Math.min(W - 2, aim.x)), y: Math.max(2, Math.min(H - 2, aim.y)) };
      await b.mouse("mouseMoved", cursor.x, cursor.y);
      if (d.fire !== mouseDown) { mouseDown = d.fire; await b.mouse(d.fire ? "mousePressed" : "mouseReleased", cursor.x, cursor.y, "left"); }
    } else {
      // every finger currently down, re-sent each tick (touchMove carries all active points)
      const pts = [];
      pts.push({ id: 1, x: stickC.x + Math.max(-1, Math.min(1, d.yaw)) * 56, y: stickC.y - Math.max(-1, Math.min(1, d.thrust)) * 56 });
      if (d.vert > 0.3) pts.push({ id: 2, ...btn.rise }); else if (d.vert < -0.3) pts.push({ id: 2, ...btn.dive });   // same thumb slides between ▲/▼ (rocker)
      if (d.fire) pts.push({ id: 3, ...btn.fire });
      // aim finger: drag on the free right side toward the target
      const want = d.aim || { x: W / 2, y: H * 0.47 };
      const dx = Math.max(-40, Math.min(40, (want.x - d.reticle.x) / 2.4)), dy = Math.max(-40, Math.min(40, (want.y - d.reticle.y) / 2.4));
      if (Math.abs(dx) + Math.abs(dy) > 1) { pts.push({ id: 4, x: W * 0.62 + (this_aim.x += dx), y: H * 0.45 + (this_aim.y += dy) }); }
      else this_aim.reset = true;
      await touchFrame(pts, d.sonar);
    }
    await sleep(40);
  }
  for (const c of [...held]) await setKey(c, false);
  await sleep(1500);
  const end = await b.eval("(() => { const g = window.__deeplight; return { mode: g.mode, state: g.sim.state, t: g.sim.time, score: g.sim.score, hull: Math.round(g.sim.hull), cont: g.sim.continues, summary: g.sim.summary && g.sim.summary.total }; })()");
  await b.shot(`${out}/99-end.jpg`);
  console.log("END", JSON.stringify(end));
  const errs = b.logs.filter((l) => /error|exception/i.test(l));
  if (errs.length) console.log("CONSOLE ERRORS:\n" + errs.slice(0, 10).join("\n"));
} finally { await b.close(); }

// ---- touch bookkeeping: CDP needs start/move/end transitions per finger
async function touchFrame(pts, sonar) {
  // CDP semantics: touchStart/touchMove carry ALL active fingers (a missing finger is a lift);
  // touchEnd carries none and lifts everything.
  if (this_aim.reset) { this_aim.x = 0; this_aim.y = 0; this_aim.reset = false; }
  const send = async (list) => {
    if (!list.length) { if (active.size) await b.touch("touchEnd", []); active = new Map(); return; }
    await b.touch(active.size ? "touchMove" : "touchStart", list);
    active = new Map(list.map((p) => [p.id, p]));
  };
  // new thumbs land at the stick centre / aim origin first (the stick is relative to touch-down)
  const landed = pts.map((p) => active.has(p.id) ? active.get(p.id) : p.id === 1 ? { id: 1, x: 130, y: 390 * 0.72 } : p.id === 4 ? { id: 4, x: 844 * 0.62, y: 390 * 0.45 } : p);
  const kept = landed.filter((p) => pts.some((q) => q.id === p.id));
  if (kept.length !== active.size || kept.some((p) => !active.has(p.id))) await send(kept);
  await send(pts);
  if (sonar) { await send([...pts, { id: 7, ...btnRef().sonar }]); await send(pts); }
}
function btnRef() { return globalThis.__btn; }
