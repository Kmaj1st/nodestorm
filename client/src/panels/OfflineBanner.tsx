import { useOnline } from "../lib/online";

// User-visible strings, in one place for the i18n layer.
const TEXT = {
  offline: "Offline — AI features paused; your graph is saved locally",
};

/** A thin notice under the toolbar while the browser has no network (AI calls fail fast meanwhile, see api.ts). */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      {TEXT.offline}
    </div>
  );
}
