import type { Graph, NodePapers } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPapers } from "../src/lib/actions";
import { toMarkdown } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { texUrl, toLatex } from "../src/lib/latex";
import { packGraph } from "../src/lib/share";
import { useGraphStore } from "../src/store/graphStore";

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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const WORKS = [
  {
    id: "https://openalex.org/W1",
    doi: "https://doi.org/10.1000/ker",
    display_name: "Kernels of group homomorphisms",
    publication_year: 1974,
    authorships: [{ author: { display_name: "Ann Author" } }],
    primary_location: { source: { display_name: "Journal of Algebra" } },
    cited_by_count: 34,
    open_access: { oa_url: "https://arxiv.org/abs/1" },
  },
];

let filters: string[] = [];
let answer: () => Response = () => json({ results: WORKS });
const realFetch = globalThis.fetch;
beforeEach(() => {
  filters = [];
  answer = () => json({ results: WORKS });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.openalex.org") return realFetch(input, init);
    filters.push(url.searchParams.get("filter")!);
    return answer();
  }) as typeof fetch;
  store().reset();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** "Group homomorphism", and "Kernel" depending on it. */
function kernelGraph(): string {
  let id = "";
  store().mutate((g) => {
    const hom = ops.addNode(g, { name: "Group homomorphism" });
    const ker = ops.addNode(hom.graph, { name: "Kernel", definition: "Elements sent to the identity." });
    id = ker.id;
    return ops.link(ker.graph, ker.id, hom.id, "uses", "defined on one");
  });
  return id;
}

const papers: NodePapers = {
  works: [
    {
      id: "W1",
      title: "The $L^p$ spaces [revisited] & 100% more_",
      year: 1974,
      authors: "Ann Author, Bo Builder",
      venue: "Journal of Algebra",
      doi: "10.1000/ker",
      url: "https://doi.org/10.1000/a%b#c",
      citedBy: 34,
      openAccessUrl: "https://arxiv.org/abs/(1)",
    },
  ],
  query: '"kernel"',
  checkedAt: 1,
};

describe("Find papers", () => {
  it("stores what OpenAlex lists, searched with the concept's prerequisites, not as an undo step", async () => {
    const id = kernelGraph();
    await findPapers(id);
    expect(filters[0]).toContain('title_and_abstract.search:"kernel" AND ("group homomorphism")');
    const p = graph().nodes.find((n) => n.id === id)!.papers!;
    expect(p.works).toEqual([
      {
        id: "W1",
        title: "Kernels of group homomorphisms",
        year: 1974,
        authors: "Ann Author",
        venue: "Journal of Algebra",
        doi: "10.1000/ker",
        url: "https://doi.org/10.1000/ker",
        citedBy: 34,
        openAccessUrl: "https://arxiv.org/abs/1",
      },
    ]);
    expect(p.checkedAt).toBeGreaterThan(0);
    store().undo(); // undoes the link and adds, not the lookup result alone
    expect(graph().nodes).toHaveLength(0);
    store().redo();
    expect(graph().nodes.find((n) => n.id === id)!.papers?.works).toHaveLength(1);
  });

  it("says so when nothing is found, and names a spent daily allowance", async () => {
    answer = () => json({ results: [] });
    const id = kernelGraph();
    await findPapers(id);
    expect(graph().nodes.find((n) => n.id === id)!.papers).toMatchObject({ works: [] });
    expect(store().toast).toMatch(/No papers found on OpenAlex for “Kernel”/);
    answer = () => json({ error: "Rate limit exceeded" }, 429);
    await findPapers(id);
    expect(store().toast).toMatch(/free daily allowance/);
    answer = () => new Response("<html>down</html>", { status: 503, headers: { "content-type": "text/html" } });
    await findPapers(id);
    expect(store().toast).toMatch(/OpenAlex could not be reached/);
  });
});

describe("Stored papers", () => {
  const withPapers = () => {
    const g = ops.addNode(ops.emptyGraph(), { name: "Kernel" }).graph;
    return ops.updateNode(g, g.nodes[0].id, { papers });
  };

  it("travel in JSON exports; malformed ones and non-https links are dropped by import repair", () => {
    const g = withPapers();
    expect(repairImport({ format: "nodestorm/v1", graphs: [g] }).doc.graphs[0].nodes[0].papers).toEqual(papers);
    const bad = (p: unknown) => repairImport({ format: "nodestorm/v1", graphs: [{ ...g, nodes: [{ ...g.nodes[0], papers: p }] }] });
    const r = bad({ works: "x" });
    expect(r.doc.graphs[0].nodes[0].papers).toBeUndefined();
    expect(r.fixes.join(" ")).toMatch(/paper lists/);
    const js = { ...papers, works: [{ ...papers.works[0], url: "javascript:alert(1)" }] };
    expect(bad(js).doc.graphs[0].nodes[0].papers).toBeUndefined();
    expect(bad({ ...papers, works: [{ ...papers.works[0], openAccessUrl: "http://x.org" }] }).doc.graphs[0].nodes[0].papers).toBeUndefined();
  });

  it("stay out of share links", () => {
    const packed = packGraph(withPapers(), "P") as { graphs: { nodes: Record<string, unknown>[] }[] };
    expect(packed.graphs[0].nodes[0].papers).toBeUndefined();
  });

  it("keep the newer list when a sandbox is merged back", () => {
    const parent = withPapers();
    const id = parent.nodes[0].id;
    const sb = ops.updateNode(ops.fork(parent, "S"), id, { papers: { ...papers, works: [], checkedAt: 9 } });
    expect(ops.merge(parent, sb).nodes[0].papers?.checkedAt).toBe(9);
    expect(ops.merge(sb, ops.fork(parent, "S")).nodes[0].papers?.checkedAt).toBe(9);
  });

  it("are listed in the Markdown export, escaped, with links that can't break out", () => {
    const md = toMarkdown(withPapers());
    expect(md).toContain("**Further reading** (from OpenAlex):");
    expect(md).toContain(
      "- [The $L^p$ spaces \\[revisited\\] & 100% more\\_](https://doi.org/10.1000/a%b#c) — Ann Author, Bo Builder, 1974, Journal of Algebra. Cited by 34. [Free copy](https://arxiv.org/abs/%281%29)",
    );
  });

  it("become a Further reading remark in the LaTeX export, escaped", () => {
    const tex = toLatex(withPapers());
    expect(tex).toContain("\\begin{remark}[Further reading]");
    expect(tex).toContain(
      "\\item \\href{https://doi.org/10.1000/a\\%b\\#c}{\\emph{The $L^p$ spaces [revisited] \\& 100\\% more\\_}}, Ann Author, Bo Builder, 1974, Journal of Algebra.",
    );
    expect(texUrl("https://x.org/a b{c}\\d")).toBe("https://x.org/a\\%20b\\%7Bc\\%7D\\%5Cd");
    // Without papers, no remark.
    expect(toLatex(ops.addNode(ops.emptyGraph(), { name: "Kernel" }).graph)).not.toContain("Further reading");
  });
});
