import { ControlButton } from "@xyflow/react";
import { Fragment, useEffect, useMemo } from "react";
import { create } from "zustand";
import { t as translate, useT } from "../i18n";
import { comboLabel, currentIsMac, SHORTCUTS, type Combo } from "../lib/shortcuts";
import { startTour } from "../store/onboardingStore";
import { Modal } from "./Modal";

/** Key names are shown as they are, except the words for mouse actions ("click", "drag"). */
const localCombo = (combo: Combo): Combo =>
  combo.map((k) => (k === "click" ? translate("shortcuts.click") : k === "drag" ? translate("shortcuts.drag") : k));

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

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const mac = useMemo(currentIsMac, []);
  return (
    <Modal label={t("shortcuts.title")} onClose={onClose} className="shortcuts">
      <h3>{t("shortcuts.title")}</h3>
      {SHORTCUTS.map((group) => (
        <section key={group.title} className="shortcuts__group">
          <h4>{t(group.title)}</h4>
          <dl>
            {group.items.map((item) => (
              <Fragment key={item.action}>
                <dt>
                  {item.keys.map((combo, i) => (
                    <Fragment key={i}>
                      {i > 0 && <span className="muted small"> {t("shortcuts.or")} </span>}
                      <kbd>{comboLabel(localCombo(combo), mac)}</kbd>
                    </Fragment>
                  ))}
                </dt>
                <dd>{t(item.action)}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
      <div className="form__actions">
        <button onClick={() => { onClose(); startTour(); }}>{t("tour.showAgain")}</button>
        <button onClick={onClose}>{t("common.close")}</button>
      </div>
    </Modal>
  );
}
