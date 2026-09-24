import { ControlButton } from "@xyflow/react";
import { Fragment, useEffect, useMemo } from "react";
import { create } from "zustand";
import { comboLabel, currentIsMac, SHORTCUTS } from "../lib/shortcuts";
import { Modal } from "./Modal";

// User-visible strings, in one place for the i18n layer.
const TEXT = {
  title: "Keyboard shortcuts",
  button: "Keyboard shortcuts (?)",
  close: "Close",
  or: "or",
};

const useHelp = create<{ open: boolean }>()(() => ({ open: false }));
const setOpen = (open: boolean) => useHelp.setState({ open });

/** The "?" key opens the list (not while typing or with a dialog open); mount once, in App. */
export function ShortcutsHelp() {
  const open = useHelp((s) => s.open);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable=true], .modal")) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null;
}

/** "?" among the canvas zoom controls. */
export function ShortcutsButton() {
  return (
    <ControlButton onClick={() => setOpen(true)} title={TEXT.button} aria-label={TEXT.button} className="shortcuts-button">
      ?
    </ControlButton>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const mac = useMemo(currentIsMac, []);
  return (
    <Modal label={TEXT.title} onClose={onClose} className="shortcuts">
      <h3>{TEXT.title}</h3>
      {SHORTCUTS.map((group) => (
        <section key={group.title} className="shortcuts__group">
          <h4>{group.title}</h4>
          <dl>
            {group.items.map((item) => (
              <Fragment key={item.action}>
                <dt>
                  {item.keys.map((combo, i) => (
                    <Fragment key={i}>
                      {i > 0 && <span className="muted small"> {TEXT.or} </span>}
                      <kbd>{comboLabel(combo, mac)}</kbd>
                    </Fragment>
                  ))}
                </dt>
                <dd>{item.action}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
      <div className="form__actions">
        <button onClick={onClose}>{TEXT.close}</button>
      </div>
    </Modal>
  );
}
