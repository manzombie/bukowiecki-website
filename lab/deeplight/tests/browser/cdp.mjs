// Minimal Chrome DevTools Protocol driver (no dependencies; Node >= 22).
// Launches a separate headless Chrome with a throwaway profile.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launch({ port = 9333, headless = true, width = 1280, height = 720, extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deeplight-cdp-"));
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    `--window-size=${width},${height}`, ...(headless ? ["--headless=new"] : []), ...extra, "about:blank",
  ];
  const proc = spawn(CHROME, args, { stdio: "ignore" });
  let ver;
  for (let i = 0; i < 80; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(150); }
  }
  if (!ver) throw new Error("Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { r, j } = pending.get(msg.id); pending.delete(msg.id); msg.error ? j(new Error(msg.error.message)) : r(msg.result); }
    else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const logs = [];
  listeners.push((m) => {
    if (m.method === "Runtime.consoleAPICalled") logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("[exception] " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const api = {
    send, logs, ver,
    async goto(url) { await send("Page.navigate", { url }); await sleep(300); },
    async eval(expr, timeout = 60000) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expr, ms = 60000) {
      const t = Date.now();
      while (Date.now() - t < ms) { if (await api.eval(expr).catch(() => false)) return true; await sleep(100); }
      throw new Error("timeout waiting for " + expr);
    },
    async shot(file, opts = {}) {
      const r = await send("Page.captureScreenshot", { format: file.endsWith(".png") ? "png" : "jpeg", quality: 85, ...opts });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async key(type, code, key = code) { await send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: 0 }); },
    async touch(type, points) { await send("Input.dispatchTouchEvent", { type, touchPoints: points }); },
    async mouse(type, x, y, button = "none", extra = {}) { await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0, ...extra }); },
    async close() { try { ws.close(); } catch {} proc.kill("SIGTERM"); await sleep(400); try { rmSync(dir, { recursive: true, force: true }); } catch {} },
  };
  return api;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
