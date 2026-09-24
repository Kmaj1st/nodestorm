import { useT } from "../i18n";
import { useOnline } from "../lib/online";

/** A thin notice under the toolbar while the browser has no network (AI calls fail fast meanwhile, see api.ts). */
export function OfflineBanner() {
  const t = useT();
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      {t("offline.banner")}
    </div>
  );
}
