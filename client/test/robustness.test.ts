import { findByName, normalizeName, type ConceptNode } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";
import { isReady, useSettings } from "../src/store/settingsStore";
import { useGraphStore, type GraphStore } from "../src/store/graphStore";

describe("saved projects from browser storage", () => {
  const load = (persisted: unknown) => {
    const merge = useGraphStore.persist.getOptions().merge!;
    return merge(persisted, { ...useGraphStore.getState(), toast: null }) as GraphStore;
  };
  const node = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, definition: "d", aliases: [], status: "ok", position: { x: 0, y: 0 }, dependsOn: [], missingDeps: [], ...extra,
  });
  const healthy = () => ({
    graphs: {
      g1: { id: "g1", name: "Main", nodes: [node("a", "Group"), node("b", "Ring", { dependsOn: ["a"] })], relations: [] },
      g2: { id: "g2", name: "Sandbox", parentId: "g1", nodes: [node("c", "Field")], relations: [] },
    },
    projects: { p1: { id: "p1", name: "Algebra", mainId: "g1", createdAt: 1 } },
    projectId: "p1",
    activeId: "g1",
  });

  it("are loaded unchanged, without a notice, when nothing is wrong", () => {
    const saved = healthy();
    const s = load(saved);
    expect(s.graphs.g1).toBe(saved.graphs.g1);
    expect(s.graphs.g2).toBe(saved.graphs.g2);
    expect(s.projects.p1.name).toBe("Algebra");
    expect(s.toast).toBeNull();
  });

  it("start with the default project when nothing was saved", () => {
    const s = load(undefined);
    expect(Object.keys(s.projects)).toHaveLength(1);
    expect(s.graphs[s.activeId]).toBeDefined();
    expect(s.toast).toBeNull();
  });

  it("are repaired field by field, keeping the project, and say so once", () => {
    const saved = healthy() as unknown as { graphs: Record<string, Record<string, unknown>>; projects: Record<string, unknown> };
    delete saved.graphs.g1.relations;
    const { missingDeps: _gone, ...noMissing } = node("b", "Ring", { dependsOn: ["a", "ghost"] });
    saved.graphs.g1.nodes = [node("a", "Group"), noMissing, { name: 42 }];
    saved.graphs.g9 = "broken" as never;
    saved.projects.p2 = null;
    const s = load(saved);
    expect(s.projects.p1.name).toBe("Algebra");
    expect(s.projectId).toBe("p1");
    const g1 = s.graphs.g1;
    expect(g1.id).toBe("g1");
    expect(g1.relations).toEqual([]);
    expect(g1.nodes.map((n) => n.name)).toEqual(["Group", "Ring"]);
    expect(g1.nodes[1].missingDeps).toEqual([]);
    expect(g1.nodes[1].dependsOn).toEqual(["a"]);
    expect(s.graphs.g2.parentId).toBe("g1");
    expect(s.graphs.g9).toBeUndefined();
    expect(s.toast).toMatch(/repaired/i);
    expect(s.toastKind).toBe("info");
  });
});

describe("normalizeName keeps meaningful symbols", () => {
  it("tells C, C++ and C# apart", () => {
    const keys = ["C", "C++", "C#"].map(normalizeName);
    expect(new Set(keys).size).toBe(3);
    expect(normalizeName("c++")).toBe(normalizeName("C++"));
    expect(normalizeName("C ++")).toBe(normalizeName("C++"));
  });

  it("tells primes, stars and daggers apart", () => {
    expect(normalizeName("f′")).not.toBe(normalizeName("f"));
    expect(normalizeName("f″")).not.toBe(normalizeName("f′"));
    expect(normalizeName("A*")).not.toBe(normalizeName("A"));
    expect(normalizeName("C*-algebra")).not.toBe(normalizeName("C-algebra"));
    expect(normalizeName("A†")).not.toBe(normalizeName("A"));
    expect(normalizeName("a+b")).toBe(normalizeName("a + b"));
  });

  it("keeps the old tolerance for case, spaces, hyphens, underscores and trailing punctuation", () => {
    expect(normalizeName("  Vector   Space ")).toBe("vector space");
    expect(normalizeName("vector-space")).toBe("vector space");
    expect(normalizeName("vector_space")).toBe("vector space");
    expect(normalizeName("Group!")).toBe("group");
    expect(normalizeName("Group.")).toBe("group");
    expect(normalizeName("Groups?")).toBe("group");
    expect(normalizeName("Euler's formula")).toBe(normalizeName("Euler’s formula"));
    expect(normalizeName("Cauchy–Schwarz inequality")).toBe(normalizeName("Cauchy-Schwarz inequality"));
    expect(normalizeName("!!!")).toBe("");
    expect(normalizeName("∇")).not.toBe(normalizeName("∫"));
  });

  it("finds C++ by name without matching C", () => {
    const nodes = [{ name: "C" }, { name: "C++" }];
    expect(findByName(nodes, "c++")?.name).toBe("C++");
    expect(findByName(nodes, "c")?.name).toBe("C");
    expect(findByName(nodes, "C#")).toBeUndefined();
  });
});

describe("a saved provider that no longer exists", () => {
  it("is not ready, so AI calls open Settings instead of failing", () => {
    const s = { ...useSettings.getState(), connection: "browser" as const, provider: "gone" as never };
    expect(isReady(s)).toBe(false);
    expect(isReady({ ...s, connection: "server" })).toBe(false);
  });

  it("is replaced by the default provider when settings load", () => {
    const merge = useSettings.persist.getOptions().merge!;
    const current = useSettings.getState();
    const out = merge({ provider: "gone", connection: "carrier-pigeon", clarify: { options: 2 } }, current) as typeof current;
    expect(out.provider).toBe(current.provider);
    expect(out.connection).toBe(current.connection);
    expect(out.clarify.options).toBe(2);
    const kept = merge({ provider: "mock" }, current) as typeof current;
    expect(kept.provider).toBe("mock");
  });
});

describe("aliases never answer for another concept", () => {
  const base = () => {
    let g = ops.addNode(ops.emptyGraph(), { name: "Group", aliases: ["Gruppe"] }).graph;
    g = ops.addNode(g, { name: "Ring" }).graph;
    return g;
  };

  it("drops a new concept's alias that is another concept's name or alias, and keeps the concept", () => {
    const r = ops.addNode(base(), { name: "Monoid", aliases: ["groups", "Gruppe", "Halbgruppe", "monoid", "Halbgruppe ", ""] });
    expect(r.existed).toBe(false);
    const n = r.graph.nodes.find((x) => x.id === r.id)!;
    expect(n.aliases).toEqual(["Halbgruppe"]);
    expect(findByName(r.graph.nodes, "Gruppe")?.name).toBe("Group");
  });

  it("drops a clashing alias set on an existing concept (look-ups, hand edits)", () => {
    const g = base();
    const ring = g.nodes.find((n) => n.name === "Ring")!;
    const out = ops.updateNode(g, ring.id, { aliases: ["Group", "Gruppe", "Rng"] });
    expect(out.nodes.find((n) => n.id === ring.id)!.aliases).toEqual(["Rng"]);
  });

  it("renaming keeps the old name as an alias but no alias of another concept", () => {
    const g = base();
    const ring = g.nodes.find((n) => n.name === "Ring")!;
    // An older graph where "Ring" wrongly carries another concept's alias.
    const bad = { ...g, nodes: g.nodes.map((n) => (n.id === ring.id ? { ...n, aliases: ["Gruppe"] } : n)) };
    const r = ops.renameNode(bad, ring.id, "Ring (algebra)");
    expect(r.error).toBeUndefined();
    expect(r.graph.nodes.find((n) => n.id === ring.id)!.aliases).toEqual(["Ring"]);
  });

  const named = (g: { nodes: { name: string; aliases: string[] }[] }, name: string) => g.nodes.find((n) => n.name === name)!;

  it("merging a sandbox brings its aliases only where they are free, and the parent's aliases win", () => {
    let parent = ops.addNode(ops.emptyGraph(), { name: "Group", aliases: ["Gruppe"] }).graph;
    let sb = ops.fork(parent, "Sandbox");
    // After the fork, both sides add "Kernel"; the parent also adds "Rng".
    parent = ops.addNode(parent, { name: "Kernel", aliases: ["Kern"] }).graph;
    parent = ops.addNode(parent, { name: "Rng" }).graph;
    sb = ops.addNode(sb, { name: "Kernel", aliases: ["Null space", "Rng"] }).graph;
    // A concept both sides have, given in the sandbox the alias the parent's new concept took.
    const group = named(sb, "Group") as ConceptNode;
    sb = { ...sb, nodes: sb.nodes.map((n) => (n.id === group.id ? { ...n, aliases: ["Kern", "Gruppe"] } : n)) };

    const out = ops.merge(parent, sb);
    expect(out.nodes.map((n) => n.name).sort()).toEqual(["Group", "Kernel", "Rng"]);
    expect(named(out, "Kernel").aliases).toEqual(["Kern", "Null space"]);
    expect(named(out, "Group").aliases).toEqual(["Gruppe"]);
    for (const key of ["Gruppe", "Kern", "Rng", "Null space"]) expect(out.nodes.filter((n) => findByName([n], key))).toHaveLength(1);
  });

  it("a concept folded into an existing meaning leaves its name as an alias, and no alias of another concept", () => {
    let g = ops.addNode(ops.emptyGraph(), { name: "Expectation (probability)" }).graph;
    g = ops.addNode(g, { name: "Mean", aliases: ["Average"] }).graph;
    const r = ops.addNode(g, { name: "Expectation", aliases: ["Expected value"] });
    // An older graph where the new concept wrongly carries another concept's alias.
    const bad = { ...r.graph, nodes: r.graph.nodes.map((n) => (n.id === r.id ? { ...n, aliases: ["Average", "Expected value"] } : n)) };
    const out = ops.applySense(bad, r.id, { name: "Expectation (probability)", definition: "" });
    expect(out.merged).toBe(true);
    expect(named(out.graph, "Expectation (probability)").aliases).toEqual(["Expectation", "Expected value"]);
    expect(findByName(out.graph.nodes, "Average")?.name).toBe("Mean");
  });
});
