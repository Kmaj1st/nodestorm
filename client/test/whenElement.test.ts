import { afterEach, describe, expect, it, vi } from "vitest";
import { whenElement } from "../src/lib/whenElement";

// Waiting for an element (Settings' Web search part, to scroll to it) without polling, and without watching the page
// once the wait is over or its owner is gone.

class FakeObserver {
  static all: FakeObserver[] = [];
  connected = false;
  constructor(readonly cb: () => void) {
    FakeObserver.all.push(this);
  }
  observe() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  /** A DOM change. */
  fire() {
    if (this.connected) this.cb();
  }
}

const root = {} as Node;
afterEach(() => {
  FakeObserver.all = [];
  vi.useRealTimers();
});

describe("whenElement", () => {
  it("calls back at once when the element is there, without observing", () => {
    const found = vi.fn();
    whenElement(() => "el", found, { root, Observer: FakeObserver });
    expect(found).toHaveBeenCalledWith("el");
    expect(FakeObserver.all).toHaveLength(0);
  });

  it("waits for a DOM change that brings it, then stops observing", () => {
    let el: string | null = null;
    const found = vi.fn();
    whenElement(() => el, found, { root, Observer: FakeObserver });
    const [obs] = FakeObserver.all;
    obs.fire();
    expect(found).not.toHaveBeenCalled();
    el = "part";
    obs.fire();
    expect(found).toHaveBeenCalledTimes(1);
    expect(obs.connected).toBe(false);
  });

  it("stops when cancelled (the pop-up closed) or after the time-out", () => {
    vi.useFakeTimers();
    const found = vi.fn();
    const cancel = whenElement(() => null, found, { root, Observer: FakeObserver });
    cancel();
    expect(FakeObserver.all[0].connected).toBe(false);
    whenElement(() => null, found, { root, Observer: FakeObserver, timeoutMs: 2000 });
    expect(FakeObserver.all[1].connected).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(FakeObserver.all[1].connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(found).not.toHaveBeenCalled();
  });
});
