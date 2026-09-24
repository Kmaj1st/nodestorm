import { describe, expect, it } from "vitest";
import { extractJson, tasks } from "../src/ai/tasks.js";
import { MockProvider } from "../src/providers/mock.js";
import type { ChatMessage, Provider } from "../src/providers/Provider.js";

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

  it("rejects invalid requests", async () => {
    await expect(tasks.relate(mock, { a: { name: "x" } })).rejects.toThrow();
  });
});

describe("structured output retry", () => {
  it("retries once when the model returns malformed JSON", async () => {
    const replies = ["not json", '{"aToB":{"kind":"k","explanation":"e"},"bToA":{"kind":"k2","explanation":"e2"}}'];
    const seen: ChatMessage[][] = [];
    const flaky: Provider = {
      id: "flaky", label: "Flaky", model: "m", configured: true,
      complete: async (m) => { seen.push(m); return replies.shift()!; },
    };
    const r = await tasks.relate(flaky, { a: { name: "A" }, b: { name: "B" } });
    expect(r.bToA.kind).toBe("k2");
    expect(seen).toHaveLength(2);
    expect(seen[1].at(-1)!.content).toMatch(/invalid/);
  });
});
