import { ControlButton, useStoreApi } from "@xyflow/react";
import { CopyCheck } from "lucide-react";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import { useT } from "../i18n";
import { activeGraph, useGraphStore } from "../store/graphStore";
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
  const doneRef = useRef<HTMLButtonElement>(null);
  if (!on) return null;
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

/** How long a finger rests on a card before Select several starts with it, and how far it may wander meanwhile. */
const HOLD_MS = 500;
const HOLD_SLOP = 10;

/**
 * Holding a card (touch or pen, not a mouse: a mouse drags) calls `onHold(id)`. Moving the finger first (a drag, or
 * Physics' pull), a second finger (a pinch) or letting go early cancel it. The tap that ends a hold is swallowed, so
 * it doesn't toggle the card straight back out of the selection, and so is the long-press context menu.
 * Returns handlers for the canvas wrapper (capture phase, before React Flow sees the events).
 */
export function useHoldToSelect(onHold: (id: string) => void) {
  const hold = useRef<{ x: number; y: number; timer: number; fired: boolean } | null>(null);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);

  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (hold.current) {
        cleanup.current(); // a second finger: a pinch, not a hold
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      // The card's own buttons (a badge, "choose a definition") keep their tap.
      if (!target || target.closest("button, a, input, select, textarea")) return;
      const id = target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
      if (!id) return;
      const move = (ev: PointerEvent) => {
        const h = hold.current;
        if (h && !h.fired && Math.hypot(ev.clientX - h.x, ev.clientY - h.y) > HOLD_SLOP) cleanup.current();
      };
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      const up = () => {
        if (!hold.current?.fired) return cleanup.current();
        // The click (if any) follows pointerup at once; stop swallowing soon after either way.
        window.removeEventListener("pointermove", move);
        window.setTimeout(() => cleanup.current(), 400);
      };
      cleanup.current = () => {
        if (hold.current) clearTimeout(hold.current.timer);
        hold.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        window.removeEventListener("click", swallow, true);
        cleanup.current = () => {};
      };
      hold.current = {
        x: e.clientX,
        y: e.clientY,
        fired: false,
        timer: window.setTimeout(() => {
          if (!hold.current) return;
          hold.current.fired = true;
          window.addEventListener("click", swallow, true);
          onHold(id);
        }, HOLD_MS),
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [onHold],
  );

  // A long press on a touch screen also opens the browser's context menu (or text selection): not on a card.
  const onContextMenuCapture = useCallback((e: SyntheticEvent) => {
    if (hold.current && e.target instanceof Element && e.target.closest(".react-flow__node")) e.preventDefault();
  }, []);

  return { onPointerDownCapture, onContextMenuCapture };
}
