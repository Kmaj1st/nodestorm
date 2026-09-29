import { describe, expect, it } from "vitest";
import { CLICK_SLOP, clickedSelection, createPressTracker } from "../src/lib/press";

// A card that slides away under the pointer between press and release (the view animating after Load example or
// focus mode) still gets the click: the browser sends it to the empty canvas, which would deselect everything.

/** A card (or one of its buttons), or the empty canvas (`null`), as the event's element. */
const on = (id: string | null, button = false) =>
  ({
    closest: (sel: string) => (sel.includes("button") ? (button ? {} : null) : id ? { dataset: { id } } : null),
  }) as unknown as EventTarget;
const at = (target: EventTarget, x = 10, y = 10, pointerId = 1) => ({ pointerId, target, clientX: x, clientY: y });

describe("press tracker", () => {
  it("a release off the pressed card without moving is a click on that card", () => {
    const t = createPressTracker();
    t.down(at(on("kernel")));
    expect(t.up(at(on(null)))).toBe("kernel"); // the card slid away: released over the canvas
    t.down(at(on("kernel")));
    expect(t.up(at(on("group")))).toBe("kernel"); // …or over another card that slid under the pointer
  });

  it("a normal click, a drag or pan, and presses off a card are left to React Flow", () => {
    const t = createPressTracker();
    t.down(at(on("kernel")));
    expect(t.up(at(on("kernel")))).toBeNull(); // released on the card: React Flow's own click
    t.down(at(on("kernel")));
    expect(t.up(at(on(null), 10 + CLICK_SLOP + 1, 10))).toBeNull(); // the pointer moved: a drag
    t.down(at(on(null)));
    expect(t.up(at(on(null)))).toBeNull(); // pressed on the canvas
    t.down(at(on("kernel", true)));
    expect(t.up(at(on(null)))).toBeNull(); // pressed on one of the card's buttons
    expect(t.up(at(on(null)))).toBeNull(); // a release with no press
  });

  it("a press is used once, and another finger's release doesn't end it", () => {
    const t = createPressTracker();
    t.down(at(on("kernel")));
    expect(t.up(at(on(null), 10, 10, 2))).toBeNull();
    expect(t.up(at(on(null)))).toBe("kernel");
    expect(t.up(at(on(null)))).toBeNull();
  });
});

describe("clickedSelection", () => {
  it("a plain click selects just that card, or keeps the group it belongs to", () => {
    expect(clickedSelection([], "a", false)).toEqual(["a"]);
    expect(clickedSelection(["b"], "a", false)).toEqual(["a"]);
    expect(clickedSelection(["a"], "a", false)).toEqual(["a"]);
    expect(clickedSelection(["a", "b"], "a", false)).toEqual(["a", "b"]);
    expect(clickedSelection(["b", "c"], "a", false)).toEqual(["a"]);
  });

  it("Shift/Ctrl-click and Select several toggle the card", () => {
    expect(clickedSelection(["b"], "a", true)).toEqual(["b", "a"]);
    expect(clickedSelection(["a", "b"], "a", true)).toEqual(["b"]);
  });
});
