import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/ai/mock";
import type { ChatMessage, Provider } from "../src/ai/provider";
import { cleanQuiz, tasks } from "../src/ai/tasks";
import { ConceptNode, QuizRequest, QuizResponse } from "../src/model";

const mock = new MockProvider();
const spy = (reply: string, seen: ChatMessage[][] = []): Provider => ({
  id: "spy", label: "Spy", model: "m", configured: true, listModels: async () => [],
  complete: async (m) => (seen.push(m), reply),
});

describe("quiz schemas", () => {
  it("fills request defaults and rejects unknown styles", () => {
    expect(QuizRequest.parse({ node: { name: "Kernel" } })).toMatchObject({ style: "recall", multipleChoice: false, prerequisites: [] });
    expect(() => QuizRequest.parse({ node: { name: "Kernel" }, style: "poetic" })).toThrow();
  });

  it("needs a question and an answer", () => {
    expect(QuizResponse.parse({ question: "Q?", answer: "A" }).hints).toEqual([]);
    expect(() => QuizResponse.parse({ question: " ", answer: "A" })).toThrow();
    expect(() => QuizResponse.parse({ question: "Q?" })).toThrow();
  });

  it("keeps mastery on a concept, within 0…1", () => {
    const base = { id: "n", name: "N", definition: "", aliases: [], status: "ok", position: { x: 0, y: 0 }, dependsOn: [], missingDeps: [] };
    const mastery = { score: 0.5, reviews: 2, reviewedAt: 1 };
    expect(ConceptNode.parse({ ...base, mastery }).mastery).toEqual(mastery);
    expect(() => ConceptNode.parse({ ...base, mastery: { ...mastery, score: 2 } })).toThrow();
  });
});

describe("cleanQuiz", () => {
  const q = { question: "Q?", answer: "A", hints: [" h1 ", "", "h2", "h3", "h4"] };
  const choices = ["a", "b", "c", "d"];

  it("trims hints to at most three", () => {
    expect(cleanQuiz(q, false).hints).toEqual(["h1", "h2", "h3"]);
  });

  it("keeps a valid multiple-choice set only when one was asked for", () => {
    expect(cleanQuiz({ ...q, choices, correctIndex: 2 }, true)).toMatchObject({ choices, correctIndex: 2 });
    expect(cleanQuiz({ ...q, choices, correctIndex: 2 }, false)).not.toHaveProperty("choices");
  });

  it("falls back to free recall when the choices are malformed", () => {
    for (const bad of [
      { choices: ["a", "b", "c"], correctIndex: 0 },
      { choices, correctIndex: 4 },
      { choices, correctIndex: null },
      { choices: ["a", "A", "c", "d"], correctIndex: 0 },
      { choices: ["a", "", "c", "d"], correctIndex: 0 },
    ]) {
      const r = cleanQuiz({ ...q, ...bad }, true);
      expect(r).not.toHaveProperty("choices");
      expect(r.answer).toBe("A");
    }
  });
});

describe("quiz task with the mock provider", () => {
  it("asks a recall question answered by the definition", async () => {
    const r = await tasks.quiz(mock, { node: { name: "Kernel", definition: "Elements sent to the identity." } });
    expect(r.question).toBe("What is Kernel?");
    expect(r.answer).toBe("Elements sent to the identity.");
    expect(r.hints.length).toBeGreaterThan(0);
    expect(r.choices).toBeUndefined();
  });

  it("connects a concept to a prerequisite, with the KB reason as answer", async () => {
    const r = await tasks.quiz(mock, { node: { name: "Isomorphism" }, prerequisites: [{ name: "Homomorphism" }], style: "connect" });
    expect(r.question).toContain("Homomorphism");
    expect(r.answer).toMatch(/bijective homomorphism/);
  });

  it("builds four distinct choices with the right one at correctIndex", async () => {
    const r = await tasks.quiz(mock, { node: { name: "Group" }, multipleChoice: true });
    expect(r.choices).toHaveLength(4);
    expect(r.choices![r.correctIndex!]).toBe(r.answer);
    expect(new Set(r.choices).size).toBe(4);
  });

  it("gives an apply question an example from the knowledge base", async () => {
    const r = await tasks.quiz(mock, { node: { name: "Homomorphism" }, style: "apply" });
    expect(r.answer).toMatch(/Exponential map/);
  });
});

describe("quiz prompt", () => {
  it("carries the style, notes, prerequisites, format and output language", async () => {
    const seen: ChatMessage[][] = [];
    const reply = JSON.stringify({ question: "Q?", answer: "A", hints: ["h"], choices: ["a", "b", "c", "d"], correctIndex: 1 });
    const r = await tasks.quiz(
      spy(reply, seen),
      { node: { name: "Kernel", notes: "ker φ" }, prerequisites: [{ name: "Homomorphism" }], style: "connect", multipleChoice: true },
      { language: "Deutsch" },
    );
    expect(r).toEqual({ question: "Q?", answer: "A", hints: ["h"], choices: ["a", "b", "c", "d"], correctIndex: 1 });
    const [system, user] = seen[0];
    expect(system.content).toContain("[task:quiz]");
    expect(system.content).toMatch(/ONE of its prerequisites/);
    expect(system.content).toMatch(/exactly 4 short options/);
    expect(system.content).toMatch(/Output language: .*quiz questions.* in Deutsch/);
    expect(user.content).toContain("Learner's notes: ker φ");
    expect(user.content).toContain("- Homomorphism");
  });

  it("asks a recall question when there is no prerequisite to connect to", async () => {
    const seen: ChatMessage[][] = [];
    await tasks.quiz(spy('{"question":"Q?","answer":"A"}', seen), { node: { name: "Group" }, style: "connect" });
    expect(seen[0][1].content).toContain("Style: recall");
    expect(seen[0][0].content).toMatch(/free-recall/);
  });
});
