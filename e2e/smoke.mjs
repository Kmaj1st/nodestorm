// End-to-end smoke test: starts the server (mock AI) + Vite, drives the UI in Chromium.
// Usage: npm run e2e   (screenshots land in e2e/screenshots/)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT || 8799);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5199);
const shots = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

const procs = [];
function start(cmd, args, env) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stderr.on("data", (d) => process.env.DEBUG && process.stderr.write(d));
  procs.push(p);
  return p;
}
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

start("npx", ["tsx", "server/src/index.ts"], { AI_PROVIDER: "mock", PORT: String(SERVER_PORT) });
start("npx", ["vite", "client", "--port", String(WEB_PORT), "--strictPort"], { SERVER_PORT: String(SERVER_PORT) });

let browser;
try {
  await waitFor(`http://localhost:${SERVER_PORT}/api/providers`);
  await waitFor(`http://localhost:${WEB_PORT}/`);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`http://localhost:${WEB_PORT}/`);

  const node = (name) => page.getByTestId(`node-${name}`);
  const addByName = async (name) => {
    await page.getByRole("button", { name: "+ Add concept" }).click();
    await page.getByLabel("Concept name").fill(name);
    await page.getByRole("button", { name: "Add", exact: true }).click();
  };
  // Is the node fully inside the visible canvas? (waits out the pan animation first)
  const inView = async (name) => {
    await page.waitForTimeout(600);
    const [n, c] = await Promise.all([node(name).boundingBox(), page.locator(".react-flow").boundingBox()]);
    return n && c && n.x >= c.x && n.y >= c.y && n.x + n.width <= c.x + c.width && n.y + n.height <= c.y + c.height;
  };

  console.log("AI setup");
  assert((await page.getByRole("button", { name: "AI settings" }).textContent()).includes("Set up AI"), "toolbar asks to set up AI on first visit");
  await page.getByRole("button", { name: "+ Add concept" }).click();
  await page.getByRole("button", { name: "Describe it" }).click();
  await page.getByLabel("Concept description").fill("a map between groups that preserves the operation");
  await page.getByRole("button", { name: "Find a name" }).click();
  await page.getByRole("dialog", { name: "Settings" }).waitFor();
  assert(true, "using AI without a key opens Settings");

  // Fake SiliconFlow so model discovery can be tested without a real key.
  await page.route("https://api.siliconflow.cn/v1/models**", (route) => {
    const auth = route.request().headers()["authorization"];
    if (auth !== "Bearer sk-good") return route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Invalid token"}' });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: "deepseek-ai/DeepSeek-V3" }, { id: "Qwen/Qwen3-32B" }, { id: "moonshotai/Kimi-K2-Instruct" }] }) });
  });
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("API key", { exact: true }).fill("sk-bad");
  await settings.getByTestId("models-error").waitFor();
  assert((await settings.getByTestId("models-error").textContent()).includes("401"), "a wrong key shows an auth error");
  await settings.getByLabel("API key", { exact: true }).fill("sk-good");
  await settings.getByTestId("models-ok").waitFor();
  assert((await settings.getByRole("list", { name: "Available models" }).getByRole("button").count()) === 3, "models discovered from the API");
  await settings.getByLabel("Model", { exact: true }).fill("qwen");
  assert((await settings.getByRole("list", { name: "Available models" }).getByRole("button").count()) === 1, "typing filters the model list");
  await settings.getByRole("button", { name: "Qwen/Qwen3-32B" }).click();
  await page.screenshot({ path: `${shots}0-settings.png` });
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  assert((await page.getByRole("button", { name: "AI settings" }).textContent()).includes("Qwen3-32B"), "toolbar shows chosen provider and model");
  const stored = await page.evaluate(() => localStorage.getItem("nodestorm-settings") ?? "");
  assert(!stored.includes("sk-good") && stored.includes("Qwen/Qwen3-32B"), "key not written to localStorage when 'remember' is off");

  // Saving returns to the Add dialog that triggered setup; close it.
  await page.getByRole("dialog", { name: "Add concept" }).getByRole("button", { name: "Cancel" }).click();

  // Switch to the offline demo provider for the rest of the flow.
  await page.getByRole("button", { name: "AI settings" }).click();
  await settings.getByLabel("Provider", { exact: true }).selectOption("mock");
  await settings.getByRole("button", { name: "Save", exact: true }).click();

  console.log("Naming from a description");
  await page.getByRole("button", { name: "+ Add concept" }).click();
  await page.getByRole("button", { name: "Describe it" }).click();
  await page.getByLabel("Concept description").fill("a map between groups that preserves the operation");
  await page.getByRole("button", { name: "Find a name" }).click();
  await page.getByRole("button", { name: "Use" }).first().click();
  await node("Homomorphism").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="node-Homomorphism"]')?.className.includes("concept--ok"));
  assert(true, "AI named the description 'Homomorphism' and it is ready");

  console.log("Missing dependency blocks a node");
  await addByName("First Isomorphism Theorem");
  const thm = node("First Isomorphism Theorem");
  await page.waitForFunction(() => document.querySelector('[data-testid="node-First Isomorphism Theorem"]')?.className.includes("concept--blocked"));
  assert(true, "theorem is blocked");
  assert((await thm.textContent()).includes("missing: Isomorphism"), "missing dependency is Isomorphism");
  assert(await page.getByRole("button", { name: /Mix/ }).isDisabled(), "Mix disabled (nothing / blocked selected)");
  await page.screenshot({ path: `${shots}1-blocked.png` });

  console.log("Install the dependency");
  await page.getByTestId("install-Isomorphism").click();
  await node("Isomorphism").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="node-First Isomorphism Theorem"]')?.className.includes("concept--ok"));
  assert(true, "theorem unblocked after installing Isomorphism");
  await page.waitForFunction(() => document.querySelector('[data-testid="node-Isomorphism"]')?.className.includes("concept--ok"));
  assert(true, "installed Isomorphism had its own deps checked (Homomorphism already present)");
  assert((await page.locator(".react-flow__edge").count()) === 3, "3 dependency edges drawn");
  assert(await inView("Isomorphism"), "installed node placed in view");
  await page.screenshot({ path: `${shots}2-installed.png` });

  console.log("Click both arrowheads of a relation");
  const arrows = page.locator('[data-testid^="arrow-"]');
  const aToB = arrows.filter({ has: page.locator("polygon") }).first();
  const relId = (await aToB.getAttribute("data-testid")).split("-").slice(1, -1).join("-");
  await page.getByTestId(`arrow-${relId}-aToB`).click({ force: true });
  const exp1 = await page.getByTestId("relation-explanation").textContent();
  await page.getByTestId(`arrow-${relId}-bToA`).click({ force: true });
  const exp2 = await page.getByTestId("relation-explanation").textContent();
  assert(exp1 && exp2 && exp1 !== exp2, `two directions differ:\n      A→B: ${exp1}\n      B→A: ${exp2}`);

  console.log("Mix two nodes");
  await node("Homomorphism").click();
  await node("First Isomorphism Theorem").click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: /Mix/ }).click();
  await page.getByTestId("relation-panel").waitFor();
  const panel = await page.getByTestId("relation-panel").textContent();
  assert(panel.includes("Mixed relation"), "mix result shown in relation panel");
  await page.screenshot({ path: `${shots}3-mixed.png` });

  console.log("Sandbox: fork, derive, merge");
  await page.getByRole("button", { name: "Fork sandbox" }).click();
  await page.getByTestId("sandbox-banner").waitFor();
  await node("Homomorphism").click();
  await page.getByRole("button", { name: /Derive/ }).click();
  await page.getByRole("button", { name: "Accept" }).first().click();
  await page.getByRole("button", { name: "Close" }).click();
  await node("Kernel").waitFor();
  assert(true, "derived 'Kernel' inside the sandbox");
  assert(await inView("Kernel"), "accepted proposal placed in view");
  await page.screenshot({ path: `${shots}4-sandbox.png` });
  await page.getByLabel("Graph").selectOption({ label: "Main graph" });
  await page.waitForTimeout(300);
  assert((await node("Kernel").count()) === 0, "main graph unaffected by sandbox");
  await page.getByLabel("Graph").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Merge back" }).click();
  await node("Kernel").waitFor();
  assert((await page.getByTestId("sandbox-banner").count()) === 0, "merged back into main graph, which now has Kernel");

  console.log("Server mode");
  await page.getByRole("button", { name: "AI settings" }).click();
  await settings.getByText("Through the local NodeStorm server").click();
  await settings.getByTestId("models-ok").waitFor();
  assert(true, "server mode discovers models through the local server");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByTestId(`arrow-${relId}-aToB`).click({ force: true });
  await page.getByRole("button", { name: "Re-analyze with AI" }).click();
  await page.waitForFunction(() => !document.querySelector(".status"));
  const toastText = (await page.locator(".toast").count()) ? await page.locator(".toast").textContent() : "";
  assert(toastText === "", `AI calls work through the server ${toastText}`);

  console.log("Persistence");
  await page.reload();
  await node("Kernel").waitFor();
  assert((await page.locator(".react-flow__node").count()) === 4, "graph survives reload (localStorage)");
  await page.screenshot({ path: `${shots}5-merged.png` });

  const openSettings = async () => {
    await page.getByRole("button", { name: "AI settings" }).click();
    return page.getByRole("dialog", { name: "Settings" });
  };
  const badge = (name) => node(name).locator(".concept__badge");
  const waitBadge = (name, text, timeout = 15000) =>
    page.waitForFunction(
      ([n, t]) => document.querySelector(`[data-testid="node-${n}"] .concept__badge`)?.textContent === t,
      [name, text],
      { timeout },
    );

  console.log("Layout");
  await page.getByRole("button", { name: "Tidy" }).click();
  await page.waitForTimeout(700);
  const top = async (name) => (await node(name).boundingBox()).y;
  assert(await top("Homomorphism") < await top("Isomorphism"), "Tidy puts Homomorphism above Isomorphism");
  assert(await top("Isomorphism") < await top("First Isomorphism Theorem"), "…and Isomorphism above First Isomorphism Theorem");
  const saved = await page.evaluate(() => localStorage.getItem("nodestorm") ?? "");
  const savedGraphs = JSON.parse(saved).state.graphs;
  assert(Object.values(savedGraphs).some((g) => g.nodes.some((n) => n.name === "Homomorphism" && n.position.y === 0)), "tidied positions are saved");
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+k");
  const find = page.getByRole("dialog", { name: "Find concept" });
  await find.getByRole("combobox").fill("frst iso");
  assert((await find.getByRole("option").first().textContent()).includes("First Isomorphism Theorem"), "Ctrl+K fuzzy-finds a concept");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="node-First Isomorphism Theorem"]')?.className.includes("concept--selected"));
  assert((await find.count()) === 0 && (await page.getByTestId("node-panel").textContent()).includes("First Isomorphism Theorem"), "Enter selects it and opens it in the inspector");
  assert(await inView("First Isomorphism Theorem"), "view centred on the found concept");
  await page.screenshot({ path: `${shots}5b-tidy.png` });

  console.log("Ambiguous names");
  {
    const st = await openSettings();
    await st.getByText("Directly from this browser").click();
    await st.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st.getByLabel("Number of meanings to offer").fill("4");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  await addByName("Expectation");
  const what = page.getByRole("dialog", { name: "What do you mean?" });
  await what.waitFor();
  assert((await what.getByRole("radio").count()) === 5, "dialog offers the configured 4 meanings + 'something else'");
  await page.screenshot({ path: `${shots}6-what-do-you-mean.png` });
  await what.getByRole("button", { name: "Later" }).click();
  await waitBadge("Expectation", "what do you mean?");
  assert(await page.getByRole("button", { name: /Mix/ }).isDisabled(), "unclear concept can't be mixed yet");
  await badge("Expectation").click();
  await what.getByText("Expectation (probability)").click();
  await what.getByRole("button", { name: "Use this meaning" }).click();
  await waitBadge("Expectation (probability)", "ready");
  assert(true, "picking a meaning renames the node and continues the analysis");
  assert((await page.getByTestId("node-panel").textContent()).includes("also: Expectation"), "original name kept as alias");

  console.log("Failures");
  let chatMode = "hang";
  await page.route("https://api.siliconflow.cn/v1/chat/completions", async (route) => {
    if (chatMode === "hang") return; // never answer
    const body = route.request().postData() ?? "";
    const content = body.includes("[task:clarify]")
      ? { ambiguous: false, senses: [{ name: "Group", domain: "algebra", definition: "A set with an associative operation, identity and inverses." }] }
      : { prerequisites: [] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) });
  });
  {
    const st = await openSettings();
    await st.getByLabel("Provider", { exact: true }).selectOption("siliconflow");
    await st.getByLabel("API key", { exact: true }).fill("sk-good");
    await st.getByLabel("Request timeout (seconds)").fill("10");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  await addByName("Group");
  await page.getByTestId("task").first().waitFor();
  assert(true, "running check is visible in the status bar");
  await waitBadge("Group", "failed – retry", 15000);
  await page.locator(".toast").waitFor();
  assert((await page.locator(".toast").textContent()).includes("didn't respond within 10s"), "a hanging request times out with a clear error");
  await page.screenshot({ path: `${shots}7-timeout.png` });
  await page.locator(".toast").click();

  await addByName("Ring");
  await page.getByTestId("task").first().waitFor();
  await page.getByRole("button", { name: /^Cancel:/ }).click();
  await waitBadge("Ring", "failed – retry", 3000);
  assert((await page.getByTestId("task").count()) === 0 && (await page.locator(".toast").count()) === 0, "cancel stops the task without an error toast");

  await addByName("Field");
  await page.reload();
  await waitBadge("Field", "failed – retry", 5000);
  assert(true, "a check interrupted by reload shows as failed, not ready");

  chatMode = "ok";
  await badge("Group").click();
  await waitBadge("Group", "ready");
  assert(true, "retry succeeds once the API answers");

  console.log("\nE2E passed");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const p of procs) try { process.kill(-p.pid); } catch {}
}
