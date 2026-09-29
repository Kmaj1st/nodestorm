import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Icon } from "../ui/Icon";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last: only the top one reacts to Escape and Tab (Settings can open over Add). */
const stack: HTMLElement[] = [];

/**
 * An accessible modal dialog: aria-modal, focus moves in on open and is trapped inside, Escape and a click
 * on the backdrop close it, and focus returns to whatever opened it.
 *
 * With a `title` it has the standard header: the title and a close (X) button. Put the actions last, in a
 * `.form__actions` row: it sticks to the bottom of a long dialog, right-aligned.
 *
 * `dirty`: the dialog holds something the user typed and hasn't saved. Escape, the backdrop and the close button
 * then ask "Discard what you typed?" first (focus on "Keep editing"; Escape again keeps editing), so a stray key
 * never loses the text. The dialog's own Cancel-like buttons still close it directly.
 */
export function Modal({ label, title, onClose, className, top, dirty = false, children }: {
  label: string;
  /** The visible heading (defaults to none: the palette and the walkthrough draw their own). */
  title?: ReactNode;
  onClose: () => void;
  className?: string;
  /** Sit near the top of the screen (command palette) instead of centred. */
  top?: boolean;
  dirty?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const body = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  // Captured during the first render, before any autoFocus inside the dialog moves focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const close = useRef(onClose);
  close.current = onClose;
  const [asking, setAsking] = useState(false);
  const confirming = asking && dirty;
  const keepBtn = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  // What Escape, the backdrop and the close button do: close, or ask first when there is unsaved text.
  const requestClose = useRef(() => {});
  requestClose.current = () => {
    if (!dirty) return onClose();
    if (!confirming && document.activeElement instanceof HTMLElement) returnTo.current = document.activeElement;
    setAsking(true);
  };
  const keepEditing = useRef(() => {});
  keepEditing.current = () => {
    setAsking(false);
    const back = returnTo.current;
    (back?.isConnected ? back : body.current)?.focus();
  };
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;

  useEffect(() => {
    if (confirming) keepBtn.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (!dirty) setAsking(false);
  }, [dirty]);

  useEffect(() => {
    const el = body.current!;
    stack.push(el);
    // Children may have autofocused a field already; otherwise focus the first control (not the header's close
    // button), or the dialog itself. Without scrolling: the dialog opens at its top, unless its opener already scrolled
    // it to a part (Settings' Web search, from the sources pop-up).
    if (!el.contains(document.activeElement)) {
      const first = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].find((n) => !n.classList.contains("modal__close"));
      (first ?? el).focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== el) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmingRef.current) keepEditing.current();
        else requestClose.current();
      } else if (e.key === "Tab") {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
        if (!items.length) return e.preventDefault();
        const first = items[0];
        const last = items[items.length - 1];
        const at = document.activeElement;
        if (e.shiftKey && (at === first || !el.contains(at))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || !el.contains(at))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(el), 1);
      // On a real unmount the node is already detached; StrictMode's simulated one keeps it attached.
      if (!el.isConnected && opener?.isConnected) opener.focus();
    };
  }, [opener]);

  return (
    <div
      className={`modal${top ? " modal--top" : ""}`}
      // Only a click that starts and ends on the backdrop closes: dragging a text selection out of a field doesn't.
      onMouseDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) requestClose.current();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={body}
        className={`modal__body${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {title !== undefined && (
          <header className="modal__header">
            <h2 className="modal__title">{title}</h2>
            <button type="button" className="icon-btn modal__close" onClick={() => requestClose.current()} aria-label={t("common.close")} title={t("common.close")}>
              <Icon icon={X} />
            </button>
          </header>
        )}
        {confirming && (
          <div className="modal__discard" role="alert" data-testid="modal-discard">
            <span>{t("modal.discardAsk")}</span>
            <span className="spacer" />
            <button type="button" ref={keepBtn} className="primary" onClick={() => keepEditing.current()}>
              {t("modal.keepEditing")}
            </button>
            <button type="button" onClick={() => onClose()}>{t("modal.discard")}</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
