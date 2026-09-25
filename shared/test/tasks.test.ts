import { describe, expect, it } from "vitest";
import { activeOnly, extractJson, passiveKind, tasks } from "../src/ai/tasks";
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

  it("has a multi-level prerequisite chain for recursive installs", async () => {
    const chain: string[] = [];
    for (let name = "Quotient group"; ; ) {
      chain.push(name);
      const r = await tasks.deps(mock, { node: { name }, existing: [] });
      const next = r.prerequisites.find((p) => p.name !== "Group")?.name ?? r.prerequisites[0]?.name;
      if (!next) break;
      name = next;
    }
    expect(chain).toEqual(["Quotient group", "Normal subgroup", "Subgroup", "Group"]);
  });

  it("relates in both directions, with one active label for a one-way relation", async () => {
    const r = await tasks.relate(mock, { a: { name: "First Isomorphism Theorem" }, b: { name: "Homomorphism" } });
    expect(r.aToB.kind).toBe("using");
    expect(r.bToA.kind).toBe("none");
  });

  it("turns a passive label from the AI into \"none\" when the other side says it actively", async () => {
    expect(["is used by", "used by", "quoted by", "is derived from", "was solved with", "被使用"].every(passiveKind)).toBe(true);
    expect(["using", "quoting", "generalizing", "always being a", "arising as", "building on", "none"].some(passiveKind)).toBe(false);
    const d = (kind: string) => ({ kind, explanation: "e" });
    expect(activeOnly(d("using"), d("is used by"))).toEqual([d("using"), d("none")]);
    expect(activeOnly(d("quoted by"), d("quoting"))).toEqual([d("none"), d("quoting")]);
    expect(activeOnly(d("generalizing"), d("specializing"))).toEqual([d("generalizing"), d("specializing")]);
    const spy: Provider = {
      id: "spy", label: "Spy", model: "m", configured: true, listModels: async () => [],
      complete: async () => '{"aToB":{"kind":"uses","explanation":"x"},"bToA":{"kind":"is used by","explanation":"y"}}',
    };
    const r = await tasks.relate(spy, { a: { name: "A" }, b: { name: "B" } });
    expect([r.aToB.kind, r.bToA.kind]).toEqual(["uses", "none"]);
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
    await expect(tasks.explain(mock, { node: { name: "x" }, level: "poetic" })).rejects.toThrow();
  });

  it("explains a known concept with a canned answer, at the requested level", async () => {
    const r = await tasks.explain(mock, {
      node: { name: "Homomorphism" },
      prerequisites: [{ name: "Group" }],
      level: "rigorous",
    });
    expect(r.summary).toMatch(/preserves the operations/);
    expect(r.intuition).toMatch(/^Formally: .*builds on Group\./);
    expect(r.keyPoints.length).toBeGreaterThan(1);
    expect(r.examples.map((e) => e.title)).toContain("Exponential map");
    expect(r.pitfalls.length).toBeGreaterThan(0);
    expect(r.furtherReading.length).toBeGreaterThan(0);
    // Described sources, not links.
    expect(JSON.stringify(r.furtherReading)).not.toMatch(/https?:|www\./);
  });

  it("explains an unknown concept generically from its definition", async () => {
    const r = await tasks.explain(mock, { node: { name: "Zorn's lemma", definition: "Every chain has an upper bound…" } });
    expect(r.summary).toBe("Every chain has an upper bound…");
    expect(r.intuition).toMatch(/^Intuitively: /);
    expect(r.examples).toEqual([]);
  });

  it("sends prerequisites, relations, level and the answer language to the model", async () => {
    const seen: ChatMessage[][] = [];
    const spy: Provider = {
      id: "spy", label: "Spy", model: "m", configured: true, listModels: async () => [],
      complete: async (m) => { seen.push(m); return '{"summary":"S"}'; },
    };
    const r = await tasks.explain(
      spy,
      {
        node: { name: "Kernel" },
        prerequisites: [{ name: "Homomorphism" }],
        relations: [{ other: "Isomorphism", toOther: { kind: "is trivial for", explanation: "" }, fromOther: { kind: "has", explanation: "" } }],
        level: "example-driven",
      },
      { language: "Deutsch" },
    );
    // Missing lists are filled with defaults.
    expect(r).toEqual({ summary: "S", intuition: "", keyPoints: [], examples: [], pitfalls: [], furtherReading: [] });
    const [system, user] = seen[0];
    expect(system.content).toContain("[task:explain]");
    expect(system.content).toMatch(/Never give URLs/);
    expect(system.content).toMatch(/Output language: .* in Deutsch/);
    expect(user.content).toContain("- Homomorphism");
    expect(user.content).toContain("- it → Isomorphism: is trivial for");
    expect(user.content).toContain("- Isomorphism → it: has");
    expect(user.content).toContain("Level: example-driven");
  });

  it("rejects an explanation without a summary after one retry", async () => {
    let calls = 0;
    const bad: Provider = {
      id: "bad", label: "Bad", model: "m", configured: true, listModels: async () => [],
      complete: async () => { calls++; return '{"summary":"","keyPoints":"not a list"}'; },
    };
    await expect(tasks.explain(bad, { node: { name: "X" } })).rejects.toThrow(/malformed output/);
    expect(calls).toBe(2);
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

describe("resolveCycle task", () => {
  const links = [
    { from: { name: "Chicken", definition: "a bird" }, to: { name: "Egg", definition: "an oval body laid by a bird" }, reason: "hatches" },
    { from: { name: "Egg", definition: "an oval body laid by a bird" }, to: { name: "Chicken", definition: "a bird" }, reason: "laid" },
  ];
  const answering = (reply: string): Provider => ({
    id: "fixed", label: "Fixed", model: "m", configured: true, listModels: async () => [], complete: async () => reply,
  });

  it("the offline demo names one link and says why", async () => {
    const res = await tasks.resolveCycle(new MockProvider(), { links });
    expect(res.remove).toEqual([0]);
    expect(res.reason).toMatch(/Egg/);
  });

  it("drops out-of-range and repeated indexes", async () => {
    const res = await tasks.resolveCycle(answering('{"remove":[1,1,7],"reason":"r"}'), { links });
    expect(res.remove).toEqual([1]);
  });

  it("rejects an answer that names no valid link", async () => {
    await expect(tasks.resolveCycle(answering('{"remove":[9],"reason":"r"}'), { links })).rejects.toThrow(/valid link/);
  });

  it("needs a real cycle (at least two links)", async () => {
    await expect(tasks.resolveCycle(new MockProvider(), { links: links.slice(0, 1) })).rejects.toThrow();
  });
});

describe("connect", () => {
  it("drops the concept itself, linked names and repeats, keeps active labels and the count", async () => {
    const { cleanConnect } = await import("../src/ai/tasks");
    const d = (kind: string) => ({ kind, explanation: "" });
    const s = (name: string, a = "using", b = "none") => ({ name, keyword: "", definition: "", kind: null, aToB: d(a), bToA: d(b) });
    const out = cleanConnect(
      { suggestions: [s("Kernel"), s("Group"), s("group"), s("Ring", "none", "used by"), s("Field", "using", "is used by"), s("Coset")] },
      { node: { name: "Kernel", definition: "", aliases: ["ker"] }, linked: ["Coset"], count: 2 },
    );
    expect(out.suggestions.map((x) => x.name)).toEqual(["Group", "Ring"]);
    const all = cleanConnect({ suggestions: [s("Field", "using", "is used by")] }, { node: { name: "K", definition: "", aliases: [] }, linked: [], count: 8 });
    expect([all.suggestions[0].aToB.kind, all.suggestions[0].bToA.kind]).toEqual(["using", "none"]);
  });
});
