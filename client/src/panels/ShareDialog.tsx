import type { Graph } from "@nodestorm/shared";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rich, useT } from "../i18n";
import { encodeShare, LONG_LINK, shareUrl } from "../lib/share";
import { Modal } from "./Modal";

/**
 * "Share link…": the graph packed into a link (see lib/share.ts), with a Copy button and its length. Rendered into
 * <body> so it stays visible when the toolbar's small-screen menu that opened it folds away.
 */
export function ShareDialog({ graph, name, onClose }: { graph: Graph; name: string; onClose: () => void }) {
  const t = useT();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    encodeShare(graph, name).then(
      (token) => live && setLink(shareUrl(token)),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => { live = false; };
  }, [graph, name]);

  const copy = async () => {
    if (!link) return;
    field.current?.select();
    const ok = await navigator.clipboard?.writeText(link).then(() => true, () => false);
    // Without clipboard access the link is at least selected for Ctrl+C.
    if (ok) setCopied(true);
  };

  return createPortal(
    <Modal label={t("share.dialog")} onClose={onClose}>
      <h3>{t("share.dialog")}</h3>
      <p className="muted small">{rich("share.intro", { n: graph.nodes.length })}</p>
      {error && <p className="error small" role="alert">{t("share.failed", { error })}</p>}
      {!link && !error && <p className="muted">{t("share.packing")}</p>}
      {link && (
        <>
          <div className="row">
            <input
              ref={field}
              readOnly
              value={link}
              aria-label={t("share.dialog")}
              data-testid="share-link"
              onFocus={(e) => e.target.select()}
            />
            <button className="primary" onClick={copy}>{t(copied ? "share.copied" : "share.copy")}</button>
          </div>
          <p className="muted small" data-testid="share-size">{t("share.chars", { n: link.length.toLocaleString() })}</p>
          {link.length > LONG_LINK && (
            <p className="warn-box small" role="status">{t("share.long")}</p>
          )}
        </>
      )}
      <div className="form__actions">
        <button onClick={onClose}>{t("common.close")}</button>
      </div>
    </Modal>,
    document.body,
  );
}
