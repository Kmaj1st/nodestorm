import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built site works from any folder or static host.
  base: "./",
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.SERVER_PORT || 8787}` },
  },
});
