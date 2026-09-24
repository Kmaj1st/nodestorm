/* global self, caches */
// NodeStorm's service worker. pwa/plugin.ts copies it into production builds as sw.js, filling in VERSION and
// PRECACHE (every file of the build). It is never registered by `vite dev`.
//
// It only ever answers same-origin GETs for the precached app shell. Everything else (AI provider calls,
// the local server's /api/*, anything not in the build) goes straight to the network and is never cached.

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__; // paths relative to this script, e.g. "index.html", "assets/index-abc123.js"
const PREFIX = "nodestorm-shell-";
const CACHE = PREFIX + VERSION;

const abs = (path) => new URL(path, self.location.href).href;
const INDEX = abs("index.html");
const SHELL = new Set(PRECACHE.map(abs));
const SCOPE = self.registration.scope;

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
      for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
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
  let key;
  if (req.mode === "navigate") {
    // Any page of the app (with or without index.html, any query) opens the cached shell; /api/ never does.
    if (!url.href.startsWith(SCOPE) || url.pathname.includes("/api/")) return;
    key = INDEX;
  } else if (SHELL.has(path)) {
    key = path;
  } else {
    return; // not part of the build: untouched by the service worker
  }
  event.respondWith(
    (async () => (await caches.match(key, { cacheName: CACHE })) ?? fetch(req))(),
  );
});
