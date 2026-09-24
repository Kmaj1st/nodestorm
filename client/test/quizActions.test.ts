import type { Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gradeConcept, quizQuestion } from "../src/lib/actions";
import * as ops from "../src/lib/graphOps";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// "Quiz me" through the real store and actions, with the offline mock AI.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const store = () => useGraphStore.getState();
const graph = (): Graph => store().graphs[store().activeId];
const byName = (name: string) => graph().nodes.find((n) => n.name === name)!;

beforeEach(() => {
  store().reset();
  useSettings.setState({ connection: "browser", provider: "mock" });
  store().mutate((g) => {
    const a = ops.addNode(g, { name: "Homomorphism", definition: "A structure-preserving map." });
    const b = ops.addNode(a.graph, { name: "Isomorphism" });
    const done = (x: Graph, id: string) => ops.updateNode(x, id, { status: "ok" });
    return ops.updateNode(done(done(b.graph, a.id), b.id), b.id, { dependsOn: [a.id] });
  });
});

describe("quiz actions", () => {
  it("asks the AI with the concept's prerequisites", async () => {
    const q = await quizQuestion(byName("Isomorphism").id, "connect", false);
    expect(q?.question).toBe("How does Isomorphism build on Homomorphism?");
    expect(store().busy).toEqual({});
  });

  it("stores a grade as a background change: undo neither removes it nor replays an older one", () => {
    const id = byName("Homomorphism").id;
    store().mutate((g) => ops.updateNode(g, id, { definition: "edited" })); // an undo step
    gradeConcept(id, "knew", undefined, 1000);
    expect(byName("Homomorphism").mastery).toEqual({ score: 1, reviews: 1, reviewedAt: 1000 });
    expect(store().history[store().activeId].past).toHaveLength(2); // the two steps from setup and edit only
    store().undo();
    expect(byName("Homomorphism").definition).toBe("A structure-preserving map.");
    expect(byName("Homomorphism").mastery).toEqual({ score: 1, reviews: 1, reviewedAt: 1000 });
    gradeConcept(id, "didnt", undefined, 2000);
    store().redo();
    expect(byName("Homomorphism").mastery).toEqual({ score: 0.5, reviews: 2, reviewedAt: 2000 });
  });

  it("refuses to quiz a shared graph in the viewer", async () => {
    store().openView(graph(), "Shared");
    expect(await quizQuestion(graph().nodes[0].id, "recall", false)).toBeUndefined();
  });
});
