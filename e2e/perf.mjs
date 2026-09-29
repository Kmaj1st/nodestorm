// Rough performance check on a big graph (300 concepts, 600 relations). Not part of `npm run e2e`.
// Usage: node e2e/perf.mjs   (E2E_WEB_PORT picks the Vite port; prints timings, asserts nothing but loose bounds)
// `node e2e/perf.mjs --built` (or E2E_BUILT=1) measures a production build instead of the dev server, whose React
// development checks dominate the timings: it builds client/dist-perf (VITE_PERF_HOOKS=1, which only adds the
// stores the benchmark drives, see client/src/perfHooks.ts) and serves it with `vite preview`.
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5199);
const BUILT = process.argv.includes("--built") || process.env.E2E_BUILT === "1";
const N = 300;
const R = 600;

// Deterministic pseudo-random numbers so every run measures the same graph.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

function bigWorkspace() {
  const statuses = ["ok", "ok", "ok", "blocked", "unclear", "error"];
  const nodes = Array.from({ length: N }, (_, i) => ({
    id: `n${i}`,
    name: `Concept ${i}`,
    definition: `Definition of concept ${i}, long enough to wrap onto a second line of the node card.`,
    aliases: [],
    status: statuses[i % statuses.length],
    position: { x: (i % 20) * 280, y: Math.floor(i / 20) * 180 },
    dependsOn: [],
    missingDeps: [],
  }));
  const origins = ["mix", "dependency", "derive"];
  const relations = [];
  const seen = new Set();
  while (relations.length < R) {
    // Mostly near neighbours (like a real brainstorm), some long links.
    const a = Math.floor(rand() * N);
    const b = rand() < 0.8 ? Math.min(N - 1, Math.max(0, a + Math.floor(rand() * 42) - 21)) : Math.floor(rand() * N);
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (a === b || seen.has(key)) continue;
    seen.add(key);
    const origin = origins[relations.length % 3];
    if (origin === "dependency") nodes[a].dependsOn.push(`n${b}`);
    relations.push({
      id: `r${relations.length}`, a: `n${a}`, b: `n${b}`, origin,
      aToB: { kind: "using", explanation: "…" }, bToA: { kind: "none", explanation: "…" },
    });
  }
  const graph = { id: "gbig", name: "Main", nodes, relations };
  const project = { id: "pbig", name: "Big graph", mainId: "gbig", createdAt: 0 };
  return { state: { graphs: { gbig: graph }, projects: { pbig: project }, projectId: "pbig", activeId: "gbig" }, version: 2 };
}

// `node e2e/perf.mjs --dump big.json` just writes the generated workspace (paste it into localStorage "nodestorm").
if (process.argv[2] === "--dump") {
  writeFileSync(process.argv[3], JSON.stringify(bigWorkspace()));
  process.exit(0);
}

if (BUILT) {
  execFileSync("npx", ["vite", "build", "client", "--outDir", "dist-perf", "--emptyOutDir", "--logLevel", "warn"], {
    stdio: "inherit",
    env: { ...process.env, VITE_PERF_HOOKS: "1" },
  });
}
const viteArgs = BUILT ? ["preview", "client", "--outDir", "dist-perf"] : ["client"];
const vite = spawn("npx", ["vite", ...viteArgs, "--port", String(WEB_PORT), "--strictPort"], { stdio: "ignore", detached: true });
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${WEB_PORT}/`)).ok) break; } catch {}
    if (i > 100) throw new Error("vite did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch();
  // No service worker: in the built mode a reload would otherwise be served from its cache.
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  const ws = JSON.stringify(bigWorkspace());
  await page.addInitScript((data) => {
    localStorage.setItem("nodestorm", data);
    localStorage.setItem("nodestorm-view", JSON.stringify({ edgeLabels: true })); // same view for every run
    // The stores and graph operations the sections drive: the perf build's hook, or imported by path from Vite.
    window.__perfStores = async () =>
      window.__nodestormPerf ?? {
        useGraphStore: (await import("/src/store/graphStore.ts")).useGraphStore,
        useView: (await import("/src/store/viewStore.ts")).useView,
        updateNode: (await import("/src/lib/graphOps.ts")).updateNode,
      };
  }, ws);
  // Warm Vite's module cache so the render timing measures React, not on-demand transpiling.
  await page.goto(`http://localhost:${WEB_PORT}/`);
  await page.waitForFunction((n) => document.querySelectorAll(".react-flow__node").length > 0 || n === 0, N);

  const results = {};
  const t0 = Date.now();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__edge").length > 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
  results["initial render (reload → edges painted)"] = Date.now() - t0;
  results["rendered nodes / edges / labels"] = await page.evaluate(() =>
    [".react-flow__node", ".react-flow__edge", ".edge-label"].map((s) => document.querySelectorAll(s).length).join(" / "),
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const taskMs = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value * 1000;
  // PERF_PROFILE=<section> (status, inspect, drag or physics; 1 means drag) prints that section's hottest functions.
  const profiling = (section) => (process.env.PERF_PROFILE === "1" ? "drag" : process.env.PERF_PROFILE) === section;
  const startProfile = async (section) => {
    if (profiling(section)) await cdp.send("Profiler.enable").then(() => cdp.send("Profiler.start"));
  };
  const printProfile = async (section) => {
    if (!profiling(section)) return;
    const { profile: p } = await cdp.send("Profiler.stop");
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const self = new Map();
    p.samples.forEach((id, i) => {
      const f = byId.get(id).callFrame;
      const k = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber}`;
      self.set(k, (self.get(k) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
    });
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v.toFixed(1).padStart(7)} ms  ${k}`);
  };

  // 20 AI-style status updates of one node, each rendered before the next (background mutations, as in actions.ts).
  await startProfile("status");
  let busy0 = await taskMs();
  results["20 status updates of one node"] = await page.evaluate(async () => {
    const { useGraphStore, updateNode } = await window.__perfStores();
    const tick = () => new Promise((r) => setTimeout(r));
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      const status = i % 2 ? "ok" : "checking";
      useGraphStore.getState().mutate((g) => updateNode(g, "n0", { status }), undefined, { history: "background" });
      await tick();
    }
    return Math.round(performance.now() - start);
  });
  results["20 status updates: main-thread busy"] = Math.round((await taskMs()) - busy0);
  await printProfile("status");

  // 20 inspector changes (opening one relation after another, as clicking arrowheads does).
  await startProfile("inspect");
  busy0 = await taskMs();
  results["20 relation inspections"] = await page.evaluate(async () => {
    const { useGraphStore } = await window.__perfStores();
    const tick = () => new Promise((r) => setTimeout(r));
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      useGraphStore.getState().setInspect({ kind: "edge", relationId: `r${i}`, dir: "aToB" });
      await tick();
    }
    useGraphStore.getState().setInspect(null);
    return Math.round(performance.now() - start);
  });
  results["20 relation inspections: main-thread busy"] = Math.round((await taskMs()) - busy0);
  await printProfile("inspect");

  // Drag one node 30 steps. Wall time here is mostly Playwright round trips, so report the renderer's
  // main-thread busy time (Chrome's TaskDuration metric) instead: that is what makes a drag janky.
  const box = await page.getByTestId("node-Concept 150").boundingBox();
  await startProfile("drag");
  busy0 = await taskMs();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2 + i * 4);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  await page.mouse.up();
  results["drag one node 30 steps: main-thread busy"] = Math.round((await taskMs()) - busy0);
  await printProfile("drag");
  const moved = await page.getByTestId("node-Concept 150").boundingBox();
  if (Math.abs(moved.x - box.x) < 100) throw new Error(`the drag did not move the node: ${JSON.stringify([box, moved])}`);

  // Physics on the whole graph for 60 frames: the simulation steps twice a frame and every card moves each frame.
  await page.evaluate(async () => {
    const { useView } = await window.__perfStores();
    useView.getState().setPrefs({ physics: true });
  });
  await startProfile("physics");
  busy0 = await taskMs();
  const frames = await page.evaluate(() => new Promise((r) => {
    const start = performance.now();
    let n = 0;
    const f = () => (++n >= 60 ? r(performance.now() - start) : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }));
  results["physics 60 frames: main-thread busy / frame"] = Math.round(((await taskMs()) - busy0) / 60);
  results["physics 60 frames: wall time"] = Math.round(frames);
  await printProfile("physics");
  await page.evaluate(async () => {
    const { useView } = await window.__perfStores();
    useView.getState().setPrefs({ physics: false });
  });

  // Zoomed in to reading size, only what's on screen is rendered (onlyRenderVisibleElements), labels included.
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(300);
  const zoomed = await page.evaluate(() =>
    [".react-flow__node", ".react-flow__edge", ".edge-label"].map((s) => document.querySelectorAll(s).length).join(" / "),
  );
  results["zoomed in: rendered nodes / edges / labels"] = zoomed;

  console.log(BUILT ? "production build (vite preview)" : "dev server");
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(42)} ${v}${typeof v === "number" ? " ms" : ""}`);
  // Loose sanity bound only: catches a pathological regression, not normal machine-to-machine noise.
  if (results["20 status updates of one node"] > 20000) throw new Error("status updates are pathologically slow");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid); } catch {}
}
