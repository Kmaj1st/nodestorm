import { describe, expect, it } from "vitest";
import {
  AiConceptKind,
  ClarifyResponse,
  ConceptNode,
  DepsResponse,
  DeriveResponse,
  ExtractResponse,
  isTheoremLike,
  NameResponse,
} from "../src/model";
import { cleanAnatomy, tasks } from "../src/ai/tasks";
import { kindFromName, MockProvider } from "../src/ai/mock";
import { anatomyPrompt, depsPrompt, languageInstruction } from "../src/ai/prompts";
import type { Provider } from "../src/ai/provider";

const reply = (text: string): Provider => ({
  id: "fixed", label: "Fixed", model: "m", configured: true, listModels: async () => [], complete: async () => text,
});

describe("concept kinds in AI answers", () => {
  it("parses a kind case-insensitively and turns unknown ones into null", () => {
    expect(AiConceptKind.parse(" Theorem ")).toBe("theorem");
    expect(AiConceptKind.parse("remark")).toBeNull();
    expect(AiConceptKind.parse(42)).toBeNull();
    expect(AiConceptKind.parse(null)).toBeNull();
    expect(AiConceptKind.parse(undefined)).toBeUndefined();
  });

  it("still accepts answers from before kinds existed", () => {
    expect(DepsResponse.parse({ prerequisites: [] }).kind).toBeUndefined();
    expect(NameResponse.parse({ candidates: [{ name: "A", definition: "d" }] }).candidates[0].kind).toBeUndefined();
    expect(ClarifyResponse.parse({ ambiguous: false, senses: [{ name: "A", domain: "x", definition: "d" }] }).senses[0].kind).toBeUndefined();
    expect(DeriveResponse.parse({ proposals: [{ name: "A", definition: "d", links: [] }] }).proposals[0].kind).toBeUndefined();
    expect(ExtractResponse.parse({ concepts: [{ name: "A" }] }).concepts[0].kind).toBeUndefined();
  });

  it("a bad kind never fails an otherwise good answer", async () => {
    const r = await tasks.deps(reply('{"prerequisites":[],"kind":"principle"}'), { node: { name: "X" } });
    expect(r).toEqual({ prerequisites: [], kind: null });
  });

  it("an old node without a kind is still valid, and a node rejects an unknown kind", () => {
    const base = { id: "n", name: "A", definition: "", aliases: [], status: "ok", position: { x: 0, y: 0 }, dependsOn: [], missingDeps: [] };
    expect(ConceptNode.safeParse(base).success).toBe(true);
    expect(ConceptNode.safeParse({ ...base, kind: "lemma" }).success).toBe(true);
    expect(ConceptNode.safeParse({ ...base, kind: "remark" }).success).toBe(false);
  });

  it("knows which kinds are theorem-like", () => {
    expect(["theorem", "lemma", "proposition", "corollary", "conjecture"].every((k) => isTheoremLike(k as never))).toBe(true);
    expect(isTheoremLike("definition")).toBe(false);
    expect(isTheoremLike(undefined)).toBe(false);
  });

  it("the prompts ask for a kind and keep its values in English", () => {
    const sys = String(depsPrompt({ node: { name: "X", definition: "", aliases: [] }, existing: [] })[0].content);
    expect(sys).toContain('"kind":"definition"|"theorem"');
    expect(languageInstruction("Chinese")).toContain('concept "kind" values');
  });
});

describe("mock provider kinds", () => {
  const mock = new MockProvider();

  it("classifies the concept a check analyses", async () => {
    expect((await tasks.deps(mock, { node: { name: "First Isomorphism Theorem" } })).kind).toBe("theorem");
    expect((await tasks.deps(mock, { node: { name: "Kernel" } })).kind).toBe("definition");
    expect((await tasks.deps(mock, { node: { name: "Zorn's lemma" } })).kind).toBe("lemma");
    expect((await tasks.deps(mock, { node: { name: "Something else" } })).kind).toBeNull();
  });

  it("names, clarifies, derives and extracts with kinds", async () => {
    expect((await tasks.name(mock, { description: "a bijective map" })).candidates[0].kind).toBe("definition");
    expect((await tasks.clarify(mock, { name: "Lagrange's theorem" })).senses[0].kind).toBe("theorem");
    expect((await tasks.derive(mock, { selected: [{ name: "Homomorphism" }] })).proposals[0].kind).toBe("definition");
    const ex = await tasks.extract(mock, { text: 'The first isomorphism theorem needs a kernel. We call it the "Main Lemma".' });
    expect(Object.fromEntries(ex.concepts.map((c) => [c.name, c.kind]))).toEqual({
      "First Isomorphism Theorem": "theorem",
      Isomorphism: "definition",
      Kernel: "definition",
      "Main Lemma": "lemma",
    });
  });

  it("reads a kind off a name", () => {
    expect(kindFromName("Axiom of choice")).toBe("axiom");
    expect(kindFromName("Goldbach conjecture")).toBe("conjecture");
    expect(kindFromName("Lemmatization")).toBeNull();
  });
});

describe("anatomy task", () => {
  const mock = new MockProvider();

  it("takes a KB theorem apart", async () => {
    const r = await tasks.anatomy(mock, { node: { name: "First Isomorphism Theorem", kind: "theorem" } });
    expect(r.hypotheses.length).toBeGreaterThanOrEqual(2);
    expect(r.hypotheses.every((h) => h.text && h.whyNeeded)).toBe(true);
    expect(r.conclusion).toContain("\\ker\\varphi");
    expect(r.proofIdea.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(4);
    expect(r.examples.length).toBeGreaterThan(0);
    expect(r.nonExamples.length).toBeGreaterThan(0);
  });

  it("builds a fallback from an if-then statement", async () => {
    const r = await tasks.anatomy(mock, { node: { name: "My result", definition: "If $n$ is even, then $n^2$ is even." } });
    expect(r.hypotheses[0].text).toBe("$n$ is even");
    expect(r.conclusion).toBe("$n^2$ is even.");
  });

  it("parses a lenient answer and tidies it", async () => {
    const r = await tasks.anatomy(
      reply('{"hypotheses":[{"text":" A "},{"text":""}],"conclusion":" B ","examples":["x","x"," ","y","z","w"]}'),
      { node: { name: "T" } },
    );
    expect(r).toEqual({
      hypotheses: [{ text: "A", whyNeeded: "", counterexampleIfDropped: "" }],
      conclusion: "B",
      proofIdea: "",
      examples: ["x", "y", "z"],
      nonExamples: [],
    });
  });

  it("rejects an answer without a conclusion", async () => {
    await expect(tasks.anatomy(reply('{"hypotheses":[]}'), { node: { name: "T" } })).rejects.toThrow(/malformed output/);
  });

  it("the prompt asks for a sketch, not a full proof, and says the kind", () => {
    const [sys, user] = anatomyPrompt({ node: { name: "T", definition: "", aliases: [], kind: "lemma" }, prerequisites: [] });
    expect(String(sys.content)).toContain("[task:anatomy]");
    expect(String(sys.content)).toContain("not a full proof");
    expect(String(user.content)).toContain("(a lemma)");
  });

  it("cleanAnatomy caps the hypotheses", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `h${i}`, whyNeeded: "", counterexampleIfDropped: "" }));
    expect(cleanAnatomy({ hypotheses: many, conclusion: "c", proofIdea: "", examples: [], nonExamples: [] }).hypotheses).toHaveLength(8);
  });
});
