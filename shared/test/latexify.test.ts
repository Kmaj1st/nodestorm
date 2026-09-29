import { describe, expect, it } from "vitest";
import { hasUnicodeMath, onlyFormulasChanged, proseWords } from "../src/latexify";
import { latexifyDemo, MockProvider } from "../src/ai/mock";
import { tasks } from "../src/ai/tasks";
import type { ChatMessage, Provider } from "../src/ai/provider";

// "Formulas → LaTeX": only the formulas written with Unicode symbols may change.

const answering = (text: string, seen: ChatMessage[][] = []): Provider => ({
  id: "spy", label: "Spy", model: "m", configured: true, listModels: async () => [],
  complete: async (messages: ChatMessage[]) => (seen.push(messages), JSON.stringify({ text })),
});

describe("the words outside the formulas", () => {
  it("are the prose, not variables, symbols or LaTeX", () => {
    expect(proseWords("A map φ: G → H with φ(ab) = φ(a)φ(b) and $\\ker f$ trivial.")).toEqual(["map", "with", "and", "trivial"]);
  });
  it("count each Chinese character", () => {
    expect(proseWords("若 φ(ab) = φ(a)φ(b)，则称同态")).toEqual(["若", "则", "称", "同", "态"]);
  });
  it("a rewrite of the formulas only keeps them; rewording, dropping or adding words doesn't", () => {
    const before = "A homomorphism is a map φ with φ(ab) = φ(a)φ(b).";
    expect(onlyFormulasChanged(before, "A homomorphism is a map $\\varphi$ with $\\varphi(ab) = \\varphi(a)\\varphi(b)$.")).toBe(true);
    expect(onlyFormulasChanged(before, "A homomorphism is a function $\\varphi$ with $\\varphi(ab) = \\varphi(a)\\varphi(b)$.")).toBe(false);
    expect(onlyFormulasChanged(before, "A homomorphism is $\\varphi$ with $\\varphi(ab) = \\varphi(a)\\varphi(b)$.")).toBe(false);
    expect(onlyFormulasChanged(before, "A homomorphism is a map $\\varphi$ with $\\varphi(ab) = \\varphi(a)\\varphi(b)$ always.")).toBe(false);
  });
  it("a function name may move into a formula", () => {
    expect(onlyFormulasChanged("where sin x ≤ 1", "where $\\sin x \\le 1$")).toBe(true);
  });
});

describe("hasUnicodeMath", () => {
  it("finds Unicode formulas outside LaTeX only", () => {
    expect(hasUnicodeMath("x² ≤ y")).toBe(true);
    expect(hasUnicodeMath("for all ε > 0")).toBe(true);
    expect(hasUnicodeMath("A group is a set with an operation.")).toBe(false);
    expect(hasUnicodeMath("It holds that $\\alpha \\le \\beta$ (α ≤ β written as LaTeX): $α$")).toBe(true);
    expect(hasUnicodeMath("$\\varphi(ab)$ and $$x ≤ y$$")).toBe(false);
  });
});

describe("the offline demo", () => {
  const cases: [string, string][] = [
    ["A map φ: G → H with φ(ab) = φ(a)φ(b).", "A map $\\varphi: G \\to H$ with $\\varphi(ab) = \\varphi(a)\\varphi(b)$."],
    ["If x² ≤ y then xᵢ₊₁ ≥ 0, and $\\ker f$ stays.", "If $x^2 \\le y$ then $x_{i+1} \\ge 0$, and $\\ker f$ stays."],
    ["For every ε > 0 there is δ > 0.", "For every $\\varepsilon > 0$ there is $\\delta > 0$."],
    ["若 φ: G → H 满足 φ(ab) = φ(a)φ(b)，则称其为同态。", "若 $\\varphi: G \\to H$ 满足 $\\varphi(ab) = \\varphi(a)\\varphi(b)$，则称其为同态。"],
    ["Plain words only.", "Plain words only."],
  ];
  for (const [before, after] of cases) {
    it(`rewrites “${before}”`, () => {
      expect(latexifyDemo(before)).toBe(after);
      expect(onlyFormulasChanged(before, after)).toBe(true);
    });
  }
  it("answers the task", async () => {
    const r = await tasks.latexify(new MockProvider(), { text: "Let x ∈ G." });
    expect(r).toEqual({ text: "Let $x \\in G$." });
  });
});

describe("the latexify task", () => {
  it("asks for the formulas only, and keeps the text's own language", async () => {
    const seen: ChatMessage[][] = [];
    await tasks.latexify(answering("Let $x \\in G$.", seen), { text: "Let x ∈ G." }, { language: "Chinese" });
    const system = String(seen[0][0].content);
    expect(system).toMatch(/ONLY those formulas/);
    expect(system).not.toMatch(/Output language/);
  });
  it("refuses an answer that changed more than the formulas", async () => {
    const r = await tasks.latexify(answering("Suppose $x \\in G$."), { text: "Let x ∈ G." });
    expect(r).toEqual({ text: "Let x ∈ G.", rejected: true });
  });
  it("refuses an empty answer", async () => {
    expect(await tasks.latexify(answering("  "), { text: "Let x ∈ G." })).toMatchObject({ rejected: true });
  });
  it("rejects an empty or oversized request", async () => {
    await expect(tasks.latexify(answering("x"), { text: "" })).rejects.toThrow();
    await expect(tasks.latexify(answering("x"), { text: "x".repeat(5000) })).rejects.toThrow();
  });
});
