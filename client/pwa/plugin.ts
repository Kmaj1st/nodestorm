import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { PDF_DATA_PREFIX } from "../src/lib/pdfData";

/** Every file under `dir`, as sorted paths relative to it with forward slashes. */
function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name), root) : [relative(root, join(dir, e.name))]))
    .map((p) => p.split(sep).join("/"))
    .sort();
}

/**
 * Writes the service worker (pwa/sw.js) into production builds, with the list of files to precache and a
 * version derived from their contents: a rebuild that changes nothing keeps the same sw.js, so users are only
 * offered an update when there is one. A small stand-in for vite-plugin-pwa, which would add ~260 packages.
 * PDF.js's CMaps and standard fonts (pdfjsData.ts, ~2 MB, fetched only by some PDFs) aren't precached: their
 * versioned folder is cached file by file on first use instead (RUNTIME).
 */
export function serviceWorker(): Plugin {
  let outDir = "";
  return {
    name: "nodestorm-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const all = listFiles(outDir).filter((f) => f !== "sw.js" && !f.endsWith(".map"));
      const onDemand = (f: string) => f.startsWith(PDF_DATA_PREFIX);
      const files = all.filter((f) => !onDemand(f));
      const runtime = [...new Set(all.filter(onDemand).map((f) => f.slice(0, f.indexOf("/") + 1)))];
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update("\0").update(readFileSync(join(outDir, f)));
      const template = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
      hash.update(template);
      const sw = template
        .replace('"__VERSION__"', JSON.stringify(hash.digest("hex").slice(0, 12)))
        .replace("__PRECACHE__", JSON.stringify(files))
        .replace("__RUNTIME__", JSON.stringify(runtime));
      writeFileSync(join(outDir, "sw.js"), sw);
    },
  };
}
