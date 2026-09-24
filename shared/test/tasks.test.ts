import { describe, expect, it } from "vitest";
import { extractJson, tasks } from "../src/ai/tasks";
import { MockProvider } from "../src/ai/mock";
import type { ChatMessage, Provider } from "../src/ai/provider";

describe("extractJson", () => {
  it("parses plain, fenced, and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: "}" } });
    expect(extractJson('Sure! Here it is: {"x":[1,2]} Hope that helps')).toEqual({ x: [1, 2] });
  });
  it("throws when no object is present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("tasks with mock provider", () => {
  const mock = new MockProvider();

  it("names a described concept", async () => {
    const r = await tasks.name(mock, { description: "a bijective structure preserving map" });
    expect(r.candidates[0].name).toBe("Isomorphism");
  });

  it("flags isomorphism as a dependency of the first isomorphism theorem", async () => {
    const r = await tasks.deps(mock, {
      node: { name: "First Isomorphism Theorem" },
      existing: [{ name: "Homomorphism" }],
    });
    const byName = Object.fromEntries(r.prerequisites.map((p) => [p.name, p]));
    expect(byName.Homomorphism.matchesExisting).toBe("Homomorphism");
    expect(byName.Isomorphism).toMatchObject({ role: "derives", matchesExisting: null });
  });

  it("relates in both directions", async () => {
    const r = await tasks.relate(mock, { a: { name: "First Isomorphism Theorem" }, b: { name: "Homomorphism" } });
    expect(r.aToB.kind).toBe("uses definition of");
    expect(r.bToA.kind).toBe("is used by");
  });

  it("asks for clarification only when a name is ambiguous, with the requested number of options", async () => {
    const amb = await tasks.clarify(mock, { name: "expectation", count: 4 });
    expect(amb.ambiguous).toBe(true);
    expect(amb.senses).toHaveLength(4);
    expect(amb.senses[0].name).toBe("Expectation (probability)");
    const clear = await tasks.clarify(mock, { name: "Isomorphism" });
    expect(clear).toMatchObject({ ambiguous: false, senses: [{ name: "Isomorphism" }] });
    expect(clear.senses[0].definition).toMatch(/bijective/);
  });

  it("treats 'ambiguous' with a single sense as not ambiguous", async () => {
    const odd: Provider = {
      id: "odd", label: "Odd", model: "m", configured: true, listModels: async () => [],
      complete: async () => '{"ambiguous":true,"senses":[{"name":"X","domain":"d","definition":"only one"}]}',
    };
    expect(await tasks.clarify(odd, { name: "X" })).toMatchObject({ ambiguous: false });
  });

  it("rejects invalid requests", async () => {
    await expect(tasks.relate(mock, { a: { name: "x" } })).rejects.toThrow();
  });
});

describe("structured output retry", () => {
  it("retries once when the model returns malformed JSON", async () => {
    const replies = ["not json", '{"aToB":{"kind":"k","explanation":"e"},"bToA":{"kind":"k2","explanation":"e2"}}'];
    const seen: ChatMessage[][] = [];
    const flaky: Provider = {
      id: "flaky", label: "Flaky", model: "m", configured: true, listModels: async () => [],
      complete: async (m) => { seen.push(m); return replies.shift()!; },
    };
    const r = await tasks.relate(flaky, { a: { name: "A" }, b: { name: "B" } });
    expect(r.bToA.kind).toBe("k2");
    expect(seen).toHaveLength(2);
    expect(seen[1].at(-1)!.content).toMatch(/invalid/);
  });
});
