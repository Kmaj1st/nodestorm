import type { Graph } from "@nodestorm/shared";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { encodeShare, LONG_LINK, shareUrl } from "../lib/share";
import { Modal } from "./Modal";

/**
 * "Share link…": the graph packed into a link (see lib/share.ts), with a Copy button and its length. Rendered into
 * <body> so it stays visible when the toolbar's small-screen menu that opened it folds away.
 */
export function ShareDialog({ graph, name, onClose }: { graph: Graph; name: string; onClose: () => void }) {
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
    <Modal label="Share link" onClose={onClose}>
      <h3>Share link</h3>
      <p className="muted small">
        Anyone with this link can view <b>{graph.nodes.length}</b> concept{graph.nodes.length === 1 ? "" : "s"} of this graph
        (not its sandboxes) and save a copy. The graph is packed into the link itself: nothing is uploaded.
      </p>
      {error && <p className="error small" role="alert">Couldn't create the link: {error}</p>}
      {!link && !error && <p className="muted">Packing…</p>}
      {link && (
        <>
          <div className="row">
            <input
              ref={field}
              readOnly
              value={link}
              aria-label="Share link"
              data-testid="share-link"
              onFocus={(e) => e.target.select()}
            />
            <button className="primary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="muted small" data-testid="share-size">{link.length.toLocaleString()} characters</p>
          {link.length > LONG_LINK && (
            <p className="warn-box small" role="status">
              This link is long. Some chat apps and mail clients cut long links off, which breaks them. If that happens,
              share the file from Export ▾ → JSON instead.
            </p>
          )}
        </>
      )}
      <div className="form__actions">
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>,
    document.body,
  );
}
