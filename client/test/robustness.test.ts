import { findByName, normalizeName } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";
import { isReady, useSettings } from "../src/store/settingsStore";

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
});
