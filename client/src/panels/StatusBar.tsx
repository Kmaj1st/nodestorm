import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { cancelTask } from "../lib/actions";
import { useGraphStore } from "../store/graphStore";

/** Running AI tasks with elapsed time and a cancel button each. */
export function StatusBar() {
  const t = useT();
  const busy = useGraphStore((s) => s.busy);
  const entries = Object.entries(busy);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!entries.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [entries.length]);

  if (!entries.length) return null;
  return (
    <div className="status" role="status" aria-live="polite">
      {entries.map(([key, task]) => {
        const secs = Math.max(0, Math.floor((now - task.startedAt) / 1000));
        const queued = task.state === "queued";
        return (
          <div key={key} className="status__row" data-testid="task" data-state={queued ? "queued" : "running"}>
            {queued ? <span className="status__queued">{t("status.queued")}</span> : <span className="spinner" aria-hidden />}
            <span>{task.label}</span>
            {!queued && secs >= 2 && <span className="status__time">{t("status.seconds", { n: secs })}</span>}
            <button className="status__cancel" onClick={() => cancelTask(key)} aria-label={t("status.cancel", { label: task.label })}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
