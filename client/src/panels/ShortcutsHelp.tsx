import { ControlButton } from "@xyflow/react";
import { useEffect } from "react";
import { create } from "zustand";
import { useT } from "../i18n";
import { ShortcutsDialog } from "./lazy";

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
  const t = useT();
  return (
    <ControlButton onClick={() => setOpen(true)} title={t("shortcuts.button")} aria-label={t("shortcuts.button")} className="shortcuts-button">
      ?
    </ControlButton>
  );
}
