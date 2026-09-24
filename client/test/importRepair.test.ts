import { GraphExport } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { repairImport } from "../src/lib/importRepair";

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  definition: "",
  aliases: [],
  status: "ok",
  position: { x: 0, y: 0 },
  dependsOn: [],
  missingDeps: [],
  ...extra,
});
const dir = { kind: "k", explanation: "e" };
const rel = (id: string, a: string, b: string) => ({ id, a, b, aToB: dir, bToA: dir, origin: "mix" });

describe("repairImport", () => {
  it("passes a valid file through untouched", () => {
    const doc = { format: "nodestorm/v1", graphs: [{ id: "g", name: "Main", nodes: [node("a"), node("b")], relations: [rel("r", "a", "b")] }] };
    const out = repairImport(doc);
    expect(out.fixes).toEqual([]);
    expect(out.doc).toEqual(doc);
  });

  it("drops dangling relations and prerequisite links, and reports them", () => {
    const { doc, fixes } = repairImport({
      format: "nodestorm/v1",
      graphs: [
        {
          id: "g",
          name: "Main",
          nodes: [node("a", { dependsOn: ["b", "ghost", "a"] }), node("b")],
          relations: [rel("r1", "a", "b"), rel("r2", "a", "ghost"), rel("r3", "ghost", "b"), rel("r4", "b", "b")],
        },
      ],
    });
    const g = doc.graphs[0];
    expect(g.relations.map((r) => r.id)).toEqual(["r1"]);
    expect(g.nodes[0].dependsOn).toEqual(["b"]);
    expect(fixes).toContain("dropped relations pointing to missing concepts (×3)");
    expect(fixes).toContain("dropped prerequisite links to missing concepts (×2)");
  });

  it("fills defaults for an older/partial shape and accepts a bare graph", () => {
    const { doc, fixes } = repairImport({
      name: "Old",
      nodes: [{ id: "a", name: "A" }, { id: "b", name: "B", status: "weird", aliases: ["x", 3] }, { id: "c" }],
      relations: [{ a: "a", b: "b" }],
    });
    expect(GraphExport.safeParse(doc).success).toBe(true);
    const g = doc.graphs[0];
    expect(g.nodes.map((n) => n.name)).toEqual(["A", "B"]);
    expect(g.nodes[1]).toMatchObject({ status: "ok", aliases: ["x"], dependsOn: [], missingDeps: [], definition: "" });
    expect(g.relations[0]).toMatchObject({ a: "a", b: "b", origin: "mix", aToB: { kind: "relates to" } });
    expect(g.relations[0].id).toBeTruthy();
    expect(fixes).toEqual(
      expect.arrayContaining([
        "wrapped a single graph",
        "dropped concepts without a name",
        "reset unknown concept statuses to “ok”",
        "placed concepts that had no position (×2)",
        "filled in missing relation directions (×2)",
      ]),
    );
  });

  it("repairs graph-level problems: newer format tag, duplicate ids, orphaned sandboxes", () => {
    const { doc, fixes } = repairImport({
      format: "nodestorm/v2",
      extra: true,
      graphs: [
        { id: "sb", name: "Sandbox", parentId: "gone", nodes: [], relations: [] },
        { id: "main", name: "Main", nodes: [node("a"), node("a")], relations: [rel("r", "a", "a")] },
        { id: "main", name: "Dup", nodes: [], relations: [] },
        "junk",
      ],
    });
    expect(doc.graphs.map((g) => g.id)).toEqual(["main", "sb"]);
    expect(doc.graphs[0].nodes).toHaveLength(1);
    expect(doc.graphs[1].parentId).toBe("main");
    expect(fixes).toEqual(
      expect.arrayContaining([
        'read format "nodestorm/v2" as nodestorm/v1',
        "dropped a concept with a duplicate id",
        "dropped a graph with a duplicate id",
        "dropped an entry that isn't a graph",
        "re-attached a sandbox whose parent graph is missing to the main graph",
      ]),
    );
  });

  it("unsticks nodes whose state can't continue from a file", () => {
    const { doc } = repairImport({
      format: "nodestorm/v1",
      graphs: [{ id: "g", name: "M", nodes: [node("a", { status: "checking" }), node("b", { status: "blocked" })], relations: [] }],
    });
    expect(doc.graphs[0].nodes[0].status).toBe("error");
    expect(doc.graphs[0].nodes[1].status).toBe("ok");
  });

  it("keeps the project name of a project export and ignores a malformed one", () => {
    const graphs = [{ id: "g", name: "Main", nodes: [], relations: [] }];
    const named = repairImport({ format: "nodestorm/v1", project: { name: " Algebra " }, graphs });
    expect(named.doc.project).toEqual({ name: "Algebra" });
    expect(named.fixes).toEqual([]);
    expect(repairImport({ format: "nodestorm/v1", project: { name: 3 }, graphs }).doc.project).toBeUndefined();
  });

  it("rejects files with no graphs", () => {
    expect(() => repairImport({ hello: 1 })).toThrow(/Not a NodeStorm file/);
    expect(() => repairImport({ format: "nodestorm/v1", graphs: [] })).toThrow(/no graphs/);
    expect(() => repairImport(null)).toThrow();
  });
});
