import type { Graph, NodeStatus, RelationOrigin } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  hideIds,
  isFiltered,
  KIND_FILTERS,
  kindFilterOf,
  neighbourhood,
  parseHidden,
  pruneHidden,
  sanitizeView,
  showIds,
  showsEverything,
  visibleParts,
  withoutHidden,
  type ViewPrefs,
} from "../src/lib/view";

/**
 * A chain A – B – C – D – E (mixed, dependency, derived, mixed) plus F linked to A by a dependency.
 * Statuses: B blocked, D unclear, E failed, the rest ready.
 */
function chain(): Graph {
  const status: Record<string, NodeStatus> = { A: "ok", B: "blocked", C: "ok", D: "unclear", E: "error", F: "ok" };
  const nodes = Object.entries(status).map(([id, s]) => ({
    id, name: id, definition: "", aliases: [], status: s, position: { x: 0, y: 0 }, dependsOn: [], missingDeps: [],
  }));
  const rel = (id: string, a: string, b: string, origin: RelationOrigin) => ({
    id, a, b, origin, aToB: { kind: "x", explanation: "" }, bToA: { kind: "y", explanation: "" },
  });
  const relations = [
    rel("ab", "A", "B", "mix"),
    rel("bc", "B", "C", "dependency"),
    rel("cd", "C", "D", "derive"),
    rel("de", "D", "E", "mix"),
    rel("fa", "F", "A", "dependency"),
  ];
  return { id: "g", name: "Main", nodes, relations };
}

const prefs = (patch: Partial<ViewPrefs> = {}): ViewPrefs => ({ ...DEFAULT_VIEW, ...patch });
const sorted = (s: Set<string>) => [...s].sort();

describe("neighbourhood", () => {
  const g = chain();
  it("grows one ring of relations per hop, in both directions", () => {
    expect(sorted(neighbourhood(g.relations, "C", 1))).toEqual(["B", "C", "D"]);
    expect(sorted(neighbourhood(g.relations, "C", 2))).toEqual(["A", "B", "C", "D", "E"]);
    expect(sorted(neighbourhood(g.relations, "C", 3))).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
  it("is just the root when it has no relations (or 0 hops)", () => {
    expect(sorted(neighbourhood([], "X", 2))).toEqual(["X"]);
    expect(sorted(neighbourhood(g.relations, "C", 0))).toEqual(["C"]);
  });
  it("copes with cycles and duplicate links", () => {
    const rels = [{ a: "A", b: "B" }, { a: "B", b: "A" }, { a: "B", b: "C" }, { a: "C", b: "A" }];
    expect(sorted(neighbourhood(rels, "A", 3))).toEqual(["A", "B", "C"]);
  });
});

describe("visibleParts", () => {
  const g = chain();
  it("shows everything by default", () => {
    const v = visibleParts(g, prefs());
    expect(v.nodes.size).toBe(6);
    expect(v.relations.size).toBe(5);
    expect(showsEverything(prefs(), null)).toBe(true);
  });

  it("focus shows the neighbourhood and only relations between shown concepts", () => {
    const v = visibleParts(g, prefs(), { nodeId: "B", hops: 1 });
    expect(sorted(v.nodes)).toEqual(["A", "B", "C"]);
    expect(sorted(v.relations)).toEqual(["ab", "bc"]);
  });

  it("a focus on a concept that no longer exists shows everything", () => {
    expect(visibleParts(g, prefs(), { nodeId: "gone", hops: 1 }).nodes.size).toBe(6);
  });

  it("hidden relation kinds are not drawn and not followed by focus", () => {
    const noDeps = prefs({ origins: { ...DEFAULT_VIEW.origins, dependency: false } });
    const all = visibleParts(g, noDeps);
    expect(sorted(all.relations)).toEqual(["ab", "cd", "de"]);
    expect(all.nodes.size).toBe(6); // concepts stay, only the links go
    // From B only the mixed link to A is left.
    expect(sorted(visibleParts(g, noDeps, { nodeId: "B", hops: 2 }).nodes)).toEqual(["A", "B"]);
  });

  it("to-do view hides ready concepts and their relations", () => {
    const v = visibleParts(g, prefs({ todoOnly: true }));
    expect(sorted(v.nodes)).toEqual(["B", "D", "E"]);
    expect(sorted(v.relations)).toEqual(["de"]);
  });

  it("to-do view applies after focus, and the focused concept stays even when ready", () => {
    // 2 hops from C reach A…E through ready C; then the ready ones except C drop out.
    const v = visibleParts(g, prefs({ todoOnly: true }), { nodeId: "C", hops: 2 });
    expect(sorted(v.nodes)).toEqual(["B", "C", "D", "E"]);
    expect(sorted(v.relations)).toEqual(["bc", "cd", "de"]);
  });
});

describe("view prefs", () => {
  it("fills in defaults field by field and clamps the focus radius", () => {
    expect(sanitizeView(null)).toEqual(DEFAULT_VIEW);
    expect(sanitizeView("garbage")).toEqual(DEFAULT_VIEW);
    const v = sanitizeView({ origins: { mix: false, bogus: false }, edgeLabels: "no", todoOnly: true, hops: 9 });
    expect(v).toEqual({ origins: { mix: false, dependency: true, derive: true, extract: true }, edgeLabels: true, todoOnly: true, hops: 3, kinds: DEFAULT_VIEW.kinds, layout: "flat", physics: false });
    // Layout and Physics: known values kept, anything else back to the default.
    expect(sanitizeView({ layout: "layered", physics: true })).toMatchObject({ layout: "layered", physics: true });
    expect(sanitizeView({ layout: "3d", physics: "yes" })).toMatchObject({ layout: "flat", physics: false });
    expect(isFiltered({ ...DEFAULT_VIEW, layout: "layered", physics: true })).toBe(false);
    // Kind filters: unknown kinds dropped, missing ones shown.
    const k = sanitizeView({ kinds: { theorem: false, remark: false, none: "x" } }).kinds;
    expect(k.theorem).toBe(false);
    expect(k.none).toBe(true);
    expect(Object.keys(k)).toHaveLength(11);
    expect("remark" in k).toBe(false);
    expect(sanitizeView({ hops: 0 }).hops).toBe(1);
    expect(sanitizeView({ hops: 2.4 }).hops).toBe(2);
  });

  it("knows when a filter hides something", () => {
    expect(isFiltered(DEFAULT_VIEW)).toBe(false);
    expect(isFiltered(prefs({ edgeLabels: false, hops: 3 }))).toBe(false); // labels and radius hide no concept
    expect(isFiltered(prefs({ todoOnly: true }))).toBe(true);
    expect(isFiltered(prefs({ origins: { ...DEFAULT_VIEW.origins, derive: false } }))).toBe(true);
    expect(showsEverything(DEFAULT_VIEW, { nodeId: "A", hops: 1 })).toBe(false);
    expect(isFiltered(prefs({ kinds: { ...DEFAULT_VIEW.kinds, none: false } }))).toBe(true);
  });
});

describe("kind filter", () => {
  // A and C are theorems, B a definition, the rest have no kind.
  const typed = (): Graph => {
    const g = chain();
    const kinds: Record<string, "theorem" | "definition"> = { A: "theorem", B: "definition", C: "theorem" };
    return { ...g, nodes: g.nodes.map((n) => (kinds[n.id] ? { ...n, kind: kinds[n.id] } : n)) };
  };

  it("hides concepts of an unticked kind and their relations", () => {
    const v = visibleParts(typed(), prefs({ kinds: { ...DEFAULT_VIEW.kinds, theorem: false } }));
    expect(sorted(v.nodes)).toEqual(["B", "D", "E", "F"]);
    expect(sorted(v.relations)).toEqual(["de"]);
  });

  it("'none' stands for concepts without a kind", () => {
    const v = visibleParts(typed(), prefs({ kinds: { ...DEFAULT_VIEW.kinds, none: false } }));
    expect(sorted(v.nodes)).toEqual(["A", "B", "C"]);
    expect(kindFilterOf({})).toBe("none");
    expect(kindFilterOf({ kind: "lemma" })).toBe("lemma");
  });

  it("keeps the focused concept even when its kind is hidden", () => {
    const v = visibleParts(typed(), prefs({ kinds: { ...DEFAULT_VIEW.kinds, theorem: false } }), { nodeId: "C", hops: 1 });
    expect(sorted(v.nodes)).toEqual(["B", "C", "D"]);
    expect(KIND_FILTERS).toContain("none");
  });
});

describe("concepts hidden by hand", () => {
  const g = chain();

  it("leaves hidden concepts and every relation touching them off the canvas", () => {
    const v = visibleParts(g, prefs(), null, new Set(["C"]));
    expect(sorted(v.nodes)).toEqual(["A", "B", "D", "E", "F"]);
    expect(sorted(v.relations)).toEqual(["ab", "de", "fa"]);
    expect(showsEverything(prefs(), null, new Set())).toBe(true);
    expect(showsEverything(prefs(), null, new Set(["C"]))).toBe(false);
  });

  it("focus mode doesn't reach through a hidden concept", () => {
    // From B, C is the way to D; with C hidden only A (and F behind it) are near.
    expect(sorted(visibleParts(g, prefs(), { nodeId: "B", hops: 2 }, new Set(["C"])).nodes)).toEqual(["A", "B", "F"]);
  });

  it("hides, shows and shows all, per graph", () => {
    let m = hideIds({}, "g", ["A", "B", "A"]);
    expect(m).toEqual({ g: ["A", "B"] });
    m = hideIds(m, "g", ["B", "C"]);
    expect(m).toEqual({ g: ["A", "B", "C"] });
    expect(hideIds(m, "g", ["A"])).toBe(m); // nothing new: the same map
    m = hideIds(m, "other", ["X"]);
    expect(showIds(m, "g", ["B"])).toEqual({ g: ["A", "C"], other: ["X"] });
    expect(showIds(m, "g")).toEqual({ other: ["X"] });
    expect(showIds(showIds(m, "other", ["X"]), "g", ["A", "B", "C"])).toEqual({});
    expect(showIds(m, "nope")).toBe(m);
    expect(showIds(m, "g", ["Z"])).toBe(m);
  });

  it("forgets concepts and graphs that no longer exist", () => {
    const m = { g: ["A", "gone"], deleted: ["X"] };
    expect(pruneHidden(m, { g })).toEqual({ g: ["A"] });
    expect(pruneHidden({ g: ["gone"] }, { g })).toEqual({});
    const ok = { g: ["A", "B"] };
    expect(pruneHidden(ok, { g })).toBe(ok); // unchanged: the same map
    // A deleted concept that Undo (or Redo) can bring back stays hidden; one only a gone graph had doesn't.
    const history = { g: { past: [{ nodes: [{ id: "gone" }] }], future: [] }, deleted: { past: [{ nodes: [{ id: "X" }] }], future: [] } };
    expect(pruneHidden(m, { g }, history as never)).toEqual({ g: ["A", "gone"] });
    expect(pruneHidden({ g: ["later"] }, { g }, { g: { past: [], future: [{ nodes: [{ id: "later" }] }] } } as never)).toEqual({ g: ["later"] });
  });

  it("tolerates anything stored", () => {
    for (const bad of [null, "x", 3, [], ["A"], true]) expect(parseHidden(bad)).toEqual({});
    expect(parseHidden({ g: ["A", 2, "", "A", null, "B"], h: "A", i: [], j: { 0: "A" } })).toEqual({ g: ["A", "B"] });
  });

  it("drops hidden concepts and their relations from a graph (3D view, Tidy)", () => {
    const w = withoutHidden(g, new Set(["A"]));
    expect(w.nodes.map((n) => n.id)).toEqual(["B", "C", "D", "E", "F"]);
    expect(w.relations.map((r) => r.id)).toEqual(["bc", "cd", "de"]);
    expect(withoutHidden(g, new Set())).toBe(g);
  });
});
