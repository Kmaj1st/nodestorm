import { ArrowLeft, ChevronLeft, ChevronRight, Play, TextSelect } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import { useDerive } from "../../store/deriveStore";
import { Icon } from "../../ui/Icon";
import { MathText } from "../MathText";

/**
 * One page of an imported document. Select a passage to start a derivation from it (pointing at a problem in a
 * reference document). A scanned page nobody could read can have its text pasted in.
 */
export function Reader() {
  const t = useT();
  const reader = useDerive((s) => s.reader)!;
  const doc = useDerive((s) => s.docs.find((d) => d.id === reader.docId));
  const pages = useDerive((s) => s.pages[reader.docId]) ?? [];
  const [selected, setSelected] = useState("");
  const [pasted, setPasted] = useState("");
  const page = pages.find((p) => p.page === reader.page);
  const at = pages.findIndex((p) => p.page === reader.page);
  const go = (i: number) => {
    setSelected("");
    void useDerive.getState().openReader(reader.docId, pages[i].page);
  };

  if (!doc) return null;
  const startFrom = (statement: string) =>
    void useDerive.getState().start({ statement, source: { docId: doc.id, title: doc.title, page: reader.page } }).then(() => {
      useDerive.getState().closeReader();
    });

  // The selection, read when the mouse or keyboard finishes selecting inside the page text.
  const readSelection = () => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    const node = sel?.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    setSelected(el?.closest(".derive-reader__text") ? text : "");
  };

  return (
    <div className="derive-reader">
      <div className="derive-reader__bar">
        <button className="small-btn" onClick={() => useDerive.getState().closeReader()}>
          <Icon icon={ArrowLeft} size={14} />
          {t("dt.reader.back")}
        </button>
        <span className="derive-reader__where" aria-live="polite">
          <b>{doc.title}</b> · {t("dt.reader.pageOf", { page: reader.page, n: doc.pages })}
        </span>
        <button className="icon-btn" disabled={at <= 0} onClick={() => go(at - 1)} aria-label={t("dt.reader.prev")} title={t("dt.reader.prev")}>
          <Icon icon={ChevronLeft} />
        </button>
        <button className="icon-btn" disabled={at < 0 || at >= pages.length - 1} onClick={() => go(at + 1)} aria-label={t("dt.reader.next")} title={t("dt.reader.next")}>
          <Icon icon={ChevronRight} />
        </button>
      </div>

      {page && page.text ? (
        <>
          <p className="muted small">{t(page.via === "vision" ? "dt.reader.viaVision" : "dt.reader.selectHint")}</p>
          <div className="derive-reader__text" onMouseUp={readSelection} onKeyUp={readSelection} data-testid="reader-text">
            {page.text.split(/\n{2,}/).map((para, i) => (
              <p key={i}>
                <MathText text={para} />
              </p>
            ))}
          </div>
          <div className="form__actions">
            <button onClick={() => startFrom(page.text)}>
              <Icon icon={Play} size={14} />
              {t("dt.reader.usePage")}
            </button>
            <button className="primary" disabled={!selected} onClick={() => startFrom(selected)}>
              <Icon icon={TextSelect} size={14} />
              {t("dt.reader.useSelection")}
            </button>
          </div>
        </>
      ) : (
        <form
          className="derive-reader__paste"
          onSubmit={(e) => {
            e.preventDefault();
            if (pasted.trim()) void useDerive.getState().setPageText(reader.docId, reader.page, pasted.trim()).then(() => setPasted(""));
          }}
        >
          <p className="warn-box small">{t("dt.reader.unread")}</p>
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} aria-label={t("dt.reader.pasteLabel")} />
          <div className="form__actions">
            <button className="primary" type="submit" disabled={!pasted.trim()}>{t("common.save")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
