import type { Graph } from "@nodestorm/shared";
import { t } from "../i18n";
import { emptyGraph, uid } from "./graphOps";

/**
 * Pure project operations. A project is one independent brainstorm: a main graph plus the sandboxes forked
 * from it. All graphs of all projects live in one flat map (so AI calls can keep addressing a graph by id);
 * a graph belongs to the project whose main graph it descends from via `parentId`.
 */

export interface Project {
  id: string;
  name: string;
  /** The project's root graph ("Main graph"). */
  mainId: string;
  createdAt: number;
}

/** The persisted part of the store. */
export interface Workspace {
  graphs: Record<string, Graph>;
  projects: Record<string, Project>;
  projectId: string;
  activeId: string;
}

export const DEFAULT_PROJECT_NAME = "Untitled project";

/** Id of the root graph `graphId` descends from (itself for a main graph). Stops on broken or cyclic links. */
export function rootOf(graphs: Record<string, Graph>, graphId: string): string {
  let id = graphId;
  const seen = new Set<string>();
  while (graphs[id]?.parentId && graphs[graphs[id].parentId!] && !seen.has(id)) {
    seen.add(id);
    id = graphs[id].parentId!;
  }
  return id;
}

/** The project's graphs: main graph first, then its sandboxes in creation order. */
export function projectGraphs(ws: Pick<Workspace, "graphs">, project: Project): Graph[] {
  const main = ws.graphs[project.mainId];
  const sandboxes = Object.values(ws.graphs).filter((g) => g.id !== project.mainId && rootOf(ws.graphs, g.id) === project.mainId);
  return main ? [main, ...sandboxes] : sandboxes;
}

/** Projects in creation order (the switcher's order). */
export function projectList(ws: Pick<Workspace, "projects">): Project[] {
  return Object.values(ws.projects).sort((a, b) => a.createdAt - b.createdAt);
}

/** "Untitled project", "Untitled project 2", … (or `base 2` etc.): the first name no project uses yet. */
export function uniqueProjectName(ws: Pick<Workspace, "projects">, base = DEFAULT_PROJECT_NAME): string {
  const taken = new Set(Object.values(ws.projects).map((p) => p.name.trim().toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Creation time strictly after every existing project, so the new one sorts last even within one millisecond. */
const nextCreatedAt = (ws: Pick<Workspace, "projects">) =>
  Math.max(Date.now(), ...Object.values(ws.projects).map((p) => p.createdAt + 1));

function newProject(ws: Pick<Workspace, "projects">, name: string, mainId: string): Project {
  return { id: uid("p"), name, mainId, createdAt: nextCreatedAt(ws) };
}

/** Add an empty project and switch to it. */
export function createProject(ws: Workspace, name?: string): Workspace {
  const main = emptyGraph();
  const p = newProject(ws, name?.trim() || uniqueProjectName(ws), main.id);
  return { graphs: { ...ws.graphs, [main.id]: main }, projects: { ...ws.projects, [p.id]: p }, projectId: p.id, activeId: main.id };
}

/** Rename a project. Blank names are ignored. */
export function renameProject(ws: Workspace, projectId: string, name: string): Workspace {
  const p = ws.projects[projectId];
  const clean = name.trim();
  if (!p || !clean || clean === p.name) return ws;
  return { ...ws, projects: { ...ws.projects, [projectId]: { ...p, name: clean } } };
}

/**
 * Copy graphs with fresh graph, node and relation ids. One id map is shared by all the copies, so sandboxes
 * still match their parent's nodes on merge-back, and parent links point at the copied parents.
 * Returns the copies in input order and the old→new graph id map.
 */
export function cloneGraphs(list: Graph[]): { graphs: Graph[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const fresh = (prefix: string, old: string) => {
    if (!ids.has(old)) ids.set(old, uid(prefix));
    return ids.get(old)!;
  };
  for (const g of list) fresh("g", g.id);
  const graphs = list.map((src) => {
    const g: Graph = structuredClone(src);
    for (const n of g.nodes) {
      n.id = fresh("n", n.id);
      n.dependsOn = n.dependsOn.map((d) => fresh("n", d));
      // A running check keeps updating the original; the copy (fresh ids) would wait for it forever.
      if (n.status === "checking") {
        n.status = "error";
        n.error = t("task.copyInterrupted");
      }
    }
    for (const r of g.relations) {
      r.id = fresh("r", r.id);
      r.a = fresh("n", r.a);
      r.b = fresh("n", r.b);
    }
    return { ...g, id: ids.get(src.id)!, parentId: src.parentId && ids.get(src.parentId) };
  });
  // A parent outside the copied set can't be followed; drop the link rather than point at another project.
  for (const g of graphs) if (g.parentId === undefined) delete g.parentId;
  return { graphs, ids };
}

/** Copy a project (main graph and sandboxes, all with fresh ids) and switch to the copy. */
export function duplicateProject(ws: Workspace, projectId: string, name?: string): Workspace {
  const p = ws.projects[projectId];
  if (!p) return ws;
  const { graphs, ids } = cloneGraphs(projectGraphs(ws, p));
  const copy = newProject(ws, name?.trim() || uniqueProjectName(ws, `${p.name} (copy)`), ids.get(p.mainId)!);
  return {
    graphs: { ...ws.graphs, ...Object.fromEntries(graphs.map((g) => [g.id, g])) },
    projects: { ...ws.projects, [copy.id]: copy },
    projectId: copy.id,
    activeId: copy.mainId,
  };
}

/**
 * Delete a project and all its graphs. Deleting the current project switches to the nearest remaining one;
 * deleting the only project leaves a fresh empty one, so there is always something to work in.
 */
export function deleteProject(ws: Workspace, projectId: string): Workspace {
  const p = ws.projects[projectId];
  if (!p) return ws;
  const gone = new Set(projectGraphs(ws, p).map((g) => g.id));
  const graphs = Object.fromEntries(Object.entries(ws.graphs).filter(([id]) => !gone.has(id)));
  const order = projectList(ws);
  const projects = { ...ws.projects };
  delete projects[projectId];
  const rest: Workspace = { ...ws, graphs, projects };
  if (!Object.keys(projects).length) return createProject({ ...rest, projects: {} });
  if (ws.projectId !== projectId) return rest;
  const i = order.findIndex((x) => x.id === projectId);
  const next = order[i + 1] ?? order[i - 1];
  return { ...rest, projectId: next.id, activeId: next.mainId };
}

/** Switch to a project, opening its main graph. */
export function switchProject(ws: Workspace, projectId: string): Workspace {
  const p = ws.projects[projectId];
  if (!p || projectId === ws.projectId) return ws;
  return { ...ws, projectId, activeId: p.mainId };
}

/**
 * Add imported graphs (main first, as repairImport returns them) as a new project and switch to it.
 * Ids are always refreshed, so importing a file exported from this browser never collides with what's here.
 */
export function importProject(ws: Workspace, imported: Graph[], name?: string): Workspace {
  const { graphs, ids } = cloneGraphs(imported);
  const main = graphs[0];
  const p = newProject(ws, uniqueProjectName(ws, name?.trim() || main.name.trim() || t("project.imported")), ids.get(imported[0].id)!);
  return {
    graphs: { ...ws.graphs, ...Object.fromEntries(graphs.map((g) => [g.id, g])) },
    projects: { ...ws.projects, [p.id]: p },
    projectId: p.id,
    activeId: main.id,
  };
}

/**
 * Make sure the workspace is consistent: every graph belongs to a project (root graphs without one get their
 * own), and the current project and active graph exist and match. Never drops a graph.
 */
export function normalizeWorkspace(ws: Workspace): Workspace {
  const graphs = { ...ws.graphs };
  const projects = { ...ws.projects };
  // Projects whose main graph is gone are dropped (they have nothing left to show).
  for (const p of Object.values(projects)) if (!graphs[p.mainId] || graphs[p.mainId].parentId) delete projects[p.id];
  const owned = new Set(Object.values(projects).map((p) => p.mainId));
  let out: Workspace = { ...ws, graphs, projects };
  for (const g of Object.values(graphs)) {
    if (rootOf(graphs, g.id) !== g.id || owned.has(g.id)) continue;
    // A root graph without a project: either a real main graph or a sandbox whose parent chain is broken.
    if (g.parentId) {
      const { parentId: _broken, ...root } = g;
      graphs[g.id] = root;
    }
    const p = newProject(out, uniqueProjectName(out, g.parentId ? g.name : "My brainstorm"), g.id);
    projects[p.id] = p;
    owned.add(g.id);
    out = { ...out, projects };
  }
  if (!Object.keys(projects).length) return createProject(out, "My brainstorm");
  const active = graphs[ws.activeId] ? rootOf(graphs, ws.activeId) : undefined;
  const current = Object.values(projects).find((p) => p.mainId === active);
  if (current) return { ...out, projectId: current.id };
  const fallback = projects[ws.projectId] ?? projectList(out)[0];
  return { ...out, projectId: fallback.id, activeId: fallback.mainId };
}

/**
 * Persisted-state migration (zustand `persist` version). v1 held one brainstorm: `{ graphs, mainId, activeId }`.
 * v2 wraps it in a project named "My brainstorm" (any other root graphs get projects of their own).
 */
export function migrateWorkspace(persisted: unknown, version: number): Workspace {
  const s = (persisted ?? {}) as Partial<Workspace> & { mainId?: string };
  const graphs = s.graphs && typeof s.graphs === "object" ? s.graphs : {};
  if (version < 2) {
    const projects: Record<string, Project> = {};
    const main = s.mainId && graphs[s.mainId] && !graphs[s.mainId].parentId ? s.mainId : undefined;
    if (main) {
      const p: Project = { id: uid("p"), name: "My brainstorm", mainId: main, createdAt: Date.now() };
      projects[p.id] = p;
    }
    return normalizeWorkspace({ graphs, projects, projectId: Object.keys(projects)[0] ?? "", activeId: s.activeId ?? main ?? "" });
  }
  return normalizeWorkspace({ graphs, projects: s.projects ?? {}, projectId: s.projectId ?? "", activeId: s.activeId ?? "" });
}
