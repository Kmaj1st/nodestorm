import { GraphExport, type Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { buildExample, EXAMPLES } from "../src/lib/examples";
import * as ops from "../src/lib/graphOps";
import { layeredLayout } from "../src/lib/layout";
import * as proj from "../src/lib/projects";

const empty = (): proj.Workspace => proj.createProject({ graphs: {}, projects: {}, projectId: "", activeId: "" }, "First");

/** A project with two concepts (B depends on A) and one sandbox of its main graph. */
function withContent() {
  let ws = empty();
  const mainId = ws.activeId;
  let g = ws.graphs[mainId];
  const a = ops.addNode(g, { name: "A" });
  g = ops.applyDeps(a.graph, a.id, []);
  const b = ops.addNode(g, { name: "B" });
  g = ops.applyDeps(b.graph, b.id, [{ name: "A", role: "uses", reason: "r", matchesExisting: null }]);
  const sb = ops.fork(g, "Sandbox 1");
  ws = { ...ws, graphs: { [g.id]: g, [sb.id]: sb } };
  return { ws, mainId, sandboxId: sb.id };
}

const names = (ws: proj.Workspace) => proj.projectList(ws).map((p) => p.name);

describe("projects", () => {
  it("creates empty projects with unique default names and switches to them", () => {
    let ws = empty();
    ws = proj.createProject(ws);
    ws = proj.createProject(ws);
    expect(names(ws)).toEqual(["First", "Untitled project", "Untitled project 2"]);
    const p = ws.projects[ws.projectId];
    expect(p.name).toBe("Untitled project 2");
    expect(ws.activeId).toBe(p.mainId);
    expect(ws.graphs[p.mainId].nodes).toEqual([]);
  });

  it("lists only a project's own graphs, main graph first", () => {
    const { ws, mainId, sandboxId } = withContent();
    const other = proj.createProject(ws);
    const first = proj.projectList(other)[0];
    expect(proj.projectGraphs(other, first).map((g) => g.id)).toEqual([mainId, sandboxId]);
    expect(proj.projectGraphs(other, other.projects[other.projectId]).map((g) => g.id)).toEqual([other.activeId]);
  });

  it("renames, ignoring blank names", () => {
    const ws = empty();
    expect(proj.renameProject(ws, ws.projectId, "  Algebra ").projects[ws.projectId].name).toBe("Algebra");
    expect(proj.renameProject(ws, ws.projectId, "   ")).toBe(ws);
  });

  it("duplicates with fresh ids, keeping links and sandbox↔main node matching", () => {
    const { ws, mainId, sandboxId } = withContent();
    const dup = proj.duplicateProject(ws, ws.projectId);
    const copy = dup.projects[dup.projectId];
    expect(copy.name).toBe("First (copy)");
    expect(Object.keys(dup.projects)).toHaveLength(2);
    const [main, sb] = proj.projectGraphs(dup, copy);
    expect(dup.activeId).toBe(main.id);
    // Nothing shared with the original.
    const orig = [ws.graphs[mainId], ws.graphs[sandboxId]];
    const ids = (gs: Graph[]) => gs.flatMap((g) => [g.id, ...g.nodes.map((n) => n.id), ...g.relations.map((r) => r.id)]);
    expect(ids([main, sb]).filter((id) => ids(orig).includes(id))).toEqual([]);
    // Structure kept: B still depends on A, the relation connects them, the sandbox hangs off the copied main.
    const node = (g: Graph, n: string) => g.nodes.find((x) => x.name === n)!;
    expect(node(main, "B").dependsOn).toEqual([node(main, "A").id]);
    expect(main.relations[0]).toMatchObject({ a: node(main, "B").id, b: node(main, "A").id });
    expect(sb.parentId).toBe(main.id);
    expect(node(sb, "A").id).toBe(node(main, "A").id);
    // The original is untouched.
    expect(ws.graphs[mainId]).toEqual(dup.graphs[mainId]);
  });

  it("deletes a project with its sandboxes and switches to a neighbour", () => {
    const { ws, mainId, sandboxId } = withContent();
    const two = proj.createProject(ws, "Second");
    const back = proj.switchProject(two, proj.projectList(two)[0].id);
    const out = proj.deleteProject(back, back.projectId);
    expect(out.graphs[mainId]).toBeUndefined();
    expect(out.graphs[sandboxId]).toBeUndefined();
    expect(names(out)).toEqual(["Second"]);
    expect(out.activeId).toBe(out.projects[out.projectId].mainId);
    // Deleting a project that isn't current keeps the current one.
    const kept = proj.deleteProject(two, proj.projectList(two)[0].id);
    expect(kept.projectId).toBe(two.projectId);
    expect(kept.activeId).toBe(two.activeId);
  });

  it("deleting the last project leaves a fresh empty one", () => {
    const { ws } = withContent();
    const out = proj.deleteProject(ws, ws.projectId);
    expect(Object.keys(out.graphs)).toHaveLength(1);
    expect(out.projects[out.projectId]).toMatchObject({ name: "Untitled project", mainId: out.activeId });
  });

  it("imports a file as a new project with fresh graph ids", () => {
    const { ws, mainId, sandboxId } = withContent();
    const out = proj.importProject(ws, [ws.graphs[mainId], ws.graphs[sandboxId]], "First");
    expect(names(out)).toEqual(["First", "First 2"]);
    const [main, sb] = proj.projectGraphs(out, out.projects[out.projectId]);
    expect(main.id).not.toBe(mainId);
    expect(sb.parentId).toBe(main.id);
    expect(out.graphs[mainId]).toBe(ws.graphs[mainId]);
  });
});

describe("persisted state migration", () => {
  it("wraps a v1 state (one main graph + sandboxes) into one project without losing anything", () => {
    const { ws, mainId, sandboxId } = withContent();
    const v1 = JSON.parse(JSON.stringify({ graphs: ws.graphs, mainId, activeId: sandboxId }));
    const out = proj.migrateWorkspace(v1, 1);
    expect(Object.values(out.projects)).toEqual([expect.objectContaining({ name: "My brainstorm", mainId })]);
    expect(out.graphs).toEqual(v1.graphs);
    expect(out.activeId).toBe(sandboxId); // still in the sandbox the user had open
    expect(proj.projectGraphs(out, out.projects[out.projectId]).map((g) => g.id)).toEqual([mainId, sandboxId]);
  });

  it("gives stray root graphs their own project and repairs a dangling active id", () => {
    const a = ops.emptyGraph();
    const stray = { ...ops.emptyGraph("Orphan"), parentId: "gone" };
    const out = proj.migrateWorkspace({ graphs: { [a.id]: a, [stray.id]: stray }, mainId: a.id, activeId: "nope" }, 1);
    expect(names(out).sort()).toEqual(["My brainstorm", "Orphan"]);
    expect(out.graphs[stray.id].parentId).toBeUndefined();
    expect(out.activeId).toBe(out.projects[out.projectId].mainId);
  });

  it("starts fresh from an empty or missing v1 state", () => {
    const out = proj.migrateWorkspace(undefined, 0);
    expect(Object.keys(out.projects)).toHaveLength(1);
    expect(out.graphs[out.activeId].nodes).toEqual([]);
  });

  it("leaves a valid v2 state as it is", () => {
    const { ws } = withContent();
    const two = proj.createProject(ws, "Second");
    expect(proj.migrateWorkspace(JSON.parse(JSON.stringify(two)), 2)).toEqual(two);
  });
});

describe("example graph", () => {
  const g = buildExample(ops.emptyGraph(), EXAMPLES.groupTheory);
  const node = (n: string) => g.nodes.find((x) => x.name === n)!;

  it("builds every concept with links in both directions", () => {
    expect(g.nodes).toHaveLength(EXAMPLES.groupTheory.concepts.length);
    expect(node("Quotient group").dependsOn.sort()).toEqual([node("Group").id, node("Normal subgroup").id].sort());
    const deps = g.nodes.reduce((s, n) => s + n.dependsOn.length, 0);
    expect(g.relations.filter((r) => r.origin === "dependency")).toHaveLength(deps);
    for (const r of g.relations) expect(r.aToB.kind && r.bToA.kind && r.aToB.explanation && r.bToA.explanation).toBeTruthy();
    // It is a valid graph (what persistence and export expect).
    expect(() => GraphExport.parse({ format: "nodestorm/v1", graphs: [g] })).not.toThrow();
  });

  it("leaves exactly one concept blocked on a missing prerequisite", () => {
    const blocked = g.nodes.filter((n) => n.status === "blocked");
    expect(blocked.map((n) => n.name)).toEqual(["First Isomorphism Theorem"]);
    expect(blocked[0].missingDeps.map((d) => d.name)).toEqual(["Isomorphism"]);
    expect(g.nodes.filter((n) => n.status !== "blocked").every((n) => n.status === "ok")).toBe(true);
  });

  it("is laid out in layers without overlaps", () => {
    const layout = layeredLayout(g);
    for (const n of g.nodes) expect(n.position).toEqual(layout.get(n.id));
    expect(node("Group").position.y).toBeLessThan(node("Subgroup").position.y);
    const spots = new Set(g.nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(spots.size).toBe(g.nodes.length);
  });
});
