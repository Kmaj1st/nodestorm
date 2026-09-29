// First-load timeline of the production build on a slow phone: "Fast 3G" (562.5 ms round trip, 1.44 Mbit/s down)
// and a 4x slower CPU, a fresh browser profile each run (nothing cached, service worker allowed). Not part of
// `npm run e2e`. Usage: `npm run build`, then `node e2e/firstload.mjs [runs]` (E2E_WEB_PORT picks the port;
// FIRSTLOAD_LANG=zh measures the Chinese interface). Prints the median of each milestone and the last run's requests.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5199);
const RUNS = Number(process.argv[2] || 3);
const LANG = process.env.FIRSTLOAD_LANG || "en";

const vite = spawn("npx", ["vite", "preview", "client", "--port", String(WEB_PORT), "--strictPort"], { stdio: "ignore", detached: true });
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${WEB_PORT}/`)).ok) break; } catch {}
    if (i > 100) throw new Error("vite preview did not start (run `npm run build` first)");
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch();
  const runs = [];
  let requests = [];
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: LANG === "zh" ? "zh-CN" : "en-US" });
    const page = await context.newPage();
    await page.addInitScript((lang) => {
      localStorage.setItem("nodestorm-ui-language", lang);
      window.__longTasks = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
      // The canvas can be used once React Flow's pane is on screen.
      const seen = () => document.querySelector(".react-flow__pane") && (window.__canvasAt ??= performance.now());
      new MutationObserver(seen).observe(document, { childList: true, subtree: true });
    }, LANG);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__canvasAt, null, { timeout: 60000 });
    await page.waitForTimeout(1500); // late long tasks (idle preloads, service worker install)
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paint = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime]));
      const ends = window.__longTasks.filter(([s]) => s < window.__canvasAt + 5000).map(([s, d]) => s + d);
      return {
        requests: performance.getEntriesByType("resource").map((e) => ({
          name: e.name.replace(location.origin, ""), start: Math.round(e.startTime), end: Math.round(e.responseEnd),
          kB: Math.round(e.encodedBodySize / 1024), blocking: e.renderBlockingStatus,
        })),
        "html received": nav.responseEnd,
        "first paint": paint["first-paint"],
        "first contentful paint": paint["first-contentful-paint"],
        "DOMContentLoaded": nav.domContentLoadedEventEnd,
        "load": nav.loadEventEnd,
        "canvas on screen": window.__canvasAt,
        "main thread quiet (last long task end)": Math.max(window.__canvasAt, ...ends),
        "long tasks before quiet (ms)": window.__longTasks.filter(([s]) => s < window.__canvasAt + 5000).reduce((a, [, d]) => a + d, 0),
      };
    });
    requests = m.requests;
    delete m.requests;
    runs.push(m);
    await context.close();
  }
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`first load, ${LANG} interface, Fast 3G + 4x CPU, median of ${RUNS}`);
  for (const k of Object.keys(runs[0])) console.log(`${k.padEnd(40)} ${Math.round(median(runs.map((r) => r[k])))} ms`);
  console.log("requests of the last run (start → end ms, kB over the wire):");
  for (const r of requests.sort((a, b) => a.start - b.start)) {
    console.log(`  ${String(r.start).padStart(6)} → ${String(r.end).padStart(6)} ${String(r.kB).padStart(5)} kB ${r.blocking === "blocking" ? "render-blocking " : ""}${r.name}`);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid); } catch {}
}
