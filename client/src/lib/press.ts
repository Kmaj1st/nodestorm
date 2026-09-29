/** How far the pointer may move between press and release for it still to be a click (not a pan or a drag). */
export const CLICK_SLOP = 4;

interface Pointer {
  pointerId: number;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
}

/** The card an event happened on (not one of its own buttons, which keep their click). */
function cardAt(target: EventTarget | null): string | null {
  const el = target as Element | null;
  if (!el || typeof el.closest !== "function" || el.closest("button, a, input, select, textarea")) return null;
  return el.closest<HTMLElement>(".react-flow__node")?.dataset.id ?? null;
}

/**
 * A card pressed and released without the pointer moving is a click on that card, even when the card slid away under
 * the pointer meanwhile (the view animating after Load example, entering or leaving focus mode, Physics). The browser
 * then sends the click to what holds both (the empty canvas), which would deselect everything and close the inspector.
 * `up` returns the pressed card's id for such a release, null otherwise (released on the card itself, moved, no card).
 * `under` is what the pointer is over at the release: a touch's events all go to what it first touched (implicit pointer
 * capture), while its click goes to what is under the finger, so the canvas passes `elementFromPoint` there.
 */
export function createPressTracker() {
  let press: { id: string; pointerId: number; x: number; y: number } | null = null;
  return {
    down(e: Pointer) {
      const id = cardAt(e.target);
      press = id ? { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY } : null;
    },
    up(e: Pointer, under: EventTarget | null = e.target): string | null {
      const p = press;
      if (!p || p.pointerId !== e.pointerId) return null;
      press = null;
      if (cardAt(under) === p.id) return null;
      return Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP ? p.id : null;
    },
  };
}

/**
 * The selection after a click on card `id` (what React Flow does for a click on it): alone, unless it is one of several
 * selected (the group stays, so it can be dragged together); with Shift/Ctrl or in Select several (`toggle`) it goes
 * in or out of the selection.
 */
export function clickedSelection(selected: readonly string[], id: string, toggle: boolean): string[] {
  const has = selected.includes(id);
  if (toggle) return has ? selected.filter((s) => s !== id) : [...selected, id];
  return has && selected.length > 1 ? [...selected] : [id];
}
