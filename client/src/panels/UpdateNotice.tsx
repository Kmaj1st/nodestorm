import { applyUpdate, dismissUpdate, useUpdateReady } from "../lib/pwa";

// User-visible strings, in one place for the i18n layer.
const TEXT = {
  available: "New version available",
  reload: "Reload",
  later: "Later",
};

/** Offers the waiting new version of the installed app; nothing changes until the user reloads. */
export function UpdateNotice() {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <span>{TEXT.available}</span>
      <button className="primary" onClick={applyUpdate}>{TEXT.reload}</button>
      <button onClick={dismissUpdate} aria-label={TEXT.later} title={TEXT.later}>✕</button>
    </div>
  );
}
