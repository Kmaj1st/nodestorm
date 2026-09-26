import "./zodConfig"; // first: see the file
import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { localeReady } from "./i18n";
import { registerServiceWorker } from "./lib/pwa";
import { initTheme } from "./lib/theme";
import { startAutoSnapshots } from "./store/snapshotStore";
import { preloadDialogs } from "./panels/lazy";
import "./styles.css";

initTheme(); // before the first render, so a dark page never flashes white
registerServiceWorker(); // production builds only: offline app shell + update notice
startAutoSnapshots(); // version snapshots in IndexedDB: loads the list, then snapshots periodically while editing

// A Chinese interface waits for its messages (a chunk of their own) so the first paint isn't English.
void localeReady.then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  preloadDialogs(); // after the first paint, when the browser is idle
});
