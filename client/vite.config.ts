import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { serviceWorker } from "./pwa/plugin";

/**
 * KaTeX's CSS lists every font as woff2, woff and ttf. Every browser we support takes woff2, so the other two are
 * dropped: otherwise the build (and the service worker's precache) would carry ~40 font files nobody downloads.
 */
function katexWoff2Only(): Plugin {
  return {
    name: "nodestorm-katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id)) return null;
      return code.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, "");
    },
  };
}

export default defineConfig({
  // serviceWorker() only runs in `vite build`: the dev server never has a service worker.
  plugins: [react(), katexWoff2Only(), serviceWorker()],
  // Relative asset paths so the built site works from any folder or static host.
  base: "./",
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${process.env.SERVER_PORT || 8787}` }, // the server binds to loopback IPv4
  },
});
