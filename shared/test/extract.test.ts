import { describe, expect, it } from "vitest";
import { EXTRACT_MAX_CHARS, ExtractRequest, ExtractResponse } from "../src/model";
import { MockProvider } from "../src/ai/mock";
import { cleanExtraction, tasks } from "../src/ai/tasks";
import type { ChatMessage, Provider } from "../src/ai/provider";

const TEXT =
  'A group is a set with an associative operation. A homomorphism is a map between groups that preserves it. ' +
  'The kernel of a homomorphism is the set of elements sent to the identity. We call a kernel-free map a "Widget morphism".';

describe("extract: schemas", () => {
  it("needs some text and caps its length with a clear message", () => {
    expect(ExtractRequest.parse({ text: "  a group  " })).toEqual({ text: "a group", existing: [] });
    expect(() => ExtractRequest.parse({ text: "   " })).toThrow(/Paste some text/);
    expect(ExtractRequest.safeParse({ text: "x".repeat(EXTRACT_MAX_CHARS) }).success).toBe(true);
    const long = ExtractRequest.safeParse({ text: "x".repeat(EXTRACT_MAX_CHARS + 1) });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0].message).toMatch(/too long.*12000/);
  });

  it("fills in optional answer fields and rejects nameless concepts", () => {
    const r = ExtractResponse.parse({ concepts: [{ name: "Ring" }] });
    expect(r).toEqual({ concepts: [{ name: "Ring", definition: "", aliases: [] }], relations: [], prerequisites: [] });
    expect(ExtractResponse.safeParse({ concepts: [{ name: " " }] }).success).toBe(false);
    expect(ExtractResponse.safeParse({ concepts: [], prerequisites: [{ dependent: "a", prerequisite: "b", role: "needs" }] }).success).toBe(false);
  });
});

describe("extract: cleanup", () => {
  const dir = { kind: "k", explanation: "" };
  it("merges repeated names, shortens quotes and drops links to unknown or identical concepts", () => {
    const r = cleanExtraction(
      {
        concepts: [
          { name: "Group", definition: "first", aliases: [], quote: `  ${"q".repeat(400)} ` },
          { name: "groups", definition: "second", aliases: [] },
          { name: "Ring", definition: "", aliases: [], quote: "  " },
        ],
        relations: [
          { from: "Group", to: "Ring", aToB: dir, bToA: dir },
          { from: "Group", to: "Field", aToB: dir, bToA: dir }, // Field is neither extracted nor in the graph
          { from: "Group", to: "Monoid", aToB: dir, bToA: dir }, // Monoid is in the graph
          { from: "Group", to: "groups", aToB: dir, bToA: dir }, // itself
        ],
        prerequisites: [{ dependent: "Ring", prerequisite: "Group", role: "uses", reason: "" }],
      },
      [{ name: "Monoid" }],
    );
    expect(r.concepts.map((c) => c.name)).toEqual(["Group", "Ring"]);
    expect(r.concepts[0].definition).toBe("first");
    expect(r.concepts[0].quote).toHaveLength(300);
    expect(r.concepts[1].quote).toBeUndefined();
    expect(r.relations.map((x) => x.to)).toEqual(["Ring", "Monoid"]);
    expect(r.prerequisites).toHaveLength(1);
  });
});

describe("extract: mock provider", () => {
  const mock = new MockProvider();

  it("recognises knowledge-base concepts and quoted new terms, with supporting quotes", async () => {
    const r = await tasks.extract(mock, { text: TEXT, existing: [{ name: "Group" }, { name: "Homomorphism" }] });
    expect(r.concepts.map((c) => c.name)).toEqual(["Group", "Homomorphism", "Kernel", "Widget Morphism"]);
    const kernel = r.concepts.find((c) => c.name === "Kernel")!;
    expect(kernel.quote).toBe("The kernel of a homomorphism is the set of elements sent to the identity.");
    expect(r.prerequisites).toContainEqual(expect.objectContaining({ dependent: "Kernel", prerequisite: "Homomorphism", role: "uses" }));
    expect(r.relations).toContainEqual(expect.objectContaining({ from: "Widget Morphism", to: "Kernel" }));
  });

  it("uses the graph's exact name for a concept it already has", async () => {
    const r = await tasks.extract(mock, { text: "Every group homomorphism has a kernel.", existing: [{ name: "Hom", aliases: ["homomorphism"] }] });
    expect(r.concepts.map((c) => c.name)).toContain("Hom");
    expect(r.prerequisites).toContainEqual(expect.objectContaining({ dependent: "Kernel", prerequisite: "Hom" }));
  });

  it("finds nothing in unrelated text", async () => {
    expect(await tasks.extract(mock, { text: "The weather was fine." })).toEqual({ concepts: [], relations: [], prerequisites: [] });
  });

  it("sends the text once, with the output language and the graph's concepts", async () => {
    const prompts: ChatMessage[][] = [];
    const rec: Provider = {
      id: "rec", label: "Rec", model: "m", configured: true, listModels: async () => [],
      complete: async (m) => (prompts.push(m), '{"concepts":[{"name":"群","quote":"群是……"}]}'),
    };
    const r = await tasks.extract(rec, { text: "群是一个集合。", existing: [{ name: "Ring" }], focus: "definitions" }, { language: "Chinese" });
    expect(r.concepts[0]).toMatchObject({ name: "群", quote: "群是……" });
    const [sys, user] = prompts[0];
    expect(sys.content).toMatch(/\[task:extract\][\s\S]*in Chinese/);
    expect(user.content).toContain("- Ring");
    expect(user.content).toContain("Focus: definitions");
    expect((user.content as string).split("群是一个集合。")).toHaveLength(2);
  });
});
