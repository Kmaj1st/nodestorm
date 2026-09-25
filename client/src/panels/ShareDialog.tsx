import type { Graph } from "@nodestorm/shared";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { createPortal } from "react-dom";
import { rich, useLang, useT } from "../i18n";
import { errorMessage } from "../lib/errors";
import { encodeShare, LONG_LINK, shareUrl } from "../lib/share";
import { Modal } from "./Modal";

/**
 * "Share link…": the graph packed into a link (see lib/share.ts), with a Copy button and its length. Rendered into
 * <body> so it stays visible when the toolbar's small-screen menu that opened it folds away.
 */
export function ShareDialog({ graph, name, onClose }: { graph: Graph; name: string; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    encodeShare(graph, name).then(
      (token) => live && setLink(shareUrl(token)),
      (e) => live && setError(errorMessage(e)),
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
    <Modal label={t("share.dialog")} title={t("share.dialog")} onClose={onClose}>
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
            <button className="primary" onClick={copy}>
              <Icon icon={copied ? Check : Copy} size={14} />
              {t(copied ? "share.copied" : "share.copy")}
            </button>
          </div>
          <p className="muted small" data-testid="share-size">{t("share.chars", { n: link.length.toLocaleString(lang === "zh" ? "zh-CN" : "en") })}</p>
          {link.length > LONG_LINK && (
            <p className="warn-box warn-box__head small" role="status">
              <Icon icon={TriangleAlert} size={16} className="warn-box__icon" />
              <span>{t("share.long")}</span>
            </p>
          )}
        </>
      )}
    </Modal>,
    document.body,
  );
}
