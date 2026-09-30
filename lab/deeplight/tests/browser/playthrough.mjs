// Real-time playthrough in headless Chrome (GPU) with the test pilot.
// Records frame timing, memory and screenshots per stage.
// Usage: node tests/browser/playthrough.mjs [safe|salvage] [--quality=medium] [--size=1280x720] [--cpu=1] [--mobile]
import { launch, sleep } from "./cdp.mjs";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const variant = args.find((a) => !a.startsWith("--")) || "safe";
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const [W, H] = opt("size", "1280x720").split("x").map(Number);
const quality = opt("quality", "medium"), cpu = +opt("cpu", "1"), mobile = args.includes("--mobile");
const tag = opt("tag", `${variant}-${quality}-${W}x${H}${cpu > 1 ? "-cpu" + cpu : ""}`);
const out = `tests/browser/out/${tag}`; mkdirSync(out, { recursive: true });

const b = await launch({ width: W, height: H });
try {
  if (mobile) await b.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  if (cpu > 1) await b.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await b.goto(`http://localhost:8765/deeplight/?bot=${variant}&quality=${quality}&t=${Date.now()}`);
  await b.waitFor("!!window.__deeplight", 90000);
  const load = await b.eval("JSON.stringify(window.__loadTimes)");
  await b.eval(`(() => {
    window.__ft = []; let last = performance.now();
    const f = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f);
    document.getElementById('btn-dive').click(); return true; })()`);
  const t0 = Date.now(); let lastShot = -99, lastObj = "", shots = 0, samples = [];
  while (Date.now() - t0 < 9 * 60 * 1000) {
    await sleep(500);
    const s = await b.eval(`(() => { const g = window.__deeplight, sim = g.sim; const ft = window.__ft.splice(0);
      return { t: sim.time, state: sim.state, mode: g.mode, obj: sim.objective && sim.objective.id, hull: Math.round(sim.hull), score: sim.score,
        ft, dpr: g.view.dpr, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0, info: g.view.info(), pos: sim.sub.pos.map(Math.round) }; })()`);
    samples.push(...s.ft);
    const el = (Date.now() - t0) / 1000;
    if (s.obj !== lastObj || el - lastShot > 15) {
      await b.shot(`${out}/${String(shots++).padStart(2, "0")}-${s.obj}.jpg`);
      lastShot = el; lastObj = s.obj;
      console.log(`${el.toFixed(0).padStart(4)}s sim ${s.t.toFixed(0)}s ${s.obj} hull ${s.hull} score ${s.score} pos ${s.pos} dpr ${s.dpr.toFixed(2)} heap ${s.heap.toFixed(0)}MB geo ${s.info.geos} calls ${s.info.calls}`);
    }
    if (s.state !== "playing" || s.mode === "summary" || s.mode === "fail") { await sleep(1200); await b.shot(`${out}/99-end-${s.state}.jpg`); console.log("END", s.state, "sim", s.t.toFixed(1), "s"); break; }
  }
  samples = samples.filter((x) => x > 0 && x < 1000).sort((a, b) => a - b);
  const pct = (p) => samples[Math.floor(samples.length * p)];
  const avg = samples.reduce((a, x) => a + x, 0) / samples.length;
  console.log(JSON.stringify({ tag, load: JSON.parse(load), frames: samples.length, avgMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), p99: +pct(0.99).toFixed(1), max: +samples.at(-1).toFixed(1) }));
  const errs = b.logs.filter((l) => /error|exception/i.test(l));
  if (errs.length) console.log("CONSOLE ERRORS:\n" + errs.slice(0, 10).join("\n"));
} finally { await b.close(); }
