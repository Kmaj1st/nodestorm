import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHoldTracker, HOLD_MS } from "../src/lib/hold";

// Holding a card starts Select several: every timer and window listener belongs to the press and goes with it.

/** A window stand-in that counts its listeners. */
function fakeWindow() {
  const target = new EventTarget();
  let count = 0;
  return {
    addEventListener: (...a: Parameters<EventTarget["addEventListener"]>) => (count++, target.addEventListener(...a)),
    removeEventListener: (...a: Parameters<EventTarget["removeEventListener"]>) => (count = Math.max(0, count - 1), target.removeEventListener(...a)),
    dispatch: (type: string, props: object = {}) => {
      const ev = Object.assign(new Event(type, { cancelable: true }), props);
      target.dispatchEvent(ev);
      return ev;
    },
    get listeners() {
      return count;
    },
  };
}
/** A card (or one of its buttons) as the pressed element. */
const card = (id: string, button = false) =>
  ({ closest: (sel: string) => (sel.includes("button") ? (button ? {} : null) : { dataset: { id } }) }) as unknown as EventTarget;
const press = (id: string, extra: object = {}) => ({ pointerType: "touch", target: card(id), clientX: 10, clientY: 10, ...extra });

describe("hold to select", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a hold selects the card, swallows the one tap ending it, and leaves no listener behind", () => {
    const win = fakeWindow();
    const held: string[] = [];
    const t = createHoldTracker((id) => held.push(id), win);
    t.down(press("a"));
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual(["a"]);
    win.dispatch("pointerup");
    expect(win.dispatch("click").defaultPrevented).toBe(true);
    expect(win.listeners).toBe(0);
    expect(win.dispatch("click").defaultPrevented).toBe(false);
  });

  it("moving, letting go early, a mouse or a card's button start nothing", () => {
    const win = fakeWindow();
    const held: string[] = [];
    const t = createHoldTracker((id) => held.push(id), win);
    t.down(press("a"));
    win.dispatch("pointermove", { clientX: 40, clientY: 10 });
    t.down(press("b"));
    win.dispatch("pointerup");
    t.down(press("c", { pointerType: "mouse" }));
    t.down(press("d", { target: card("d", true) }));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(held).toEqual([]);
    expect(win.listeners).toBe(0);
  });

  it("a second finger is a pinch: the hold is cancelled", () => {
    const win = fakeWindow();
    const held: string[] = [];
    const t = createHoldTracker((id) => held.push(id), win);
    t.down(press("a"));
    t.down(press("b"));
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual([]);
    expect(t.holding()).toBe(false);
  });

  it("a new press soon after a hold starts its own (the old timer doesn't cancel it, its tap isn't swallowed)", () => {
    const win = fakeWindow();
    const held: string[] = [];
    const t = createHoldTracker((id) => held.push(id), win);
    t.down(press("a"));
    vi.advanceTimersByTime(HOLD_MS);
    win.dispatch("pointerup"); // no click came (the browser dropped it)
    vi.advanceTimersByTime(100);
    t.down(press("b"));
    win.dispatch("pointerup"); // a quick tap on b
    expect(win.dispatch("click").defaultPrevented).toBe(false);
    vi.advanceTimersByTime(250);
    t.down(press("c"));
    vi.advanceTimersByTime(100); // past the first hold's swallow time: c's press goes on
    expect(t.holding()).toBe(true);
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual(["a", "c"]);
  });

  it("dispose (unmount, strict mode's trial one included) ends a press under way", () => {
    const win = fakeWindow();
    const held: string[] = [];
    const t = createHoldTracker((id) => held.push(id), win);
    t.down(press("a"));
    t.dispose();
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual([]);
    expect(win.listeners).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
