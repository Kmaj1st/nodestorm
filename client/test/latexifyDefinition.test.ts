import { beforeEach, describe, expect, it, vi } from "vitest";
import { addConcept, latexifyDefinition } from "../src/lib/actions";
import { api } from "../src/lib/api";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// "Formulas → LaTeX" on a definition: the AI rewrites only the Unicode formulas; one undo step, source kept.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const store = () => useGraphStore.getState();
const node = (id: string) => store().graphs[store().activeId].nodes.find((n) => n.id === id)!;
const TEXT = "A map φ: G → H with φ(ab) = φ(a)φ(b).";

beforeEach(() => {
  store().reset();
  store().setSettingsOpen(false);
  store().setToast(null);
  vi.restoreAllMocks();
  useSettings.setState({ newConcepts: "ask", connection: "browser", provider: "mock", language: "auto" });
});

describe("latexifyDefinition", () => {
  it("rewrites the formulas as one undo step and keeps the source", async () => {
    const id = addConcept({ name: "Homomorphism", definition: TEXT });
    const source = node(id).source;
    await latexifyDefinition(id);
    expect(node(id).definition).toBe("A map $\\varphi: G \\to H$ with $\\varphi(ab) = \\varphi(a)\\varphi(b)$.");
    expect(node(id).source).toEqual(source);
    expect(store().toast).toMatch(/LaTeX/);
    store().undo();
    expect(node(id).definition).toBe(TEXT);
  });

  it("an answer that changed more than the formulas leaves the definition as it was", async () => {
    const id = addConcept({ name: "Homomorphism", definition: TEXT });
    vi.spyOn(api, "latexify").mockResolvedValueOnce({ text: TEXT, rejected: true });
    await latexifyDefinition(id);
    expect(node(id).definition).toBe(TEXT);
    expect(store().toast).toMatch(/more than the formulas/);
  });

  it("a definition edited meanwhile isn't overwritten", async () => {
    const id = addConcept({ name: "Homomorphism", definition: TEXT });
    vi.spyOn(api, "latexify").mockImplementationOnce(async () => {
      store().mutate((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, definition: "Edited φ." } : n)) }));
      return { text: "A map $\\varphi$." };
    });
    await latexifyDefinition(id);
    expect(node(id).definition).toBe("Edited φ.");
    expect(store().toast).toMatch(/edited meanwhile/);
  });

  it("without an AI set up, Settings opens and nothing is sent", async () => {
    useSettings.setState({ provider: "openai", configs: {} });
    const id = addConcept({ name: "Homomorphism", definition: TEXT });
    const call = vi.spyOn(api, "latexify");
    await latexifyDefinition(id);
    expect(call).not.toHaveBeenCalled();
    expect(store().settingsOpen).toBe(true);
    expect(node(id).definition).toBe(TEXT);
  });
});
