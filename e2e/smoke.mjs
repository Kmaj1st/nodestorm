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
// E2E_BUILT=1 runs everything against the production build (`npm run build` first) served by `vite preview`, which
// proxies /api like the dev server; that build has the Content-Security-Policy, and any violation fails the run.
const BUILT = process.env.E2E_BUILT === "1";
start("npx", ["vite", ...(BUILT ? ["preview"] : []), "client", "--port", String(WEB_PORT), "--strictPort"], { SERVER_PORT: String(SERVER_PORT) });
const cspViolations = [];

let browser;
try {
  await waitFor(`http://localhost:${SERVER_PORT}/api/providers`);
  await waitFor(`http://localhost:${WEB_PORT}/`);
  browser = await chromium.launch();
  // A context (not browser.newPage) so the share-link section can open a second page with the same storage.
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "en-US" });
  // Never ask the real encyclopedias: every concept's definition then comes from the offline demo AI, as the
  // flows below expect. The "Definitions from encyclopedias" section answers with fixtures instead. The web search
  // engines are blocked too ("Web search settings" answers Tavily with a fixture).
  const LOOKUP_SITES = /proofwiki\.org|wikipedia\.org|wikidata\.org|lean-lang\.org|openalex\.org|baike\.baidu\.com|moegirl\.org\.cn|fandom\.com|wiki\.biligame\.com|api\.tavily\.com|google\.serper\.dev|api\.search\.brave\.com/;
  const blockLookups = (ctx) => ctx.route(LOOKUP_SITES, (r) => r.abort());
  await blockLookups(context);
  // The run starts in English whatever the machine's language (the selectors below are English); the 中文 section at
  // the end switches the interface language itself, and that choice is kept across its reloads.
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem("nodestorm-ui-language")) localStorage.setItem("nodestorm-ui-language", "en");
    } catch {}
  });
  if (BUILT) {
    // Collected from every page and frame (the Baidu Baike srcdoc frame inherits the page's policy).
    await context.exposeBinding("__cspViolation", (_src, v) => cspViolations.push(v));
    await context.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation?.(`${e.effectiveDirective} ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`)),
    );
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`http://localhost:${WEB_PORT}/`);
  if (BUILT) assert(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), "production build: the page has a Content-Security-Policy");
  // A first visit shows the welcome card (the Onboarding section below tests it); it doesn't block the toolbar.
  await page.getByTestId("welcome").waitFor();

  const node = (name) => page.getByTestId(`node-${name}`);
  /** The inspector's definition source. The definition shows formatted until Edit opens the source, so open it. */
  const definitionField = async (scope = page) => {
    const field = scope.getByTestId("definition");
    if (!(await field.count())) await scope.getByTestId("definition-edit").click();
    await field.waitFor();
    return field;
  };
  /** Add a concept by name; with a `definition` (typed as the user's own), no source is looked for. */
  const addByName = async (name, definition) => {
    await page.getByRole("button", { name: "Add concept", exact: true }).click();
    await page.getByLabel("Concept name").fill(name);
    if (definition) await page.getByRole("textbox", { name: "Definition (optional)" }).fill(definition);
    await page.getByRole("button", { name: "Add", exact: true }).click();
  };
  /**
   * Open a toolbar menu (`button` toggles `menu`) and return the menu once it is really open. A dialog that is still
   * closing takes the click (its backdrop) or hands focus back after it, so wait for it to go first; then click while
   * the button says it is closed until the menu shows (never toggling an open one shut).
   */
  const openMenu = async (button, menu, pg = page) => {
    await pg.waitForFunction(() => !document.querySelector(".modal"));
    for (let i = 0; i < 5 && !(await menu.isVisible()); i++) {
      if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
      await menu.waitFor({ timeout: 2000 }).catch(() => {});
    }
    await menu.waitFor({ timeout: 1000 });
    return menu;
  };
  const openFile = (pg = page) =>
    openMenu(pg.getByRole("button", { name: "File", exact: true }), pg.getByRole("menu", { name: "File" }), pg);
  /** File → `item` (a menuitem, matched exactly), in `pg` (the page, or a share viewer). */
  const fromFile = async (item, pg = page) => (await openFile(pg)).getByRole("menuitem", { name: item, exact: true }).click();
  /** Waits (up to 5 s) until `locator`'s whole text is `want`; says whether it is (for asserting right after an action). */
  const textIs = (locator, want) =>
    locator
      .filter({ hasText: new RegExp(`^${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
      .waitFor({ timeout: 5000 })
      .then(() => true, () => false);
  // Is the node fully inside the visible canvas? (waits out the pan animation first)
  const inView = async (name) => {
    await page.waitForTimeout(600);
    const [n, c] = await Promise.all([node(name).boundingBox(), page.locator(".react-flow").boundingBox()]);
    return n && c && n.x >= c.x && n.y >= c.y && n.x + n.width <= c.x + c.width && n.y + n.height <= c.y + c.height;
  };

  console.log("AI setup");
  assert((await page.getByRole("button", { name: "Settings", exact: true }).textContent()).includes("Set up AI"), "toolbar asks to set up AI on first visit");
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
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
  // These sections follow the automatic flow; "Add with look-ups" below tests asking first (the default).
  assert(await settings.getByTestId("new-concepts-ask").isChecked(), "adding a concept asks first by default");
  await settings.getByTestId("new-concepts-ask").uncheck();
  await settings.getByRole("button", { name: "Save", exact: true }).click();

  console.log("Naming from a description");
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
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
  // Derive in the main graph suggests a sandbox, and its button forks one without leaving the dialog.
  await node("Homomorphism").click();
  await page.getByRole("button", { name: "Derive", exact: true }).click();
  const deriveDialog = page.getByRole("dialog", { name: "Derive" });
  await deriveDialog.getByRole("button", { name: "Fork a sandbox" }).click();
  await page.getByTestId("sandbox-banner").waitFor();
  assert(
    (await deriveDialog.getByRole("status").textContent()).includes("Now in Sandbox 1") &&
      (await deriveDialog.getByRole("button", { name: "Fork a sandbox" }).count()) === 0 &&
      (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Goal",
    "Derive's Fork a sandbox forks, says so, and keeps the dialog open with the focus on the goal",
  );
  await deriveDialog.getByRole("button", { name: "Accept" }).first().click();
  await page.getByRole("button", { name: "Close" }).click();
  await node("Kernel").waitFor();
  assert(true, "derived 'Kernel' inside the sandbox");
  assert(await inView("Kernel"), "accepted proposal placed in view");
  await page.screenshot({ path: `${shots}4-sandbox.png` });
  await page.getByLabel("Graph").selectOption({ label: "Main graph" });
  await page.getByTestId("sandbox-banner").waitFor({ state: "detached" }); // the main graph is on screen
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
    await openFile();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
    return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
  };
  const md = await exportAs("Markdown notes");
  const mdText = md.data.toString("utf8");
  assert(md.name.endsWith(".md") && mdText.includes("### Homomorphism"), "Markdown notes contain the concepts");
  assert(
    mdText.includes("- First Isomorphism Theorem → Isomorphism: deriving") &&
      !mdText.includes("- Isomorphism → First Isomorphism Theorem:") &&
      !/ by\b/.test(mdText.split("## Relations")[1] ?? ""),
    "Markdown describes a dependency once, with its active label (no passive \"… by\" side)",
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
  assert(!(await page.getByRole("button", { name: "Redo", exact: true }).isDisabled()), "redo and the Undo button work too");

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

  console.log("Physics and layers");
  {
    const stored = () =>
      page.evaluate(() => {
        const st = JSON.parse(localStorage.getItem("nodestorm") ?? "{}").state;
        return Object.fromEntries(st.graphs[st.activeId].nodes.map((n) => [n.name, n.position]));
      });
    const cards = async () => {
      const out = {};
      for (const l of await page.locator('.react-flow__node [data-testid^="node-"]').all()) out[(await l.getAttribute("data-testid")).slice(5)] = await l.boundingBox();
      return out;
    };
    const overlapping = (bs) => {
      const list = Object.entries(bs);
      for (const [i, [na, a]] of list.entries()) {
        for (const [nb, b] of list.slice(i + 1)) {
          if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
            console.log(`  (${na} overlaps ${nb}: ${JSON.stringify(a)} ${JSON.stringify(b)})`);
            return true;
          }
        }
      }
      return false;
    };
    const settled = () => page.waitForFunction(() => document.querySelector(".canvas")?.getAttribute("data-settled") === "true", null, { timeout: 20000 });
    const before = await stored();
    await page.getByRole("button", { name: "Physics" }).click();
    assert((await page.getByRole("button", { name: "Physics" }).getAttribute("aria-pressed")) === "true", "Physics is a toggle button");
    await settled();
    assert(!overlapping(await cards()), "Physics settles with no overlapping cards");
    const after = await stored();
    assert(JSON.stringify(after) !== JSON.stringify(before), "the settled positions are saved");
    // Waits until the saved positions are `want` (or 5 s went by); says whether they are.
    const storedBecomes = (want) =>
      page
        .waitForFunction((w) => {
          const st = JSON.parse(localStorage.getItem("nodestorm") ?? "{}").state;
          return JSON.stringify(Object.fromEntries(st.graphs[st.activeId].nodes.map((n) => [n.name, n.position]))) === w;
        }, JSON.stringify(want), { timeout: 5000 })
        .then(() => true, () => false);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert(await storedBecomes(before), "one Undo takes the whole arrangement back");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await storedBecomes(after);
    // A drag holds the card at the pointer; its neighbours follow and the result is again one undo step.
    const iso = await node("Isomorphism").boundingBox();
    await page.mouse.move(iso.x + 60, iso.y + 20);
    await page.mouse.down();
    await page.mouse.move(iso.x + 260, iso.y + 60, { steps: 8 });
    await page.mouse.up();
    await settled();
    assert(!overlapping(await cards()), "…and after a drag");
    await page.getByRole("button", { name: "Physics" }).click();

    console.log("Layered view");
    const flat = await stored();
    await page.getByRole("button", { name: /^View/ }).click();
    await page.getByLabel("Layered (2.5D)").check();
    await page.keyboard.press("Escape");
    const drawn = await page.locator(".layer-plate").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
    assert(drawn, "the layered view draws its layer plates");
    assert((await page.locator(".layer-plate").count()) >= 3, "…one per dependency layer");
    const layered = await cards();
    assert(layered["Homomorphism"].y < layered["Isomorphism"].y && layered["Isomorphism"].y < layered["First Isomorphism Theorem"].y, "prerequisites stand on the layers above");
    assert(!overlapping(layered), "no card overlaps another in the layered view");
    assert(JSON.stringify(await stored()) === JSON.stringify(flat), "switching the view moves nothing that is saved");
    // A drag slides the card along its layer.
    const b = layered["Isomorphism"];
    await page.mouse.move(b.x + 60, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + 180, b.y + 220, { steps: 6 });
    await page.mouse.up();
    // The drop is saved when the drag ends.
    await page
      .waitForFunction((x) => {
        const st = JSON.parse(localStorage.getItem("nodestorm") ?? "{}").state;
        return st.graphs[st.activeId].nodes.find((n) => n.name === "Isomorphism")?.position.x !== x;
      }, flat["Isomorphism"].x, { timeout: 5000 })
      .catch(() => {});
    const moved = (await cards())["Isomorphism"];
    assert(Math.abs(moved.y - b.y) < 2 && moved.x > b.x + 60, "a card dragged in the layered view stays on its layer");
    const s2 = await stored();
    assert(s2["Isomorphism"].y === flat["Isomorphism"].y && s2["Isomorphism"].x !== flat["Isomorphism"].x, "…and only its x is saved");
    await page.screenshot({ path: `${shots}5c-layered.png` });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("button", { name: /^View/ }).click();
    await page.getByLabel("Flat").check();
    await page.keyboard.press("Escape");
    const plain = await page.locator(".layer-plate").first().waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
    assert(plain && (await page.locator(".layer-plate").count()) === 0, "the flat view has no plates");
    assert(JSON.stringify(await stored()) === JSON.stringify(flat), "back to flat, the layout is as it was");

    console.log("3D view");
    await page.getByRole("button", { name: /^View/ }).click();
    await page.getByRole("button", { name: "3D view…" }).click();
    const d3 = page.getByRole("dialog", { name: "3D view" });
    await d3.getByTestId("graph3d-canvas").waitFor({ timeout: 20000 });
    assert(await d3.getByRole("heading", { name: "Layer 0: foundations" }).isVisible(), "the 3D view lists the concepts by layer");
    await d3.getByTestId("graph3d-canvas").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("+");
    await page.keyboard.press("0");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}5d-3d.png` });
    await d3.getByRole("button", { name: "Isomorphism", exact: true }).click();
    await d3.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector('[data-testid="node-Isomorphism"]')?.className.includes("concept--selected"));
    assert((await page.getByLabel("Rename concept").inputValue()) === "Isomorphism", "picking a concept in the 3D view opens it on the canvas");
  }

  console.log("Ambiguous names");
  {
    const st = await openSettings();
    await st.getByText("Directly from this browser").click();
    await st.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st.getByLabel("Number of meanings to offer").fill("4");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  {
    // Wikipedia has only a disambiguation page; Wikidata lists four meanings (fixtures shaped like the real answers).
    // They are near matches for other names, so nothing is taken unasked: the sources pop-up opens.
    const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    await context.unroute(LOOKUP_SITES);
    await context.route(LOOKUP_SITES, (route) => {
      const url = decodeURIComponent(route.request().url()).replace(/\+/g, " ");
      if (url.includes("titles=Expectation&")) return route.fulfill(json({ query: { pages: [{ title: "Expectation", pageprops: { disambiguation: "" }, extract: "Expectation may refer to:" }] } }));
      if (url.includes("wbsearchentities") && url.includes("Expectation")) {
        return route.fulfill(json({ search: [
          { id: "Q200125", label: "Expectation (probability)", description: "long-run average value of a random variable" },
          { id: "Q7", label: "Expectation (psychology)", description: "belief about what will happen in the future" },
          { id: "Q8", label: "Expectation (quantum mechanics)", description: "average outcome of measuring an observable" },
          { id: "Q9", label: "Expectation (economics)", description: "forecast of future economic variables" },
        ] }));
      }
      if (url.includes("wbgetentities")) return route.fulfill(json({ entities: {} }));
      return route.abort();
    });
  }
  await addByName("Expectation");
  const what = page.getByRole("dialog", { name: "Sources" });
  await what.getByTestId("source-item").first().waitFor();
  assert((await what.getByRole("radio").count()) === 5, "the pop-up offers the configured 4 meanings (one source each) + “My own definition”");
  assert((await what.getByRole("heading", { name: /^Meaning:/ }).count()) === 4, "…grouped by meaning, as the AI tells them apart");
  await page.screenshot({ path: `${shots}6-what-do-you-mean.png` });
  await what.getByRole("button", { name: "Later" }).click();
  await waitBadge("Expectation", "choose a definition");
  assert(await page.getByRole("button", { name: /Mix/ }).isDisabled(), "unclear concept can't be mixed yet");
  await badge("Expectation").click();
  await what.getByText("Expectation (probability)").click();
  await what.getByRole("button", { name: "Use this text" }).click();
  await waitBadge("Expectation (probability)", "ready");
  assert(true, "picking a source's definition renames the node and continues the analysis");
  assert((await page.getByTestId("node-panel").textContent()).includes("also: Expectation"), "original name kept as alias");
  await context.unroute(LOOKUP_SITES);
  await blockLookups(context);

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
  // Typed definitions: the AI call under test is the prerequisite check (definitions never come from the AI).
  await addByName("Group", "A set with an associative operation, an identity and inverses.");
  await page.getByTestId("task").first().waitFor();
  assert(true, "running check is visible in the status bar");
  await waitBadge("Group", "failed – retry", 15000);
  await page.locator(".toast").waitFor();
  assert((await page.locator(".toast").textContent()).includes("didn't respond within 10s"), "a hanging request times out with a clear error");
  await page.screenshot({ path: `${shots}7-timeout.png` });
  await page.locator(".toast").click();

  await addByName("Ring", "A set with two operations.");
  await page.getByTestId("task").first().waitFor();
  await page.getByRole("button", { name: /^Cancel:/ }).click();
  await waitBadge("Ring", "failed – retry", 3000);
  assert((await page.getByTestId("task").count()) === 0 && (await page.locator(".toast").count()) === 0, "cancel stops the task without an error toast");

  await addByName("Field", "A ring where division works.");
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

  const addBtn = page.getByRole("button", { name: "Add concept", exact: true });
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
  const fileMenu = page.getByRole("button", { name: "File", exact: true });
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
  await addByName("Monoid", "A set with an associative operation and an identity.");
  await waitBadge("Monoid", "ready", 15000);
  assert(chatBodies.length >= 2 && (await page.locator(".toast").count()) === 0, "a 429 is retried after Retry-After; node ends up ready, no error toast");
  assert(chatBodies.every((b) => b.includes("Output language") && b.includes("Chinese (中文)")), "the 中文 setting puts the language instruction into the prompt");
  {
    const st = await openSettings();
    assert(/This session: ~[\d.]+k tokens/.test(await st.getByTestId("token-usage").textContent()), "token usage of this session shown in Settings");
    // Back to Auto: the offline demo follows the answer language too, and the later sections expect its English.
    await st.getByLabel("AI answers in").selectOption({ label: "Auto (match the concept names)" });
    await st.getByLabel("Concurrent AI requests").fill("1");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  chatMode = "hang";
  await addByName("Semigroup", "A set with an associative operation.");
  await addByName("Lattice", "A partially ordered set with meets and joins.");
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
    const menu = await openMenu(projectButton, page.getByRole("menu", { name: "Projects" }));
    // Commands are menuitems; projects (other than the current one, marked ✓) are menuitemradios.
    const role = ["New project", "Rename…", "Duplicate", "Delete…"].includes(item) ? "menuitem" : "menuitemradio";
    await menu.getByRole(role, { name: item, exact: true }).click();
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

  console.log("Basic concepts");
  {
    // Taken as given: marking the blocked theorem basic drops its missing prerequisite; Undo brings it back.
    const panel = page.getByTestId("node-panel");
    const toggle = panel.getByTestId("basic-toggle");
    assert(!(await toggle.isChecked()), "a concept isn't basic to begin with");
    await toggle.check();
    await waitBadge("First Isomorphism Theorem", "ready");
    const card = node("First Isomorphism Theorem");
    assert(!(await card.getAttribute("class")).includes("concept--blocked") && !(await card.textContent()).includes("missing:"), "a basic concept is no longer blocked");
    assert((await card.getByRole("img", { name: "Basic concept" }).count()) === 1, "…its card carries the basic mark");
    await panel.getByTestId("basic-note").waitFor();
    assert(
      (await panel.getByTestId("install-Isomorphism").count()) === 0 && (await panel.getByTestId("install-all").count()) === 0,
      "…and the inspector says it is taken as given, with nothing to install",
    );
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="node-panel"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    assert(!violations.length, `axe finds no WCAG A/AA violations in the inspector of a basic concept${violations.map((v) => ` ${v.id}`).join("")}`);
    await page.screenshot({ path: `${shots}10-basic.png` });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await waitBadge("First Isomorphism Theorem", "blocked");
    assert(!(await toggle.isChecked()) && (await card.textContent()).includes("missing: Isomorphism"), "Undo makes it blocked on its missing prerequisite again");
  }
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
  const current = await page.getByRole("menu", { name: "Projects" }).getByRole("menuitemradio", { checked: true }).allTextContents();
  assert(
    JSON.stringify(left) === JSON.stringify(["Algebra notes"]) && JSON.stringify(current) === JSON.stringify(["Algebra notes"]),
    "deleting the example project leaves only the first one, now current",
  );
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
  const definition = await definitionField(nodePanel);
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
  await fromFile("Share link…");
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
        (await viewer.getByRole("button", { name: "Add concept", exact: true }).isVisible()),
      "a corrupt link shows an error and the normal app",
    );
    await viewer.goto(link); // only the hash changes: opened via hashchange
    await viewer.getByTestId("viewer-banner").waitFor();
    assert((await viewer.getByTestId("viewer-banner").textContent()).includes("Viewing a shared graph"), "opening the link shows the viewer banner");
    await viewer.waitForFunction((n) => document.querySelectorAll(".react-flow__node").length === n, sharedCount);
    assert(true, `the shared graph has the same ${sharedCount} concepts`);
    assert((await viewer.getByRole("button", { name: "Add concept", exact: true }).count()) === 0 && !(await viewer.getByRole("button", { name: /^Project: / }).count()), "editing controls and the project menu are hidden");
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
    await fromFile("Flashcards (Anki)…", viewer);
    const viewerCards = viewer.getByRole("dialog", { name: "Flashcards" });
    assert(/^[1-9]\d* cards$/.test(await viewerCards.getByTestId("flash-count").textContent()), "flashcards can be exported from a shared graph");
    await viewerCards.getByRole("button", { name: "Close" }).click();
    await viewer.getByRole("button", { name: "Save a copy" }).click();
    await viewer.getByTestId("viewer-banner").waitFor({ state: "detached" });
    const viewerProject = viewer.getByRole("button", { name: /^Project: / });
    assert(
      (await viewerProject.getAttribute("aria-label")) === "Project: Algebra notes 2" && (await viewer.locator(".react-flow__node").count()) === sharedCount,
      "Save a copy adds a new project with those concepts",
    );
    assert(!new URL(viewer.url()).hash && (await viewer.getByRole("button", { name: "Add concept", exact: true }).isEnabled()), "the link is cleared from the address bar and the copy is editable");
    await viewerProject.click();
    const all = await viewer.getByRole("menu", { name: "Projects" }).getByRole("menuitemradio").allTextContents();
    const checked = await viewer.getByRole("menu", { name: "Projects" }).getByRole("menuitemradio", { checked: true }).allTextContents();
    assert(
      JSON.stringify(all) === JSON.stringify(["Algebra notes", "Algebra notes 2"]) && JSON.stringify(checked) === JSON.stringify(["Algebra notes 2"]),
      "the original project is still there (the copy is current)",
    );
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
  assert(true, "the toolbar button and the close (X) button of the focus control do the same");

  const viewMenu = async () => {
    if (!(await page.getByRole("dialog", { name: "View" }).isVisible())) await page.getByRole("button", { name: /^View/ }).click();
    return page.getByRole("dialog", { name: "View" });
  };
  await (await viewMenu()).getByRole("checkbox", { name: "Prerequisite links" }).uncheck();
  await waitCounts("7/2");
  assert((await page.locator(".relation--dependency").count()) === 0, "the View filter hides dependency links (concepts stay)");
  assert(
    (await page.getByRole("button", { name: "View (filters on)" }).getByTestId("view-filtered").count()) === 1,
    "the View button shows that a filter is on (a dot, and its name says so)",
  );
  await (await viewMenu()).getByRole("checkbox", { name: "Prerequisite links" }).check();
  await page.keyboard.press("Escape"); // the popover would cover Group
  // Group is selected and ready: the to-do view hides it, and then Delete must not remove it.
  await node("Group").click();
  await (await viewMenu()).getByRole("checkbox", { name: /To-do only/ }).check();
  await waitCounts("1/0");
  assert(await node("First Isomorphism Theorem").isVisible(), "the to-do view shows only the concept that isn't ready");
  await page.keyboard.press("Escape"); // closes the popover, and focus returns to the View button
  await page.evaluate(() => document.activeElement?.blur());
  // Nothing has focus now, so Delete reaches the app's handler (as on the canvas).
  const deleteReachesApp = await page.evaluate(() => document.activeElement === document.body);
  await page.keyboard.press("Delete");
  // Finding a concept the to-do view hides turns that view off instead of selecting something invisible.
  // The pointer rests where the results appear: a row that shows up under a still pointer must not take over
  // the keyboard's choice (it used to, now and then, when the browser sent it a hover).
  await page.mouse.move(700, 210);
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

  console.log("Hide concepts");
  {
    // Hiding is a view choice for this tab: the concept and its relations leave the canvas; nothing is deleted.
    const theme = async (value) => {
      const st = await openSettings();
      const select = st.getByLabel("Theme", { exact: true });
      const was = await select.inputValue();
      await select.selectOption(value);
      await st.getByRole("button", { name: "Save", exact: true }).click();
      await st.waitFor({ state: "detached" });
      return was;
    };
    const themeBefore = await theme("light");
    await waitCounts("7/11");
    // How many relations stay when these concepts are hidden (from the saved graph).
    const linksWithout = (names) => page.evaluate((names) => {
      const s = JSON.parse(localStorage.getItem("nodestorm")).state;
      const g = s.graphs[s.activeId];
      const ids = g.nodes.filter((n) => names.includes(n.name)).map((n) => n.id);
      return g.relations.filter((r) => !ids.includes(r.a) && !ids.includes(r.b)).length;
    }, names);
    const kernelLinks = 11 - (await linksWithout(["Kernel"]));
    await node("Kernel").click();
    await page.getByTestId("hide-concept").click();
    await waitCounts(`6/${11 - kernelLinks}`);
    const count = page.getByTestId("hidden-count");
    assert(
      kernelLinks > 0 && (await node("Kernel").count()) === 0 && (await count.textContent()) === "1 hidden" && (await page.getByTestId("node-panel").count()) === 0,
      "Hide in the inspector takes the concept and its relations off the canvas, closes the inspector and shows “1 hidden”",
    );
    await page.waitForFunction(() => document.activeElement?.dataset.testid === "hidden-count");
    assert(
      (await page.locator(".sr-only[role=status]").filter({ hasText: "Hid Kernel from the canvas." }).count()) === 1,
      "the focus goes to “1 hidden” (not the page) and screen readers hear what was hidden",
    );
    await page.reload();
    await waitCounts(`6/${11 - kernelLinks}`);
    assert((await count.textContent()) === "1 hidden", "hidden concepts stay hidden after a reload (same tab)");
    await count.click();
    const list = page.getByRole("dialog", { name: "Hidden concepts" });
    await list.waitFor();
    assert((await list.getByRole("button", { name: "Show Kernel" }).count()) === 1, "the popover lists the hidden concept with a Show button");
    const { violations } = await new AxeBuilder({ page }).include(".hidden-bar").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    assert(!violations.length, `axe finds no WCAG A/AA violations in the hidden-concepts popover${violations.map((v) => ` ${v.id}`).join("")}`);
    await page.keyboard.press("Escape");
    await list.waitFor({ state: "detached" });
    assert((await page.evaluate(() => document.activeElement?.dataset.testid)) === "hidden-count", "Escape closes the popover and hands focus back");
    await count.click();
    await list.getByRole("button", { name: "Show Kernel" }).click();
    await waitCounts("7/11");
    assert((await page.getByTestId("hidden-bar").count()) === 0, "Show brings it back with its relations, and the indicator goes");

    await node("Group").click();
    await node("Homomorphism").click({ modifiers: ["Shift"] });
    await page.keyboard.press("h");
    await waitCounts(`5/${await linksWithout(["Group", "Homomorphism"])}`);
    await page.waitForFunction(() => document.querySelector("[data-testid=hidden-count]")?.textContent === "2 hidden");
    assert((await node("Group").count()) === 0 && (await node("Homomorphism").count()) === 0, "H hides the selected concepts");
    await page.waitForFunction(() => document.activeElement?.classList.contains("react-flow__node"));
    assert(true, "…and the focus goes on to a concept still shown");
    await count.click();
    await page.screenshot({ path: `${shots}11b-hidden.png` });
    await page.keyboard.press("Escape");
    // Find goes to a hidden concept by showing it again.
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Find concept" }).getByRole("combobox").fill("Homomorphism");
    await page.keyboard.press("Enter");
    await node("Homomorphism").waitFor();
    assert((await count.textContent()) === "1 hidden", "Find shows a hidden concept again");
    await page.getByTestId("hidden-show-all").click();
    await waitCounts("7/11");
    assert((await page.getByTestId("hidden-bar").count()) === 0, "Show all brings everything back");

    // Phone, dark: the indicator in the canvas corner.
    await theme("dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Find concept" }).getByRole("combobox").fill("Kernel");
    await page.keyboard.press("Enter");
    await page.getByTestId("hide-concept").click();
    await count.waitFor();
    await page.screenshot({ path: `${shots}11b-hidden-mobile.png` });
    await count.click();
    const popover = page.locator("#hidden-list");
    await popover.waitFor();
    const [pop, zoom] = await Promise.all([popover.boundingBox(), page.locator(".react-flow__controls").boundingBox()]);
    const apart = pop.x >= zoom.x + zoom.width || pop.y >= zoom.y + zoom.height || pop.y + pop.height <= zoom.y;
    assert(apart && (await noHScroll()), "on a phone the hidden-concepts list opens beside the zoom controls, not over them");
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "detached" });
    await page.getByTestId("hidden-show-all").click();
    await page.getByTestId("hidden-bar").waitFor({ state: "detached" });
    await page.setViewportSize({ width: 1400, height: 900 });
    await waitCounts("7/11");
    await theme(themeBefore);
  }

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
    await page.getByRole("button", { name: "Add concept", exact: true }).click();
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
  assert(await oneRow(), "…and at 1400px (the brand and button labels come back from 1440px)");
  await toolbar.screenshot({ path: `${shots}14-toolbar-en.png` });
  await openFile();
  const fileItems = await page.getByRole("menu", { name: "File" }).getByRole("menuitem").allTextContents();
  assert(
    JSON.stringify(fileItems) ===
      JSON.stringify([
        "Import JSON…", "Extract from text…", "Import LaTeX (.tex)…", "Save snapshot…", "Versions…", "Quiz me…", "Derive together…", "Absurd chain…", "Walkthrough…", "Notation…",
        "JSON (this project)", "Markdown notes", "LaTeX document (.tex)", "Mermaid diagram", "PNG image", "Flashcards (Anki)…", "Share link…",
      ]),
    "File holds import, Extract from text, Quiz me, Derive together, Absurd chain, Versions, every export format and the share link",
  );
  // Keyboard: the first entry has focus, arrows wrap, Escape hands focus back to the button.
  assert((await page.evaluate(() => document.activeElement?.textContent)) === "Import JSON…", "opening the File menu focuses its first entry");
  await page.keyboard.press("ArrowUp");
  assert((await page.evaluate(() => document.activeElement?.textContent)) === "Share link…", "ArrowUp from the first entry wraps to the last");
  await page.keyboard.press("Escape");
  assert((await page.evaluate(() => document.activeElement?.textContent?.trim())) === "File", "Escape returns focus to the File button");

  {
    const st = await openSettings();
    await st.getByLabel("Interface language", { exact: true }).selectOption("zh");
    await st.getByRole("button", { name: "Save", exact: true }).click();
  }
  const addZh = page.getByRole("button", { name: "添加概念", exact: true });
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
  await page.getByRole("button", { name: "Add concept", exact: true }).waitFor();
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
  await fromFile("Extract from text…");
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
  // Pasted text: Escape asks before dropping it, and Keep editing leaves it there.
  await page.keyboard.press("Escape");
  await extract.getByTestId("modal-discard").waitFor();
  await extract.getByRole("button", { name: "Keep editing" }).click();
  await extract.getByTestId("modal-discard").waitFor({ state: "detached" });
  assert((await extractText.inputValue()).startsWith("A group is a set"), "Escape with pasted text asks “Discard what you typed?”, and Keep editing keeps it");
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
    await blockLookups(ctx);
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
          "Take the 1-minute tour|Load the Group theory example|Start empty|Settings",
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
        (await p.getByRole("button", { name: "Add concept", exact: true }).evaluate((b) => b === document.activeElement)),
      "Start empty closes the card and focuses Add concept",
    );
    await p.reload();
    await p.locator(".canvas__empty").waitFor();
    assert((await p.getByTestId("welcome").count()) === 0, "…for good (still no card after a reload)");
    await ctx.close();
  }
  {
    // 中文 on a phone: the card is in Chinese, and the tour points at the More tools button instead of the folded buttons.
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
    assert(titles.at(-1) === "更多工具" && titles[1] === "安装缺少的前置知识", "on a phone the tour has 5 steps, ending at More tools (Fork, File and Settings are folded away)");
    await p.screenshot({ path: `${shots}17-tour-zh-mobile.png` });
    await tour.getByRole("button", { name: "跳过导览" }).click();
    await tour.waitFor({ state: "detached" });
    await p.reload();
    await p.getByTestId("node-群").waitFor();
    assert((await p.getByTestId("node-第一同构定理").count()) === 1 && (await p.getByTestId("node-Group").count()) === 0, "in 中文 the example is the Chinese one");
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
  {
    console.log("No relation found, and relation colours");
    // The offline demo knows no direct link between Subgroup and Homomorphism: Mix finds none either way.
    await node("Subgroup").click();
    await node("Homomorphism").click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: /Mix/ }).click();
    await page.getByText(/No relation found between “Subgroup” and “Homomorphism”/).waitFor();
    const line = page.locator("path.relation--unrelated");
    assert((await line.count()) === 1, "a Mix that finds nothing draws a “no relation” link");
    const stroke = () => line.evaluate((el) => getComputedStyle(el).stroke);
    const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--edge-unrelated").trim());
    const before = await stroke();
    assert(before !== (await page.locator("path.relation--mix").first().evaluate((el) => getComputedStyle(el).stroke)), "…in its own colour, not the mixed-relation grey");
    assert(token === "#db2777" && before === "rgb(219, 39, 119)", `…the theme's “no relation” colour (${token}, ${before})`);
    {
      const st = await openSettings();
      await st.getByTestId("edge-color-unrelated").fill("#00aa00");
      await st.getByRole("button", { name: "Save", exact: true }).click();
    }
    assert((await stroke()) === "rgb(0, 170, 0)", "a colour chosen in Settings → Relation colours is used at once");
    {
      const st = await openSettings();
      await st.getByTestId("edge-colors-reset-all").click();
      await st.getByRole("button", { name: "Save", exact: true }).click();
    }
    assert((await stroke()) === before, "Reset all goes back to the theme's colour");
    await page.getByRole("button", { name: /^View/ }).click();
    assert(await page.locator(".view-menu__legend").getByText("No relation found").isVisible(), "the View menu shows the colour legend");
    await page.keyboard.press("Escape");

    console.log("Suggest connections");
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } }); // clear the Mix selection
    await node("Subgroup").click();
    await page.getByTestId("connect-button").click();
    const conn = page.getByRole("dialog", { name: "Connections for Subgroup" });
    await conn.waitFor();
    const offered = await conn.locator(".extract__list li").allTextContents();
    assert(offered.some((x) => /Lagrange/i.test(x)), `it proposes keywords to connect, e.g. Lagrange's theorem (${offered.length} offered)`);
    assert((await page.getByTestId(/^node-Lagrange/i).count()) === 0, "…and adds nothing until the user picks");
    await conn.getByRole("button", { name: /^Add selected/ }).click();
    await page.getByTestId(/^node-Lagrange/i).first().waitFor();
    assert(true, "the picked concepts go into the graph, linked to Subgroup");

    console.log("Definition sources");
    await node("Group").click();
    const srcLine = page.getByTestId("definition-source");
    assert(/^Source:/.test((await srcLine.textContent()) ?? ""), "every definition shows its source line");
    const groupDef = await page.getByTestId("definition-view").textContent();
    await srcLine.getByTestId("lookup-menu").click();
    const menu = page.getByRole("menu", { name: "Look up in…" });
    assert(
      JSON.stringify(await menu.getByRole("menuitem").allTextContents()) ===
        JSON.stringify(["ProofWiki", "Wikipedia / Wikidata", "Baidu Baike", "Moegirl (萌娘百科)", "Fandom · choose the wiki in Settings", "BWIKI · choose the wiki in Settings", "Search the web and compare…", "Search on RedNote"]),
      "“Look up in…” offers the encyclopedias, Baidu Baike, the community wikis, a web search to compare and a RedNote search (no AI entry), even for a defined concept",
    );
    assert(
      (await page.getByTestId("lookup-rednote").getAttribute("href")) === "https://www.xiaohongshu.com/search_result?keyword=Group" &&
        (await page.getByTestId("lookup-rednote").getAttribute("target")) === "_blank",
      "RedNote (no public API) opens its own search in a new tab",
    );
    await menu.getByRole("menuitem", { name: "Search the web and compare…" }).click();
    const compare = page.getByRole("dialog", { name: "Sources" });
    await compare.getByText("Sources for “Group”").waitFor();
    await compare.getByTestId("source-item").first().waitFor();
    assert((await page.getByTestId("definition-view").textContent()) === groupDef, "the sources are only offered: the current definition stays");
    await compare.getByRole("button", { name: "Cancel", exact: true }).click();
    assert((await compare.count()) === 0 && (await page.getByTestId("definition-view").textContent()) === groupDef, "Cancel keeps the current definition");
    await srcLine.getByTestId("lookup-menu").click();
    await menu.getByRole("menuitem", { name: "Search the web and compare…" }).click();
    const encyclopedia = compare.locator('[data-site="demo-encyclopedia.example"]');
    await encyclopedia.getByRole("radio").check();
    const picked = await encyclopedia.getByTestId("source-passage").textContent();
    await compare.getByRole("button", { name: "Use this text" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="definition-source"]')?.textContent?.includes("demo-encyclopedia.example"));
    assert((await (await definitionField()).inputValue()) === picked, "choosing a passage replaces the definition with exactly that passage, the page as its source");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert(!(await page.getByTestId("definition-source").textContent()).includes("demo-encyclopedia.example"), "…as one undo step");

    console.log("Baidu Baike");
    // A stand-in for Baidu's JSONP script: it tries to reach the app's page (the sandbox must stop it), then answers.
    await page.route(/baike\.baidu\.com\/api\/openapi/, (route) => {
      const cb = new URL(route.request().url()).searchParams.get("callback");
      const body =
        "try { parent.__baikeLeak = 1 } catch (e) {}" +
        "try { localStorage.getItem('nodestorm'); parent.postMessage({ leak: 'storage' }, '*') } catch (e) {}" +
        `${cb}(${JSON.stringify({ title: "正规子群", desc: "数学术语", abstract: "设G是一个群，H是其子群。若对任何a∈G都有aH=Ha[1]，则称H是G的正规子群。", url: "http://baike.baidu.com/view/1004664.htm" })})`;
      return route.fulfill({ status: 200, contentType: "application/javascript", body });
    });
    // Earlier sections' blocked look-ups paused Baidu Baike for a while (as a refusing site is); a reload starts afresh.
    await page.reload();
    await node("Group").waitFor();
    const leaks = [];
    await page.exposeFunction("__noteLeak", (x) => leaks.push(x)).catch(() => {});
    await page.evaluate(() => window.addEventListener("message", (e) => e.data?.leak && window.__noteLeak?.(e.data.leak)));
    await addByName("正规子群");
    await node("正规子群").locator(".concept__def").waitFor({ timeout: 20000 });
    await node("正规子群").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="definition-source"]')?.textContent?.includes("Baidu Baike"), null, { timeout: 20000 });
    assert((await page.getByTestId("definition-view").textContent()).includes("则称H是G的正规子群"), "a concept with a Chinese name gets Baidu Baike's definition (footnote marks removed)");
    assert((await page.getByTestId("definition-source").getByRole("link").getAttribute("href")) === "https://baike.baidu.com/view/1004664.htm", "…with its https source link");
    assert((await page.evaluate(() => window.__baikeLeak)) === undefined && !leaks.length, "Baidu's script runs sandboxed: it can't reach the app's page or storage");
    assert((await page.locator('iframe[data-lookup="baidu"]').count()) === 0, "…and its frame is gone afterwards");
    await page.unroute(/baike\.baidu\.com\/api\/openapi/);

    // Zoomed far out, descriptions would be unreadable: cards show just their name, larger.
    const nameSize = () => node("Group").locator(".concept__name").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const near = await nameSize();
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForFunction(() => document.querySelector(".canvas")?.classList.contains("canvas--far"));
    assert(await node("Group").locator(".concept__def").isHidden(), "zoomed out, a card hides its description");
    assert((await nameSize()) > near, "…and shows its name larger");
    await page.screenshot({ path: `${shots}5e-zoomed-out.png` });
    await page.getByRole("button", { name: "Fit everything in view" }).click();
  }
  await node("First Isomorphism Theorem").click(); // blocked, with a learning path in the inspector
  await audit("main screen with a graph and a concept open in the inspector");
  {
    const st = await openSettings();
    await audit("Settings dialog");
    await st.getByRole("button", { name: "Cancel" }).click();
  }
  // The sources pop-up is audited (light and dark) in "Sources from the web".
  const firstArrow = page.locator('[data-testid^="arrow-"]').first();
  await firstArrow.click({ force: true });
  await page.getByTestId("relation-panel").waitFor();
  await audit("inspector with a relation open");
  await setTheme("dark");
  await audit("dark theme, relation open");
  await node("Group").click();
  await audit("dark theme, concept open");
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByLabel("Layered (2.5D)").check();
  await audit("dark theme, View menu with the layout choice");
  await page.getByRole("button", { name: "3D view…" }).click();
  await page.getByTestId("graph3d-canvas").waitFor({ timeout: 20000 });
  await audit("dark theme, 3D view");
  await page.screenshot({ path: `${shots}38-3d-dark.png` });
  await page.getByRole("dialog", { name: "3D view" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Physics" }).click();
  await page.waitForFunction(() => document.querySelector(".canvas")?.getAttribute("data-settled") === "true", null, { timeout: 20000 });
  await audit("dark theme, layered view with Physics");
  await page.screenshot({ path: `${shots}38-layered-dark.png` });
  await page.getByRole("button", { name: "Physics" }).click();
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByLabel("Flat").check();
  await page.keyboard.press("Escape");
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
  await page.getByRole("button", { name: "Add concept", exact: true }).waitFor();

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
  await openFile();
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
    await fromFile("Quiz me…");
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
      await fromFile(name);
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
    await openFile();
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

  console.log("Flashcards");
  {
    // The Group theory example from the Versions section: export it as Anki cards, then as CSV.
    await fromFile("Flashcards (Anki)…");
    const cards = page.getByRole("dialog", { name: "Flashcards" });
    await cards.waitFor();
    await audit("Flashcards dialog");
    const count = async () => Number((await cards.getByTestId("flash-count").textContent()).match(/\d+/)[0]);
    const all = await count();
    await cards.getByRole("checkbox", { name: /^Relations/ }).uncheck();
    const withoutRelations = await count();
    assert(withoutRelations > 0 && withoutRelations < all, `unticking relation cards leaves fewer cards (${all} → ${withoutRelations})`);
    const save = async () => {
      const [dl] = await Promise.all([page.waitForEvent("download"), cards.getByTestId("flash-download").click()]);
      return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), "utf8") };
    };
    const anki = await save();
    const lines = anki.text.trimEnd().split("\n");
    assert(anki.name.endsWith("-anki.txt"), `the Anki file is named <project>-anki.txt: ${anki.name}`);
    assert(
      ["#separator:tab", "#html:true", "#notetype:Basic", "#tags column:3"].every((h) => lines.includes(h)) &&
        lines.some((l) => l.startsWith("#deck:")),
      "the Anki file starts with the header lines Anki reads",
    );
    const notes = lines.filter((l) => !l.startsWith("#"));
    assert(notes.length === withoutRelations && notes.every((l) => l.split("\t").length === 3), "one Front/Back/Tags line per card");
    assert(notes.some((l) => l.startsWith("Homomorphism\t")), "…including a Homomorphism card");
    assert(!notes.some((l) => l.startsWith("How does ")), "…and no relation cards once unticked");
    await cards.getByRole("radio", { name: /^CSV/ }).check();
    const csv = await save();
    assert(csv.name.endsWith("-flashcards.csv"), `the CSV file is named <project>-flashcards.csv: ${csv.name}`);
    // RFC 4180: quoted fields may hold commas, doubled quotes and line breaks.
    const rows = [];
    let row = [], field = "", quoted = false;
    const src = csv.text.replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r" && src[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
      else field += c;
    }
    assert(
      JSON.stringify(rows[0]) === '["front","back","tags"]' && rows.length === withoutRelations + 1 && rows.every((r) => r.length === 3),
      "the CSV parses back into front,back,tags rows, one per card",
    );
    assert(rows.some((r) => r[0] === "Homomorphism" && r[1].length > 0), "…with the Homomorphism card and its definition");
    await cards.getByRole("button", { name: "Close" }).click();
    await cards.waitFor({ state: "detached" });
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
    const view = page.getByTestId("definition-view");
    await view.locator(".katex").first().waitFor();
    assert(!(await view.innerText()).includes("$\\ker"), "the inspector shows the definition formatted, in a box");
    const definition = await definitionField();
    const source = await definition.inputValue();
    assert(source.includes("$\\ker\\varphi$"), "the inspector edits the LaTeX source");
    const preview = page.getByTestId("definition-preview");
    await preview.locator(".katex").first().waitFor();
    assert(await preview.isVisible(), "…and shows the typeset definition under the field");
    await definition.fill("Costs \\$5, or $10 with $a^2$ and $x");
    await preview.getByText("Costs $5, or $10 with").waitFor(); // the preview shows the new text…
    await preview.locator(".katex").first().waitFor(); // …typeset
    assert((await preview.locator(".katex").count()) === 1, "an escaped \\$, prices and an unclosed $ stay text; only $a^2$ is a formula");
    assert((await preview.innerText()).includes("Costs $5, or $10 with"), "…and \\$ shows as a dollar");
    await definition.fill("Broken: $\\frac{1}{$ here");
    await preview.getByText("$\\frac{1}{$").waitFor();
    assert(!(await preview.locator(".katex").count()), "a formula KaTeX can't parse is shown as its source");
    await definition.fill("Plain text again");
    const noPreview = await preview.waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
    assert(noPreview, "text without a formula has no preview");
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

  console.log("Walkthrough");
  {
    // Still the offline demo in browser mode: Group ← Subgroup ← Normal Subgroup.
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    for (const name of ["Group", "Subgroup", "Normal Subgroup"]) {
      await addByName(name);
      await waitBadge(name, "ready");
    }
    await node("Normal Subgroup").click();
    const opener = page.getByTestId("walk-node");
    await opener.click();
    const walk = page.getByRole("dialog", { name: "Walkthrough: learning path of Normal Subgroup" });
    await walk.waitFor();
    const slideIs = (name) => textIs(walk.getByTestId("walk-name"), name);
    assert(
      (await slideIs("Group")) && (await textIs(walk.getByTestId("walk-progress"), "1 / 3")),
      "the inspector's walkthrough starts with the deepest prerequisite (1 / 3)",
    );
    await page.keyboard.press("ArrowRight");
    assert(await slideIs("Subgroup"), "→ advances to the next concept");
    assert((await walk.getByRole("button", { name: "Group", exact: true }).count()) === 1, "…which lists what it builds on");
    await page.keyboard.press("End");
    assert((await slideIs("Normal Subgroup")) && (await walk.getByTestId("walk-next").isDisabled()), "End jumps to the concept itself");
    await walk.getByTestId("walk-prev").click();
    assert(await slideIs("Subgroup"), "the Previous button goes back");
    await audit("walkthrough slide (light)");
    await page.setViewportSize({ width: 390, height: 800 });
    const [scrollW, clientW] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(scrollW <= clientW && (await walk.getByTestId("walk-next").isVisible()), "the slide fits a 390px-wide phone");
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.keyboard.press("Escape");
    await walk.waitFor({ state: "detached" });
    assert(await opener.evaluate((el) => el === document.activeElement), "Escape closes it and focus returns to the button");

    await setTheme("dark");
    await fromFile("Walkthrough…");
    const whole = page.getByRole("dialog", { name: "Walkthrough" });
    await whole.waitFor();
    await audit("walkthrough slide (dark)");
    assert(await textIs(whole.getByTestId("walk-progress"), "1 / 3"), "File → Walkthrough… covers the whole graph");
    await whole.getByTestId("walk-show").click();
    await whole.waitFor({ state: "detached" });
    const shown = await page
      .waitForFunction(() => document.querySelector('[data-testid="node-panel"] [aria-label="Rename concept"]')?.value === "Group", null, { timeout: 3000 })
      .then(() => true, () => false);
    const shownName = await page.getByTestId("node-panel").getByLabel("Rename concept").inputValue().catch(() => "(no inspector)");
    assert(shown, `Show on canvas closes it and selects the concept (${shownName})`);
    await setTheme("light");

    // Presenting a shared graph: the read-only viewer has the walkthrough too.
    await fromFile("Share link…");
    const link = await page.getByTestId("share-link").inputValue();
    await page.keyboard.press("Escape");
    const viewer = await context.newPage();
    viewer.on("pageerror", (e) => console.error("pageerror:", e.message));
    await viewer.goto(link);
    await viewer.getByTestId("viewer-banner").waitFor();
    await viewer.getByTestId("node-Normal Subgroup").click();
    await viewer.getByTestId("walk-node").click();
    const shared = viewer.getByRole("dialog", { name: "Walkthrough: learning path of Normal Subgroup" });
    await shared.waitFor();
    await viewer.keyboard.press("Space");
    assert(await textIs(shared.getByTestId("walk-name"), "Subgroup"), "the share viewer walks through a learning path too");
    await viewer.close();
  }

  console.log("Cycle resolution");
  {
    // Offline demo in browser mode. Its Chicken and Egg need each other, so adding both closes a cycle.
    const st = await openSettings();
    await st.getByText("Directly from this browser").click();
    await st.getByLabel("Provider", { exact: true }).selectOption("mock");
    await st.getByRole("button", { name: "Save", exact: true }).click();
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await addByName("Chicken");
    await waitBadge("Chicken", "blocked"); // waiting for Egg
    await addByName("Egg");
    await page.locator(".toast").filter({ hasText: "Broke a dependency cycle" }).waitFor();
    assert(
      (await page.locator(".toast").textContent()).includes("“Chicken” needs “Egg”"),
      "a check that closes a cycle resolves it automatically and says which link went, and why",
    );
    await node("Egg").click();
    assert((await page.getByTestId("cycle-warning").count()) === 0, "…so no cycle is left");
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await node("Egg").click();
    await page.getByTestId("cycle-warning").waitFor();
    assert(true, "Ctrl+Z brings the removed link (and the cycle) back");
    await audit("inspector with a dependency cycle warning");
    await page.getByTestId("resolve-cycle").click();
    await page.getByTestId("cycle-warning").waitFor({ state: "detached" });
    assert(true, "“Resolve with AI” in the inspector breaks it again");
  }

  console.log("Derive together");
  {
    // Still the offline demo in browser mode. A fresh project, so its library starts empty.
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await page.getByTestId("derive-together").click();
    const panel = page.getByTestId("derive-panel");
    await panel.getByRole("heading", { name: "Derive together" }).waitFor();
    const toast = (text) => page.locator(".toast").filter({ hasText: text }).waitFor();

    // References: a text file, and a scanned PDF (a page without text) that the vision model reads.
    await page.getByTestId("import-reference").setInputFiles({
      name: "Lecture notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("The kernel of a homomorphism is the set of elements it sends to the identity.\fA normal subgroup is invariant under conjugation."),
    });
    await toast("Imported Lecture notes (2 pages)");
    await page.getByTestId("import-reference").setInputFiles("e2e/fixtures/scanned.pdf");
    await toast("Imported scanned (1 page)");
    await panel.getByRole("button", { name: "scanned", exact: true }).click();
    await panel.getByText("Read from the scanned page by the vision model").waitFor();
    assert((await panel.getByTestId("reader-text").textContent()).includes("is a normal subgroup of"), "a scanned page is read by the vision model");
    await panel.getByRole("button", { name: "Back" }).click();

    // Chinese in a font the PDF only names (STSong-Light, predefined CMap UniGB-UCS2-H): its text is read with
    // PDF.js's CMaps, which the app serves from its versioned pdfjs-<version>/ folder (pwa/pdfjsData.ts).
    const cmap = page.waitForResponse((r) => /\/pdfjs-[\d.]+\/cmaps\/UniGB-UCS2-H\.bcmap$/.test(r.url()) && r.ok());
    await page.getByTestId("import-reference").setInputFiles("e2e/fixtures/cjk.pdf");
    await toast("Imported cjk (1 page)");
    await cmap;
    await panel.getByRole("button", { name: "cjk", exact: true }).click();
    assert((await panel.getByTestId("reader-text").textContent()).includes("群论：正规子群与商群"), "a Chinese PDF with a font that isn't embedded is read with the CMaps");
    await panel.getByRole("button", { name: "Back" }).click();
    await panel.getByRole("button", { name: "Delete cjk" }).click();
    await panel.getByRole("button", { name: "cjk", exact: true }).waitFor({ state: "detached" });

    // A problem sheet: its problems are found and listed.
    await page.getByTestId("import-problems").setInputFiles("e2e/fixtures/problems.pdf");
    await panel.getByRole("list", { name: "Problems on problems" }).waitFor();
    assert((await panel.locator(".derive-problem").count()) === 3, "the problems on an imported sheet are listed");
    await panel.getByRole("button", { name: "Start problem 1" }).click();
    assert((await panel.getByTestId("dt-problem").textContent()).includes("kernel of a group homomorphism"), "starting a problem opens it in the workspace");

    // A step with a gap, a hint that cites the notes, then a correct step that solves it.
    await panel.getByLabel("Step 1").fill("The kernel is closed under conjugation.");
    await panel.getByRole("button", { name: "Add and check" }).click();
    const v1 = panel.getByTestId("verdict-1");
    await v1.waitFor();
    assert((await v1.textContent()).includes("Gap") && (await v1.textContent()).includes("Relies on: Homomorphism"), "a step with a gap is flagged, naming what it relies on");
    await panel.getByRole("button", { name: "Hint", exact: true }).click();
    const hint = panel.locator(".derive-hint").first();
    await hint.waitFor();
    const cite = hint.getByRole("button", { name: /^\[1\] Lecture notes, p\. \d$/ });
    assert(await cite.isVisible(), "a hint cites the reference by page");
    assert(await panel.getByRole("button", { name: "Another hint" }).isVisible(), "…and the next one is a stronger hint");
    const cited = (await cite.textContent()).match(/p\. (\d)/)[1];
    await cite.click();
    await panel.getByTestId("reader-text").waitFor();
    assert((await panel.locator(".derive-reader__where").textContent()) === `Lecture notes · page ${cited} of 2`, "a citation opens the cited page");
    await panel.getByRole("button", { name: "Back" }).click();
    await panel.getByLabel("Step 2").fill("Since $\\varphi(gkg^{-1}) = \\varphi(g)\\varphi(k)\\varphi(g)^{-1} = e$, hence $gkg^{-1} \\in \\ker\\varphi$.");
    await panel.getByLabel("Step 2").press("Control+Enter");
    await panel.getByTestId("verdict-2").filter({ hasText: "Correct" }).waitFor();
    await panel.getByText("Solved.").waitFor();
    assert(true, "Ctrl+Enter adds and checks a step; a correct final step solves the problem");
    await audit("Derive together workspace");
    await setTheme("dark");
    await audit("Derive together workspace, dark theme");
    await setTheme("light");

    // Into the graph: the learner picks what goes in.
    await panel.getByRole("button", { name: "Add to graph…" }).click();
    const add = page.getByRole("dialog", { name: "Add to graph" });
    await add.waitFor();
    await audit("Add to graph dialog");
    await add.getByLabel("Include Normal Subgroup").uncheck();
    await add.getByRole("button", { name: /^Add \d items$/ }).click();
    const result = "The kernel of a group homomorphism is a normal subgroup";
    await node(result).waitFor();
    await node("Kernel").waitFor();
    assert((await page.locator('[data-testid="node-Normal Subgroup"]').count()) === 0, "only the ticked concepts are added");
    await node(result).click();
    assert((await page.locator(".inspector").textContent()).includes("Kernel"), "the result depends on the concepts it used");
    assert((await page.getByLabel("My notes").inputValue()).includes("2. Since"), "the steps are kept in the result's notes");
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await page.locator(`[data-testid="node-${result}"]`).waitFor({ state: "detached" });
    assert(true, "Ctrl+Z takes the whole addition back");

    // Pointing at a problem in a document: select its text in the reader.
    await panel.getByRole("tab", { name: "Library" }).click();
    await panel.getByRole("button", { name: "problems", exact: true }).click();
    await panel.getByTestId("reader-text").waitFor();
    await page.evaluate(() => {
      const p = [...document.querySelectorAll(".derive-reader__text p")].find((el) => el.textContent.includes("image"));
      const text = p.firstChild.nodeType === 3 ? p.firstChild : p.querySelector("span").firstChild;
      const at = text.textContent.indexOf("2. Show");
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, text.textContent.indexOf("subgroup.", at) + "subgroup.".length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await panel.getByRole("button", { name: "Use selection as problem" }).click();
    assert(
      (await panel.getByTestId("dt-problem").textContent()).startsWith("2. Show that the image of a group homomorphism is a subgroup."),
      "selected text in a document becomes the problem",
    );

    // Documents and derivations are kept (IndexedDB) across a reload.
    await page.reload();
    await page.getByTestId("derive-together").click();
    await panel.getByRole("tab", { name: "Library" }).click();
    await panel.getByRole("heading", { name: "Your derivations" }).waitFor();
    // The library fills in from IndexedDB after the heading shows.
    await page
      .waitForFunction(() => document.querySelectorAll(".derive-session").length === 2 && document.querySelectorAll(".derive-doc").length === 3, null, { timeout: 5000 })
      .catch(() => {});
    const [sessionsKept, docsKept] = [await panel.locator(".derive-session").count(), await panel.locator(".derive-doc").count()];
    assert(sessionsKept === 2 && docsKept === 3, `documents and derivations survive a reload (${sessionsKept}/2 derivations, ${docsKept}/3 documents)`);
    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "detached" });
  }

  console.log("Add with look-ups");
  {
    const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    const kernel = "== Definition ==\nThe '''kernel''' of $\\phi$ is $\\map {\\phi^{-1} } {e_H}$.";
    // The offline demo answers in the browser, so count its answers by the status-bar tasks' names instead.
    await context.unrouteAll();
    await context.route(LOOKUP_SITES, (route) => {
      const url = decodeURIComponent(route.request().url()).replace(/\+/g, " ");
      if (url.includes("proofwiki") && url.includes("page=Definition:Kernel")) return route.fulfill(json({ parse: { title: "Definition:Kernel", wikitext: kernel } }));
      if (url.includes("minecraft.fandom.com") && url.includes("titles=Kernel")) {
        return route.fulfill(json({ query: { pages: [{ title: "Kernel", extract: "The Kernel is a block found deep underground that powers the old machines." }] } }));
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    const s1 = await openSettings();
    await s1.getByTestId("new-concepts-ask").check();
    await s1.getByTestId("lookup-fandom").fill("minecraft");
    await s1.getByRole("button", { name: "Save", exact: true }).click();
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await addByName("Kernel");
    const dlg = page.getByRole("dialog", { name: "Sources" });
    await dlg.getByText("Sources for “Kernel”").waitFor();
    await dlg.getByTestId("source-item").first().waitFor();
    const sources = await dlg.getByTestId("source-item").evaluateAll((els) => els.map((e) => e.dataset.site));
    assert(sources[0] === "ProofWiki" && sources.includes("Fandom (minecraft)"), `the pop-up lists every source, the encyclopedias with the web pages: ${sources}`);
    assert(
      (await dlg.getByRole("heading", { name: /^Meaning:/ }).count()) === 2,
      "the Minecraft wiki's block is another meaning of the name: the sources are grouped by meaning",
    );
    assert((await dlg.getByTestId("sense-searched").textContent()).includes("Searched ProofWiki, Wikipedia, Fandom (minecraft)"), "…and says what was searched");
    assert((await dlg.getByTestId("sense-ask-ai").count()) === 0 && (await dlg.getByRole("button", { name: "Ask the AI" }).count()) === 0, "there is no “Ask the AI”: the AI doesn't write definitions");
    await audit("sources pop-up");
    await page.screenshot({ path: `${shots}lookups-popup.png` });
    await dlg.getByRole("radio").first().check();
    await dlg.getByRole("button", { name: "Use this text" }).click();
    await waitBadge("Kernel", "check with AI");
    assert(!(await node("Kernel").textContent()).includes("missing"), "adding and choosing a definition doesn't check prerequisites (no AI)");
    await node("Kernel").click();
    await page.getByTestId("pending-box").waitFor();
    await node("Kernel").getByRole("button", { name: "Check the prerequisites of Kernel with the AI" }).click();
    await waitBadge("Kernel", "blocked");
    assert((await node("Kernel").textContent()).includes("missing: Homomorphism"), "“Check with AI” checks its prerequisites");

    // Nothing found (the offline demo's web doesn't know the name either): the pop-up says so; the user writes one.
    await addByName("Zorblax");
    await dlg.getByText("Nothing was found for “Zorblax”.", { exact: false }).waitFor();
    assert(true, "an unknown name: the pop-up says nothing was found");
    assert(
      (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Your definition",
      "…with “My own definition” open and its definition box focused, to write one right away",
    );
    // Escape with a typed definition: asks before discarding it; Escape again keeps editing.
    await page.keyboard.type("A subset closed under the operation");
    await page.keyboard.press("Escape");
    const discard = dlg.getByTestId("modal-discard");
    await discard.waitFor();
    assert(
      (await page.evaluate(() => document.activeElement?.textContent)) === "Keep editing",
      "Escape with a typed definition asks “Discard what you typed?”, focus on Keep editing",
    );
    await page.keyboard.press("Escape");
    await discard.waitFor({ state: "detached" });
    assert(
      (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Your definition" &&
        (await dlg.getByLabel("Your definition").inputValue()) === "A subset closed under the operation",
      "…Escape again keeps editing: the text is still there and focused",
    );
    await page.keyboard.press("Escape");
    await discard.getByRole("button", { name: "Discard" }).click();
    await dlg.waitFor({ state: "detached" });
    assert(true, "…and Discard closes the pop-up");
    await waitBadge("Zorblax", "needs a definition");
    await badge("Zorblax").click();
    await dlg.getByText("Nothing was found for “Zorblax”.", { exact: false }).waitFor();
    await dlg.getByLabel("Your definition").fill("A made-up creature.");
    await dlg.getByRole("button", { name: "Use this text" }).click();
    await waitBadge("Zorblax", "check with AI");
    await node("Zorblax").click();
    assert((await page.getByTestId("definition-source").textContent()).includes("written by you"), "“My own definition” is saved as written by you");

    const s2 = await openSettings();
    await s2.getByTestId("new-concepts-ask").uncheck();
    await s2.getByTestId("lookup-fandom").fill("");
    await s2.getByRole("button", { name: "Save", exact: true }).click();
    await context.unrouteAll();
    await blockLookups(context);
  }

  console.log("Definitions from encyclopedias");
  {
    // Fixtures shaped like ProofWiki's and Wikimedia's real API answers.
    const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    const kernel = [
      "== Definition ==",
      "Let $\\phi: G \\to H$ be a [[Definition:Group Homomorphism|group homomorphism]].",
      "The '''kernel''' of $\\phi$ is the [[Definition:Set|set]]:",
      ":$\\map \\ker \\phi := \\set {x \\in G: \\map \\phi x = e_H}$",
      "{{Proofread}}",
      "== Also see ==",
      "* [[Kernel is Normal Subgroup of Domain]]",
    ].join("\n");
    await context.unrouteAll();
    await context.route(LOOKUP_SITES, (route) => {
      const url = decodeURIComponent(route.request().url()).replace(/\+/g, " ");
      if (url.includes("proofwiki") && url.includes("page=Definition:Kernel")) return route.fulfill(json({ parse: { title: "Definition:Kernel", wikitext: kernel } }));
      if (url.includes("proofwiki")) return route.fulfill({ status: 403, contentType: "text/html", headers: { "cf-mitigated": "challenge" }, body: "Just a moment..." });
      if (url.includes("titles=Expectation&")) return route.fulfill(json({ query: { pages: [{ title: "Expectation", pageprops: { disambiguation: "" }, extract: "Expectation may refer to:" }] } }));
      if (url.includes("wbsearchentities") && url.includes("Expectation")) {
        return route.fulfill(json({ search: [
          { id: "Q200125", label: "expected value", description: "long-run average value of a random variable" },
          { id: "Q7", label: "expectation", description: "belief about the future" },
        ] }));
      }
      if (url.includes("wbgetentities")) return route.fulfill(json({ entities: { Q200125: { sitelinks: { enwiki: { title: "Expected value" } } } } }));
      if (url.includes("titles=Expected value")) {
        return route.fulfill(json({ query: { pages: [{ title: "Expected value", extract: "In probability theory, the expected value is a generalization of the weighted average.", fullurl: "https://en.wikipedia.org/wiki/Expected_value" }] } }));
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    // "Ambiguous names" served other Expectation fixtures: forget the cached look-ups and this session's sources.
    await page.evaluate(() => localStorage.removeItem("nodestorm-lookup-cache"));
    await page.reload();
    // Wikipedia's language follows the AI answer language: make sure it is Auto.
    const lang = await openSettings();
    await lang.getByLabel("AI answers in").selectOption({ label: "Auto (match the concept names)" });
    await lang.getByRole("button", { name: "Save", exact: true }).click();
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();

    await addByName("Kernel");
    await waitBadge("Kernel", "blocked"); // looked up, then the AI found its prerequisites
    await node("Kernel").click();
    const def = await (await definitionField()).inputValue();
    assert(def.startsWith("Let $\\phi: G \\to H$ be a group homomorphism.") && def.includes("\\left\\{x \\in G"), "a new concept's definition comes from ProofWiki, macros turned into standard LaTeX");
    const link = page.getByTestId("definition-source").getByRole("link");
    assert((await link.textContent()) === "ProofWiki: Definition:Kernel" && (await link.getAttribute("href")) === "https://proofwiki.org/wiki/Definition:Kernel", "…with a link to its source");
    await audit("inspector with a looked-up definition");

    // ProofWiki refuses this one (a bot check), so Wikipedia and Wikidata answer: two meanings to choose from.
    await addByName("Expectation");
    const sense = page.getByRole("dialog", { name: "Sources" });
    await sense.getByTestId("source-item").first().waitFor();
    const sites = await sense.getByTestId("source-item").evaluateAll((els) => els.map((e) => e.dataset.site));
    assert(sites.includes("Wikipedia") && sites.includes("Wikidata"), `several meanings, none to take unasked: the sources pop-up, each source naming its site: ${sites}`);
    await sense.getByText("Expected value", { exact: true }).click();
    await sense.getByRole("button", { name: "Use this text" }).click();
    await node("Expected value").click();
    assert((await (await definitionField()).inputValue()).startsWith("In probability theory"), "the chosen meaning brings its definition");

    const st = await openSettings();
    await st.getByText("ProofWiki refused recent requests").waitFor();
    assert(true, "Settings says ProofWiki is being skipped for now");
    await audit("Settings with the definitions section");
    await st.getByLabel("Look definitions up in encyclopedias and wikis").uncheck();
    await st.getByRole("button", { name: "Save", exact: true }).click();
    await addByName("Normal Subgroup");
    await waitBadge("Normal Subgroup", "blocked");
    await node("Normal Subgroup").click();
    assert(
      (await (await definitionField()).inputValue()).startsWith("A subgroup $N$") && (await page.getByTestId("definition-source").textContent()).includes("demo-"),
      "with look-ups off, the most reliable web page defines a new concept (its words, its page as the source)",
    );
    await context.unrouteAll();
    await blockLookups(context);
  }

  console.log("Sources from the web");
  {
    // The offline demo's web search: an encyclopedia, lecture notes and a sloppy forum page for each concept it
    // knows; its AI rates them and points at passages. The encyclopedias are blocked here.
    const s1 = await openSettings();
    await s1.getByTestId("new-concepts-ask").check();
    await s1.getByRole("button", { name: "Save", exact: true }).click();
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    const dlg = page.getByRole("dialog", { name: "Sources" });
    const item = (site) => dlg.locator(`[data-site="${site}"]`);

    await addByName("Homomorphism");
    await dlg.getByTestId("source-item").first().waitFor();
    const rated = await dlg.getByTestId("source-item").evaluateAll((els) =>
      els.map((e) => `${e.dataset.site}:${e.querySelector('[data-testid="source-reliability"]').textContent}`),
    );
    assert(rated.includes("demo-encyclopedia.example:Reliable") && rated.includes("demo-lecture-notes.example:Reliable"), `the sources are listed with reliability badges: ${rated}`);
    assert(rated.at(-1) === "demo-forum.example:Doubtful", "the forum page is rated doubtful, and listed last");
    await item("demo-forum.example").getByText("Why?").click();
    assert(/forum/i.test(await item("demo-forum.example").getByTestId("source-reasons").textContent()), "…with the AI's reason");
    assert((await dlg.getByTestId("sources-note").textContent()).includes("demo-forum.example"), "the AI's assessment says where the sources disagree");
    assert((await dlg.getByTestId("sense-searched").textContent()).includes("Offline demo"), "the footer says what was searched");
    // Search again asks the engines past their cache: offered with a note that it uses search quota.
    assert(
      (await dlg.getByTestId("sources-search-again").isEnabled()) && /search quota/.test(await dlg.getByTestId("sources-quota").textContent()),
      "Search again is offered, noting that it uses search quota",
    );
    const link = item("demo-lecture-notes.example").getByRole("link");
    assert((await link.getAttribute("target")) === "_blank" && (await link.getAttribute("rel")) === "noopener noreferrer", "each page opens in a new tab, without opener");
    await audit("sources pop-up with web pages");
    await page.screenshot({ path: `${shots}39-sources.png` });
    // Settings can't open over the pop-up from the toolbar: close it, switch, and reopen it from the badge (this
    // session's sources come back, rated, without searching again).
    await dlg.getByRole("button", { name: "Later" }).click();
    await setTheme("dark");
    await badge("Homomorphism").click();
    await item("demo-forum.example").waitFor();
    assert((await dlg.getByTestId("sources-note").count()) === 1, "reopened from its badge, the pop-up shows the rated sources again");
    await audit("sources pop-up, dark theme");
    await page.screenshot({ path: `${shots}39-sources-dark.png` });
    await dlg.getByRole("button", { name: "Later" }).click();
    // After a reload too: the rated sources are kept (a day) in localStorage, so reopening searches nothing, neither
    // the web nor the encyclopedias, and asks the AI nothing.
    await page.waitForFunction(() => (localStorage.getItem("nodestorm-sources-cache") ?? "").includes("demo-forum.example"));
    await page.reload();
    const requests = [];
    const countRequest = (req) => !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(req.url()) && requests.push(req.url());
    page.on("request", countRequest);
    await badge("Homomorphism").click();
    await item("demo-forum.example").waitFor();
    assert(
      (await dlg.getByTestId("sources-note").count()) === 1 && (await dlg.getByTestId("sources-searching").count()) === 0 && (await dlg.getByTestId("source-reliability").first().textContent()) === "Reliable",
      "after a reload, the badge reopens the rated sources…",
    );
    assert(requests.length === 0, `…without searching again (${requests.length} requests: ${requests.join(", ")})`);
    page.off("request", countRequest);
    await dlg.getByRole("button", { name: "Later" }).click();
    await setTheme("light");
    await badge("Homomorphism").click();
    await item("demo-forum.example").waitFor();
    // Keyboard only: the pop-up opens on the first source; only the source the keyboard is on has its actions in
    // the Tab order, so "Use this text" is a few Tab presses away whatever the number of sources.
    await page.waitForFunction(() => document.activeElement?.matches('.sources input[type="radio"]'));
    await page.keyboard.press("Space");
    let tabs = 0;
    while (tabs < 40 && !(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "source-use"))) {
      await page.keyboard.press("Tab");
      tabs++;
    }
    assert(tabs <= 8, `from the pop-up's first source, “Use this text” is ${tabs} Tab presses away (3 sources)`);
    // Arrow keys move between the sources; Tab then reaches that source's actions, each naming its source.
    await item("demo-encyclopedia.example").getByRole("radio").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    assert(
      (await page.evaluate(() => document.activeElement?.closest("[data-site]")?.getAttribute("data-site"))) === "demo-lecture-notes.example",
      "arrow down to the next source, then Tab: that source's actions",
    );
    const copyNames = await dlg.getByTestId("source-edit-copy").evaluateAll((els) => els.map((e) => [e.closest("[data-site]").dataset.site, e.getAttribute("aria-label")]));
    assert(copyNames.every(([site, name]) => name === `Edit a copy (${site})`), "each source's action names its source for screen readers");
    // Keyboard: Tab reaches the radios; arrow keys move between them.
    const notes = item("demo-lecture-notes.example");
    await notes.getByRole("radio").focus();
    await page.keyboard.press("Space");
    assert(await notes.getByRole("radio").isChecked(), "a passage can be picked from the keyboard");
    // The passage is the lecture notes' own sentence (the offline demo's definition of Homomorphism), shown typeset.
    const passage = "A map between algebraic structures that preserves the operations, e.g. $\\varphi(ab) = \\varphi(a)\\varphi(b)$ for groups.";
    assert((await notes.getByTestId("source-passage").locator(".katex").count()) > 0, "the passage's formula is typeset in the pop-up");
    await dlg.getByRole("button", { name: "Use this text" }).click();
    await waitBadge("Homomorphism", "check with AI");
    await node("Homomorphism").click();
    assert((await (await definitionField()).inputValue()) === passage, "the definition is exactly the chosen passage");
    const src = page.getByTestId("definition-source").getByRole("link");
    assert(
      (await src.getAttribute("href")).startsWith("https://demo-lecture-notes.example/") && (await src.textContent()).startsWith("demo-lecture-notes.example:"),
      "…with the page as its source",
    );
    // The AI's rating of that source stays with the definition, its reason one click away.
    const rating = page.getByTestId("source-rating");
    assert(/^ · Reliable \(AI check of \d+ sources\)$/.test(await rating.textContent()), `the inspector shows the AI's rating of the source (${await rating.textContent()})`);
    await page.getByTestId("node-panel").getByText("Why?").click();
    assert((await page.getByTestId("source-rating-reasons").textContent()).length > 0, "…and why");

    // Select other words of a source with the mouse: exactly that selection is used.
    await addByName("Group");
    await item("demo-encyclopedia.example").waitFor();
    const selected = await item("demo-encyclopedia.example").getByTestId("source-passage").evaluate((mark) => {
      const text = mark.querySelector("[data-from]:not([data-to])").firstChild; // the first piece of plain text
      const range = document.createRange();
      range.setStart(text, 2);
      range.setEnd(text, Math.min(text.length, 30));
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString().trim();
    });
    await dlg.getByTestId("source-use-selection").click();
    assert(await dlg.getByTestId("source-selection").getByRole("radio").isChecked(), "“Use selected text” offers the selection as a choice, picked");
    await page.screenshot({ path: `${shots}39-sources-selection.png` });
    await dlg.getByRole("button", { name: "Use this text" }).click();
    await waitBadge("Group", "check with AI");
    await node("Group").click();
    assert((await (await definitionField()).inputValue()) === selected, `the definition is exactly the selected text (${selected})`);
    assert((await page.getByTestId("definition-source").textContent()).includes("demo-encyclopedia.example"), "…from that page");
    // Edited by hand, the definition is the user's: the source and its rating go.
    await (await definitionField()).fill(`${selected} (edited)`);
    await page.waitForFunction(() => document.querySelector('[data-testid="definition-source"]')?.textContent.includes("written by you"));
    assert((await page.getByTestId("source-rating").count()) === 0, "a definition edited by hand drops the AI's rating of its old source");

    // Formulas in a source's text are typeset; a selection that ends inside one takes the whole formula, as LaTeX.
    await addByName("Normal Subgroup");
    const enc = item("demo-encyclopedia.example");
    await enc.waitFor();
    await enc.locator(".src__math .katex").first().waitFor();
    assert(true, "formulas in a source's text are typeset");
    await enc.getByTestId("source-passage").evaluate((mark) => {
      const text = mark.querySelector("[data-from]:not([data-to])").firstChild; // "A subgroup "
      const formula = mark.querySelector("[data-to]"); // $N$, typeset
      const walker = document.createTreeWalker(formula, NodeFilter.SHOW_TEXT);
      const inside = walker.nextNode();
      const range = document.createRange();
      range.setStart(text, 2);
      range.setEnd(inside, Math.min(1, inside.length));
      document.getSelection().removeAllRanges();
      document.getSelection().addRange(range);
    });
    await dlg.getByTestId("source-use-selection").click();
    await dlg.getByRole("button", { name: "Use this text" }).click();
    await waitBadge("Normal Subgroup", "check with AI");
    await node("Normal Subgroup").click();
    const withFormula = await (await definitionField()).inputValue();
    assert(withFormula === "subgroup $N$", `a selection ending inside a formula takes all of it, as its LaTeX source (${withFormula})`);

    // Edit a copy: cut down, it stays the source's words; changed, it is the user's.
    await addByName("Subgroup");
    await item("demo-lecture-notes.example").waitFor();
    await item("demo-lecture-notes.example").getByTestId("source-edit-copy").click();
    const own = dlg.getByTestId("source-own-text");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "source-own-text");
    assert((await own.inputValue()).length > 0, "Edit a copy puts the text into “My own definition”, focused");
    const whole = await own.inputValue();
    await own.fill(whole.split(". ")[0].trim());
    assert((await dlg.getByTestId("source-copy-note").textContent()).startsWith("Still demo-lecture-notes.example's own words"), "cut down to a part of it, it is still the source's words");
    await own.fill(`${whole} (my note)`);
    assert((await dlg.getByTestId("source-copy-note").textContent()).startsWith("Changed: saved as written by you"), "changed, it says it will be saved as written by you");
    await dlg.getByRole("button", { name: "Use this text" }).click();
    await waitBadge("Subgroup", "check with AI");
    await node("Subgroup").click();
    assert((await page.getByTestId("definition-source").textContent()).includes("written by you"), "…and it is");

    // A phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await addByName("Kernel");
    await dlg.getByTestId("source-item").first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `the pop-up fits a phone (${overflow}px too wide)`);
    await page.screenshot({ path: `${shots}39-sources-phone.png` });
    await dlg.getByRole("button", { name: "Later" }).click();
    await page.setViewportSize({ width: 1400, height: 900 });

    // 中文.
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await blockLookups(ctx);
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("nodestorm-ui-language", "zh");
          localStorage.setItem("nodestorm-settings", JSON.stringify({ state: { provider: "mock", connection: "browser", newConcepts: "ask" }, version: 1 }));
          localStorage.setItem("nodestorm-onboarding", JSON.stringify({ welcome: "done", tour: "skipped" }));
        } catch {}
      });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => console.error("pageerror:", e.message));
      await p.goto(`http://localhost:${WEB_PORT}/`);
      await p.getByRole("button", { name: "添加概念", exact: true }).click();
      await p.getByLabel("概念名称").fill("Kernel");
      await p.getByRole("button", { name: "添加", exact: true }).click();
      const zh = p.getByRole("dialog", { name: "来源" });
      await zh.getByText("“Kernel”的来源").waitFor();
      await zh.getByTestId("source-item").first().waitFor();
      assert((await zh.getByText("存疑").count()) === 1 && (await zh.getByRole("button", { name: "使用这段文字" }).count()) === 1, "in 中文 the pop-up is Chinese");
      await p.screenshot({ path: `${shots}39-sources-zh.png` });
      await zh.getByRole("button", { name: "稍后" }).click();

      // The offline demo in Chinese: on the Chinese example, Mix and the sources of a new concept are Chinese too.
      const projects = await openMenu(p.getByRole("button", { name: /^项目：/ }), p.getByRole("menu", { name: "项目" }), p);
      await projects.getByRole("menuitem", { name: "新建项目", exact: true }).click();
      await p.getByLabel("项目名称").press("Enter");
      await p.getByRole("button", { name: "载入示例：群论" }).click();
      await p.getByTestId("node-核").waitFor();
      await p.getByTestId("node-核").click();
      await p.getByTestId("node-同态").click({ modifiers: ["Shift"] });
      await p.getByRole("button", { name: /混合/ }).click();
      await p.getByTestId("relation-panel").waitFor();
      // The panel may open on 同态's side (no relation that way): look at what 核 does to 同态.
      const other = p.getByRole("button", { name: "查看 核 对 同态 的作用" });
      if (await other.count()) await other.click();
      const kind = await p.getByTestId("relation-kind").inputValue();
      const why = await p.getByTestId("relation-explanation").inputValue();
      assert(kind === "使用" && why === "核是对同态定义的。", `Mix in the Chinese example gives a Chinese relation label (${kind}: ${why})`);
      await p.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
      await p.getByRole("button", { name: "添加概念", exact: true }).click();
      await p.getByLabel("概念名称").fill("拉格朗日定理");
      await p.getByRole("button", { name: "添加", exact: true }).click();
      await zh.getByText("“拉格朗日定理”的来源").waitFor();
      await zh.getByTestId("source-item").first().waitFor();
      const sites = await zh.getByTestId("source-item").evaluateAll((els) => els.map((e) => e.dataset.site));
      assert(
        ["zh.demo-encyclopedia.example", "zh.demo-lecture-notes.example", "zh.demo-forum.example"].every((s) => sites.includes(s)),
        `a Chinese name finds the demo's Chinese pages (${sites})`,
      );
      const forum = zh.locator('[data-site="zh.demo-forum.example"]');
      await forum.getByText("原因").click();
      const reasons = await zh.getByTestId("source-reasons").allTextContents();
      assert(
        reasons.length >= 3 && reasons.every((r) => /\p{Script=Han}/u.test(r) && !/[A-Za-z]{4}/.test(r)) &&
          (await forum.getByTestId("source-reasons").textContent()).startsWith("论坛帖子") &&
          (await zh.getByTestId("sources-note").textContent()).includes("与其他来源矛盾"),
        `…rated with Chinese reasons and note (${reasons.join(" | ")})`,
      );
      await p.screenshot({ path: `${shots}39-sources-zh-demo.png` });
      await ctx.close();
    }
    const s2 = await openSettings();
    await s2.getByTestId("new-concepts-ask").uncheck();
    await s2.getByRole("button", { name: "Save", exact: true }).click();
  }

  console.log("Absurd chain");
  {
    // Still the offline demo in browser mode: its chains run through a short list of true facts.
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await addByName("Homomorphism");
    await addByName("Group");
    await waitBadge("Group", "ready");
    await waitBadge("Homomorphism", "ready");
    const mainNodes = await page.locator(".react-flow__node").count();

    // Free-form, from the File menu: two ends that aren't in the graph at all.
    await fromFile("Absurd chain…");
    const dlg = page.getByRole("dialog", { name: "Absurd chain" });
    await dlg.waitFor();
    assert(await dlg.getByRole("button", { name: "Build the chain" }).isDisabled(), "the chain needs two ends");
    await dlg.getByLabel("From", { exact: true }).fill("Fourier transform");
    await dlg.getByLabel("To", { exact: true }).fill("fourier transforms");
    await dlg.getByText("Pick two different concepts.").waitFor();
    await dlg.getByLabel("To", { exact: true }).fill("Toast");
    await dlg.getByLabel("Style").selectOption("conspiracy");
    await dlg.getByLabel("To", { exact: true }).press("Enter");
    const result = dlg.getByTestId("absurd-result");
    await result.waitFor();
    const hops = dlg.getByRole("list", { name: "The chain" }).getByRole("listitem");
    assert(
      (await hops.count()) === 4 &&
        (await result.getByRole("heading").textContent()) === "What they don't want you to know about Fourier transform and Toast",
      "Enter builds a chain from Fourier transform to Toast, in four links with a title in the chosen style",
    );
    const first = hops.first();
    assert(
      (await first.textContent()).includes("inventing a fix for") && (await first.textContent()).includes("Joseph Fourier developed Fourier analysis"),
      "each link shows its relation and its sober fact",
    );
    assert(
      (await first.locator(".absurd-hop__quip").evaluate((el) => getComputedStyle(el).fontStyle)) === "italic",
      "…and its narration, set apart in italics",
    );
    await hops.nth(1).locator(".katex").first().waitFor();
    assert(true, "formulas in a fact are typeset");
    assert((await result.textContent()).includes("Connect enough dots"), "the chain ends with its moral");
    await audit("Absurd chain dialog with a chain");
    const quip1 = await first.locator(".absurd-hop__quip").textContent();
    await dlg.getByRole("button", { name: "Roll again" }).click();
    await page.waitForFunction(
      (q) => document.querySelector(".absurd-hop__quip")?.textContent !== q,
      quip1,
    );
    assert(true, "Roll again asks for another chain between the same ends");

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://localhost:${WEB_PORT}` });
    await dlg.getByRole("button", { name: "Copy as text" }).click();
    await page.locator(".toast").filter({ hasText: "Chain copied" }).waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(
      copied.startsWith("What they don't want you to know") && copied.includes("1. Fourier transform → Heat equation (inventing a fix for)") && copied.includes("Moral: "),
      "Copy as text puts the whole chain on the clipboard",
    );
    await page.screenshot({ path: `${shots}30-absurd-chain.png` });

    // Into a sandbox: the graph itself stays as it was.
    await dlg.getByRole("button", { name: "Add to a sandbox" }).click();
    await dlg.waitFor({ state: "detached" });
    await page.getByTestId("sandbox-banner").filter({ hasText: "What they don't want you to know" }).waitFor();
    await node("Maillard reaction").waitFor();
    assert((await page.locator(".react-flow__node").count()) === mainNodes + 5, "Add to a sandbox forks the graph under the chain's title and adds the chain's five concepts there");
    await page.getByRole("combobox", { name: "Graph" }).selectOption({ label: "Main graph" });
    await page.getByTestId("sandbox-banner").waitFor({ state: "detached" });
    assert((await page.locator(".react-flow__node").count()) === mainNodes, "…while the main graph is unchanged");

    // From the toolbar, with two concepts selected: they are the two ends.
    await setTheme("dark");
    await node("Homomorphism").click();
    await node("Group").click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Absurd chain", exact: true }).click();
    await dlg.waitFor();
    assert(
      (await dlg.getByLabel("From", { exact: true }).inputValue()) === "Homomorphism" && (await dlg.getByLabel("To", { exact: true }).inputValue()) === "Group",
      "the toolbar's Absurd chain starts from the two selected concepts",
    );
    await dlg.getByRole("button", { name: "Swap the two ends" }).click();
    await dlg.getByRole("button", { name: "Build the chain" }).click();
    await result.waitFor();
    assert((await hops.first().textContent()).includes("Group") && (await hops.count()) === 1, "Swap turns the chain around");
    await audit("Absurd chain dialog, dark theme");
    await page.screenshot({ path: `${shots}31-absurd-chain-dark.png` });
    await dlg.getByRole("button", { name: "Close" }).click();
    await setTheme("light");

    // Stops along the way: one concept of the graph (typed in lower case) and one of the user's own, with what it means.
    await fromFile("Absurd chain…");
    await dlg.waitFor();
    await dlg.getByLabel("From", { exact: true }).fill("Fourier transform");
    await dlg.getByLabel("To", { exact: true }).fill("Toast");
    const via = dlg.getByRole("group", { name: "Stops along the way" });
    const stopRows = via.getByTestId("absurd-stop");
    const newStop = via.getByLabel("New stop", { exact: true });
    await newStop.fill("Grandma's oven");
    await newStop.press("Enter");
    await stopRows.nth(0).waitFor();
    await newStop.fill("homomorphism");
    await via.getByRole("button", { name: "Add stop" }).click();
    await stopRows.nth(1).waitFor();
    assert(
      (await stopRows.nth(1).textContent()).includes("Homomorphism") && (await stopRows.nth(1).textContent()).includes("In your graph"),
      "a stop typed as a concept of the graph takes its name and is marked as in the graph",
    );
    await newStop.fill("Toast");
    await newStop.press("Enter");
    await via.getByText("“Toast” is one of the ends").waitFor();
    assert((await stopRows.count()) === 2, "an end can't also be a stop");
    await newStop.fill("");
    // Reorder with the keyboard: Homomorphism first, then the custom stop; the focus stays on the moved row.
    await via.getByRole("button", { name: "Move “Homomorphism” up" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Move “Homomorphism” down");
    assert((await stopRows.nth(0).textContent()).includes("Homomorphism"), "Move up reorders the stops and keeps the focus on the moved one");
    await via.getByLabel("What “Grandma's oven” means").fill("The oven in my grandmother's kitchen, which also makes toast.");
    await dlg.getByRole("button", { name: "Build the chain" }).click();
    await result.waitFor();
    const onChain = await hops.evaluateAll((els) => els.map((el) => [...el.querySelectorAll(".absurd-hop__ends strong")].map((s) => s.textContent)));
    const names = [onChain[0][0], ...onChain.map((h) => h[1])];
    assert(
      names[0] === "Fourier transform" && names.at(-1) === "Toast" && names.indexOf("Homomorphism") > 0 && names.indexOf("Grandma's oven") > names.indexOf("Homomorphism"),
      `the chain passes through both stops, in order (${names.join(" → ")})`,
    );
    assert((await result.getByText("your stop").count()) === 2, "the user's stops are marked in the chain");
    await audit("Absurd chain dialog with stops");
    await page.screenshot({ path: `${shots}31b-absurd-chain-stops.png` });
    await dlg.getByRole("button", { name: "Add to a sandbox" }).click();
    await dlg.waitFor({ state: "detached" });
    await node("Grandma's oven").click();
    assert(
      (await (await definitionField()).inputValue()) === "The oven in my grandmother's kitchen, which also makes toast." &&
        (await page.getByTestId("node-panel").textContent()).includes("written by you"),
      "in the sandbox, the custom stop's definition is the user's description, written by you",
    );
    await page.getByRole("combobox", { name: "Graph" }).selectOption({ label: "Main graph" });
    await page.getByTestId("sandbox-banner").waitFor({ state: "detached" });
  }

  console.log("Lean / Mathlib");
  {
    // Loogle answers with fixtures: it knows two of the offline demo's three names for "Kernel".
    const known = {
      "MonoidHom.ker": { type: " {G : Type u_1} [Group G] {M : Type u_6} [MulOneClass M] (f : G →* M) : Subgroup G", doc: "The multiplicative kernel of a monoid homomorphism is the subgroup of elements `x : G` such that `f x = 1`" },
      "MonoidHom.normal_ker": { type: " {G : Type u_1} [Group G] {M : Type u_6} [MulOneClass M] (f : G →* M) : f.ker.Normal", doc: null },
    };
    await context.unrouteAll();
    await context.route(LOOKUP_SITES, (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "loogle.lean-lang.org") return route.abort();
      const q = url.searchParams.get("q");
      const k = known[q];
      const body = k ? { count: 1, hits: [{ name: q, type: k.type, module: "Mathlib.Algebra.Group.Subgroup.Ker", doc: k.doc }] } : { error: `unknown identifier '${q}'` };
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    });
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await addByName("Kernel");
    await waitBadge("Kernel", "blocked");
    await node("Kernel").click();
    const formal = page.getByTestId("formal");
    await formal.getByTestId("formal-button").click();
    await formal.locator(".formal-decl").first().waitFor();
    const names = await formal.locator(".formal-decl__name").allTextContents();
    assert(JSON.stringify(names) === JSON.stringify(["MonoidHom.ker", "MonoidHom.normal_ker"]), "Find in Mathlib lists only declarations Loogle confirms");
    assert((await formal.textContent()).includes("Not in Mathlib (dropped): MonoidHom.kernelSubgroupOfDoom"), "…and says which suggestions were dropped");
    assert(
      (await formal.getByRole("link", { name: "MonoidHom.ker" }).getAttribute("href")) ===
        "https://leanprover-community.github.io/mathlib4_docs/Mathlib/Algebra/Group/Subgroup/Ker.html#MonoidHom.ker",
      "each links to the Mathlib documentation",
    );
    const tryIt = await formal.getByRole("link", { name: "Try it in the Lean editor" }).first().getAttribute("href");
    assert(decodeURIComponent(tryIt).endsWith("#code=import Mathlib\n\n#check MonoidHom.ker\n"), "…and opens it in the Lean web editor with Mathlib imported");
    await audit("inspector with Mathlib declarations");
    await context.unrouteAll();
    await blockLookups(context);
  }

  console.log("Papers");
  {
    // OpenAlex answers with fixtures (still on "Kernel" from the Mathlib section, which is missing "Homomorphism").
    const filters = [];
    let hold = null; // a promise the next answer waits for (to test Cancel)
    const works = [
      {
        id: "https://openalex.org/W101",
        doi: "https://doi.org/10.1017/S1446788700014567",
        display_name: "Kernels of inverse semigroup homomorphisms",
        publication_year: 1974,
        authorships: ["D. B. McAlister", "N. R. Reilly", "A. Third", "B. Fourth"].map((display_name) => ({ author: { display_name } })),
        primary_location: { landing_page_url: "https://www.cambridge.org/x", source: { display_name: "Journal of the Australian Mathematical Society" } },
        cited_by_count: 1234,
        open_access: { oa_url: "https://arxiv.org/abs/0000.0001" },
      },
      {
        id: "https://openalex.org/W102",
        doi: null,
        display_name: "The kernel of a <i>homomorphism</i>",
        publication_year: 1996,
        authorships: [{ author: { display_name: "C. Author" } }],
        primary_location: { landing_page_url: "http://insecure.example.org/paper", source: null },
        cited_by_count: 3,
        open_access: { oa_url: null },
      },
    ];
    await context.unrouteAll();
    await context.route(LOOKUP_SITES, async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "api.openalex.org") return route.abort();
      filters.push(url.searchParams.get("filter"));
      if (hold) await hold;
      // A cancelled request may be gone by now.
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ meta: { count: 2 }, results: works }) }).catch(() => {});
    });
    const papers = page.getByTestId("papers");
    await papers.scrollIntoViewIfNeeded();
    assert((await papers.textContent()).includes("every paper listed exists"), "the Papers section says what it does before a search");
    // Cancel a slow search: nothing is stored.
    let release;
    hold = new Promise((r) => (release = r));
    await papers.getByTestId("papers-button").click();
    await papers.getByTestId("papers-cancel").click();
    release();
    hold = null;
    await papers.getByRole("button", { name: "Find papers" }).waitFor();
    assert((await papers.locator(".paper").count()) === 0, "a cancelled search stores nothing");
    await papers.getByTestId("papers-button").click();
    await papers.locator(".paper").first().waitFor();
    const searched = filters.slice(-2).map((f) => f.split(",")[0]);
    // Two works are fewer than half the list, so the name alone fills it up (the same two here, not repeated).
    assert(
      JSON.stringify(searched) === JSON.stringify(['title_and_abstract.search:"kernel" AND ("homomorphism")', 'title_and_abstract.search:"kernel"']),
      `the search uses the concept's prerequisites, then the name alone: ${searched}`,
    );
    const titles = await papers.locator(".paper__title").allTextContents();
    assert(JSON.stringify(titles) === JSON.stringify(["Kernels of inverse semigroup homomorphisms", "The kernel of a homomorphism"]), `lists the papers OpenAlex found: ${titles}`);
    const first = papers.getByRole("link", { name: "Kernels of inverse semigroup homomorphisms" });
    assert((await first.getAttribute("href")) === "https://doi.org/10.1017/S1446788700014567", "a title links to its DOI");
    assert((await first.getAttribute("target")) === "_blank" && (await first.getAttribute("rel")) === "noopener noreferrer", "…in a new tab, without an opener");
    const meta = await papers.locator(".paper__meta").first().textContent();
    assert(meta.includes("D. B. McAlister, N. R. Reilly, A. Third et al., 1974, Journal of the Australian Mathematical Society · cited by 1,234"), `byline and citations: ${meta}`);
    assert((await papers.getByRole("link", { name: "Free copy" }).getAttribute("href")) === "https://arxiv.org/abs/0000.0001", "an open-access copy is linked");
    // A work with only a plain-http page links to OpenAlex instead.
    assert((await papers.getByRole("link", { name: "The kernel of a homomorphism" }).getAttribute("href")) === "https://openalex.org/W102", "never an http link");
    assert((await papers.getByRole("link", { name: "Search OpenAlex yourself" }).getAttribute("href")).startsWith("https://openalex.org/works?search="), "links to searching OpenAlex");
    assert(await papers.getByRole("button", { name: "Search again" }).isVisible(), "offers Search again");
    await audit("inspector with papers");
    await setTheme("dark");
    await audit("inspector with papers, dark theme");
    await page.screenshot({ path: `${shots}35-papers-dark.png` });
    await setTheme("light");
    // The result survives a reload (stored on the node, like Mathlib results).
    await page.reload();
    await node("Kernel").click();
    await page.getByTestId("papers").locator(".paper").first().waitFor();
    assert((await page.getByTestId("papers").locator(".paper").count()) === 2, "papers survive a reload");
    await context.unrouteAll();
    await blockLookups(context);
  }

  console.log("Concept kinds");
  {
    // Still the offline demo in browser mode; a fresh project.
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await addByName("Lagrange's theorem");
    await waitBadge("Lagrange's theorem", "blocked"); // needs Subgroup
    const tag = (name) => node(name).locator(".kind-tag");
    await tag("Lagrange's theorem").waitFor();
    assert((await tag("Lagrange's theorem").textContent()) === "Theorem", "the check classifies a theorem, and its card says so");
    await page.getByTestId("install-Subgroup").click();
    await tag("Subgroup").waitFor();
    assert((await tag("Subgroup").textContent()) === "Definition", "an installed prerequisite gets its kind too");
    await node("Lagrange's theorem").click();
    const select = page.getByTestId("kind-select");
    assert((await select.inputValue()) === "theorem", "the inspector shows the kind");
    await select.selectOption("lemma");
    await tag("Lagrange's theorem").filter({ hasText: "Lemma" }).waitFor({ timeout: 5000 });
    assert(true, "changing the kind in the inspector updates the card");
    await select.selectOption("");
    await tag("Lagrange's theorem").waitFor({ state: "detached", timeout: 5000 });
    assert(true, "…and “Not set” removes the tag");
    await select.selectOption("theorem");
    await audit("kind tags on cards and the kind select");
    await setTheme("dark");
    await audit("kind tags on cards and the kind select, dark theme");
    await setTheme("light");

    // The View menu filters by kind.
    await page.getByRole("button", { name: /^View/ }).click();
    const view = page.getByRole("dialog", { name: "View" });
    await view.getByRole("checkbox", { name: "Theorem", exact: true }).uncheck();
    await node("Lagrange's theorem").waitFor({ state: "detached" });
    assert(await node("Subgroup").isVisible(), "unticking Theorem in View hides the theorems, and only them");
    assert((await page.getByRole("button", { name: "View (filters on)" }).count()) === 1, "…and the View button says a filter is on");
    await audit("View menu with kind filters");
    await view.getByRole("checkbox", { name: "Theorem", exact: true }).check();
    await node("Lagrange's theorem").waitFor();
    await page.keyboard.press("Escape");
  }

  console.log("Theorem anatomy");
  {
    await node("Subgroup").click();
    assert((await page.getByTestId("anatomy").count()) === 0, "a definition has no theorem anatomy");
    await node("Lagrange's theorem").click();
    await page.getByTestId("anatomy-button").click();
    const conclusion = page.getByTestId("anatomy-conclusion");
    await conclusion.waitFor();
    assert((await page.getByTestId("anatomy-hypotheses").locator("li").count()) === 2, "a theorem is taken apart into its hypotheses…");
    assert((await conclusion.locator(".katex").count()) > 0, "…and a conclusion with its formulas typeset");
    const section = page.getByTestId("anatomy");
    assert(
      (await section.textContent()).includes("Why needed:") && (await section.textContent()).includes("Non-examples"),
      "each hypothesis says why it is needed; examples and non-examples follow",
    );
    assert((await page.getByTestId("anatomy-button").textContent()).includes("Regenerate"), "the button offers to regenerate it");
    await page.locator(".inspector").screenshot({ path: `${shots}30-anatomy.png` });
    await audit("theorem anatomy in the inspector");
    await setTheme("dark");
    await audit("theorem anatomy in the inspector, dark theme");
    await setTheme("light");
    await page.reload();
    await node("Lagrange's theorem").click();
    await page.getByTestId("anatomy-conclusion").waitFor();
    assert(true, "the anatomy is kept on the concept across a reload");
  }

  console.log("LaTeX export");
  {
    const tex = await exportAs("LaTeX document (.tex)");
    const src = tex.data.toString("utf8");
    assert(tex.name.endsWith(".tex") && src.includes("\\documentclass{amsart}") && src.trimEnd().endsWith("\\end{document}"), "File exports a LaTeX document");
    assert(
      src.indexOf("\\begin{definition}[{Subgroup}]\\label{c:subgroup}") >= 0 &&
        src.indexOf("\\label{c:subgroup}") < src.indexOf("\\begin{theorem}[{Lagrange's theorem}]"),
      "each concept is an environment of its kind, prerequisites first",
    );
    assert(src.includes("\\emph{Uses:} Definition~\\ref{c:subgroup} (Subgroup)."), "a theorem refers to the definition it uses");
    assert(src.includes("\\begin{proof}[Proof idea]") && src.includes("$|H|$ divides $|G|$"), "the anatomy's proof idea is a proof sketch, formulas kept");
  }

  console.log("Notation glossary");
  {
    const openGlossary = async () => {
      await fromFile("Notation…");
      const dialog = page.getByRole("dialog", { name: "Notation" });
      await dialog.waitFor();
      return dialog;
    };
    let dialog = await openGlossary();
    assert((await dialog.textContent()).includes("No notation yet"), "a graph without symbols says how to get some");
    await dialog.getByRole("button", { name: "Close" }).click();

    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.getByRole("button", { name: "Load example: Group theory" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 7);
    // Hide the definitions: jumping to one from the glossary must show it again.
    await page.getByRole("button", { name: /^View/ }).click();
    await page.getByRole("dialog", { name: "View" }).getByRole("checkbox", { name: "Definition", exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await node("Kernel").waitFor({ state: "detached" });
    dialog = await openGlossary();
    const rows = dialog.getByTestId("glossary").locator("tbody tr");
    assert((await rows.count()) >= 3, "the glossary lists the symbols the definitions introduce");
    const kernelRow = rows.filter({ hasText: "Kernel" });
    assert((await kernelRow.locator(".glossary__symbol .katex").count()) === 1, "…typeset, e.g. the kernel's symbol");
    await audit("notation glossary");
    await dialog.getByRole("button", { name: "Close" }).click();
    await setTheme("dark");
    dialog = await openGlossary();
    await audit("notation glossary, dark theme");
    await dialog.getByRole("button", { name: "Close" }).click();
    await setTheme("light");
    dialog = await openGlossary();
    await dialog.getByRole("button", { name: "Kernel" }).click();
    await dialog.waitFor({ state: "detached" });
    await node("Kernel").waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Rename concept"]')?.value === "Kernel");
    assert(true, "a glossary entry jumps to its concept, turning off the filter that hid it");
  }

  console.log("LaTeX import");
  {
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await page.getByTestId("tex-import").setInputFiles("e2e/fixtures/homomorphisms.tex");
    const dlg = page.getByRole("dialog", { name: "Import from LaTeX: Notes on Group Homomorphisms" });
    await dlg.waitFor();
    const names = await dlg.locator(".extract__name").evaluateAll((els) => els.map((e) => e.value));
    assert(
      JSON.stringify(names) === JSON.stringify(["Homomorphism", "Kernel", "Lemma 1.3 (Notes on Group Homomorphisms)", "First Isomorphism Theorem", "Remark (Notes on Group Homomorphisms)"]),
      "a .tex file's definitions, lemma, theorem and remark become candidates, named by title or defined term",
    );
    await audit("LaTeX import review");
    await dlg.getByLabel("Add Remark (Notes on Group Homomorphisms)").uncheck();
    await dlg.getByLabel("Name for Lemma 1.3 (Notes on Group Homomorphisms)").fill("Kernel is normal");
    await dlg.getByRole("button", { name: /^Add/ }).last().click();
    await node("First Isomorphism Theorem").waitFor();
    await node("Kernel is normal").waitFor();
    assert((await page.locator('[data-testid="node-Remark (Notes on Group Homomorphisms)"]').count()) === 0, "unticked results are left out, renamed ones keep the new name");
    await node("First Isomorphism Theorem").click();
    const panel = await page.locator(".inspector").textContent();
    assert(panel.includes("Kernel is normal") && panel.includes("Homomorphism"), "a result needs what it refers to (\\ref in its statement or proof)");
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await page.locator('[data-testid="node-First Isomorphism Theorem"]').waitFor({ state: "detached" });
    assert(true, "the whole import is one undo step");
  }

  console.log("Parody voices & Reviewer 2");
  {
    // Still the offline demo in browser mode; a fresh project with one concept.
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.locator(".canvas__empty").waitFor();
    await addByName("Homomorphism");
    await waitBadge("Homomorphism", "ready");
    await node("Homomorphism").click();
    const inspector = page.locator(".inspector");
    const explain = page.getByTestId("explain");
    await explain.getByLabel("Explanation level").selectOption("rigorous");
    await explain.getByLabel("Narrator").selectOption("noir-detective");
    assert(
      await inspector.evaluate((el) => el.scrollWidth <= el.clientWidth),
      "the level and narrator selects fit the inspector's width",
    );
    await explain.getByTestId("explain-button").click();
    const tag = explain.getByTestId("explain-voice-tag");
    await tag.waitFor();
    const text = await explain.textContent();
    assert(
      (await tag.textContent()) === "Noir detective" && text.includes("Rigorous explanation") && text.includes("The rain hadn't stopped"),
      "Explain more tells a rigorous explanation in the chosen narrator's voice, and says which",
    );
    assert(
      (await explain.getByTestId("explanation-summary").textContent()).includes("preserves the operations") &&
        (await explain.locator(".explain__list .katex").count()) > 0,
      "…while the summary stays a plain definition and the formulas are still typeset",
    );
    await audit("inspector with a voiced explanation");
    await inspector.screenshot({ path: `${shots}32-explain-voice.png` });
    await setTheme("dark");
    await audit("inspector with a voiced explanation, dark theme");
    await setTheme("light");
    await page.reload();
    await node("Homomorphism").click();
    await explain.getByTestId("explain-voice-tag").waitFor();
    assert((await explain.getByLabel("Narrator").inputValue()) === "noir-detective", "the voice is kept with the explanation across a reload");

    // Reviewer 2 on a derivation with a gap.
    await inspector.getByTestId("derive-node").click();
    const panel = page.getByTestId("derive-panel");
    await panel.getByTestId("dt-problem").waitFor();
    await panel.getByLabel("Step 1").fill("The kernel is closed under conjugation.");
    await panel.getByRole("button", { name: "Add step", exact: true }).click();
    await panel.getByTestId("dt-referee").click();
    const report = panel.getByTestId("dt-referee-report");
    await report.waitFor();
    const reportText = await report.textContent();
    assert(
      reportText.includes("Referee report") && reportText.includes("Major revisions") && reportText.includes("Grudging praise"),
      "Reviewer 2 writes a referee report with a verdict and grudging praise",
    );
    assert(
      (await report.locator(".derive-referee__point").first().textContent()).startsWith("MajorStep 1"),
      "…whose points name the step and how serious they are, most serious first",
    );
    await audit("Derive together with a referee report");
    await panel.screenshot({ path: `${shots}33-referee.png` });
    await setTheme("dark");
    await audit("Derive together with a referee report, dark theme");
    await panel.screenshot({ path: `${shots}34-referee-dark.png` });
    await setTheme("light");
    await panel.getByLabel("Step 2").fill("So it is normal.");
    await panel.getByRole("button", { name: "Add step", exact: true }).click();
    await report.getByText("Your steps have changed since this report.").waitFor();
    assert(true, "a report says when the steps changed after it");
    await report.locator("summary").click();
    assert(await report.locator(".derive-referee__summary").isHidden(), "the report collapses");
    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "detached" });

    // Surprise me: with one concept in the graph, it is one of the ends.
    await fromFile("Absurd chain…");
    const dlg = page.getByRole("dialog", { name: "Absurd chain" });
    await dlg.waitFor();
    await dlg.getByLabel("From", { exact: true }).fill("");
    await dlg.getByLabel("To", { exact: true }).fill("");
    await dlg.getByTestId("absurd-surprise").click();
    await dlg.getByTestId("absurd-result").waitFor();
    const from = await dlg.getByLabel("From", { exact: true }).inputValue();
    const to = await dlg.getByLabel("To", { exact: true }).inputValue();
    assert(from === "Homomorphism" && to && to !== from, `Surprise me picks the graph's concept and a fun end (${from} → ${to}) and builds the chain`);
    await audit("Absurd chain dialog after Surprise me");
    await dlg.getByRole("button", { name: "Close" }).click();
  }

  console.log("Guess the chain");
  {
    // The offline demo's Homomorphism → Toast chain: Exponential function, Fourier transform, Heat equation, Heat and
    // Maillard reaction are hidden between the ends.
    const openChain = async () => {
      await fromFile("Absurd chain…");
      const d = page.getByRole("dialog", { name: "Absurd chain" });
      await d.waitFor();
      await d.getByLabel("From", { exact: true }).fill("Homomorphism");
      await d.getByLabel("To", { exact: true }).fill("Toast");
      await d.getByTestId("absurd-play").click();
      await d.getByTestId("chain-game").waitFor();
      return d;
    };
    const dlg = await openChain();
    const board = dlg.getByTestId("chain-game");
    const hops = board.getByRole("list", { name: "The chain" }).getByRole("listitem");
    const score = board.getByTestId("chain-game-score");
    const feedback = board.getByTestId("chain-game-feedback");
    const guessField = board.getByLabel("Guess a hidden concept");
    assert(
      (await hops.count()) === 6 && (await score.textContent()) === "Score 0 / 15" &&
        (await board.textContent()).includes("6 links, 5 hidden concepts") &&
        (await hops.first().textContent()).includes("including"),
      "Guess the chain shows the two ends, six links with their relations and five hidden concepts",
    );
    const boardText = await board.textContent();
    assert(
      !["Exponential function", "Maillard reaction", "Joseph Fourier", "Nobody seems surprised"].some((x) => boardText.includes(x)),
      "…while the concepts in between, the facts and the narration stay hidden",
    );
    await page.waitForFunction(() => document.activeElement?.closest(".chain-game__guess"));
    assert(true, "the guess field has the focus");
    assert((await feedback.getAttribute("role")) === "status", "feedback is announced to screen readers");
    assert(
      (await dlg.getByRole("button", { name: "Copy as text" }).count()) === 0 && (await dlg.getByRole("button", { name: "Add to a sandbox" }).count()) === 0,
      "copying or adding the chain would give it away, so they wait for the end",
    );

    await guessField.fill("Pizza");
    await guessField.press("Enter");
    await feedback.filter({ hasText: "Not on this chain: Pizza." }).waitFor();
    assert((await score.textContent()) === "Score 0 / 15", "a wrong guess is announced and costs nothing");
    await guessField.fill("fourier transfrom");
    await guessField.press("Enter");
    await feedback.filter({ hasText: "Right: Fourier transform. +3 points, score 3 of 15." }).waitFor();
    assert(
      (await score.textContent()) === "Score 3 / 15" && (await hops.nth(1).textContent()).includes("Fourier transform") &&
        (await guessField.inputValue()) === "",
      "a right guess (typo forgiven, any order) reveals the concept and scores 3",
    );

    const clue = board.getByRole("button", { name: "Clue for hidden concept 3" });
    await clue.focus();
    await page.keyboard.press("Enter");
    const clueText = hops.nth(2).locator(".chain-game__clue");
    await clueText.waitFor();
    assert(
      (await clueText.textContent()).includes("From Fourier transform it is a short walk to [?]. We walked it."),
      "a clue (from the keyboard) shows the link's narration with the hidden name blanked out",
    );
    await page.waitForFunction(() => document.activeElement?.closest(".chain-game__guess"));
    assert(true, "…and hands the focus back to the guess field");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert(
      await page.evaluate(() => {
        const body = document.querySelector(".modal__body");
        return document.documentElement.scrollWidth <= 390 && body.scrollWidth <= body.clientWidth;
      }),
      "the game board fits a 390px-wide phone without sideways scrolling",
    );
    await audit("Guess the chain with a clue, 390px wide");
    await page.setViewportSize({ width: 1400, height: 900 });
    await audit("Guess the chain with a clue");
    await guessField.fill("the heat equations");
    await guessField.press("Enter");
    await feedback.filter({ hasText: "Right: Heat equation. +2 points, score 5 of 15." }).waitFor();
    assert(
      (await hops.nth(2).textContent()).includes("Joseph Fourier developed Fourier analysis"),
      "after a clue a right guess scores 2, and a link with both ends known shows its fact",
    );

    await board.getByRole("button", { name: "Reveal hidden concept 1" }).click();
    await feedback.filter({ hasText: "Hidden concept 1 was Exponential function." }).waitFor();
    assert(
      (await score.textContent()) === "Score 5 / 15" && (await hops.first().textContent()).includes("Revealed"),
      "revealing a concept gives it away for no points",
    );
    await page.screenshot({ path: `${shots}35-chain-game.png` });

    for (const name of ["Heat", "Maillard reaction"]) {
      await guessField.fill(name);
      await guessField.press("Enter");
    }
    const summary = dlg.getByTestId("chain-game-summary");
    await summary.waitFor();
    const summaryText = await summary.textContent();
    assert(
      summaryText.includes("You scored 11 of 15") && summaryText.includes("Found alone: 3. After a clue: 1. Revealed: 1. Wrong guesses: 1.") &&
        summaryText.includes("Everything is connected") && summaryText.includes("a perfectly ordinary connection"),
      "when every concept is known, the summary gives the title, the score, the tally and the moral",
    );
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "chain-game-summary");
    assert(
      (await dlg.getByTestId("chain-game-best").textContent()) === "Your first score for this pair of concepts.",
      "…the focus moves to it, and the first score for a pair is its best",
    );
    await dlg.getByRole("button", { name: "Copy as text" }).waitFor();
    await audit("Guess the chain summary");
    await page.screenshot({ path: `${shots}36-chain-game-summary.png` });
    await dlg.getByRole("button", { name: "Close" }).click();

    // Dark theme, a second game on the same pair: give up, see the best score kept from before, play again.
    await setTheme("dark");
    await openChain();
    await audit("Guess the chain, dark theme");
    await board.getByRole("button", { name: "Show the answer" }).click();
    await summary.waitFor();
    assert(
      (await summary.textContent()).includes("You scored 0 of 15") &&
        (await dlg.getByTestId("chain-game-best").textContent()) === "Your best for this pair of concepts: 11 / 15.",
      "Show the answer ends the game, and the best score for the pair is kept in the browser",
    );
    await audit("Guess the chain summary, dark theme");
    await page.screenshot({ path: `${shots}37-chain-game-dark.png` });
    await dlg.getByRole("button", { name: "Play again" }).click();
    await summary.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector('[data-testid="chain-game-score"]')?.textContent === "Score 0 / 15");
    await page.waitForFunction(() => document.activeElement?.closest(".chain-game__guess"));
    assert(true, "Play again starts a new game between the same ends");
    await dlg.getByRole("button", { name: "Close" }).click();
    await setTheme("light");
  }

  console.log("Small screens");
  {
    // A phone (390px wide) on the Group theory example: nothing may scroll sideways or spill off the screen.
    await projectMenu("New project");
    await page.getByLabel("Project name").press("Enter");
    await page.getByRole("button", { name: "Load example: Group theory" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 7);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const fits = async (loc) => {
      const b = await loc.boundingBox();
      return b && b.x >= 0 && b.x + b.width <= 390;
    };
    const top = async (name) => (await page.getByRole("button", { name, exact: true }).boundingBox()).y;
    assert(await noHScroll(), "phone: no horizontal scroll on the main screen");
    assert(
      new Set(await Promise.all(["Add concept", "Mix", "Derive", "Derive together"].map(top))).size === 1,
      "phone: Add, Mix, Derive and Derive together share one toolbar row",
    );
    assert((await page.locator(".react-flow__edge[tabindex]").count()) === 0, "relations are reached by their arrowheads, not by an extra tab stop each");
    await audit("phone, nothing selected (the details sheet scrolls and can take focus)");

    // The View popover opens inside the screen (it used to run off its left edge), and Tab out of it closes it.
    const viewButton = page.getByRole("button", { name: /^View/ });
    await viewButton.click();
    const viewPop = page.getByRole("dialog", { name: "View" });
    assert((await fits(viewPop)) && (await noHScroll()), "phone: the View popover fits the screen");
    await viewPop.getByRole("checkbox", { name: "Relation labels" }).focus();
    for (let i = 0; i < 8 && (await viewPop.isVisible()); i++) await page.keyboard.press("Tab");
    assert(!(await viewPop.isVisible()), "Tab out of the View popover closes it");
    await viewButton.click();
    await page.keyboard.press("Escape");
    assert(!(await viewPop.isVisible()) && (await viewButton.evaluate((el) => el === document.activeElement)), "Escape closes the View popover and focus returns to its button");

    // Settings (behind More tools on a phone): the two wiki fields stack instead of pushing past the dialog's edge.
    const moreTools = page.getByRole("button", { name: "More tools" });
    await moreTools.click();
    const st = await openSettings();
    await st.getByTestId("lookup-bwiki").scrollIntoViewIfNeeded();
    assert((await fits(st.getByTestId("lookup-bwiki"))) && (await fits(st.getByTestId("lookup-fandom"))), "phone: Settings' wiki fields fit the screen");
    await st.getByRole("button", { name: "Cancel" }).click();
    await moreTools.click();

    // The inspector bottom sheet with a concept open.
    await node("Normal subgroup").click();
    await page.getByLabel("Rename concept").waitFor();
    assert(await noHScroll(), "phone: no horizontal scroll with the inspector open");
    await audit("phone, a concept open in the details sheet");

    // Derive together covers the phone screen: what it hides leaves the Tab order, and closing it returns focus.
    const dtButton = page.getByTestId("derive-together");
    await dtButton.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("derive-panel");
    await panel.getByRole("heading", { name: "Derive together" }).waitFor();
    assert(await page.locator(".toolbar").evaluate((el) => el.inert), "phone: the toolbar behind Derive together is inert");
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    assert(await page.evaluate(() => !document.activeElement?.closest(".toolbar, .react-flow, .sheet")), "…so Tab never lands on what the panel covers");
    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "detached" });
    assert(
      !(await page.locator(".toolbar").evaluate((el) => el.inert)) && (await dtButton.evaluate((el) => el === document.activeElement)),
      "closing it restores the app and focus returns to the Derive together button",
    );
    await page.screenshot({ path: `${shots}38-phone.png` });
    await page.setViewportSize({ width: 1400, height: 900 });
  }

  console.log("Phone selection");
  {
    // A touch phone has no Shift key: "Select several" (by the zoom buttons) or holding a card selects two for Mix.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "en-US" });
    await blockLookups(ctx);
    await ctx.addInitScript(() => {
      try {
        if (localStorage.getItem("nodestorm-ui-language")) return;
        localStorage.setItem("nodestorm-ui-language", "en");
        localStorage.setItem("nodestorm-settings", JSON.stringify({ state: { provider: "mock", connection: "browser" }, version: 1 }));
      } catch {}
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error("pageerror:", e.message));
    await p.goto(`http://localhost:${WEB_PORT}/`);
    const axe = async (what) => {
      await p.waitForTimeout(300);
      const { violations } = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const report = violations.flatMap((v) => v.nodes.map((n) => `\n    ${v.id} (${v.impact}) at ${n.target.join(" ")}: ${n.failureSummary}`));
      assert(!violations.length, `axe finds no WCAG A/AA violations: ${what}${report.join("")}`);
    };
    const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const card = (name) => p.getByTestId(`node-${name}`);
    assert(await p.evaluate(() => matchMedia("(pointer: coarse)").matches), "phone: a touch screen is emulated (pointer: coarse)");
    await p.getByRole("button", { name: "Load the Group theory example" }).tap();
    await p.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 7);

    // The notice that follows shows at the top, and an open dialog keeps clear of it.
    const toast = p.getByTestId("toast");
    await toast.waitFor();
    assert((await toast.getAttribute("role")) === "status" && (await toast.textContent()).includes("Tap a concept"), "phone: the example's notice is announced (role=status)");
    await p.getByRole("button", { name: "Add concept", exact: true }).tap();
    const dlg = p.getByRole("dialog", { name: "Add concept" });
    await dlg.getByRole("button", { name: "Add", exact: true }).waitFor();
    const tb = await toast.boundingBox();
    const covered = [];
    for (const b of await dlg.getByRole("button").all()) {
      const box = await b.boundingBox();
      if (box && overlap(tb, box)) covered.push(await b.textContent());
    }
    const bar = await p.locator(".toolbar").boundingBox();
    assert(tb.y >= bar.y + bar.height && tb.y < 300 && !covered.length, `phone: the notice sits under the toolbar and covers none of the dialog's buttons${covered.length ? ` (covers ${covered.join(", ")})` : ""}`);
    await p.screenshot({ path: `${shots}phone-toast-dialog.png` });
    await p.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached" });
    await toast.tap();
    await toast.waitFor({ state: "detached" });
    assert(true, "a tap dismisses the notice");

    // How to use names Select several on a touch screen, not Shift-click.
    await p.getByRole("button", { name: "Show details" }).tap();
    const help = p.locator(".inspector--help");
    assert((await help.textContent()).includes("Select several") && !(await help.textContent()).includes("Shift/Ctrl-click"), "phone: How to use says Select several, not Shift/Ctrl-click");

    // React Flow's attribution stays visible, under the zoom buttons instead of over the cards.
    const attribution = p.locator(".react-flow__attribution");
    const [ab, cb] = [await attribution.boundingBox(), await p.locator(".react-flow__controls").boundingBox()];
    assert((await attribution.isVisible()) && ab.y >= cb.y + cb.height && ab.x < cb.x + cb.width, "phone: the React Flow attribution is shown under the zoom buttons");

    // Select several: taps add concepts and take them out; Mix is enabled with two.
    const toggle = p.getByTestId("select-several");
    const mix = p.getByRole("button", { name: "Mix", exact: true });
    const count = p.getByTestId("select-count");
    await toggle.tap();
    assert((await toggle.getAttribute("aria-pressed")) === "true" && (await count.textContent()) === "Tap concepts to select them", "Select several is on, and its bar says what to do");
    assert((await mix.isDisabled()) && (await mix.getAttribute("title")).includes("pick exactly two"), "Mix is disabled, its tooltip says to pick two");
    await card("Subgroup").tap();
    await card("Homomorphism").tap();
    assert((await textIs(count, "2 selected")) && (await mix.isEnabled()), "two taps select two concepts, and Mix is enabled");
    await card("Group").tap();
    assert((await textIs(count, "3 selected")) && (await mix.isDisabled()), "a third tap adds a third (Mix wants exactly two)");
    await card("Group").tap();
    assert(await textIs(count, "2 selected"), "tapping a selected concept takes it out again");
    await p.locator(".react-flow__pane").tap({ position: { x: 370, y: 12 } });
    assert((await textIs(count, "2 selected")) && (await help.isVisible()), "a tap on the empty canvas keeps the selection, and no concept opened in the details sheet");
    await axe("phone, Select several with two concepts selected");
    await p.screenshot({ path: `${shots}phone-select.png` });
    await p.emulateMedia({ colorScheme: "dark" });
    await axe("phone, Select several, dark theme");
    await p.screenshot({ path: `${shots}phone-select-dark.png` });
    await p.emulateMedia({ colorScheme: "light" });
    await mix.tap();
    await p.getByText(/No relation found between “Subgroup” and “Homomorphism”/).first().waitFor();
    assert((await p.locator("path.relation--unrelated").count()) === 1, "Mix works on the two tapped concepts");
    if (await toast.isVisible()) {
      const sheet = await p.locator(".sheet").boundingBox();
      assert(!overlap(await toast.boundingBox(), sheet), "phone: a notice doesn't cover the details sheet");
    }

    // Done (or Escape) leaves the mode and keeps the selection; holding a card starts it again with just that card.
    await p.getByRole("button", { name: "Done" }).tap();
    assert((await p.getByTestId("select-bar").count()) === 0 && (await toggle.getAttribute("aria-pressed")) === "false", "Done leaves Select several");
    // Mix opened its relation in the details sheet: fold it away, so the cards have the canvas to themselves again.
    await p.getByRole("button", { name: "Hide details" }).tap();
    await p.getByRole("button", { name: "Fit everything in view" }).tap();
    await p.waitForTimeout(500);
    const cdp = await ctx.newCDPSession(p);
    const hb = await card("Kernel").boundingBox();
    const at = [{ x: hb.x + 20, y: hb.y + 12 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at });
    await p.waitForTimeout(800);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(300);
    assert((await textIs(count, "1 selected")) && (await card("Kernel").evaluate((el) => el.closest(".react-flow__node").classList.contains("selected"))), "holding a card starts Select several with just that card");
    await card("Normal subgroup").tap();
    assert((await textIs(count, "2 selected")) && (await mix.isEnabled()), "…and a tap on another adds it");
    await p.keyboard.press("Escape");
    assert((await p.getByTestId("select-bar").count()) === 0, "Escape leaves Select several");

    // 中文
    await p.evaluate(() => localStorage.setItem("nodestorm-ui-language", "zh"));
    await p.reload();
    await p.locator(".react-flow__node").nth(6).waitFor();
    await p.getByTestId("select-several").tap();
    await p.locator(".react-flow__node").nth(1).tap();
    await p.locator(".react-flow__node").nth(2).tap();
    assert(await textIs(p.getByTestId("select-count"), "已选 2 个"), "中文: the bar says 已选 2 个");
    await p.screenshot({ path: `${shots}phone-select-zh.png` });
    await ctx.close();
  }

  console.log("Web search settings");
  {
    // Tavily answers from a fixture: the key "tvly-good" works, any other is rejected with a 401, as Tavily does.
    const TAVILY = /api\.tavily\.com/;
    await context.route(TAVILY, (route) => {
      const req = route.request();
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const ok = req.headers().authorization === "Bearer tvly-good";
      const body = ok
        ? { query: "x", results: [{ title: "Group (mathematics)", url: "https://en.wikipedia.org/wiki/Group_(mathematics)", content: "In mathematics, a group is a set with an operation." }] }
        : { detail: { error: "Unauthorized: missing or invalid API key." } };
      return route.fulfill({ status: ok ? 200 : 401, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
    });
    const st = await openSettings();
    const ws = st.getByTestId("web-search-settings");
    await ws.scrollIntoViewIfNeeded();
    assert(await ws.getByTestId("search-brave-enabled").isDisabled(), "web search: Brave can't be ticked in browser mode…");
    assert(await ws.getByText(/it needs the local NodeStorm server/).isVisible(), "…and says it needs the local NodeStorm server");
    assert(await ws.getByText("Concept names are sent to the search engines you enable.").isVisible(), "the privacy line is shown");
    await ws.getByTestId("search-tavily-enabled").check();
    const key = ws.getByTestId("search-tavily-key");
    const test = ws.getByTestId("search-tavily-test");
    assert((await key.getAttribute("type")) === "password" && (await test.isDisabled()), "Tavily's key field is a password field, and Test waits for a key");
    await key.fill("tvly-good");
    await test.click();
    await ws.getByTestId("search-tavily-ok").waitFor();
    assert(true, "Test with a working Tavily key says it works");
    await key.fill("tvly-wrong");
    assert((await ws.getByTestId("search-tavily-ok").count()) === 0, "changing the key clears the old result");
    await test.click();
    const err = ws.getByTestId("search-tavily-error");
    await err.waitFor();
    const text = (await err.textContent()) ?? "";
    assert(text.startsWith("Tavily rejected the API key. Check it in Settings."), `a wrong key: Test says Tavily rejected it (${text})`);
    await audit("Settings with the web search section filled in");
    await key.fill("tvly-good");
    await st.getByRole("button", { name: "Save", exact: true }).click();
    const stored = await page.evaluate(() => localStorage.getItem("nodestorm-settings") ?? "{}");
    assert(!stored.includes("tvly-good") && JSON.parse(stored).state.search.tavily.enabled === true, "the engine is saved, its key not in localStorage (Remember keys is off)");
    const st2 = await openSettings();
    await st2.getByTestId("search-tavily-enabled").uncheck();
    await st2.getByRole("button", { name: "Save", exact: true }).click();
    await context.unroute(TAVILY);
  }

  if (BUILT) assert(!cspViolations.length, `production build: nothing broke the Content-Security-Policy${cspViolations.length ? `: ${cspViolations.join("; ")}` : ""}`);

  console.log("\nE2E passed");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const p of procs) try { process.kill(-p.pid); } catch {}
}
