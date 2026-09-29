import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Builds src/i18n/early.ts as an entry of its own and loads it (async) before the app's script, so a Chinese interface
 * fetches its messages alongside the app's chunk rather than after it (Vite would bundle a second <script> of
 * index.html into the app's entry). Only in `vite build`: the dev server has no chunks to wait for.
 */
export function earlyLocale(): Plugin {
  return {
    name: "nodestorm-early-locale",
    apply: "build",
    config: () => ({
      build: {
        rollupOptions: {
          input: {
            index: fileURLToPath(new URL("../index.html", import.meta.url)),
            early: fileURLToPath(new URL("../src/i18n/early.ts", import.meta.url)),
          },
        },
      },
    }),
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const early = Object.values(ctx.bundle ?? {}).find((c) => c.type === "chunk" && c.isEntry && c.name === "early");
        if (!early) throw new Error("nodestorm-early-locale: no early chunk in the bundle");
        return html.replace(/(\n\s*)<script type="module"/, `$1<script type="module" async crossorigin src="./${early.fileName}"></script>$1<script type="module"`);
      },
    },
  };
}
