import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
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

/**
 * What a dialog shows when its chunk couldn't be fetched (e.g. a first visit that went offline). Browsers remember a
 * failed module import for the rest of the page's life, so only a reload can fetch it again; the graph is saved.
 */
function LoadFailed({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="modal">
      <div className="modal__loading" role="alert">
        <p>{t("common.loadFailed")}</p>
        <div className="form__actions">
          <button onClick={onClose}>{t("common.close")}</button>
          <button className="primary" onClick={() => location.reload()}>{t("common.reload")}</button>
        </div>
      </div>
    </div>
  );
}

/** Catches a failed chunk load so it can't unmount the whole app. */
class LoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A lazily loaded dialog behind its own Suspense and error boundaries, so the rest of the app stays on screen. */
function lazyDialog<P extends object>(load: () => Promise<ComponentType<P>>, closeDialog?: () => void) {
  const Inner = lazy(async () => ({ default: await load() }));
  return function LazyDialog(props: P) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;
    const close = () => {
      const onClose = closeDialog ?? (props as { onClose?: () => void }).onClose;
      if (onClose) onClose();
      else setDismissed(true);
    };
    return (
      <LoadBoundary fallback={<LoadFailed onClose={close} />}>
        <Suspense fallback={<Loading />}>
          <Inner {...props} />
        </Suspense>
      </LoadBoundary>
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

// Closing after a failed load leaves the concept "unclear"; its badge reopens the dialog.
const SenseDialogLazy = lazyDialog(
  () => loaders.sense().then((m) => m.SenseDialog),
  () => useGraphStore.getState().setClarifying(null),
);
/** "What do you mean?" is mounted all the time; its chunk is only needed once a concept turns out ambiguous. */
export function SenseDialog() {
  const clarifying = useGraphStore((s) => s.clarifying !== null);
  return clarifying ? <SenseDialogLazy /> : null;
}

/** Fetch every dialog's chunk in the background, once the page has settled. A failure here only means the dialog
 * shows its "couldn't be loaded" notice (with Reload) when opened. */
export function preloadDialogs() {
  const run = () => Object.values(loaders).forEach((load) => void load().catch(() => {}));
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1000);
}
