import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { serviceWorker } from "./pwa/plugin";

export default defineConfig({
  // serviceWorker() only runs in `vite build`: the dev server never has a service worker.
  plugins: [react(), serviceWorker()],
  // Relative asset paths so the built site works from any folder or static host.
  base: "./",
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.SERVER_PORT || 8787}` },
  },
});
