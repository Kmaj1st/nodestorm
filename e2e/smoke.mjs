// End-to-end smoke test: starts the server (mock AI) + Vite, drives the UI in Chromium.
// Usage: npm run e2e   (screenshots land in e2e/screenshots/)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

  console.log("Export");
  const exportAs = async (label) => {
    await page.getByRole("button", { name: "Export ▾" }).click();
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
  await page.getByLabel("Theme").selectOption("dark");
  assert(isDark(await bodyBg()), "switching to Dark darkens the page background");
  await page.screenshot({ path: `${shots}9-dark.png` });
  await page.reload();
  await node("Group").waitFor();
  assert(isDark(await bodyBg()) && (await page.getByLabel("Theme").inputValue()) === "dark", "dark theme is remembered after reload");

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
  assert(!(await page.getByLabel("Theme").isVisible()), "less-used toolbar controls fold into a menu");
  await page.getByRole("button", { name: "More tools" }).click();
  assert((await page.getByLabel("Theme").isVisible()) && (await noHScroll()), "the menu opens them, still without horizontal scroll");
  await page.screenshot({ path: `${shots}9-mobile.png` });
  await page.getByRole("button", { name: "Hide details" }).click();
  assert((await page.getByTestId("relation-panel").isHidden()), "the inspector bottom sheet collapses");
  await page.getByRole("button", { name: "Show details" }).click();
  await addBtn.click();
  const box = await addDialog.boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 390 && (await noHScroll()), "Add concept dialog fits the phone screen");
  await page.screenshot({ path: `${shots}9-mobile-dialog.png` });
  await page.keyboard.press("Escape");

  console.log("\nE2E passed");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const p of procs) try { process.kill(-p.pid); } catch {}
}
