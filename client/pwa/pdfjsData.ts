import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { pdfDataDir } from "../src/lib/pdfData";

const FOLDERS = ["cmaps", "standard_fonts"];
const TYPES: Record<string, string> = { ".ttf": "font/ttf" };

/**
 * PDF.js's CMaps (~170 files, 1.2 MB) and standard fonts (~800 kB), which src/lib/pdf.ts fetches when a PDF needs
 * them, served from `pdfjs-<version>/` (pdfData.ts): copied into the build, and straight from pdfjs-dist in
 * `vite dev`. They are fetched one at a time and only by some PDFs, so the service worker doesn't precache them
 * (pwa/plugin.ts leaves the folder out) but caches each on first use.
 */
export function pdfjsData(): Plugin {
  const pkg = createRequire(import.meta.url).resolve("pdfjs-dist/package.json");
  const root = dirname(pkg);
  const dir = pdfDataDir(JSON.parse(readFileSync(pkg, "utf8")).version);
  const route = new RegExp(`^/${dir.replace(/[.]/g, "\\.")}(${FOLDERS.join("|")})/([\\w+-][\\w.+-]*)$`);
  return {
    name: "nodestorm-pdfjs-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = route.exec(new URL(req.url ?? "/", "http://dev").pathname);
        const file = m && join(root, m[1], m[2]);
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const folder of FOLDERS) {
        for (const name of readdirSync(join(root, folder)).sort()) {
          this.emitFile({ type: "asset", fileName: `${dir}${folder}/${name}`, source: readFileSync(join(root, folder, name)) });
        }
      }
    },
  };
}
