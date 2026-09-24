import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ops from "../src/lib/graphOps";
import * as hist from "../src/lib/history";
import { useGraphStore } from "../src/store/graphStore";

// The store persists to localStorage; give it an in-memory one (tests run in Node).
vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
});

describe("history stacks", () => {
  it("undoes and redoes steps in order; a new step clears redo", () => {
    let h = hist.emptyHistory<number>();
    h = hist.record(h, 0);
    h = hist.record(h, 1); // present is now 2
    const u1 = hist.undo(h, 2)!;
    expect(u1.present).toBe(1);
    const u2 = hist.undo(u1.history, u1.present)!;
    expect(u2.present).toBe(0);
    expect(hist.undo(u2.history, u2.present)).toBeNull();
    const r1 = hist.redo(u2.history, u2.present)!;
    expect(r1.present).toBe(1);
    const branched = hist.record(r1.history, 1);
    expect(branched.future).toEqual([]);
    expect(hist.redo(branched, 5)).toBeNull();
  });

  it("is capped, dropping the oldest steps", () => {
    let h = hist.emptyHistory<number>();
    for (let i = 0; i < 150; i++) h = hist.record(h, i);
    expect(h.past).toHaveLength(hist.HISTORY_LIMIT);
    expect(h.past[0]).toBe(50);
    expect(hist.record(hist.emptyHistory<number>(), 0, undefined, 2).past).toHaveLength(1);
  });

  it("coalesces consecutive steps with the same key, but not across other steps or undo", () => {
    let h = hist.emptyHistory<string>();
    h = hist.record(h, "", "def");
    h = hist.record(h, "a", "def");
    h = hist.record(h, "ab", "def");
    expect(h.past).toEqual([""]);
    h = hist.record(h, "abc", "name");
    h = hist.record(h, "abcd", "def");
    expect(h.past).toEqual(["", "abc", "abcd"]);
    const u = hist.undo(h, "abcde")!;
    expect(hist.record(u.history, "abcd", "def").past).toHaveLength(3);
  });

  it("rebase applies a background change to every snapshot", () => {
    const h = hist.rebase({ past: [1, 2], future: [3], lastKey: "k" }, (n) => n * 10);
    expect(h).toEqual({ past: [10, 20], future: [30], lastKey: "k" });
  });
});

describe("graph store history", () => {
  const s = () => useGraphStore.getState();
  const names = (id = s().activeId) => s().graphs[id].nodes.map((n) => n.name);
  const add = (name: string, graphId?: string) => {
    let id = "";
    s().mutate((g) => {
      const r = ops.addNode(g, { name });
      id = r.id;
      return r.graph;
    }, graphId);
    return id;
  };

  beforeEach(() => s().reset());

  it("undo brings back a deleted node with its relations; redo deletes it again", () => {
    const a = add("A");
    const b = add("B");
    s().mutate((g) => ops.upsertRelation(g, a, b, { kind: "x", explanation: "" }, { kind: "y", explanation: "" }));
    s().mutate((g) => ops.removeNode(g, a));
    expect(names()).toEqual(["B"]);
    expect(s().graphs[s().activeId].relations).toHaveLength(0);
    s().undo();
    expect(names()).toEqual(["A", "B"]);
    expect(s().graphs[s().activeId].relations).toHaveLength(1);
    s().redo();
    expect(names()).toEqual(["B"]);
  });

  it("keeps a separate history per graph (sandbox)", () => {
    const main = s().activeId;
    add("A");
    s().forkActive();
    const sb = s().activeId;
    add("B");
    expect(s().history[sb].past).toHaveLength(1); // the fork starts with an empty history
    s().undo(main);
    expect(names(main)).toEqual([]);
    expect(names(sb)).toEqual(["A", "B"]);
    s().undo(sb);
    expect(names(sb)).toEqual(["A"]);
    s().undo(sb); // nothing left: no-op
    expect(names(sb)).toEqual(["A"]);
  });

  it("background (AI) updates are not undo steps and survive undo/redo", () => {
    const a = add("A"); // step 1 (status "checking")
    add("B"); // step 2
    // A's check finishes after B was added.
    s().mutate((g) => ops.applyDeps(g, a, []), undefined, { history: "background" });
    expect(s().history[s().activeId].past).toHaveLength(2);
    s().undo(); // undo "add B": A must not go back to "checking"
    expect(names()).toEqual(["A"]);
    expect(s().graphs[s().activeId].nodes[0].status).toBe("ok");
  });

  it("a late AI result for a deleted node lands when the delete is undone", () => {
    const a = add("A");
    s().mutate((g) => ops.removeNode(g, a));
    s().mutate((g) => ops.applyDeps(g, a, []), undefined, { history: "background" });
    s().undo();
    expect(s().graphs[s().activeId].nodes[0].status).toBe("ok");
  });

  it("a check restored without a running task is marked failed instead of spinning forever", () => {
    add("A"); // "checking", but no analyze task is running in this test
    add("B");
    s().undo();
    const node = s().graphs[s().activeId].nodes[0];
    expect(node.status).toBe("error");
    expect(node.error).toMatch(/interrupted/);
  });

  it("no-op mutations and 'merge' mutations don't add steps", () => {
    const a = add("A");
    s().mutate((g) => g);
    s().mutate((g) => ops.updateNode(g, a, { definition: "d" }), undefined, { history: "merge" });
    expect(s().history[s().activeId].past).toHaveLength(1);
    s().undo();
    expect(names()).toEqual([]);
  });
});

describe("hand edits", () => {
  it("renames a concept, keeps the old name as alias and links nodes waiting for the new name", () => {
    let g = ops.emptyGraph();
    const thm = ops.addNode(g, { name: "Theorem" });
    g = ops.applyDeps(thm.graph, thm.id, [{ name: "Isomorphism", role: "derives", reason: "r", matchesExisting: null }]);
    const iso = ops.addNode(g, { name: "Isomorfism" }); // typo: doesn't satisfy the dependency yet
    expect(iso.graph.nodes.find((n) => n.id === thm.id)!.status).toBe("blocked");
    const r = ops.renameNode(iso.graph, iso.id, "  Isomorphism ");
    expect(r.error).toBeUndefined();
    const renamed = r.graph.nodes.find((n) => n.id === iso.id)!;
    expect(renamed.name).toBe("Isomorphism");
    expect(renamed.aliases).toEqual(["Isomorfism"]);
    expect(r.graph.nodes.find((n) => n.id === thm.id)!.status).toBe("ok");
    expect(ops.findRelation(r.graph, thm.id, iso.id)).toBeDefined();
  });

  it("rejects empty and duplicate names", () => {
    const a = ops.addNode(ops.emptyGraph(), { name: "Group", aliases: ["groups"] });
    const b = ops.addNode(a.graph, { name: "Ring" });
    expect(ops.renameNode(b.graph, b.id, "   ").error).toMatch(/empty/);
    expect(ops.renameNode(b.graph, b.id, "group").error).toMatch(/already/);
    expect(ops.renameNode(b.graph, b.id, "Groups").error).toMatch(/already/);
    expect(ops.renameNode(b.graph, b.id, "Ring").graph).toBe(b.graph);
  });

  it("edits one direction of a relation", () => {
    const a = ops.addNode(ops.emptyGraph(), { name: "A" });
    const b = ops.addNode(a.graph, { name: "B" });
    const g = ops.upsertRelation(b.graph, a.id, b.id, { kind: "x", explanation: "1" }, { kind: "y", explanation: "2" });
    const rel = g.relations[0];
    const out = ops.updateRelation(g, rel.id, "bToA", { explanation: "edited" });
    expect(out.relations[0].bToA).toEqual({ kind: "y", explanation: "edited" });
    expect(out.relations[0].aToB).toEqual(rel.aToB);
    expect(ops.updateRelation(g, "missing", "aToB", { kind: "z" })).toBe(g);
  });
});
