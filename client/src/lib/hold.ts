/** How long a finger rests on a card before Select several starts with it, and how far it may wander meanwhile. */
export const HOLD_MS = 500;
export const HOLD_SLOP = 10;
/** After a hold, how long the tap it ends may take to arrive (its click is swallowed until then). */
const SWALLOW_MS = 400;
/** An options object rather than `true`: the same in browsers, and Node's EventTarget (tests) only matches this form. */
const CAPTURE = { capture: true };

type Listeners = Pick<EventTarget, "addEventListener" | "removeEventListener">;
interface Press {
  pointerType: string;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
}

/**
 * Holding a card (touch or pen, not a mouse: a mouse drags) calls `onHold(id)`. Moving the finger first (a drag, or
 * Physics' pull), a second finger (a pinch) or letting go early cancel it. The tap that ends a hold is swallowed, so it
 * doesn't toggle the card straight back out of the selection. Every timer and listener belongs to the current press:
 * a new press after the finger went up starts afresh (its tap isn't swallowed), and `dispose` (unmount) ends it all.
 */
export function createHoldTracker(onHold: (id: string) => void, win: Listeners = window) {
  let hold: { x: number; y: number; timer: ReturnType<typeof setTimeout>; fired: boolean; lifted: boolean } | null = null;
  let cleanup = () => {};

  const down = (e: Press) => {
    if (e.pointerType === "mouse") return;
    if (hold) {
      const pinch = !hold.lifted; // a second finger while the first still rests: a pinch, not a hold
      cleanup();
      if (pinch) return;
    }
    const target = e.target as Element | null;
    // The card's own buttons (a badge, "choose a definition") keep their tap.
    if (!target || typeof target.closest !== "function" || target.closest("button, a, input, select, textarea")) return;
    const id = target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
    if (!id) return;
    const move = (ev: Event) => {
      const { clientX = 0, clientY = 0 } = ev as PointerEvent;
      if (hold && !hold.fired && Math.hypot(clientX - hold.x, clientY - hold.y) > HOLD_SLOP) cleanup();
    };
    // The click ending a hold: swallowed once, then everything of this press goes.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
      cleanup();
    };
    const up = () => {
      if (!hold?.fired) return cleanup();
      // The click (if any) follows pointerup at once; stop swallowing soon after either way.
      hold.lifted = true;
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", up);
      win.removeEventListener("pointercancel", up);
      hold.timer = setTimeout(cleanup, SWALLOW_MS);
    };
    const mine = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", up);
      win.removeEventListener("pointercancel", up);
      win.removeEventListener("click", swallow, CAPTURE);
      cleanup = () => {};
    };
    cleanup = mine;
    hold = {
      x: e.clientX,
      y: e.clientY,
      fired: false,
      lifted: false,
      timer: setTimeout(() => {
        if (!hold) return;
        hold.fired = true;
        win.addEventListener("click", swallow, CAPTURE);
        onHold(id);
      }, HOLD_MS),
    };
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", up);
    win.addEventListener("pointercancel", up);
  };

  return {
    down,
    /** A press is under way (the long-press context menu is kept off the card meanwhile). */
    holding: () => hold !== null,
    dispose: () => cleanup(),
  };
}
