import { useEffect, useRef, useState, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last: only the top one reacts to Escape and Tab (Settings can open over Add). */
const stack: HTMLElement[] = [];

/**
 * An accessible modal dialog: aria-modal, focus moves in on open and is trapped inside, Escape and a click
 * on the backdrop close it, and focus returns to whatever opened it.
 */
export function Modal({ label, onClose, className, top, children }: {
  label: string;
  onClose: () => void;
  className?: string;
  /** Sit near the top of the screen (command palette) instead of centred. */
  top?: boolean;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  // Captured during the first render, before any autoFocus inside the dialog moves focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = body.current!;
    stack.push(el);
    // Children may have autofocused a field already; otherwise focus the first control, or the dialog itself.
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== el) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
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
    <div className={`modal${top ? " modal--top" : ""}`} onClick={onClose}>
      <div
        ref={body}
        className={`modal__body${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
