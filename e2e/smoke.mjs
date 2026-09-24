// End-to-end smoke test: starts the server (mock AI) + Vite, drives the UI in Chromium.
// Usage: npm run e2e   (screenshots land in e2e/screenshots/)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
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
  // A context (not browser.newPage) so the share-link section can open a second page with the same storage.
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "en-US" });
  // The run starts in English whatever the machine's language (the selectors below are English); the 中文 section at
  // the end switches the interface language itself, and that choice is kept across its reloads.
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem("nodestorm-ui-language")) localStorage.setItem("nodestorm-ui-language", "en");
    } catch {}
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`http://localhost:${WEB_PORT}/`);
  // A first visit shows the welcome card (the Onboarding section below tests it); it doesn't block the toolbar.
  await page.getByTestId("welcome").waitFor();

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
  assert((await page.getByRole("button", { name: "Settings", exact: true }).textContent()).includes("Set up AI"), "toolbar asks to set up AI on first visit");
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
  assert((await page.getByRole("button", { name: "Settings", exact: true }).textContent()).includes("Qwen3-32B"), "toolbar shows the chosen model");
  const stored = await page.evaluate(() => localStorage.getItem("nodestorm-settings") ?? "");
  assert(!stored.includes("sk-good") && stored.includes("Qwen/Qwen3-32B"), "key not written to localStorage when 'remember' is off");

  // Saving returns to the Add dialog that triggered setup; close it.
  await page.getByRole("dialog", { name: "Add concept" }).getByRole("button", { name: "Cancel" }).click();

  // Switch to the offline demo provider for the rest of the flow.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
  const exp1 = await page.getByTestId("relation-explanation").inputValue();
  await page.getByTestId(`arrow-${relId}-bToA`).click({ force: true });
  const exp2 = await page.getByTestId("relation-explanation").inputValue();
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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

  console.log("Export");
  const exportAs = async (label) => {
    await page.getByRole("button", { name: "File ▾" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
    return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
  };
  const md = await exportAs("Markdown notes");
  const mdText = md.data.toString("utf8");
  assert(md.name.endsWith(".md") && mdText.includes("### Homomorphism"), "Markdown notes contain the concepts");
  assert(
    mdText.includes("- First Isomorphism Theorem → Isomorphism: derives") &&
      mdText.includes("- Isomorphism → First Isomorphism Theorem: is derived by"),
    "Markdown describes a relation in both directions",
  );
  const mmd = await exportAs("Mermaid diagram");
  assert(mmd.data.toString("utf8").startsWith("flowchart"), "Mermaid export is a flowchart");
  assert((await page.locator(".toast").getAttribute("class")).includes("toast--info"), "confirmations use the neutral notice style, not error red");
  await page.locator(".toast").click(); // "copied/downloaded" notice
  const png = await exportAs("PNG image");
  writeFileSync(`${shots}8-export.png`, png.data);
  assert(png.name.endsWith(".png") && png.data.subarray(1, 4).toString() === "PNG" && png.data.length > 5000, "PNG image of the canvas");

  console.log("Undo & editing");
  const undoBtn = page.getByRole("button", { name: "Undo", exact: true });
  assert(await undoBtn.isDisabled(), "undo history is not persisted (nothing to undo after reload)");
  const edgeCount = () => page.locator(".react-flow__edge").count();
  const edgesBefore = await edgeCount();
  await node("Homomorphism").click();
  await page.keyboard.press("Delete");
  await node("Homomorphism").waitFor({ state: "detached" });
  assert((await edgeCount()) < edgesBefore, "Delete removes the selected node and its edges");
  await page.keyboard.press("Control+z");
  await node("Homomorphism").waitFor();
  await page.waitForFunction((n) => document.querySelectorAll(".react-flow__edge").length === n, edgesBefore);
  assert(true, "Ctrl+Z brings it back with its edges");
  await page.keyboard.press("Control+Shift+z");
  await node("Homomorphism").waitFor({ state: "detached" });
  await undoBtn.click();
  await node("Homomorphism").waitFor();
  assert(!(await page.getByRole("button", { name: "Redo", exact: true }).isDisabled()), "redo and the ↶ button work too");

  await node("Kernel").click();
  const rename = page.getByLabel("Rename concept");
  await rename.fill("Isomorphism");
  await rename.press("Enter");
  assert((await page.getByTestId("node-panel").getByRole("alert").textContent()).includes("already in the graph"), "renaming to an existing name is rejected");
  await rename.fill("Kernel of a homomorphism");
  await rename.press("Enter");
  await node("Kernel of a homomorphism").waitFor();
  assert((await page.getByTestId("node-panel").textContent()).includes("also: ker, Kernel"), "rename keeps the old name as an alias");

  await page.getByTestId(`arrow-${relId}-aToB`).click({ force: true });
  const explanation = page.getByTestId("relation-explanation");
  await explanation.fill("Edited by hand.");
  await explanation.press("Enter");
  await page.getByTestId(`arrow-${relId}-bToA`).click({ force: true });
  await page.getByTestId(`arrow-${relId}-aToB`).click({ force: true });
  assert((await explanation.inputValue()) === "Edited by hand.", "relation explanation edited by hand");
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await page.getByTestId(`arrow-${relId}-aToB`).click({ force: true });
  assert((await explanation.inputValue()) !== "Edited by hand.", "the edit is undoable");
  await page.keyboard.press("Control+y");
  await page.screenshot({ path: `${shots}5b-edited.png` });

  const openSettings = async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
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
  // The inspector title is an editable name field, so read its value rather than the panel's text.
  assert(
    (await find.count()) === 0 && (await page.getByLabel("Rename concept").inputValue()) === "First Isomorphism Theorem",
    "Enter selects it and opens it in the inspector",
  );
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
  let rateLimitOnce = false;
  const chatBodies = [];
  await page.route("https://api.siliconflow.cn/v1/chat/completions", async (route) => {
    if (chatMode === "hang") return; // never answer
    const body = route.request().postData() ?? "";
    chatBodies.push(body);
    if (rateLimitOnce) {
      rateLimitOnce = false;
      const headers = { "retry-after": "1", "access-control-expose-headers": "retry-after" };
      return route.fulfill({ status: 429, headers, contentType: "application/json", body: '{"message":"rate limited"}' });
    }
    const content = body.includes("[task:clarify]")
      ? { ambiguous: false, senses: [{ name: "Group", domain: "algebra", definition: "A set with an associative operation, identity and inverses." }] }
      : { prerequisites: [] };
    const reply = { choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 1234 } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply) });
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

  console.log("Dependency tools");
  {
    const st = await openSettings();
    await st.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  const pathSteps = () => page.getByTestId("learning-path").locator("li").allTextContents();
  // Mock KB: Quotient group → Group (present), Normal subgroup → Subgroup → Group.
  await addByName("Quotient Group");
  await waitBadge("Quotient Group", "blocked");
  assert(
    JSON.stringify(await pathSteps()) === JSON.stringify(["Group", "Normal subgroup missing", "Quotient Group"]),
    "learning path lists the present prerequisite and marks the missing one",
  );
  await page.getByTestId("install-all").click();
  const confirm = page.getByRole("dialog", { name: "Install all missing" });
  assert((await confirm.locator("li").allTextContents()).join() === "Normal subgroup", "confirm popover lists the depth-1 install");
  await confirm.getByTestId("install-all-confirm").click();
  await waitBadge("Quotient Group", "ready");
  await waitBadge("Normal subgroup", "ready");
  await waitBadge("Subgroup", "ready");
  assert(true, "install-all reached depth 2 (Normal subgroup → Subgroup) and unblocked the chain");
  await page.locator(".toast").waitFor();
  assert((await page.locator(".toast").textContent()).includes("Installed 2 prerequisites of Quotient Group (2 levels)"), "the run is summarised");
  await page.locator(".toast").click();
  const steps = await pathSteps();
  assert(
    JSON.stringify(steps) === JSON.stringify(["Group", "Subgroup", "Normal subgroup", "Quotient Group"]),
    `learning path in study order: ${steps.join(" → ")}`,
  );
  const wrapper = (name) => page.locator(".react-flow__node", { has: node(name) });
  await page.getByTestId("highlight-path").click();
  assert((await wrapper("Subgroup").getAttribute("class")).includes("path-on"), "highlight marks the chain on the canvas");
  assert((await wrapper("Homomorphism").getAttribute("class")).includes("path-dim"), "highlight dims unrelated nodes");
  assert((await page.locator(".react-flow__edge.path-on").count()) === 4, "the 4 dependency links of the chain are highlighted");
  await page.screenshot({ path: `${shots}8-learning-path.png` });
  await page.getByTestId("highlight-path").click();
  assert((await page.locator(".path-on, .path-dim").count()) === 0, "toggling highlight off restores the canvas");

  // Simulate a wrong AI answer that makes Group depend on Quotient Group (which depends on Group).
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("nodestorm"));
    const g = saved.state.graphs[saved.state.activeId];
    const id = (name) => g.nodes.find((n) => n.name === name).id;
    g.nodes.find((n) => n.name === "Group").dependsOn.push(id("Quotient Group"));
    localStorage.setItem("nodestorm", JSON.stringify(saved));
  });
  await page.reload();
  await node("Group").waitFor();
  assert((await node("Group").getAttribute("class")).includes("concept--cycle"), "nodes on a dependency cycle are flagged");
  await page.locator(".relation--cycle").first().waitFor({ state: "attached", timeout: 5000 });
  // Both loops are flagged: Group ⇄ Quotient Group, and Group → Quotient Group → Normal subgroup → Subgroup → Group.
  assert((await page.locator(".relation--cycle").count()) === 4, "every dependency link on a cycle is flagged");
  await node("Group").click();
  const cyc = page.getByTestId("cycle-warning");
  assert((await cyc.textContent()).includes("Group → Quotient Group → Group"), "inspector explains the cycle");
  await page.screenshot({ path: `${shots}9-cycle.png` });
  await cyc.getByTestId("remove-link-Group-Quotient Group").click();
  assert((await page.getByTestId("cycle-warning").count()) === 0 && (await page.locator(".concept--cycle, .relation--cycle").count()) === 0, "'remove this link' breaks the cycle");
  assert((await page.getByTestId("node-panel").textContent()).includes("Needed by"), "the correct direction (Quotient Group needs Group) is kept");

  console.log("Theme & a11y");
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const isDark = (css) => css.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b) / 3 < 64;
  assert(!isDark(await bodyBg()), "light theme by default (the browser prefers light)");
  {
    // The theme lives in Settings (Interface), next to the interface language.
    const st = await openSettings();
    await st.getByLabel("Theme", { exact: true }).selectOption("dark");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  assert(isDark(await bodyBg()), "switching to Dark darkens the page background");
  await page.screenshot({ path: `${shots}9-dark.png` });
  await page.reload();
  await node("Group").waitFor();
  {
    const st = await openSettings();
    const remembered = (await st.getByLabel("Theme", { exact: true }).inputValue()) === "dark";
    await st.getByRole("button", { name: "Cancel" }).click();
    assert(isDark(await bodyBg()) && remembered, "dark theme is remembered after reload");
  }

  const addBtn = page.getByRole("button", { name: "+ Add concept" });
  await addBtn.click();
  const addDialog = page.getByRole("dialog", { name: "Add concept" });
  await addDialog.waitFor();
  assert((await addDialog.getAttribute("aria-modal")) === "true", "dialogs are aria-modal");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Tab");
  assert(await addDialog.evaluate((el) => el.contains(document.activeElement)), "Tab keeps focus inside the dialog");
  await page.keyboard.press("Escape");
  await addDialog.waitFor({ state: "detached" });
  assert(await addBtn.evaluate((el) => el === document.activeElement), "Escape closes Add concept and focus returns to its button");

  await page.locator('[data-testid^="arrow-"]').first().focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("relation-panel").waitFor();
  assert(true, "an arrowhead opens its relation from the keyboard");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert(await noHScroll(), "no horizontal scroll at 390px");
  const fileMenu = page.getByRole("button", { name: "File ▾" });
  assert(!(await fileMenu.isVisible()), "less-used toolbar controls fold into a menu");
  await page.getByRole("button", { name: "More tools" }).click();
  assert((await fileMenu.isVisible()) && (await noHScroll()), "the menu opens them, still without horizontal scroll");
  await page.screenshot({ path: `${shots}9-mobile.png` });
  await page.getByRole("button", { name: "Hide details" }).click();
  assert((await page.getByTestId("relation-panel").isHidden()), "the inspector bottom sheet collapses");
  await page.getByRole("button", { name: "Show details" }).click();
  await addBtn.click();
  const box = await addDialog.boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 390 && (await noHScroll()), "Add concept dialog fits the phone screen");
  await page.screenshot({ path: `${shots}9-mobile-dialog.png` });
  await page.keyboard.press("Escape");

  console.log("Rate limits, answer language, queue");
  {
    const st = await openSettings();
    // Earlier sections may have switched to the offline demo; this one talks to the routed SiliconFlow.
    await st.getByLabel("Provider", { exact: true }).selectOption("siliconflow");
    await st.getByLabel("AI answers in").selectOption({ label: "中文" });
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  chatBodies.length = 0;
  rateLimitOnce = true;
  await addByName("Monoid");
  await waitBadge("Monoid", "ready", 15000);
  assert(chatBodies.length >= 3 && (await page.locator(".toast").count()) === 0, "a 429 is retried after Retry-After; node ends up ready, no error toast");
  assert(chatBodies.every((b) => b.includes("Output language") && b.includes("Chinese (中文)")), "the 中文 setting puts the language instruction into the prompt");
  {
    const st = await openSettings();
    assert(/This session: ~[\d.]+k tokens/.test(await st.getByTestId("token-usage").textContent()), "token usage of this session shown in Settings");
    await st.getByLabel("Concurrent AI requests").fill("1");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  chatMode = "hang";
  await addByName("Semigroup");
  await addByName("Lattice");
  const queuedTask = page.locator('[data-testid="task"][data-state="queued"]');
  await queuedTask.waitFor();
  assert((await queuedTask.textContent()).includes("queued") && (await page.getByTestId("task").count()) === 2, "with a limit of 1 the second AI call waits as 'queued'");
  await queuedTask.getByRole("button", { name: /^Cancel:/ }).click();
  await waitBadge("Lattice", "failed – retry", 3000);
  assert((await page.getByTestId("task").count()) === 1, "a queued call can be cancelled");
  await page.getByRole("button", { name: /^Cancel:/ }).click();
  await waitBadge("Semigroup", "failed – retry", 3000);

  console.log("Projects");
  const projectButton = page.getByRole("button", { name: /^Project: / });
  const projectMenu = async (item) => {
    await projectButton.click();
    // Commands are menuitems; projects (other than the current one, marked ✓) are menuitemradios.
    const role = ["New project", "Rename…", "Duplicate", "Delete…"].includes(item) ? "menuitem" : "menuitemradio";
    await page.getByRole("menu", { name: "Projects" }).getByRole(role, { name: item, exact: true }).click();
  };
  const nodeCount = () => page.locator(".react-flow__node").count();
  assert((await projectButton.getAttribute("aria-label")) === "Project: My brainstorm", "existing work lives in the first project");
  const firstCount = await nodeCount();
  await projectMenu("New project");
  await page.getByLabel("Project name").press("Enter"); // keep the suggested name
  await page.locator(".canvas__empty").waitFor();
  assert((await nodeCount()) === 0 && (await projectButton.getAttribute("aria-label")) === "Project: Untitled project", "a new project starts with an empty canvas");
  assert((await page.getByLabel("Graph").locator("option").count()) === 1, "the graph selector lists only this project's graphs");
  await page.getByRole("button", { name: "Load example: Group theory" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 7);
  assert((await projectButton.getAttribute("aria-label")) === "Project: Group theory", "the example builds 7 concepts offline and names the project");
  assert((await node("First Isomorphism Theorem").textContent()).includes("missing: Isomorphism"), "the example has a blocked concept to install");
  await node("First Isomorphism Theorem").click();
  await page.getByTestId("install-Isomorphism").click();
  await waitBadge("First Isomorphism Theorem", "ready");
  assert((await nodeCount()) === 8, "installing the missing prerequisite unblocks it");
  await page.screenshot({ path: `${shots}10-example.png` });

  await projectMenu("My brainstorm");
  await node("Quotient Group").waitFor();
  assert((await nodeCount()) === firstCount, "switching back shows the first project's concepts");
  await projectMenu("Rename…");
  await page.getByLabel("Project name").fill("Algebra notes");
  await page.getByLabel("Project name").press("Enter");
  await page.reload();
  await node("Quotient Group").waitFor();
  assert((await projectButton.getAttribute("aria-label")) === "Project: Algebra notes", "rename survives reload");

  await projectMenu("Group theory");
  await node("Kernel").waitFor();
  page.once("dialog", (d) => d.accept());
  await projectMenu("Delete…");
  await node("Quotient Group").waitFor();
  await projectButton.click();
  const left = await page.getByRole("menu", { name: "Projects" }).getByRole("menuitemradio").allTextContents();
  assert(JSON.stringify(left) === JSON.stringify(["✓ Algebra notes"]), "deleting the example project leaves only the first one, now current");
  await page.keyboard.press("Escape");

  console.log("Explain & notes");
  await page.setViewportSize({ width: 1400, height: 900 });
  {
    const st = await openSettings();
    // Earlier sections switched to the routed SiliconFlow (which now hangs); use the offline demo here.
    await st.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  const findAndOpen = async (query) => {
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+k");
    await find.getByRole("combobox").fill(query);
    const first = await find.getByRole("option").first().textContent();
    await page.keyboard.press("Enter");
    return first;
  };
  await findAndOpen("Homomorphism");
  const nodePanel = page.getByTestId("node-panel");
  await nodePanel.getByLabel("Explanation level").selectOption("example-driven");
  await nodePanel.getByTestId("explain-button").click();
  const summary = nodePanel.getByTestId("explanation-summary");
  await summary.waitFor();
  const summaryText = await summary.textContent();
  assert(summaryText.includes("preserves the operations"), "Explain more shows a summary for Homomorphism");
  const explainText = await nodePanel.getByTestId("explain").textContent();
  assert(
    explainText.includes("Example-driven explanation") && explainText.includes("Exponential map") && explainText.includes("Pitfalls"),
    "the explanation shows its level, examples and pitfalls",
  );
  assert((await nodePanel.getByTestId("explain-button").textContent()) === "Regenerate", "the button now offers Regenerate");
  await nodePanel.locator(".explain summary").click();
  assert(await summary.isHidden(), "the explanation collapses");
  await nodePanel.locator(".explain summary").click();
  await page.screenshot({ path: `${shots}10-explain.png` });
  const definition = nodePanel.getByTestId("definition");
  // The offline summary is the KB definition the node already has, so change that first. (Compared as source text:
  // the summary on screen has its formula typeset.)
  const summarySource = await definition.inputValue();
  await definition.fill("A structure-preserving map.");
  await nodePanel.getByTestId("use-summary").click();
  assert((await definition.inputValue()) === summarySource, "'Use summary as definition' copies the summary");
  assert(await nodePanel.getByTestId("use-summary").isDisabled(), "…and is disabled once they match");

  const notes = nodePanel.getByTestId("notes");
  await notes.pressSequentially("Compare with zebra stripes");
  assert((await notes.inputValue()) === "Compare with zebra stripes", "a note can be typed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert((await notes.inputValue()) === "", "one undo removes the whole typed note");
  assert((await definition.inputValue()) === summarySource, "…and leaves the earlier definition change alone");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert((await notes.inputValue()) === "Compare with zebra stripes", "redo brings the note back");

  await page.reload();
  await node("Homomorphism").waitFor();
  const hit = await findAndOpen("zebra");
  assert(hit.includes("Homomorphism") && hit.includes("note:"), "Ctrl+K finds the concept by a word in its note");
  assert((await page.getByLabel("Rename concept").inputValue()) === "Homomorphism", "…and opens it");
  assert(
    (await summary.textContent()) === summaryText && (await notes.inputValue()) === "Compare with zebra stripes",
    "explanation and notes survive a reload",
  );

  console.log("Share link");
  await page.setViewportSize({ width: 1400, height: 900 });
  const sharedCount = await nodeCount();
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("menuitem", { name: "Share link…" }).click();
  const link = await page.getByTestId("share-link").inputValue();
  assert(link.includes("#share=1.") && /[\d,]+ characters/.test(await page.getByTestId("share-size").textContent()), "Share link… shows the link and its length");
  await page.keyboard.press("Escape");
  {
    // Same browser context, so the recipient here has this browser's projects too: they must stay untouched.
    const viewer = await context.newPage();
    viewer.on("pageerror", (e) => console.error("pageerror:", e.message));
    await viewer.goto(`http://localhost:${WEB_PORT}/#share=1.not-a-real-link`);
    await viewer.locator(".toast").waitFor();
    assert(
      (await viewer.locator(".toast").textContent()).includes("Couldn't open the shared link") &&
        (await viewer.getByRole("button", { name: "+ Add concept" }).isVisible()),
      "a corrupt link shows an error and the normal app",
    );
    await viewer.goto(link); // only the hash changes: opened via hashchange
    await viewer.getByTestId("viewer-banner").waitFor();
    assert((await viewer.getByTestId("viewer-banner").textContent()).includes("Viewing a shared graph"), "opening the link shows the viewer banner");
    await viewer.waitForFunction((n) => document.querySelectorAll(".react-flow__node").length === n, sharedCount);
    assert(true, `the shared graph has the same ${sharedCount} concepts`);
    assert((await viewer.getByRole("button", { name: "+ Add concept" }).count()) === 0 && !(await viewer.getByRole("button", { name: /^Project: / }).count()), "editing controls and the project menu are hidden");
    await viewer.getByTestId("node-Quotient Group").click();
    await viewer.getByTestId("node-panel").waitFor();
    assert(
      (await viewer.getByLabel("Rename concept").getAttribute("readonly")) !== null &&
        !(await viewer.getByTestId("node-panel").getByRole("button", { name: "Delete", exact: true }).isVisible()),
      "the inspector is read-only",
    );
    assert(
      (await viewer.getByTestId("notes").getAttribute("readonly")) !== null &&
        !(await viewer.getByTestId("explain-button").isVisible()),
      "notes and Explain more can't be used in the viewer",
    );
    await viewer.screenshot({ path: `${shots}11-shared-viewer.png` });
    await viewer.getByRole("button", { name: "Save a copy" }).click();
    await viewer.getByTestId("viewer-banner").waitFor({ state: "detached" });
    const viewerProject = viewer.getByRole("button", { name: /^Project: / });
    assert(
      (await viewerProject.getAttribute("aria-label")) === "Project: Algebra notes 2" && (await viewer.locator(".react-flow__node").count()) === sharedCount,
      "Save a copy adds a new project with those concepts",
    );
    assert(!new URL(viewer.url()).hash && (await viewer.getByRole("button", { name: "+ Add concept" }).isEnabled()), "the link is cleared from the address bar and the copy is editable");
    await viewerProject.click();
    const all = await viewer.getByRole("menu", { name: "Projects" }).getByRole("menuitemradio").allTextContents();
    assert(JSON.stringify(all) === JSON.stringify(["Algebra notes", "✓ Algebra notes 2"]), "the original project is still there");
    await viewer.close();
  }

  console.log("Focus & filters");
  await page.setViewportSize({ width: 1400, height: 900 });
  await projectMenu("New project");
  await page.getByLabel("Project name").press("Enter");
  await page.getByRole("button", { name: "Load example: Group theory" }).click();
  // Group theory: 7 concepts, 9 dependency links + 2 mixed relations; only First Isomorphism Theorem isn't ready.
  const waitCounts = (want) => page.waitForFunction((w) =>
    [".react-flow__node", ".react-flow__edge"].map((s) => document.querySelectorAll(s).length).join("/") === w, want, { timeout: 5000 });
  await waitCounts("7/11");
  const focusButton = page.getByRole("button", { name: "Focus", exact: true });
  assert(await focusButton.isDisabled(), "Focus needs a selected concept");
  await node("Kernel").click();
  await page.keyboard.press("f");
  await page.getByTestId("focus-bar").waitFor();
  await waitCounts("4/4");
  assert((await node("Group").count()) === 0 && (await node("Normal subgroup").isVisible()),
    "F focuses on Kernel: 1 hop shows its neighbours (via any relation) and hides a far concept (Group)");
  await page.screenshot({ path: `${shots}11-focus.png` });
  await node("Homomorphism").click();
  await page.waitForFunction(() => document.querySelector(".focus-bar")?.textContent.includes("Homomorphism"));
  await node("Group").waitFor();
  assert((await node("Normal subgroup").count()) === 0, "selecting another concept re-centres the focus on it");
  await page.getByLabel("Focus radius").selectOption("2");
  await waitCounts("7/11");
  assert(await node("Normal subgroup").isVisible(), "2 hops from Homomorphism reach the whole example");
  await page.getByLabel("Focus radius").selectOption("1");
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await waitCounts("7/11");
  assert((await page.getByTestId("focus-bar").count()) === 0, "Esc leaves focus mode and shows everything again");
  await node("Kernel").click();
  await focusButton.click();
  await waitCounts("4/4");
  await page.getByRole("button", { name: "Leave focus mode" }).click();
  await waitCounts("7/11");
  assert(true, "the toolbar button and the ✕ of the focus control do the same");

  const viewMenu = async () => {
    if (!(await page.getByRole("dialog", { name: "View" }).isVisible())) await page.getByRole("button", { name: /^View/ }).click();
    return page.getByRole("dialog", { name: "View" });
  };
  await (await viewMenu()).getByRole("checkbox", { name: "Dependency links" }).uncheck();
  await waitCounts("7/2");
  assert((await page.locator(".relation--dependency").count()) === 0, "the View filter hides dependency links (concepts stay)");
  assert((await page.getByRole("button", { name: /^View/ }).textContent()).includes("•"), "the View button shows that a filter is on");
  await (await viewMenu()).getByRole("checkbox", { name: "Dependency links" }).check();
  await page.keyboard.press("Escape"); // the popover would cover Group
  // Group is selected and ready: the to-do view hides it, and then Delete must not remove it.
  await node("Group").click();
  await (await viewMenu()).getByRole("checkbox", { name: /To-do only/ }).check();
  await waitCounts("1/0");
  assert(await node("First Isomorphism Theorem").isVisible(), "the to-do view shows only the concept that isn't ready");
  await page.keyboard.press("Escape"); // closes the popover
  // Nothing has focus now, so Delete reaches the app's handler (as on the canvas).
  const deleteReachesApp = await page.evaluate(() => document.activeElement === document.body);
  await page.keyboard.press("Delete");
  // Finding a concept the to-do view hides turns that view off instead of selecting something invisible.
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Find concept" }).getByRole("combobox").fill("Group");
  await page.keyboard.press("Enter");
  await waitCounts("7/11");
  assert(deleteReachesApp, "Delete doesn't remove a selected concept the to-do view hid");
  // Find focuses on the next frame, once the revealed node is rendered.
  await page.waitForFunction(() => document.querySelector('[aria-label="Rename concept"]')?.value === "Group");
  assert(
    (await node("Group").isVisible()) && (await page.getByLabel("Rename concept").inputValue()) === "Group",
    "Find reveals a concept the to-do view was hiding",
  );
  await (await viewMenu()).getByRole("checkbox", { name: "Relation labels" }).uncheck();
  await page.keyboard.press("Escape");
  await page.reload();
  await waitCounts("7/11");
  assert((await page.locator(".edge-label").count()) === 0 && !(await (await viewMenu()).getByRole("checkbox", { name: "Relation labels" }).isChecked()),
    "view preferences survive a reload");
  await (await viewMenu()).getByRole("checkbox", { name: "Relation labels" }).check();
  await page.keyboard.press("Escape");
  await page.locator(".edge-label").first().waitFor();

  console.log("Shortcuts & offline");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("?");
  await help.waitFor();
  const helpText = await help.textContent();
  assert(helpText.includes("Undo") && helpText.includes("Ctrl+Z") && helpText.includes("Ctrl+K"), "? opens the shortcuts dialog, listing Undo");
  await page.keyboard.press("Escape");
  await help.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Keyboard shortcuts (?)" }).click();
  await help.waitFor();
  await page.screenshot({ path: `${shots}12-shortcuts.png` });
  await help.getByRole("button", { name: "Close" }).click();
  await help.waitFor({ state: "detached" });
  assert(true, "the ? button among the canvas controls opens it too");

  {
    // A provider that needs the network, in browser mode (the key reuses the faked SiliconFlow from the start).
    const st = await openSettings();
    await st.getByText("Directly from this browser").click();
    await st.getByLabel("Provider", { exact: true }).selectOption("siliconflow");
    const key = st.getByLabel("API key", { exact: true });
    if (!(await key.inputValue())) await key.fill("sk-good");
    await st.getByRole("button", { name: "Save", exact: true }).click();
    await st.waitFor({ state: "detached" });

    await context.setOffline(true);
    await page.getByTestId("offline-banner").waitFor();
    assert((await page.getByTestId("offline-banner").textContent()).includes("Offline — AI features paused"), "going offline shows the offline banner");
    await page.getByRole("button", { name: "+ Add concept" }).click();
    await page.getByRole("button", { name: "Describe it" }).click();
    await page.getByLabel("Concept description").fill("a subgroup closed under conjugation");
    const started = Date.now();
    await page.getByRole("button", { name: "Find a name" }).click();
    await page.locator(".toast").filter({ hasText: "You're offline" }).waitFor({ timeout: 3000 });
    assert(Date.now() - started < 3000, `an AI action fails fast with the offline message (${Date.now() - started} ms)`);
    await page.screenshot({ path: `${shots}13-offline.png` });
    await page.getByRole("dialog", { name: "Add concept" }).getByRole("button", { name: "Cancel" }).click();

    await context.setOffline(false);
    await page.getByTestId("offline-banner").waitFor({ state: "detached" });
    assert(true, "back online hides the banner");
    const st2 = await openSettings();
    await st2.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st2.getByRole("button", { name: "Save", exact: true }).click();
  }

  console.log("Toolbar layout & 中文");
  const toolbar = page.locator(".toolbar");
  const oneRow = () => toolbar.evaluate((el) => el.getBoundingClientRect().height < 60);
  await page.setViewportSize({ width: 1200, height: 800 });
  assert(await oneRow(), "at 1200px the whole toolbar fits on one row");
  await page.getByRole("button", { name: "Fork sandbox" }).click();
  await page.getByTestId("sandbox-banner").getByRole("button", { name: "Merge back" }).waitFor();
  assert(await oneRow(), "…also in a sandbox, whose Merge back and Discard sit in the sandbox banner");
  await page.setViewportSize({ width: 1400, height: 900 });
  await toolbar.screenshot({ path: `${shots}14-toolbar-en.png` });
  await page.getByRole("button", { name: "File ▾" }).click();
  const fileItems = await page.getByRole("menu", { name: "File" }).getByRole("menuitem").allTextContents();
  assert(
    JSON.stringify(fileItems) ===
      JSON.stringify([
        "Import JSON…", "Extract from text…", "Quiz me…", "Save snapshot…", "Versions…",
        "JSON (this project)", "Markdown notes", "Mermaid diagram", "PNG image", "Share link…",
      ]),
    "File ▾ holds import, Extract from text, Quiz me, Versions, every export format and the share link",
  );
  await page.keyboard.press("Escape");

  {
    const st = await openSettings();
    await st.getByLabel("Interface language", { exact: true }).selectOption("zh");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  const addZh = page.getByRole("button", { name: "+ 添加概念" });
  await addZh.waitFor();
  assert(
    (await page.evaluate(() => document.documentElement.lang)) === "zh-CN" &&
      (await page.getByTestId("sandbox-banner").textContent()).includes("沙盒模式"),
    "switching the interface to 中文 translates the toolbar and banners, and sets <html lang>",
  );
  await page.setViewportSize({ width: 1200, height: 800 });
  assert(await oneRow(), "the Chinese toolbar fits on one row at 1200px too");
  await page.setViewportSize({ width: 1400, height: 900 });
  await toolbar.screenshot({ path: `${shots}15-toolbar-zh.png` });
  await addZh.click();
  const addDialogZh = page.getByRole("dialog", { name: "添加概念" });
  await addDialogZh.waitFor();
  assert((await addDialogZh.getByRole("button", { name: "我知道名字" }).count()) === 1, "dialogs are in Chinese");
  await page.screenshot({ path: `${shots}15-zh.png` });
  await page.keyboard.press("Escape");
  await page.reload();
  await addZh.waitFor();
  assert(true, "the interface language is remembered after reload");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settingsZh = page.getByRole("dialog", { name: "设置" });
  await settingsZh.getByLabel("界面语言", { exact: true }).selectOption("en");
  await settingsZh.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "+ Add concept" }).waitFor();
  assert((await page.evaluate(() => document.documentElement.lang)) === "en", "and back to English");

  console.log("Extract from text");
  {
    const st = await openSettings();
    await st.getByText("Directly from this browser").click();
    await st.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  await projectMenu("New project");
  await page.getByLabel("Project name").press("Enter");
  await page.locator(".canvas__empty").waitFor();
  await addByName("Group");
  await addByName("Homomorphism");
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 2);
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("menuitem", { name: "Extract from text…" }).click();
  const extract = page.getByRole("dialog", { name: "Extract from text" });
  const extractText = extract.getByLabel("Text", { exact: true });
  await extractText.fill("x".repeat(12_001));
  assert(
    (await extract.getByText(/^Too long/).isVisible()) && (await extract.getByRole("button", { name: "Extract", exact: true }).isDisabled()),
    "a text over the length cap is refused with a clear message",
  );
  await extractText.fill(
    "A group is a set with an associative operation, an identity and inverses. A homomorphism between groups preserves " +
      "the operation, and its kernel is the set of elements it sends to the identity. We call such a map a \"Widget morphism\".",
  );
  await extract.getByRole("button", { name: "Extract", exact: true }).click();
  await extract.getByTestId("extract-Kernel").waitFor();
  const tick = (name) => extract.getByRole("checkbox", { name: `Add ${name}`, exact: true });
  assert(
    !(await tick("Group").isChecked()) && (await tick("Group").isDisabled()) && !(await tick("Homomorphism").isChecked()) &&
      (await extract.getByTestId("extract-Homomorphism").textContent()).includes("Already in the graph as “Homomorphism”"),
    "concepts already in the graph are flagged as duplicates and link to the existing ones",
  );
  assert(
    (await tick("Kernel").isChecked()) && (await tick("Widget Morphism").isChecked()) &&
      (await extract.getByTestId("extract-Kernel").textContent()).includes("its kernel is the set of elements"),
    "new candidates are ticked, with a quote from the text",
  );
  assert((await extract.getByText("Kernel needs Homomorphism (uses)").count()) === 1, "the prerequisite the text states is listed");
  await page.screenshot({ path: `${shots}16-extract.png` });
  await extract.getByRole("button", { name: /^Add selected/ }).click();
  await node("Widget Morphism").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 4);
  assert(await node("Kernel").isVisible(), "Add selected adds the new concepts (and not the duplicates)");
  await waitBadge("Kernel", "ready");
  assert((await page.locator(".react-flow__edge").count()) >= 1, "…linked to the existing concept they need");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 2);
  assert((await node("Kernel").count()) === 0 && (await node("Widget Morphism").count()) === 0, "one Ctrl+Z removes the whole extraction");

  console.log("Onboarding");
  // Fresh browser contexts: a first visit, with nothing in localStorage but the interface language.
  const firstVisit = async (lang, viewport = { width: 1400, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, locale: lang === "zh" ? "zh-CN" : "en-US" });
    await ctx.addInitScript((l) => {
      try {
        if (!localStorage.getItem("nodestorm-ui-language")) localStorage.setItem("nodestorm-ui-language", l);
      } catch {}
    }, lang);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error("pageerror:", e.message));
    await p.goto(`http://localhost:${WEB_PORT}/`);
    return { ctx, p };
  };
  const onboardingState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("nodestorm-onboarding") ?? "null"));
  // The popover is hidden while it waits for its anchor; wait until it is placed.
  const placed = (p) => p.locator('[data-testid="tour"]:not([style*="hidden"])').waitFor();

  {
    const { ctx, p } = await firstVisit("en");
    const welcome = p.getByTestId("welcome");
    await welcome.waitFor();
    assert(
      (await welcome.getByRole("heading", { name: "Welcome to NodeStorm" }).isVisible()) &&
        (await welcome.getByRole("button").allTextContents()).join("|") ===
          "Take the 1-minute tour|Load the Group theory example|Start empty|⚙ Settings",
      "a first visit shows the welcome card: tour, example, start empty, and where to add an AI key",
    );
    await p.screenshot({ path: `${shots}17-welcome.png` });
    await welcome.getByRole("button", { name: "Take the 1-minute tour" }).click();
    const intro = p.getByRole("dialog", { name: "A quick tour" });
    await intro.waitFor();
    assert((await welcome.count()) === 0, "starting the tour closes the welcome card");
    await intro.getByRole("button", { name: "Load the example" }).click();
    await p.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 7);
    const tour = p.getByTestId("tour");
    const count = p.getByTestId("tour-count");
    const titles = [];
    for (let i = 1; i <= 7; i++) {
      await count.filter({ hasText: `Step ${i} of 7` }).waitFor();
      await placed(p);
      titles.push(await tour.locator("h3").textContent());
      const next = tour.getByRole("button", { name: i === 7 ? "Finish" : "Next" });
      if (i === 1) {
        assert(await next.evaluate((b) => b === document.activeElement), "the tour focuses its Next button");
        assert((await tour.getByRole("button", { name: "Back" }).isDisabled()), "…and Back is off on the first step");
      }
      if (i === 2) {
        // Points at the Install button of the blocked concept, which the tour selected.
        const [ring, btn] = await Promise.all([p.locator(".tour-ring").boundingBox(), p.getByTestId("install-Isomorphism").boundingBox()]);
        assert(ring && btn && Math.abs(ring.x + 4 - btn.x) < 2 && Math.abs(ring.y + 4 - btn.y) < 2, "step 2 highlights the blocked concept's Install button");
        await p.screenshot({ path: `${shots}17-tour-install.png` });
        // Back and forth.
        await tour.getByRole("button", { name: "Back" }).click();
        await count.filter({ hasText: "Step 1 of 7" }).waitFor();
        await tour.getByRole("button", { name: "Next" }).click();
        await count.filter({ hasText: "Step 2 of 7" }).waitFor();
        await placed(p);
      }
      await next.click();
    }
    assert(
      JSON.stringify(titles) ===
        JSON.stringify(["Add concepts", "Install what's missing", "Relations go both ways", "Mix two concepts", "Experiment in a sandbox", "Import, export, share", "Connect an AI"]),
      "Next walks through all 7 steps: add, install, arrowheads, Mix, sandbox, File, Settings",
    );
    await tour.waitFor({ state: "detached" });
    assert((await onboardingState(p))?.tour === "done", "finishing the tour is remembered");
    await p.reload();
    await p.getByTestId("node-Group").waitFor();
    assert((await welcome.count()) === 0 && (await tour.count()) === 0 && (await onboardingState(p))?.tour === "done", "…and after a reload neither the card nor the tour comes back");

    // Show tour again from the ? dialog; the keyboard drives it, Escape skips it.
    await p.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await p.keyboard.press("?");
    await p.getByRole("dialog", { name: "Keyboard shortcuts" }).getByRole("button", { name: "Show tour again" }).click();
    await count.filter({ hasText: "Step 1 of 7" }).waitFor();
    await placed(p);
    await p.keyboard.press("Enter");
    await count.filter({ hasText: "Step 2 of 7" }).waitFor();
    await placed(p);
    await p.keyboard.press("Escape");
    await tour.waitFor({ state: "detached" });
    assert((await onboardingState(p))?.tour === "skipped", "Show tour again (in ?) restarts it; Enter goes on and Escape skips it");
    await ctx.close();
  }
  {
    // Start empty: the card goes, the canvas hint stays, and focus moves to Add concept.
    const { ctx, p } = await firstVisit("en");
    await p.getByTestId("welcome").getByRole("button", { name: "Start empty" }).click();
    await p.locator(".canvas__empty").waitFor();
    assert(
      (await p.getByTestId("welcome").count()) === 0 &&
        (await p.getByRole("button", { name: "+ Add concept" }).evaluate((b) => b === document.activeElement)),
      "Start empty closes the card and focuses Add concept",
    );
    await p.reload();
    await p.locator(".canvas__empty").waitFor();
    assert((await p.getByTestId("welcome").count()) === 0, "…for good (still no card after a reload)");
    await ctx.close();
  }
  {
    // 中文 on a phone: the card is in Chinese, and the tour points at ☰ instead of the folded buttons.
    const { ctx, p } = await firstVisit("zh", { width: 390, height: 844 });
    const welcome = p.getByTestId("welcome");
    await welcome.waitFor();
    assert(
      (await welcome.getByRole("heading", { name: "欢迎使用 NodeStorm" }).isVisible()) &&
        (await welcome.getByRole("button", { name: "花 1 分钟看看导览" }).isVisible()) &&
        (await welcome.getByRole("button", { name: "载入群论示例" }).isVisible()),
      "in 中文 the welcome card is Chinese",
    );
    await p.screenshot({ path: `${shots}17-welcome-zh-mobile.png` });
    await welcome.getByRole("button", { name: "花 1 分钟看看导览" }).click();
    await p.getByRole("dialog", { name: "快速导览" }).getByRole("button", { name: "载入示例" }).click();
    const tour = p.getByTestId("tour");
    const titles = [];
    for (let i = 1; i <= 5; i++) {
      await p.getByTestId("tour-count").filter({ hasText: `第 ${i} 步，共 5 步` }).waitFor();
      await placed(p);
      titles.push(await tour.locator("h3").textContent());
      if (i < 5) await tour.getByRole("button", { name: "下一步" }).click();
    }
    assert(titles.at(-1) === "更多工具" && titles[1] === "安装缺少的前置知识", "on a phone the tour has 5 steps, ending at ☰ (Fork, File and Settings are folded away)");
    await p.screenshot({ path: `${shots}17-tour-zh-mobile.png` });
    await tour.getByRole("button", { name: "跳过导览" }).click();
    await tour.waitFor({ state: "detached" });
    await p.reload();
    await p.getByTestId("node-Group").waitFor();
    assert((await onboardingState(p))?.tour === "skipped" && (await welcome.count()) === 0 && (await tour.count()) === 0, "Skip ends the tour and is remembered");
    await ctx.close();
  }

  console.log("Accessibility audit");
  // axe-core with the WCAG 2.0/2.1/2.2 A and AA rules, on the main screens in both themes and in 中文. Nothing is
  // excluded at the moment. axe's "needs review" results (e.g. contrast of text on React Flow's transformed canvas,
  // which it can't measure) aren't failures.
  const audit = async (what) => {
    await page.waitForTimeout(300); // let transitions and lazily loaded dialogs settle
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const report = violations.flatMap((v) => v.nodes.map((n) => `\n    ${v.id} (${v.impact}) at ${n.target.join(" ")}: ${n.failureSummary}`));
    assert(!violations.length, `axe finds no WCAG A/AA violations: ${what}${report.join("")}`);
  };
  const setTheme = async (theme) => {
    const st = await openSettings();
    await st.getByLabel("Theme", { exact: true }).selectOption(theme);
    await st.getByRole("button", { name: "Save", exact: true }).click();
  };
  await setTheme("light");
  await projectMenu("New project");
  await page.getByLabel("Project name").press("Enter");
  await page.getByRole("button", { name: "Load example: Group theory" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 7);
  await node("First Isomorphism Theorem").click(); // blocked, with a learning path in the inspector
  await audit("main screen with a graph and a concept open in the inspector");
  {
    const st = await openSettings();
    await audit("Settings dialog");
    await st.getByRole("button", { name: "Cancel" }).click();
  }
  await addByName("Expectation");
  await what.waitFor();
  await audit("“What do you mean?” dialog");
  await what.getByRole("button", { name: "Later" }).click();
  const firstArrow = page.locator('[data-testid^="arrow-"]').first();
  await firstArrow.click({ force: true });
  await page.getByTestId("relation-panel").waitFor();
  await audit("inspector with a relation open");
  await setTheme("dark");
  await audit("dark theme, relation open");
  await node("Group").click();
  await audit("dark theme, concept open");
  {
    const st = await openSettings();
    await st.getByLabel("Theme", { exact: true }).selectOption("light");
    await st.getByLabel("Interface language", { exact: true }).selectOption("zh");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  await addZh.waitFor();
  await audit("中文 interface");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await audit("中文 Settings dialog");
  // Back to English for the sections after this one (their selectors are English).
  await settingsZh.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
  await settingsZh.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "+ Add concept" }).waitFor();

  console.log("Quiz");
  {
    // The offline demo provider, in browser mode, on a fresh project: Group ← Subgroup ← Normal Subgroup.
    const st = await openSettings();
    await st.getByText("Directly from this browser").click();
    await st.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  await projectMenu("New project");
  await page.getByLabel("Project name").press("Enter");
  await page.locator(".canvas__empty").waitFor();
  for (const name of ["Group", "Subgroup", "Normal Subgroup"]) {
    await addByName(name);
    await waitBadge(name, "ready");
  }
  await page.getByRole("button", { name: "File ▾" }).click();
  assert(await page.getByRole("menuitem", { name: "Quiz me…" }).isVisible(), "File has a Quiz me… entry");
  await page.keyboard.press("Escape");
  await node("Normal Subgroup").click();
  await page.getByTestId("quiz-node").click();
  const quizDialog = page.getByRole("dialog", { name: "Quiz me" });
  await quizDialog.waitFor();
  assert(
    await quizDialog.getByRole("radio", { name: "The learning path of Normal Subgroup (3 concepts)" }).isChecked(),
    "the inspector's Quiz me starts on the concept's learning path",
  );
  await audit("Quiz me: setup");
  await quizDialog.getByTestId("quiz-start").click();
  const quizConcept = quizDialog.getByTestId("quiz-concept");
  await quizDialog.getByTestId("quiz-question").waitFor();
  assert(
    (await quizConcept.textContent()) === "Group" && (await quizDialog.getByText("Question 1 of 3").isVisible()),
    "the first question is about a prerequisite (Group, 1 of 3)",
  );
  assert(
    await quizDialog.getByTestId("quiz-question").evaluate((el) => el === document.activeElement),
    "…and the question has focus",
  );
  await quizDialog.getByRole("button", { name: /^Hint/ }).click();
  assert((await quizDialog.getByRole("list", { name: "Hints" }).locator("li").count()) === 1, "hints are shown on demand, one at a time");
  await quizDialog.getByRole("button", { name: "Show answer" }).click();
  await audit("Quiz me: question with answer shown");
  assert(
    (await quizDialog.getByTestId("quiz-answer").textContent()).includes("associative binary operation"),
    "Show answer reveals the model answer",
  );
  await page.screenshot({ path: `${shots}18-quiz.png` });
  await quizDialog.getByRole("group", { name: "How did it go?" }).getByRole("button", { name: "Knew it" }).click();
  await quizConcept.filter({ hasText: "Subgroup" }).waitFor();
  assert((await quizConcept.textContent()) === "Subgroup", "self-grading moves on to the next concept in study order");
  await quizDialog.getByTestId("quiz-question").waitFor();
  await quizDialog.getByRole("button", { name: "Show answer" }).click();
  await quizDialog.getByRole("button", { name: "Didn't know" }).click();
  await quizConcept.filter({ hasText: "Normal Subgroup" }).waitFor();
  await quizDialog.getByTestId("quiz-question").waitFor();
  await quizDialog.getByRole("button", { name: "Show answer" }).click();
  await quizDialog.getByRole("button", { name: "Partly" }).click();
  const quizSummary = quizDialog.getByTestId("quiz-summary");
  await quizSummary.waitFor();
  assert(
    (await quizSummary.locator(".quiz__count").allTextContents()).join("|") === "1 Knew it|1 Partly|1 Didn't know|0 Skipped",
    "the summary counts the self-grades",
  );
  await page.screenshot({ path: `${shots}18-quiz-summary.png` });
  await quizSummary.getByRole("button", { name: "Close" }).click();
  await quizDialog.waitFor({ state: "detached" });
  const masteryOf = (name) => page.getByTestId(`mastery-${name}`);
  assert(
    (await masteryOf("Group").getAttribute("class")).includes("mastery--strong") &&
      (await masteryOf("Subgroup").getAttribute("class")).includes("mastery--weak") &&
      (await masteryOf("Normal Subgroup").getAttribute("class")).includes("mastery--fair"),
    "each concept shows a mastery dot (strong / weak / fair)",
  );
  assert((await masteryOf("Group").getAttribute("aria-label")).startsWith("Mastery: strong"), "…with an accessible label");
  await page.reload();
  await masteryOf("Group").waitFor();
  assert(
    (await masteryOf("Subgroup").getAttribute("class")).includes("mastery--weak"),
    "mastery is kept after a reload",
  );
  {
    // A second quiz over the whole graph starts on the weak spot: Group is known well, so Subgroup needn't wait for it.
    await page.getByRole("button", { name: "File ▾" }).click();
    await page.getByRole("menuitem", { name: "Quiz me…" }).click();
    await quizDialog.waitFor();
    await quizDialog.getByRole("radio", { name: /^The whole graph/ }).check();
    await quizDialog.getByLabel("Multiple choice (4 options)").check();
    await quizDialog.getByTestId("quiz-start").click();
    await quizDialog.getByRole("group", { name: "Choose an answer" }).waitFor();
    assert((await quizConcept.textContent()) === "Subgroup", "the next quiz asks the weakest ready concept first");
    const choices = quizDialog.getByRole("group", { name: "Choose an answer" }).getByRole("button");
    assert((await choices.count()) === 4, "multiple choice offers four options");
    await choices.first().click();
    await quizDialog.getByTestId("quiz-answer").waitFor();
    assert(await quizDialog.getByText(/^(Right!|Not quite\.)$/).isVisible(), "picking an option says whether it was right");
    await quizDialog.getByRole("button", { name: "Knew it" }).click();
    await quizDialog.getByText("Question 2 of 3").waitFor();
    await quizDialog.getByRole("button", { name: "Finish" }).click();
    await quizSummary.waitFor();
    assert((await quizSummary.textContent()).includes("2 concepts weren't asked."), "finishing early says how many weren't asked");
    await page.keyboard.press("Escape");
    await quizDialog.waitFor({ state: "detached" });
  }

  console.log("Versions");
  {
    // Still the offline demo provider in browser mode (Quiz section). A fresh project with the example graph.
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.getByRole("button", { name: "Load example: Group theory" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 7);
    const fileItem = async (name) => {
      await page.getByRole("button", { name: "File ▾" }).click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    const versions = page.getByRole("dialog", { name: "Versions" });
    const entries = () => versions.getByTestId("version").locator(".versions__title").allTextContents();

    await fileItem("Save snapshot…");
    await versions.waitFor();
    const labelField = versions.getByLabel("Snapshot label (optional)");
    assert(await labelField.evaluate((el) => el === document.activeElement), "Save snapshot… opens Versions with the label field focused");
    await labelField.fill("Before cleanup");
    await versions.getByTestId("versions-save").click();
    await versions.getByText("Saved “Before cleanup”.").waitFor();
    assert(JSON.stringify(await entries()) === JSON.stringify(["Before cleanup"]), "a named snapshot is listed");
    assert((await versions.getByTestId("version").first().textContent()).includes("7 concepts"), "…with its concept count");
    await audit("Versions dialog");
    await versions.getByRole("button", { name: "Close" }).click();

    await node("Group").click();
    await page.keyboard.press("Delete");
    await node("Group").waitFor({ state: "detached" });
    await fileItem("Versions…");
    await versions.getByTestId("version").first().getByRole("button", { name: "Compare" }).click();
    const diff = versions.getByTestId("version-diff");
    await diff.waitFor();
    assert((await diff.textContent()).includes("Brings back 1 concept: Group"), "Compare says restoring brings back the deleted concept");
    await versions.getByTestId("version").first().getByRole("button", { name: "Restore", exact: true }).click();
    await versions.waitFor({ state: "detached" });
    await node("Group").waitFor();
    assert(await node("Group").isVisible(), "Restore brings the deleted concept back");
    assert((await page.locator(".toast").textContent()).includes("Restored “Before cleanup”"), "…and says so");
    await page.locator(".toast").click();
    await fileItem("Versions…");
    await versions.getByTestId("version").first().waitFor();
    assert((await entries())[0] === "Before restoring a version", "the state before the restore is kept as a version");
    await versions.getByRole("button", { name: "Close" }).click();

    await node("First Isomorphism Theorem").click();
    await page.getByTestId("install-all").click();
    await page.getByRole("dialog", { name: "Install all missing" }).getByTestId("install-all-confirm").click();
    await waitBadge("First Isomorphism Theorem", "ready");
    await fileItem("Versions…");
    await versions.getByTestId("version").first().waitFor();
    assert((await entries())[0] === "Before Install all", "an automatic snapshot is taken before Install all");
    assert((await versions.getByTestId("version").first().textContent()).includes("7 concepts"), "…of the graph before the run");
    await versions.getByRole("button", { name: "Close" }).click();

    await page.reload();
    await node("Group").waitFor();
    await fileItem("Versions…");
    await versions.getByTestId("version").first().waitFor();
    const after = await entries();
    assert(
      JSON.stringify(after) === JSON.stringify(["Before Install all", "Before restoring a version", "Before cleanup"]),
      `the list is kept after a reload: ${after.join(" | ")}`,
    );
    await versions.getByTestId("version").last().getByRole("button", { name: "Preview" }).click();
    await page.getByTestId("viewer-banner").waitFor();
    assert((await page.getByTestId("viewer-banner").textContent()).includes("Previewing an earlier version"), "Preview opens the version read-only");
    await page.getByRole("button", { name: "File ▾" }).click();
    assert(!(await page.getByRole("menuitem", { name: "Versions…" }).count()), "Versions is hidden in the read-only viewer");
    await page.keyboard.press("Escape");
    await page.getByTestId("viewer-banner").getByRole("button", { name: "Close" }).click();
    await page.getByTestId("viewer-banner").waitFor({ state: "detached" });
    assert(await node("Isomorphism").isVisible(), "closing the preview returns to the current project");
  }

  console.log("Keys behind dialogs");
  {
    // With a dialog open and focus on <body> (as between quiz cards), Delete/Backspace/Ctrl+Z must not act behind it.
    const count = await page.locator(".react-flow__node").count();
    await page.locator(".react-flow__node").first().click();
    await page.keyboard.press("Shift+?");
    const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await shortcuts.waitFor();
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(200);
    assert((await page.locator(".react-flow__node").count()) === count, "Delete/Backspace do nothing behind an open dialog");
    await shortcuts.getByRole("button", { name: "Close" }).click();
  }

  console.log("Math");
  {
    // Still the offline demo in browser mode; its Kernel definition is "The set $\ker\varphi$ of elements …".
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await addByName("Kernel");
    const card = node("Kernel");
    await card.locator(".concept__def .katex").first().waitFor();
    const tex = await card.locator(".katex annotation").allTextContents();
    assert(tex.includes("\\ker\\varphi"), `the card typesets $\\ker\\varphi$ with KaTeX (${tex.join(", ")})`);
    assert(!(await card.locator(".concept__def").innerText()).includes("$"), "…and shows no dollar delimiters");
    await card.click();
    const definition = page.getByTestId("definition");
    const source = await definition.inputValue();
    assert(source.includes("$\\ker\\varphi$"), "the inspector edits the LaTeX source");
    const preview = page.getByTestId("definition-preview");
    await preview.locator(".katex").first().waitFor();
    assert(await preview.isVisible(), "…and shows the typeset definition under the field");
    await definition.fill("Costs \\$5, or $10 with $a^2$ and $x");
    await page.waitForTimeout(100);
    assert((await preview.locator(".katex").count()) === 1, "an escaped \\$, prices and an unclosed $ stay text; only $a^2$ is a formula");
    assert((await preview.innerText()).includes("Costs $5, or $10 with"), "…and \\$ shows as a dollar");
    await definition.fill("Broken: $\\frac{1}{$ here");
    await preview.getByText("$\\frac{1}{$").waitFor();
    assert(!(await preview.locator(".katex").count()), "a formula KaTeX can't parse is shown as its source");
    await definition.fill("Plain text again");
    assert(!(await preview.count()), "text without a formula has no preview");
    await definition.fill(source);
    await card.locator(".katex").first().waitFor();

    await setTheme("dark");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    const [mathColor, textColor] = await card.locator(".concept__def").evaluate((el) => [
      getComputedStyle(el.querySelector(".katex")).color,
      getComputedStyle(el).color,
    ]);
    const light = mathColor.match(/\d+/g).slice(0, 3).reduce((a, b) => a + Number(b), 0) > 3 * 128;
    assert(mathColor === textColor && light, `formulas take the (light) text colour in dark mode (${mathColor})`);
    await page.screenshot({ path: `${shots}math-dark.png` });
    await audit("math on a card and in the inspector (dark)");
    await setTheme("light");
    await audit("math on a card and in the inspector (light)");
  }

  console.log("\nE2E passed");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const p of procs) try { process.kill(-p.pid); } catch {}
}
