// Rough performance check on a big graph (300 concepts, 600 relations). Not part of `npm run e2e`.
// Usage: node e2e/perf.mjs   (E2E_WEB_PORT picks the Vite port; prints timings, asserts nothing but loose bounds)
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5199);
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
      aToB: { kind: "uses", explanation: "…" }, bToA: { kind: "is used by", explanation: "…" },
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

const vite = spawn("npx", ["vite", "client", "--port", String(WEB_PORT), "--strictPort"], { stdio: "ignore", detached: true });
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${WEB_PORT}/`)).ok) break; } catch {}
    if (i > 100) throw new Error("vite did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  const ws = JSON.stringify(bigWorkspace());
  await page.addInitScript((data) => {
    localStorage.setItem("nodestorm", data);
    localStorage.setItem("nodestorm-view", JSON.stringify({ edgeLabels: true })); // same view for every run
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

  // 20 AI-style status updates of one node, each rendered before the next (background mutations, as in actions.ts).
  results["20 status updates of one node"] = await page.evaluate(async () => {
    const { useGraphStore } = await import("/src/store/graphStore.ts");
    const { updateNode } = await import("/src/lib/graphOps.ts");
    const tick = () => new Promise((r) => setTimeout(r));
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      const status = i % 2 ? "ok" : "checking";
      useGraphStore.getState().mutate((g) => updateNode(g, "n0", { status }), undefined, { history: "background" });
      await tick();
    }
    return Math.round(performance.now() - start);
  });

  // 20 inspector changes (opening one relation after another, as clicking arrowheads does).
  results["20 relation inspections"] = await page.evaluate(async () => {
    const { useGraphStore } = await import("/src/store/graphStore.ts");
    const tick = () => new Promise((r) => setTimeout(r));
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      useGraphStore.getState().setInspect({ kind: "edge", relationId: `r${i}`, dir: "aToB" });
      await tick();
    }
    useGraphStore.getState().setInspect(null);
    return Math.round(performance.now() - start);
  });

  // Drag one node 30 steps. Wall time here is mostly Playwright round trips, so report the renderer's
  // main-thread busy time (Chrome's TaskDuration metric) instead: that is what makes a drag janky.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const taskMs = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value * 1000;
  const box = await page.getByTestId("node-Concept 150").boundingBox();
  const profile = Boolean(process.env.PERF_PROFILE); // print the hottest functions during the drag
  if (profile) await cdp.send("Profiler.enable").then(() => cdp.send("Profiler.start"));
  const busy0 = await taskMs();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2 + i * 4);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  await page.mouse.up();
  results["drag one node 30 steps: main-thread busy"] = Math.round((await taskMs()) - busy0);
  if (profile) {
    const { profile: p } = await cdp.send("Profiler.stop");
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const self = new Map();
    p.samples.forEach((id, i) => {
      const f = byId.get(id).callFrame;
      const k = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber}`;
      self.set(k, (self.get(k) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
    });
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v.toFixed(1).padStart(7)} ms  ${k}`);
  }
  const moved = await page.getByTestId("node-Concept 150").boundingBox();
  if (Math.abs(moved.x - box.x) < 100) throw new Error(`the drag did not move the node: ${JSON.stringify([box, moved])}`);

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
