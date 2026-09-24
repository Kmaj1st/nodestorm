import type { Graph } from "@nodestorm/shared";
import { Bookmark, History, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Icon } from "../ui/Icon";
import { createPortal } from "react-dom";
import { t as tr, useLocale, useT, type MessageKey } from "../i18n";
import { diffSummary, isSame, MAX_AUTO, type AutoReason, type SnapshotMeta } from "../lib/snapshots";
import { currentProject, useGraphStore } from "../store/graphStore";
import {
  deleteSnapshot,
  loadSnapshots,
  restoreAsNew,
  restoreSnapshot,
  snapshotMain,
  takeSnapshot,
  useSnapshots,
} from "../store/snapshotStore";
import { Modal } from "./Modal";
import "./versions.css";

const REASONS: Record<AutoReason, MessageKey> = {
  installAll: "versions.reason.installAll",
  extract: "versions.reason.extract",
  deriveTogether: "versions.reason.deriveTogether",
  merge: "versions.reason.merge",
  discard: "versions.reason.discard",
  tidy: "versions.reason.tidy",
  restore: "versions.reason.restore",
  periodic: "versions.reason.periodic",
};

/** The list's name for a snapshot: its label, or why it was taken. */
const title = (m: SnapshotMeta) =>
  m.kind === "named" ? m.label ?? tr("versions.unnamed") : tr(REASONS[m.reason ?? "periodic"] ?? "versions.reason.periodic");

/**
 * "Versions…" (File menu): the current project's snapshots (lib/snapshots.ts), newest first. Save a named one, compare
 * one with the project as it is now, preview it read-only, restore it (in place or as a new project) or delete it.
 * Rendered into <body> so it stays visible when the toolbar's small-screen menu that opened it folds away.
 */
export function VersionsDialog({ onClose, focusSave }: { onClose: () => void; focusSave?: boolean }) {
  const t = useT();
  const lang = useLocale((s) => s.lang);
  const available = useSnapshots((s) => s.available);
  const all = useSnapshots((s) => s.metas);
  const project = useGraphStore(currentProject);
  const main = useGraphStore((s) => s.graphs[currentProject(s).mainId]);
  const metas = all.filter((m) => m.projectId === project.id);
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => void loadSnapshots(), []);

  const when = (m: SnapshotMeta) =>
    new Date(m.createdAt).toLocaleString(lang === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" });

  /** Run a step with the buttons disabled; a failure is shown in the dialog. */
  const act = (fn: () => Promise<void>) => async () => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(tr("versions.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setWorking(false);
    }
  };

  const save = act(async () => {
    const meta = await takeSnapshot({ label });
    if (!meta) throw new Error(tr("versions.unavailable"));
    setLabel("");
    setNotice(tr("versions.saved", { name: title(meta) }));
  });
  const restore = (m: SnapshotMeta) => act(async () => {
    await restoreSnapshot(m.id);
    useGraphStore.getState().setToast(tr("versions.restored", { name: title(m), when: when(m) }), "info");
    onClose();
  });
  const restoreCopy = (m: SnapshotMeta) => act(async () => {
    const name = await restoreAsNew(m.id, tr("versions.copyName", { name: project.name, when: when(m) }));
    useGraphStore.getState().setToast(tr("versions.restoredAsNew", { name }), "info");
    onClose();
  });
  const preview = (m: SnapshotMeta) => act(async () => {
    const graph = await snapshotMain(m.id);
    useGraphStore.getState().openView(graph, `${project.name} · ${title(m)} · ${when(m)}`, "snapshot");
    onClose();
  });
  const remove = (m: SnapshotMeta) => act(async () => {
    await deleteSnapshot(m.id);
    setDeleting(null);
    setNotice(tr("versions.deleted", { name: title(m) }));
  });

  return createPortal(
    <Modal label={t("versions.dialog")} title={t("versions.dialog")} onClose={onClose} className="versions">
      <p className="muted small">{t("versions.intro", { name: project.name, n: MAX_AUTO })}</p>
      {available === false ? (
        <p className="warn-box small" role="status" data-testid="versions-unavailable">{t("versions.unavailable")}</p>
      ) : (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("versions.labelPlaceholder")}
            aria-label={t("versions.label")}
            maxLength={120}
            autoFocus={focusSave}
          />
          <button type="submit" className="primary" disabled={working || !available} data-testid="versions-save">
            <Icon icon={Save} size={14} />
            {t("versions.save")}
          </button>
        </form>
      )}
      <div role="status" className="small versions__notice">
        {notice && <span>{notice}</span>}
      </div>
      {error && <p className="error small" role="alert">{error}</p>}
      {available && !metas.length && <p className="muted">{t("versions.empty")}</p>}
      {metas.length > 0 && (
        <ul className="versions__list" aria-label={t("versions.list")} data-testid="versions-list">
          {metas.map((m) => (
            <li key={m.id} className="versions__item" data-testid="version">
              <div className="versions__head">
                <Icon icon={m.kind === "named" ? Bookmark : History} size={14} className="versions__icon" />
                <span className={`versions__title${m.kind === "named" ? " versions__title--named" : ""}`}>{title(m)}</span>
                <time className="muted small" dateTime={new Date(m.createdAt).toISOString()}>{when(m)}</time>
              </div>
              <div className="muted small">
                {t("versions.counts", { concepts: m.concepts, relations: m.relations })}
                {m.sandboxes > 0 && ` · ${t("versions.sandboxes", { n: m.sandboxes })}`}
              </div>
              <div className="versions__actions">
                <button
                  className="small-btn"
                  aria-expanded={comparing === m.id}
                  onClick={() => setComparing(comparing === m.id ? null : m.id)}
                >
                  {t("versions.compare")}
                </button>
                <button className="small-btn" disabled={working} onClick={preview(m)} title={t("versions.previewTitle")}>
                  {t("versions.preview")}
                </button>
                <button className="small-btn" disabled={working} onClick={restore(m)} title={t("versions.restoreTitle")}>
                  {t("versions.restore")}
                </button>
                <button className="small-btn" disabled={working} onClick={restoreCopy(m)} title={t("versions.restoreNewTitle")}>
                  {t("versions.restoreNew")}
                </button>
                {deleting === m.id ? (
                  <button className="small-btn danger" disabled={working} onClick={remove(m)} autoFocus>
                    {t("versions.confirmDelete")}
                  </button>
                ) : (
                  <button className="small-btn" disabled={working} onClick={() => setDeleting(m.id)}>
                    {t("common.delete")}
                  </button>
                )}
              </div>
              {comparing === m.id && main && <Compare id={m.id} current={main} />}
            </li>
          ))}
        </ul>
      )}
    </Modal>,
    document.body,
  );
}

/** What restoring a snapshot would change in the main graph: concepts back, gone and changed, and relations. */
function Compare({ id, current }: { id: string; current: Graph }) {
  const t = useT();
  const [snap, setSnap] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    snapshotMain(id).then(
      (g) => live && setSnap(g),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => { live = false; };
  }, [id]);
  if (error) return <p className="error small" role="alert">{t("versions.failed", { error })}</p>;
  if (!snap) return <p className="muted small">{t("common.loading")}</p>;
  const d = diffSummary(snap, current);
  const names = (list: string[]) => list.slice(0, 8).join(", ") + (list.length > 8 ? ", …" : "");
  if (isSame(d)) return <p className="muted small versions__diff">{t("versions.same")}</p>;
  return (
    <ul className="versions__diff small" data-testid="version-diff" aria-label={t("versions.diffLabel")}>
      {d.added.length > 0 && <li>{t("versions.diffAdded", { n: d.added.length, names: names(d.added) })}</li>}
      {d.removed.length > 0 && <li>{t("versions.diffRemoved", { n: d.removed.length, names: names(d.removed) })}</li>}
      {d.changed.length > 0 && <li>{t("versions.diffChanged", { n: d.changed.length, names: names(d.changed) })}</li>}
      {(d.relationsAdded > 0 || d.relationsRemoved > 0) && (
        <li>{t("versions.diffRelations", { added: d.relationsAdded, removed: d.relationsRemoved })}</li>
      )}
    </ul>
  );
}
