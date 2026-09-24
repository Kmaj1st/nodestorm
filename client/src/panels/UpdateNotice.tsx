import { useT } from "../i18n";
import { applyUpdate, dismissUpdate, useUpdateReady } from "../lib/pwa";

/** Offers the waiting new version of the installed app; nothing changes until the user reloads. */
export function UpdateNotice() {
  const t = useT();
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <span>{t("update.available")}</span>
      <button className="primary" onClick={applyUpdate}>{t("update.reload")}</button>
      <button onClick={dismissUpdate} aria-label={t("update.later")} title={t("update.later")}>✕</button>
    </div>
  );
}
