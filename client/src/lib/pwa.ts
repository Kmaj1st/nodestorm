import { useSyncExternalStore } from "react";

/**
 * Service worker registration and the "new version available" flow. Production builds only: `vite dev`
 * (and so the e2e run) never registers one. The worker itself is client/pwa/sw.js.
 */

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const setWaiting = (sw: ServiceWorker | null) => {
  waiting = sw;
  listeners.forEach((l) => l());
};

const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    let reg: ServiceWorkerRegistration;
    try {
      // Relative to the page, so the app also works from a sub-path (GitHub Pages).
      reg = await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("Service worker not registered:", e);
      return;
    }
    // Only an *update* waits: the very first install has no controller and simply takes over.
    const track = (sw: ServiceWorker | null) => {
      if (!sw) return;
      const check = () => sw.state === "installed" && navigator.serviceWorker.controller && setWaiting(sw);
      check();
      sw.addEventListener("statechange", check);
    };
    track(reg.waiting ?? reg.installing);
    reg.addEventListener("updatefound", () => track(reg.installing));
    // Long-lived tabs (an installed app may stay open for days) look for a new version now and then.
    const update = () => void reg.update().catch(() => {});
    setInterval(update, UPDATE_CHECK_MS);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && update());
  });
}

/** The waiting new version, if any (for the update notice). */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => waiting !== null,
  );
}

/** Switch to the waiting version and reload once it has taken over. */
export function applyUpdate() {
  const sw = waiting;
  if (!sw) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  sw.postMessage({ type: "SKIP_WAITING" });
}

/** Hide the notice for now; it comes back on the next visit (the new version is still waiting). */
export function dismissUpdate() {
  setWaiting(null);
}
