// Production-build check of the installable/offline app: serves client/dist with `vite preview`, checks the
// manifest and the service worker, then opens the app offline (server stopped) and tries the update notice.
// Usage: npm run e2e:pwa   (builds first; or `node e2e/pwa.mjs` after `npm run build`)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = Number(process.env.E2E_WEB_PORT || 4273);
const base = `http://localhost:${PORT}/`;
const dist = new URL("../client/dist/", import.meta.url).pathname;
const shots = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
if (!existsSync(`${dist}sw.js`)) throw new Error("client/dist/sw.js is missing: run `npm run build` first");

let server;
function startServer() {
  server = spawn("npx", ["vite", "preview", "client", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stderr.on("data", (d) => process.env.DEBUG && process.stderr.write(d));
}
function stopServer() {
  try { process.kill(-server.pid); } catch {}
}
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}
async function waitDown(url) {
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); } catch { return; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} is still up`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const swPath = `${dist}sw.js`;
const swOriginal = readFileSync(swPath, "utf8");
let browser;
try {
  startServer();
  await waitFor(base);
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route(/proofwiki\.org|wikipedia\.org|wikidata\.org|lean-lang\.org/, (r) => r.abort()); // no real encyclopedia lookups
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(base);
  const addButton = page.getByRole("button", { name: "Add concept", exact: true });
  await addButton.waitFor();

  console.log("Manifest");
  const manifestUrl = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href);
  assert(manifestUrl === `${base}manifest.webmanifest`, "the page links the web app manifest (relative to the page)");
  const manifest = await (await fetch(manifestUrl)).json();
  assert(manifest.name && manifest.short_name === "NodeStorm" && manifest.display === "standalone", "the manifest names an installable standalone app");
  for (const icon of manifest.icons) assert((await fetch(new URL(icon.src, manifestUrl))).ok, `icon ${icon.src} (${icon.sizes}${icon.purpose ? `, ${icon.purpose}` : ""}) is served`);
  assert(manifest.icons.some((i) => i.purpose === "maskable"), "there is a maskable icon");

  console.log("Service worker");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cached = (await Promise.all(keys.map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat();
    return { script: reg.active?.scriptURL, scope: reg.scope, keys, cached };
  });
  assert(sw.script === `${base}sw.js` && sw.scope === base, "sw.js is registered for the app's folder and controls the page");
  assert(sw.keys.length === 1 && sw.keys[0].startsWith("nodestorm-shell-"), "one versioned cache");
  assert(sw.cached.includes(`${base}index.html`) && sw.cached.some((u) => /\/assets\/index-.*\.js$/.test(u)), "the app shell (index.html, scripts) is precached");
  assert(!sw.cached.some((u) => u.includes("/api/") || !u.startsWith(base)), "nothing but same-origin build files is cached");
  // Dialogs, the Anthropic SDK and the PNG exporter are lazily loaded chunks: they must be precached as well.
  const assets = readdirSync(`${dist}assets`).filter((f) => !f.endsWith(".map"));
  const missing = assets.filter((f) => !sw.cached.includes(`${base}assets/${f}`));
  assert(assets.length > 3 && !missing.length, `every chunk of the build is precached, lazy ones included (${assets.length} files)${missing.length ? `; missing: ${missing}` : ""}`);
  const fonts = assets.filter((f) => f.startsWith("KaTeX_"));
  assert(fonts.length > 10 && fonts.every((f) => f.endsWith(".woff2")), `KaTeX's fonts are in the build as woff2 only (${fonts.length} files)`);

  console.log("Offline");
  stopServer();
  await waitDown(base);
  await context.setOffline(true);
  await page.reload();
  await addButton.waitFor({ timeout: 10000 });
  assert(true, "with the server stopped and the network off, a reload still opens the app");
  assert(await page.getByTestId("offline-banner").isVisible(), "…and it shows the offline banner");
  // Straight after the reload, before the idle-time preload could have fetched them.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.waitFor({ timeout: 10000 });
  await settings.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("?");
  await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
  assert(true, "lazily loaded dialogs (Settings, Keyboard shortcuts) open offline");
  // KaTeX (script, CSS and fonts) is only loaded once a formula is on screen: that must work offline too.
  await addButton.click();
  await page.getByLabel("Concept name").fill("Kernel");
  await page.getByRole("dialog").getByRole("textbox", { name: /^Definition/ }).fill("The set $\\ker\\varphi$.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByTestId("node-Kernel").locator(".katex").waitFor({ timeout: 10000 });
  await page.waitForFunction(
    () => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "KaTeX_Main" && f.status === "loaded"),
    null,
    { timeout: 10000 },
  );
  assert(true, "a formula is typeset offline, with KaTeX's fonts from the cache");
  const second = await context.newPage();
  await second.goto(`${base}?from=home-screen`);
  await second.getByRole("button", { name: "Add concept", exact: true }).waitFor({ timeout: 10000 });
  assert(true, "a new window of the app opens offline too");
  await page.screenshot({ path: `${shots}pwa-offline.png` });
  await second.close();

  console.log("Update");
  writeFileSync(swPath, swOriginal.replace(/const VERSION = "([^"]+)"/, 'const VERSION = "$1-next"'));
  startServer();
  await waitFor(base);
  await context.setOffline(false);
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
  await page.getByTestId("update-notice").waitFor({ timeout: 15000 });
  assert((await page.getByTestId("update-notice").textContent()).includes("New version available"), "a new build shows the “New version available” notice");
  assert((await page.evaluate(() => caches.keys())).length === 2, "…while the page keeps running on the old version until the user reloads");
  await page.screenshot({ path: `${shots}pwa-update.png` });
  await Promise.all([page.waitForEvent("load"), page.getByTestId("update-notice").getByRole("button", { name: "Reload" }).click()]);
  await addButton.waitFor();
  const after = await page.evaluate(async () => ({ keys: await caches.keys(), controlled: !!navigator.serviceWorker.controller }));
  assert(after.controlled && after.keys.length === 1 && after.keys[0].endsWith("-next"), "Reload switches to the new version and drops the old cache");
  assert((await page.getByTestId("update-notice").count()) === 0, "…and the notice is gone");

  console.log("Failed chunk load");
  {
    // A first visit before anything is precached (no service worker), with the Find dialog's chunk failing.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    await ctx.route(/proofwiki\.org|wikipedia\.org|wikidata\.org|lean-lang\.org/, (r) => r.abort());
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    let fail = true;
    await p.route(/FindDialog-.*\.js$/, (route) => (fail ? route.abort() : route.continue()));
    await p.goto(base);
    await p.getByRole("button", { name: "Add concept", exact: true }).waitFor();
    await p.waitForTimeout(3500); // let the idle-time preload try (and fail) first
    await p.keyboard.press("Control+k");
    const alert = p.getByRole("alert").filter({ hasText: "couldn't be loaded" });
    await alert.waitFor();
    assert(
      (await p.getByRole("button", { name: "Add concept", exact: true }).isVisible()) && !errors.length,
      "a dialog whose chunk fails to load shows an error instead of blanking the app",
    );
    fail = false;
    await Promise.all([p.waitForEvent("load"), alert.getByRole("button", { name: "Reload" }).click()]);
    await p.getByRole("button", { name: "Add concept", exact: true }).waitFor();
    await p.keyboard.press("Control+k");
    await p.getByRole("dialog", { name: "Find concept" }).waitFor();
    assert(true, "Reload fetches it again once the network is back");
    await ctx.close();
  }

  console.log("\nPWA check passed");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  writeFileSync(swPath, swOriginal);
  await browser?.close();
  stopServer();
}
