import { ControlButton } from "@xyflow/react";
import { CircleHelp, Keyboard } from "lucide-react";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useT } from "../i18n";
import { touchScreen } from "../lib/touch";
import { ShortcutsDialog } from "./lazy";
import { Icon } from "../ui/Icon";

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

/**
 * The keyboard-shortcuts button among the canvas zoom controls ("?" opens it too). On a touch screen, where it is the
 * way back to the tour, it is "Help and tour".
 */
export function ShortcutsButton() {
  const t = useT();
  const touch = useMemo(touchScreen, []);
  const label = t(touch ? "shortcuts.buttonTouch" : "shortcuts.button");
  return (
    <ControlButton onClick={() => setOpen(true)} title={label} aria-label={label} className="shortcuts-button">
      <Icon icon={touch ? CircleHelp : Keyboard} size={14} />
    </ControlButton>
  );
}
