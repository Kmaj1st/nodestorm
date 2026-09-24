import type { ConceptNode, Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { buildExample, EXAMPLES } from "../src/lib/examples";
import { buildGlossary, pickSymbol } from "../src/lib/glossary";
import * as ops from "../src/lib/graphOps";

const node = (id: string, name: string, patch: Partial<ConceptNode> = {}): ConceptNode => ({
  id, name, definition: "", aliases: [], status: "ok", position: { x: 0, y: 0 }, dependsOn: [], missingDeps: [], ...patch,
});

describe("pickSymbol", () => {
  it("takes the left-hand side of a defining equation", () => {
    expect(pickSymbol(["\\ker\\varphi = \\{ g \\in G : \\varphi(g) = e \\}"])).toEqual({
      symbol: "\\ker\\varphi",
      formula: "\\ker\\varphi = \\{ g \\in G : \\varphi(g) = e \\}",
    });
    expect(pickSymbol(["n! := 1 \\cdot 2 \\cdots n"])?.symbol).toBe("n!");
    expect(pickSymbol(["\\binom{n}{k} \\coloneqq \\frac{n!}{k!(n-k)!}"])?.symbol).toBe("\\binom{n}{k}");
  });

  it("skips lone variables and falls back to the first short formula", () => {
    expect(pickSymbol(["N", "G", "G/N"])).toEqual({ symbol: "G/N" });
    expect(pickSymbol(["\\varphi", "x_1", "\\varphi: G \\to H"])).toEqual({ symbol: "\\varphi: G \\to H" });
    // "x = 5" defines nothing new: its left side is a lone variable, and the whole thing is short.
    expect(pickSymbol(["x = 5"])).toEqual({ symbol: "x = 5" });
  });

  it("gives up on long statements and on nothing at all", () => {
    expect(pickSymbol(["\\sum_{i=1}^{n} i^2 + \\int_0^1 f(x)\\,dx \\geq \\prod_{j} a_j + b_j + c_j"])).toBeUndefined();
    expect(pickSymbol([])).toBeUndefined();
  });
});

describe("buildGlossary", () => {
  it("lists definitions and notation with a formula, in study order", () => {
    const g = buildExample(ops.emptyGraph(), EXAMPLES.groupTheory);
    const entries = buildGlossary(g);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.symbol]));
    expect(byName.Kernel).toBe("\\ker\\varphi");
    expect(byName["Quotient group"]).toBe("G/N");
    expect(byName.Homomorphism).toBe("\\varphi: G \\to H");
    // No formula, or not a definition: not listed.
    expect(byName.Group).toBeUndefined();
    expect(byName["First Isomorphism Theorem"]).toBeUndefined();
    const names = entries.map((e) => e.name);
    expect(names.indexOf("Homomorphism")).toBeLessThan(names.indexOf("Kernel"));
  });

  it("includes notation concepts and ignores untyped ones", () => {
    const g: Graph = {
      id: "g", name: "G", relations: [],
      nodes: [
        node("a", "Big O", { kind: "notation", definition: "$f = O(g)$ means $|f| \\le C|g|$ eventually." }),
        node("b", "Untyped", { definition: "$\\mathbb{N}$" }),
      ],
    };
    expect(buildGlossary(g)).toEqual([{ nodeId: "a", name: "Big O", kind: "notation", symbol: "f = O(g)" }]);
  });
});

describe("glossary: cut-off left-hand sides", () => {
  it("never shows half of a set-builder, presentation or \\left…\\right group", () => {
  expect(pickSymbol(["\\{g \\in G : g = e\\}"])?.symbol).not.toBe("\\{g \\in G : g");
  expect(pickSymbol(["\\left\\{ x : x = 1 \\right\\}"])?.symbol).not.toBe("\\left\\{ x : x");
  expect(pickSymbol(["\\langle a,b \\mid a=b\\rangle"])?.symbol).not.toBe("\\langle a,b \\mid a");
  expect(pickSymbol(["\\ker\\varphi = \\{g : \\varphi(g)=e\\}"])?.symbol).toBe("\\ker\\varphi");
  expect(pickSymbol(["\\left( a \\right) = b"])?.symbol).toBe("\\left( a \\right)");
  });
});
