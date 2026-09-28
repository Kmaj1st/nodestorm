import type { Graph } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptProposal, addConcept, analyzeNode, derive, mix, suggestNames } from "../src/lib/actions";
import { api } from "../src/lib/api";
import * as ops from "../src/lib/graphOps";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Actions whose results are stored in the graph: what is kept when the AI fails or the graph changed meanwhile, and
// which changes are one undo step.

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
const dir = (kind: string) => ({ kind, explanation: `${kind} because` });

beforeEach(() => {
  store().reset();
  store().setToast(null);
  useSettings.setState({ connection: "browser", provider: "mock" });
  store().mutate((g) => {
    const a = ops.addNode(g, { name: "Group", definition: "A set with an associative operation, identity and inverses." });
    const b = ops.addNode(a.graph, { name: "Ring", definition: "Two operations." });
    const ok = (x: Graph, id: string) => ops.updateNode(x, id, { status: "ok" });
    return ok(ok(b.graph, a.id), b.id);
  });
});

afterEach(() => vi.restoreAllMocks());

describe("checking a concept", () => {
  it("an AI failure marks the concept failed with the reason (never left 'checking') and says so", async () => {
    vi.spyOn(api, "deps").mockRejectedValue(new Error("The model is overloaded"));
    await analyzeNode(byName("Ring").id);
    expect(byName("Ring").status).toBe("error");
    expect(byName("Ring").error).toMatch(/overloaded/);
    expect(store().toast).toMatch(/Ring.*overloaded/);
    expect(store().busy).toEqual({});
  });

  it("a basic concept is taken as given: no AI call", async () => {
    const deps = vi.spyOn(api, "deps");
    store().mutate((g) => ops.updateNode(g, byName("Group").id, { basic: true, status: "pending" }));
    await analyzeNode(byName("Group").id);
    expect(deps).not.toHaveBeenCalled();
    expect(byName("Group").status).toBe("ok");
  });
});

describe("mix", () => {
  it("stores the relation both ways as one undo step and opens it", async () => {
    vi.spyOn(api, "relate").mockResolvedValue({ aToB: dir("generalises"), bToA: dir("specialises") });
    const before = store().history[store().activeId].past.length;
    await mix(byName("Group").id, byName("Ring").id);
    const rel = ops.findRelation(graph(), byName("Group").id, byName("Ring").id)!;
    expect(rel.a === byName("Group").id ? rel.aToB.kind : rel.bToA.kind).toBe("generalises");
    expect(store().history[store().activeId].past).toHaveLength(before + 1);
    expect(store().inspect).toMatchObject({ kind: "edge", relationId: rel.id });
    store().undo();
    expect(ops.findRelation(graph(), byName("Group").id, byName("Ring").id)).toBeUndefined();
  });

  it("stores nothing when one end was deleted while the AI answered", async () => {
    let answer!: (v: { aToB: ReturnType<typeof dir>; bToA: ReturnType<typeof dir> }) => void;
    vi.spyOn(api, "relate").mockReturnValue(new Promise((r) => (answer = r)));
    const ringId = byName("Ring").id;
    const running = mix(byName("Group").id, ringId);
    store().mutate((g) => ops.removeNode(g, ringId));
    answer({ aToB: dir("uses"), bToA: dir("used by") });
    await running;
    expect(graph().relations).toEqual([]);
    store().undo(); // the delete: Ring comes back without a relation from the stale answer
    expect(graph().relations).toEqual([]);
  });

  it("keeps 'no relation found' as a link and says so", async () => {
    vi.spyOn(api, "relate").mockResolvedValue({ aToB: dir("none"), bToA: dir("none") });
    await mix(byName("Group").id, byName("Ring").id);
    expect(ops.isUnrelated(ops.findRelation(graph(), byName("Group").id, byName("Ring").id)!)).toBe(true);
    expect(store().toastKind).toBe("info");
  });
});

describe("derived proposals", () => {
  it("adds the proposal with its links as ONE undo step; a link to an unknown name or to itself is skipped", () => {
    const before = store().history[store().activeId].past.length;
    const id = acceptProposal(
      {
        name: "Field",
        definition: "A commutative ring whose non-zero elements form a group.",
        aliases: [],
        kind: "definition",
        links: [
          { to: "Ring", fromNew: dir("is a"), toNew: dir("generalises") },
          { to: "group", fromNew: dir("uses"), toNew: dir("used by") },
          { to: "Nowhere", fromNew: dir("uses"), toNew: dir("used by") },
          { to: "Field", fromNew: dir("uses"), toNew: dir("used by") },
        ],
      },
      [byName("Group").id, byName("Ring").id],
    );
    expect(byName("Field").id).toBe(id);
    expect(byName("Field").source?.site).toBe("AI");
    const linked = graph().relations.map((r) => [r.a, r.b].filter((x) => x !== id).map((x) => graph().nodes.find((n) => n.id === x)!.name)[0]).sort();
    expect(linked).toEqual(["Group", "Ring"]);
    expect(store().history[store().activeId].past).toHaveLength(before + 1);
    store().undo();
    expect(graph().nodes.map((n) => n.name).sort()).toEqual(["Group", "Ring"]);
    expect(graph().relations).toEqual([]);
  });
});

describe("adding a concept that already exists", () => {
  it("says so and adds nothing", () => {
    const count = graph().nodes.length;
    const id = addConcept({ name: " group " });
    expect(id).toBe(byName("Group").id);
    expect(graph().nodes).toHaveLength(count);
    expect(store().toast).toMatch(/Group|group/);
  });
});

describe("AI actions in the viewer", () => {
  it("naming and deriving are refused for a shared graph, without an AI call", async () => {
    const name = vi.spyOn(api, "name");
    const der = vi.spyOn(api, "derive");
    store().openView(graph(), "Shared");
    expect(await suggestNames("a set with one operation")).toBeUndefined();
    expect(await derive([graph().nodes[0].id])).toBeUndefined();
    expect(name).not.toHaveBeenCalled();
    expect(der).not.toHaveBeenCalled();
  });

  it("outside the viewer they return the AI's candidates and proposals", async () => {
    vi.spyOn(api, "name").mockResolvedValue({ candidates: [{ name: "Monoid", definition: "d", aliases: [], kind: "definition" }] } as never);
    vi.spyOn(api, "derive").mockResolvedValue({ proposals: [] });
    expect((await suggestNames("a set with one operation"))?.map((c) => c.name)).toEqual(["Monoid"]);
    expect(await derive([byName("Group").id])).toEqual([]);
  });
});
