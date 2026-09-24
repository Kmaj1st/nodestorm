import { lazy, Suspense, type ComponentType } from "react";
import { useT } from "../i18n";
import { useGraphStore } from "../store/graphStore";

/**
 * Dialogs that aren't needed for the first paint, each in a chunk of its own. The service worker precaches every
 * chunk of the build (pwa/plugin.ts), so they open offline too; preloadDialogs() fetches them once the page is idle,
 * so opening one (or typing right after Ctrl+K) normally doesn't wait for the network at all.
 */
const loaders = {
  add: () => import("./AddNodeDialog"),
  derive: () => import("./DeriveDialog"),
  extract: () => import("./ExtractDialog"),
  find: () => import("./FindDialog"),
  sense: () => import("./SenseDialog"),
  settings: () => import("./SettingsDialog"),
  share: () => import("./ShareDialog"),
  shortcuts: () => import("./ShortcutsDialog"),
};

/** Shown for the moment a dialog's chunk takes to load (normally from the cache). */
function Loading() {
  const t = useT();
  return (
    <div className="modal">
      <div className="modal__loading" role="status">{t("common.loading")}</div>
    </div>
  );
}

/** A lazily loaded dialog behind its own Suspense boundary, so the rest of the app stays on screen meanwhile. */
function lazyDialog<P extends object>(load: () => Promise<ComponentType<P>>) {
  const Inner = lazy(async () => ({ default: await load() }));
  return function LazyDialog(props: P) {
    return (
      <Suspense fallback={<Loading />}>
        <Inner {...props} />
      </Suspense>
    );
  };
}

export const AddNodeDialog = lazyDialog(() => loaders.add().then((m) => m.AddNodeDialog));
export const DeriveDialog = lazyDialog(() => loaders.derive().then((m) => m.DeriveDialog));
export const ExtractDialog = lazyDialog(() => loaders.extract().then((m) => m.ExtractDialog));
export const FindDialog = lazyDialog(() => loaders.find().then((m) => m.FindDialog));
export const SettingsDialog = lazyDialog(() => loaders.settings().then((m) => m.SettingsDialog));
export const ShareDialog = lazyDialog(() => loaders.share().then((m) => m.ShareDialog));
export const ShortcutsDialog = lazyDialog(() => loaders.shortcuts().then((m) => m.ShortcutsDialog));

const SenseDialogLazy = lazyDialog(() => loaders.sense().then((m) => m.SenseDialog));
/** "What do you mean?" is mounted all the time; its chunk is only needed once a concept turns out ambiguous. */
export function SenseDialog() {
  const clarifying = useGraphStore((s) => s.clarifying !== null);
  return clarifying ? <SenseDialogLazy /> : null;
}

/** Fetch every dialog's chunk in the background, once the page has settled. Failures are ignored (retried on use). */
export function preloadDialogs() {
  const run = () => Object.values(loaders).forEach((load) => void load().catch(() => {}));
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1000);
}
