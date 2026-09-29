import { ControlButton, useStoreApi } from "@xyflow/react";
import { CopyCheck } from "lucide-react";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import { useT } from "../i18n";
import { createHoldTracker } from "../lib/hold";
import { activeGraph, isViewing, useGraphStore } from "../store/graphStore";
import { useView } from "../store/viewStore";
import { Icon } from "../ui/Icon";

/**
 * "Select several": a touch screen has no Shift or Ctrl key, so Mix and Derive (two or more concepts) were out of
 * reach there. While it is on, a tap or click on a concept adds it to the selection or takes it out, exactly as
 * Shift/Ctrl-click does (which keeps working). Its button sits with the zoom buttons in the canvas corner (the toolbar
 * has no room left at 1200px), holding a card starts it with that card,
 * and the bar on the canvas says how many are selected, with Clear and Done (Escape, see App.tsx).
 */

/** The toggle, among the canvas's zoom buttons (not in the read-only viewer, which has nothing to mix or derive). */
export function SelectSeveralButton() {
  const t = useT();
  const on = useView((v) => v.selecting);
  const empty = useGraphStore((s) => !activeGraph(s).nodes.length);
  return (
    <ControlButton
      className={`select-several${on ? " select-several--on" : ""}`}
      onClick={() => useView.getState().setSelecting(!on)}
      disabled={empty && !on}
      aria-pressed={on}
      title={t("select.title")}
      aria-label={t("select.button")}
      data-testid="select-several"
    >
      <Icon icon={CopyCheck} size={14} />
    </ControlButton>
  );
}

/**
 * Inside <ReactFlow>: while Select several is on, React Flow's multi-selection stays active, as if Shift were held.
 * (React Flow resets it whenever a multi-selection key goes up, so it is put back each time.)
 */
export function SelectSeveralSync() {
  const store = useStoreApi();
  const on = useView((v) => v.selecting);
  useEffect(() => {
    if (!on) return;
    const hold = () => {
      if (!store.getState().multiSelectionActive) store.setState({ multiSelectionActive: true });
    };
    hold();
    const stop = store.subscribe(hold);
    return () => {
      stop();
      store.setState({ multiSelectionActive: false });
    };
  }, [on, store]);
  return null;
}

/** On the canvas while Select several is on: "2 selected · Clear · Done". */
export function SelectBar() {
  const t = useT();
  const store = useStoreApi();
  const on = useView((v) => v.selecting);
  const n = useGraphStore((s) => s.selection.length);
  const viewing = useGraphStore(isViewing);
  const doneRef = useRef<HTMLButtonElement>(null);
  if (!on || viewing) return null;
  // Clear disables itself and Done takes the bar away: the keyboard goes on to Done, then back to the toggle.
  const clear = () => {
    store.getState().unselectNodesAndEdges();
    doneRef.current?.focus();
  };
  const done = () => {
    const fromBar = doneRef.current === document.activeElement;
    useView.getState().setSelecting(false);
    if (fromBar) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="select-several"]')?.focus());
  };
  return (
    <div className="select-bar" role="group" aria-label={t("select.bar")} data-testid="select-bar">
      <Icon icon={CopyCheck} size={14} className="select-bar__icon" />
      <span className="select-bar__count" aria-live="polite" data-testid="select-count">
        {n ? t("select.count", { n }) : t("select.hint")}
      </span>
      <button onClick={clear} disabled={!n} title={t("select.clearTitle")}>
        {t("select.clear")}
      </button>
      <button ref={doneRef} className="primary select-bar__done" onClick={done} title={t("select.doneTitle")}>
        {t("select.done")}
      </button>
    </div>
  );
}

/**
 * Holding a card on a touch screen calls `onHold(id)` (see createHoldTracker in lib/hold.ts). Returns handlers for the
 * canvas wrapper (capture phase, before React Flow sees the events). A long press also opens the browser's context
 * menu (or text selection): not on a card. Unmounting (also strict mode's trial one) ends a press under way.
 */
export function useHoldToSelect(onHold: (id: string) => void) {
  const latest = useRef(onHold);
  useEffect(() => {
    latest.current = onHold;
  }, [onHold]);
  const tracker = useRef<ReturnType<typeof createHoldTracker> | null>(null);
  useEffect(() => {
    const t = createHoldTracker((id) => latest.current(id));
    tracker.current = t;
    return () => {
      t.dispose();
      tracker.current = null;
    };
  }, []);

  const onPointerDownCapture = useCallback((e: ReactPointerEvent) => tracker.current?.down(e), []);
  const onContextMenuCapture = useCallback((e: SyntheticEvent) => {
    if (tracker.current?.holding() && e.target instanceof Element && e.target.closest(".react-flow__node")) e.preventDefault();
  }, []);

  return { onPointerDownCapture, onContextMenuCapture };
}
