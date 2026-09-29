import { ConceptKind, DepRole, DirRel, type ConceptNode, type Graph } from "@nodestorm/shared";
import groupTheory from "../data/groupTheory.json";
import groupTheoryZh from "../data/groupTheory.zh.json";
import type { Lang } from "../i18n";
import { depRelation, setPositions, uid, upsertRelation } from "./graphOps";
import { layeredLayout } from "./layout";

/**
 * Ready-made example graphs, built offline from static data (no AI call). Concepts are already checked:
 * their prerequisites are linked, and one is left blocked on a missing prerequisite to show the install flow.
 */

interface ExampleDep {
  name: string;
  role: string;
  reason: string;
}

export interface ExampleData {
  name: string;
  /** The site every definition is credited to ("NodeStorm example"): written for the example, with no page to link. */
  source?: string;
  concepts: { name: string; kind?: string; definition: string; aliases: string[]; dependsOn?: ExampleDep[]; missing?: ExampleDep[] }[];
  relations: { a: string; b: string; aToB: DirRel; bToA: DirRel }[];
}

export const EXAMPLES = { groupTheory: groupTheory as ExampleData };

/** The example written in each interface language: same concepts, prerequisites and relations, in the same order. */
export const EXAMPLES_BY_LANG: Record<Lang, typeof EXAMPLES> = {
  en: EXAMPLES,
  zh: { groupTheory: groupTheoryZh as ExampleData },
};

/** Build the example's concepts and relations into `g` (normally empty), laid out in layers. */
export function buildExample(g: Graph, data: ExampleData): Graph {
  const ids = new Map(data.concepts.map((c) => [c.name, uid("n")]));
  const id = (name: string) => {
    const found = ids.get(name);
    if (!found) throw new Error(`Example "${data.name}" refers to unknown concept "${name}"`);
    return found;
  };
  const nodes: ConceptNode[] = data.concepts.map((c) => {
    const missingDeps = (c.missing ?? []).map((d) => ({ ...d, role: DepRole.parse(d.role) }));
    return {
      id: id(c.name),
      name: c.name,
      definition: c.definition,
      aliases: c.aliases,
      status: missingDeps.length ? "blocked" : "ok",
      position: { x: 0, y: 0 },
      dependsOn: (c.dependsOn ?? []).map((d) => id(d.name)),
      missingDeps,
      ...(c.kind ? { kind: ConceptKind.parse(c.kind) } : {}),
      ...(data.source ? { source: { site: data.source, title: "" } } : {}),
    };
  });
  let out: Graph = { ...g, nodes: [...g.nodes, ...nodes] };
  // Dependency edges (dashed), described in both directions like the ones the AI check creates.
  for (const c of data.concepts) {
    for (const d of c.dependsOn ?? []) {
      const dependent = out.nodes.find((n) => n.id === id(c.name))!;
      const prereq = out.nodes.find((n) => n.id === id(d.name))!;
      const rel = depRelation(dependent, prereq, DepRole.parse(d.role), d.reason);
      out = upsertRelation(out, dependent.id, prereq.id, rel.aToB, rel.bToA, "dependency");
    }
  }
  for (const r of data.relations) out = upsertRelation(out, id(r.a), id(r.b), DirRel.parse(r.aToB), DirRel.parse(r.bToA), "mix");
  return setPositions(out, layeredLayout(out));
}
