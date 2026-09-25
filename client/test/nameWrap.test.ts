import { describe, expect, it, vi } from "vitest";
import { nameWrap } from "../src/lib/nameWrap";

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

describe("nameWrap (how a card wraps a concept's name)", () => {
  it("gives the name's language by its script, for hyphenation and CJK glyphs", () => {
    expect(nameWrap("Group homomorphism").lang).toBe("en");
    expect(nameWrap("同态基本定理").lang).toBe("zh");
    expect(nameWrap("ベクトル空間").lang).toBe("ja");
  });

  it("marks a name by its longest word, so a single long word is set smaller", () => {
    expect(nameWrap("Fundamental theorem of homomorphisms").size).toBe("long");
    expect(nameWrap("Group").size).toBeUndefined();
    expect(nameWrap("Homomorphism").size).toBeUndefined();
    expect(nameWrap("Zusammenhangskomponente").size).toBe("xlong");
    expect(nameWrap("Cauchy–Schwarz inequality").size).toBeUndefined();
  });

  it("doesn't count Chinese text as one long word (it wraps between characters)", () => {
    expect(nameWrap("同态基本定理与商群的对应关系").size).toBeUndefined();
  });
});
