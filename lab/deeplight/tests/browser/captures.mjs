// Delivery captures: key moments of a real bot playthrough + debug/collision views.
import { launch, sleep } from "./cdp.mjs";
import { mkdirSync } from "node:fs";
const out = "tests/browser/out/captures"; mkdirSync(out, { recursive: true });
const b = await launch({ width: 1280, height: 720, port: 9337 });
const shot = (n) => b.shot(`${out}/${n}.jpg`);
const frames = (n) => b.eval(`(() => { for (let i = 0; i < ${n}; i++) __deeplight._frame(1/60); return 1; })()`);
try {
  await b.goto(`http://localhost:8765/deeplight/?bot=salvage&t=${Date.now()}`);
  await b.waitFor("!!window.__deeplight", 90000);
  await sleep(1500); await shot("01-title");
  await b.eval("document.getElementById('btn-dive').click(); 1");
  // follow the bot; capture when stages are reached
  const want = [
    ["02-launch-bay", (s) => s.t > 3.2],
    ["03-kelp-galleries", (s) => s.obj === "galleries" && s.t > 16],
    ["04-echo-hall-sonar", (s) => s.obj === "echo" && s.sonarAge > 0.5 && s.sonarAge < 0.9],
    ["05-mines", (s) => s.arming],
    ["06-salvage-run", (s) => s.pos[2] < -318 && s.pos[2] > -345 && s.pos[0] > -45 && s.pos[0] < -20],
    ["07-halcyon-wreck", (s) => s.obj === "cavern" && s.pos[2] < -445],
    ["08-throat-shades", (s) => s.frozen],
    ["09-warden-gate", (s) => s.obj === "gate" && s.wardenTell],
    ["10-seal-broken-ascent", (s) => s.obj === "ascend" && s.pos[1] > -20],
  ];
  let i = 0;
  const t0 = Date.now();
  while (i < want.length && Date.now() - t0 < 6 * 60000) {
    const s = await b.eval(`(() => { const g = __deeplight, sim = g.sim; return { t: sim.time, obj: sim.objective && sim.objective.id, pos: sim.sub.pos, sonarAge: sim.time - sim.sonarT,
      arming: sim.entities.some((e) => e.type === 'mine' && e.state === 'arming'), frozen: sim.entities.some((e) => e.type === 'shade' && e.state === 'frozen' && Math.hypot(...e.pos.map((v, k) => v - sim.sub.pos[k])) < 25),
      wardenTell: sim.entities.some((e) => e.type === 'warden' && (e.state === 'tell' || e.state === 'recover')), state: sim.state }; })()`);
    if (s.state !== "playing") break;
    // skip a stage we can no longer reach
    if (i < want.length - 1 && want.slice(i + 1).some(([, f]) => f(s)) && !want[i][1](s) && ["05-mines", "08-throat-shades"].includes(want[i][0]) && s.obj !== "echo" && s.obj !== "throat") i++;
    if (want[i][1](s)) { await shot(want[i][0]); console.log("captured", want[i][0], "t", s.t.toFixed(1)); i++; }
    await sleep(60);
  }
  await b.waitFor("__deeplight.mode === 'summary'", 120000).catch(() => {});
  await sleep(800); await shot("11-summary");

  // debug / collision views in the sandbox junction and against a wall
  await b.goto(`http://localhost:8765/deeplight/?level=sandbox&debug=1&t=${Date.now()}`);
  await b.waitFor("!!window.__deeplight", 60000);
  await b.eval(`(() => { const g = __deeplight; g.start(); g.hud.hidePrompt(); g.sim.sub.reset({ pos: [4, 0, -66], yaw: -0.9 }); g.rig.reset(); g.prev = g._snap(); return 1; })()`);
  await b.key("keyDown", "KeyW", "w"); await sleep(1200); await b.key("keyUp", "KeyW", "w"); await sleep(400);
  await shot("12-debug-junction");
  await b.eval(`(() => { const g = __deeplight; g.sim.sub.reset({ pos: [55, -6, -95], yaw: -1.2 }); g.rig.reset(); g.prev = g._snap(); return 1; })()`);
  await b.key("keyDown", "KeyW", "w"); await sleep(3500);
  await shot("13-debug-wall-scrape");
  await b.key("keyDown", "KeyC", "c"); await b.key("keyUp", "KeyC", "c"); await sleep(500);
  await shot("14-debug-cockpit-at-wall");
  await b.key("keyUp", "KeyW", "w");
} finally { await b.close(); }
