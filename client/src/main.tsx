import "./zodConfig"; // first: see the file
import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { localeReady, t } from "./i18n";
import { en } from "./i18n/en";
import { registerServiceWorker } from "./lib/pwa";
import { initTheme } from "./lib/theme";
import { useGraphStore } from "./store/graphStore";
import { startAutoSnapshots } from "./store/snapshotStore";
import { preloadDialogs } from "./panels/lazy";
import "./styles.css";

initTheme(); // before the first render, so a dark page never flashes white
registerServiceWorker(); // production builds only: offline app shell + update notice
startAutoSnapshots(); // version snapshots in IndexedDB: loads the list, then snapshots periodically while editing

// A Chinese interface waits for its messages (a chunk of their own) so the first paint isn't English.
void localeReady.then(() => {
  nameFirstProject();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  preloadDialogs(); // after the first paint, when the browser is idle
});

/**
 * A first visit's project is named when the store is created, before a Chinese interface's messages have arrived: while
 * it is still the only, empty "My brainstorm", it takes the interface language's name (我的头脑风暴).
 */
function nameFirstProject() {
  const s = useGraphStore.getState();
  const projects = Object.values(s.projects);
  const name = t("project.default");
  if (projects.length !== 1 || projects[0].name !== en["project.default"] || name === projects[0].name) return;
  if (Object.values(s.graphs).some((g) => g.nodes.length)) return;
  s.renameProject(projects[0].id, name);
}
