import { CancelledError, SiteBlockedError } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Baidu Baike's JSONP call runs in a sandboxed iframe; only that frame's own answer (its window and the nonce) may be
// used. The DOM here is a small fake: just what baikeFetch touches.

vi.mock("../src/lib/baikeFrame", () => ({
  baikeFrameDoc: (src: string, nonce: string) => JSON.stringify({ src, nonce }),
}));

interface FakeFrame {
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  style: { cssText: string };
  srcdoc: string;
  contentWindow: object;
  removed: boolean;
  setAttribute(k: string, v: string): void;
  remove(): void;
}

let frames: FakeFrame[] = [];
let listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];

beforeEach(() => {
  frames = [];
  listeners = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const f: FakeFrame = {
        attrs: {},
        dataset: {},
        style: { cssText: "" },
        srcdoc: "",
        contentWindow: {},
        removed: false,
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        remove() {
          this.removed = true;
        },
      };
      frames.push(f);
      return f;
    },
    body: { appendChild: () => undefined },
  });
  vi.stubGlobal("window", {
    addEventListener: (_: string, fn: (typeof listeners)[number]) => listeners.push(fn),
    removeEventListener: (_: string, fn: (typeof listeners)[number]) => (listeners = listeners.filter((l) => l !== fn)),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const post = (source: unknown, data: unknown) => listeners.slice().forEach((l) => l({ source, data }));
const frameInfo = (f: FakeFrame) => JSON.parse(f.srcdoc) as { src: string; nonce: string };

describe("Baidu Baike fetch through the sandboxed frame", () => {
  it("uses a scripts-only sandbox and asks for the encoded name", async () => {
    const { baikeFetch } = await import("../src/lib/baike");
    const p = baikeFetch("正规 子群");
    const [f] = frames;
    expect(f.attrs.sandbox).toBe("allow-scripts");
    expect(frameInfo(f).src).toContain(`bk_key=${encodeURIComponent("正规 子群")}`);
    post(f.contentWindow, { nonce: frameInfo(f).nonce, data: {} });
    expect(await p).toEqual({});
  });

  it("ignores messages from other windows or with the wrong nonce, and uses the frame's own answer", async () => {
    const { baikeFetch } = await import("../src/lib/baike");
    const p = baikeFetch("群");
    const [f] = frames;
    const { nonce } = frameInfo(f);
    post({}, { nonce, data: { title: "forged", abstract: "from another window" } });
    post(f.contentWindow, { nonce: "guess", data: { title: "forged", abstract: "wrong nonce" } });
    post(f.contentWindow, "not an object");
    expect(f.removed).toBe(false);
    post(f.contentWindow, { nonce, data: { title: "群", abstract: "一种代数结构。", extra: 1 } });
    expect(await p).toEqual({ title: "群", abstract: "一种代数结构。" });
    expect(f.removed).toBe(true);
    expect(listeners).toEqual([]);
  });

  it("rejects an answer of the wrong shape, a script that failed to load, and no answer at all", async () => {
    const { baikeFetch } = await import("../src/lib/baike");
    let p = baikeFetch("群");
    post(frames[0].contentWindow, { nonce: frameInfo(frames[0]).nonce, data: { title: 42 } });
    await expect(p).rejects.toBeInstanceOf(SiteBlockedError);

    p = baikeFetch("群");
    post(frames[1].contentWindow, { nonce: frameInfo(frames[1]).nonce, error: true });
    await expect(p).rejects.toBeInstanceOf(SiteBlockedError);

    vi.useFakeTimers();
    p = baikeFetch("群");
    const caught = p.catch((e) => e);
    vi.advanceTimersByTime(8001);
    expect(await caught).toBeInstanceOf(SiteBlockedError);
    expect(frames[2].removed).toBe(true);
  });

  it("stops (and cleans up) when cancelled", async () => {
    const { baikeFetch } = await import("../src/lib/baike");
    const ctrl = new AbortController();
    const p = baikeFetch("群", ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    expect(frames[0].removed).toBe(true);
    expect(listeners).toEqual([]);
    await expect(baikeFetch("群", ctrl.signal)).rejects.toBeInstanceOf(CancelledError);
    expect(frames).toHaveLength(1); // an already-cancelled call doesn't even create a frame
  });

  it("baikeLookup turns the answer into a definition, or nothing for a missing entry", async () => {
    const { baikeLookup } = await import("../src/lib/baike");
    let p = baikeLookup("  群 ");
    post(frames[0].contentWindow, { nonce: frameInfo(frames[0]).nonce, data: { title: "群", abstract: "一种代数结构。" } });
    expect((await p).map((s) => [s.name, s.definition, s.exact])).toEqual([["群", "一种代数结构。", true]]);
    p = baikeLookup("无");
    post(frames[1].contentWindow, { nonce: frameInfo(frames[1]).nonce, data: {} });
    expect(await p).toEqual([]);
  });
});
