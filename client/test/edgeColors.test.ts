import { beforeEach, describe, expect, it, vi } from "vitest";
import { toMarkdown, toMermaid } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";

// "No relation found" links (Mix found nothing either way) and the customisable relation colours.

const data = vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
});

const none = { kind: "none", explanation: "Nothing links them." };

describe("no relation found", () => {
  it("is a relation whose two sides are both \"none\"", () => {
    expect(ops.isUnrelated({ aToB: none, bToA: { kind: " none ", explanation: "" } })).toBe(true);
    expect(ops.isUnrelated({ aToB: { kind: "using", explanation: "" }, bToA: none })).toBe(false);
  });

  it("is written once in Markdown and as a crossed link in Mermaid", () => {
    let g = ops.addNode(ops.emptyGraph("Main"), { name: "Toast" }).graph;
    g = ops.addNode(g, { name: "Monad" }).graph;
    const [a, b] = g.nodes;
    g = ops.upsertRelation(g, a.id, b.id, none, none, "mix");
    const md = toMarkdown(g);
    expect(md).toContain("- Toast — Monad: no relation found — Nothing links them.");
    expect(md).not.toMatch(/: none\b/);
    expect(toMermaid(g)).toContain("n0 -.-x n1");
  });
});

describe("relation colours", () => {
  beforeEach(() => {
    data.clear();
    vi.resetModules();
  });

  it("keeps only known relation types with #rrggbb values", async () => {
    const { sanitizeEdgeColors } = await import("../src/lib/theme");
    expect(sanitizeEdgeColors({ unrelated: "#00AA00", mix: "red", bogus: "#123456", derive: "#12345" })).toEqual({ unrelated: "#00aa00" });
    expect(sanitizeEdgeColors(null)).toEqual({});
  });

  it("survives a reload, and resetting all removes the stored choice", async () => {
    const first = await import("../src/lib/theme");
    first.useTheme.getState().setEdgeColors({ unrelated: "#00aa00", mix: "not a colour" });
    expect(first.useTheme.getState().edgeColors).toEqual({ unrelated: "#00aa00" });
    vi.resetModules();
    const again = await import("../src/lib/theme");
    expect(again.useTheme.getState().edgeColors).toEqual({ unrelated: "#00aa00" });
    again.useTheme.getState().setEdgeColors({});
    expect(data.has("nodestorm-edge-colors")).toBe(false);
  });
});
