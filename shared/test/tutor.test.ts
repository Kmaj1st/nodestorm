import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/ai/mock";
import { AnthropicProvider } from "../src/ai/anthropic";
import { OpenAICompatibleProvider } from "../src/ai/openaiCompatible";
import { textOf, type ChatMessage, type Provider } from "../src/ai/provider";
import { checkStepPrompt, readPagePrompt, tutorHintPrompt } from "../src/ai/prompts";
import { cleanProblems, tasks, validCites } from "../src/ai/tasks";

const mock = new MockProvider();
const problem = "Show that the kernel of a group homomorphism is a normal subgroup.";
const refs = [{ n: 1, title: "Notes", page: 3, text: "The kernel of a homomorphism is the set of elements sent to the identity." }];

/** A provider that records what it was sent and answers with a fixed reply. */
function recorder(reply: unknown) {
  const sent: ChatMessage[][] = [];
  const p: Provider = {
    id: "rec", label: "Rec", model: "m", configured: true, listModels: async () => [],
    complete: async (m) => {
      sent.push(m);
      return JSON.stringify(reply);
    },
  };
  return { p, sent };
}

describe("content parts", () => {
  it("textOf joins text parts and skips images", () => {
    expect(textOf("plain")).toBe("plain");
    expect(textOf([{ type: "text", text: "a" }, { type: "image", mediaType: "image/png", data: "xx" }, { type: "text", text: "b" }])).toBe("a\n\nb");
  });

  it("readPage sends the image as a separate part", () => {
    const [sys, user] = readPagePrompt({ mediaType: "image/jpeg", data: "QUJD" });
    expect(textOf(sys.content)).toContain("[task:readPage]");
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content).toContainEqual({ type: "image", mediaType: "image/jpeg", data: "QUJD" });
  });

  it("OpenAI-compatible providers send images as data URLs", async () => {
    let body: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"ok"}' } }] }), { status: 200 });
    }) as typeof fetch;
    const orig = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const p = new OpenAICompatibleProvider({ id: "x", label: "X", baseURL: "https://example.test/v1", apiKey: "k", model: "vl" });
      await p.complete(readPagePrompt({ mediaType: "image/png", data: "QUJD" }));
    } finally {
      globalThis.fetch = orig;
    }
    expect(typeof body.messages[0].content).toBe("string");
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
  });

  it("the Anthropic provider sends images as base64 image blocks", async () => {
    let params: any;
    const p = new AnthropicProvider({ apiKey: "k", model: "claude-opus-5" });
    // Stand in for the lazily loaded SDK client.
    (p as any).api = async () => ({
      Anthropic: {},
      client: {
        beta: {
          messages: {
            create: async (x: any) => {
              params = x;
              return { content: [{ type: "text", text: '{"text":"ok"}' }], stop_reason: "end_turn", usage: {} };
            },
          },
        },
      },
    });
    await p.complete(readPagePrompt({ mediaType: "image/png", data: "QUJD" }));
    expect(typeof params.system).toBe("string");
    expect(params.messages[0].content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "QUJD" },
    });
  });
});

describe("tutor prompts", () => {
  it("hints get stronger with each ask and never ask for the answer", () => {
    const first = textOf(tutorHintPrompt({ problem, steps: [], references: [], context: [], nth: 1 })[0].content);
    const third = textOf(tutorHintPrompt({ problem, steps: [], references: [], context: [], nth: 3 })[0].content);
    expect(first).toContain("Never write out the next step");
    expect(first).toContain("first hint");
    expect(third).toContain("stuck after several hints");
  });

  it("the step check lists earlier steps and numbered references", () => {
    const [, user] = checkStepPrompt({ problem, steps: ["Let $k \\in \\ker\\varphi$."], step: "Then φ(gkg⁻¹) = e.", references: refs, context: [] });
    const text = textOf(user.content);
    expect(text).toContain("Step 1: Let $k");
    expect(text).toContain("Newest step to check: Then");
    expect(text).toContain("[1] Notes, p. 3:");
  });
});

describe("tutor tasks", () => {
  it("drops citations of references that weren't given", async () => {
    expect(validCites([3, 1, 1, 9], [{ n: 1 }, { n: 3 }])).toEqual([1, 3]);
    const { p } = recorder({ hint: "Look at [1] and [7].", cites: [7, 1], concepts: [{ name: "Kernel" }, { name: "kernels" }] });
    const r = await tasks.tutorHint(p, { problem, references: refs });
    expect(r.cites).toEqual([1]);
    expect(r.concepts).toEqual([{ name: "Kernel", definition: "" }]);
  });

  it("solved only counts for a correct step", async () => {
    const { p } = recorder({ verdict: "gap", comment: "", missing: ["Normality", " ", "Normality"], solved: true });
    const r = await tasks.checkStep(p, { problem, step: "Hence it is normal." });
    expect(r).toMatchObject({ verdict: "gap", solved: false, missing: ["Normality"] });
  });

  it("rejects an empty step or problem", async () => {
    await expect(tasks.checkStep(mock, { problem, step: "  " })).rejects.toThrow(/Write the step/);
    await expect(tasks.tutorHint(mock, { problem: "" })).rejects.toThrow(/Choose a problem/);
  });

  it("cleans up split problems", () => {
    const r = cleanProblems(
      { problems: [{ label: " 1 ", statement: "Prove A.", page: 1 }, { label: "1'", statement: " prove  a. ", page: 1 }, { label: "2", statement: "Prove B.", page: 9 }] },
      [1, 2],
    );
    expect(r.problems).toEqual([
      { label: "1", statement: "Prove A.", page: 1 },
      { label: "2", statement: "Prove B.", page: null },
    ]);
  });

  it("the offline demo splits a sheet, hints and checks steps", async () => {
    const sheet = await tasks.splitProblems(mock, {
      pages: [
        { page: 1, text: "Problem sheet 3 1. Show that the kernel of a group homomorphism is a normal subgroup. 2. Show that the image is a subgroup." },
        { page: 2, text: "3. Prove the First Isomorphism Theorem." },
      ],
    });
    expect(sheet.problems.map((p) => [p.label, p.page])).toEqual([["1", 1], ["2", 1], ["3", 2]]);

    const hint = await tasks.tutorHint(mock, { problem, references: refs, nth: 1 });
    expect(hint.cites).toEqual([1]);
    expect(hint.concepts.map((c) => c.name)).toEqual(expect.arrayContaining(["Kernel", "Normal Subgroup"]));

    const gap = await tasks.checkStep(mock, { problem, step: "The kernel is closed under conjugation." });
    expect(gap.verdict).toBe("gap");
    expect(gap.missing).toEqual(["Homomorphism"]);
    const ok = await tasks.checkStep(mock, { problem, step: "Since φ(gkg⁻¹) = φ(g)φ(g)⁻¹ = e, hence gkg⁻¹ ∈ ker φ." });
    expect(ok).toMatchObject({ verdict: "ok", solved: true });
    expect((await tasks.checkStep(mock, { problem, step: "why?" })).verdict).toBe("unclear");

    const page = await tasks.readPage(mock, { mediaType: "image/jpeg", data: "QUJD" });
    expect(page.text).toContain("\\ker\\varphi");
  });
});
