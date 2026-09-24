import { RefreshCw, X } from "lucide-react";
import { useT } from "../i18n";
import { Icon } from "../ui/Icon";
import { applyUpdate, dismissUpdate, useUpdateReady } from "../lib/pwa";

/** Offers the waiting new version of the installed app; nothing changes until the user reloads. */
export function UpdateNotice() {
  const t = useT();
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <Icon icon={RefreshCw} className="update-notice__icon" />
      <span>{t("update.available")}</span>
      <button className="primary" onClick={applyUpdate}>{t("update.reload")}</button>
      <button className="icon-btn" onClick={dismissUpdate} aria-label={t("update.later")} title={t("update.later")}>
        <Icon icon={X} />
      </button>
    </div>
  );
}
