/* global self, caches */
// NodeStorm's service worker. pwa/plugin.ts copies it into production builds as sw.js, filling in VERSION,
// PRECACHE (every file of the build but RUNTIME's) and RUNTIME. It is never registered by `vite dev`.
//
// It only ever answers same-origin GETs for the precached app shell, and for files of the build's RUNTIME folders
// (PDF.js's CMaps and standard fonts), which it caches on first use. Everything else (AI provider calls, the local
// server's /api/*, anything not in the build) goes straight to the network and is never cached.

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__; // paths relative to this script, e.g. "index.html", "assets/index-abc123.js"
// Folders cached file by file on first use, e.g. "pdfjs-6.3.289/". Each has its own cache, named after the folder
// (which is versioned): it outlives app updates, and goes when a new build no longer has that folder.
const RUNTIME = __RUNTIME__;
const PREFIX = "nodestorm-shell-";
const CACHE = PREFIX + VERSION;
const DATA_PREFIX = "nodestorm-data-";
const dataCache = (dir) => DATA_PREFIX + dir.replace(/\/$/, "");

const abs = (path) => new URL(path, self.location.href).href;
const INDEX = abs("index.html");
const SHELL = new Set(PRECACHE.map(abs));
const SCOPE = self.registration.scope;
const DATA = RUNTIME.map((dir) => ({ url: abs(dir), cache: dataCache(dir) }));

self.addEventListener("install", (event) => {
  // `cache: "reload"` skips the HTTP cache, so a new version never precaches stale files.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([...SHELL].map((url) => new Request(url, { cache: "reload" })))));
  // No skipWaiting here: the page shows "New version available" and the user decides when to reload.
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CACHE, ...DATA.map((d) => d.cache)]);
      for (const key of await caches.keys()) {
        if ((key.startsWith(PREFIX) || key.startsWith(DATA_PREFIX)) && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  url.hash = "";
  const path = url.origin + url.pathname;
  let key, data;
  if (req.mode === "navigate") {
    // Any page of the app (with or without index.html, any query) opens the cached shell; /api/ never does.
    if (!url.href.startsWith(SCOPE) || url.pathname.includes("/api/")) return;
    key = INDEX;
  } else if (SHELL.has(path)) {
    key = path;
  } else if (url.search === "" && (data = DATA.find((d) => path.startsWith(d.url)))) {
    event.respondWith(cacheOnFirstUse(req, path, data.cache));
    return;
  } else {
    return; // not part of the build: untouched by the service worker
  }
  event.respondWith(
    (async () => (await caches.match(key, { cacheName: CACHE })) ?? fetch(req))(),
  );
});

/** A file of a RUNTIME folder: from its cache, else from the network, kept if it came (a 404 is not). */
async function cacheOnFirstUse(req, path, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(path);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") await cache.put(path, res.clone());
  return res;
}
