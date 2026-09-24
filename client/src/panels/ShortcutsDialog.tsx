import { Fragment, useMemo } from "react";
import { t as translate, useT } from "../i18n";
import { comboLabel, currentIsMac, SHORTCUTS, type Combo } from "../lib/shortcuts";
import { startTour } from "../store/onboardingStore";
import { Modal } from "./Modal";

/** Key names are shown as they are, except the words for mouse actions ("click", "drag"). */
const localCombo = (combo: Combo): Combo =>
  combo.map((k) => (k === "click" ? translate("shortcuts.click") : k === "drag" ? translate("shortcuts.drag") : k));

/** The list of keyboard shortcuts; ShortcutsHelp opens it with "?" or the canvas button. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
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
