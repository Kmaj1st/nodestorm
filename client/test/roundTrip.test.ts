import { findByName, normalizeName, type Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { sourceLabel, toMarkdown } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { wikiBase, wikiName } from "../src/lib/mediawiki";
import { decodeShare, encodeShare } from "../src/lib/share";

const node = (id: string, name: string, extra: Partial<Graph["nodes"][number]> = {}): Graph["nodes"][number] => ({
  id,
  name,
  definition: "",
  aliases: [],
  status: "ok",
  position: { x: 0, y: 0 },
  dependsOn: [],
  missingDeps: [],
  ...extra,
});

const wiki = { site: "Wikipedia", title: "Kernel (algebra)", url: "https://en.wikipedia.org/wiki/Kernel_(algebra)" };
const unclear = node("k", "Kernel", {
  status: "unclear",
  senses: [
    { name: "Kernel (algebra)", domain: "algebra", definition: "Preimage of the identity.", source: wiki, kind: "definition" },
    { name: "Kernel (OS)", domain: "computing", definition: "Core of an OS.", source: { site: "AI", title: "Demo · mock" }, kind: null },
  ],
});
const needsDefinition = node("n", "Frobenius", { status: "unclear" });
const doc = (nodes: Graph["nodes"]) => ({ format: "nodestorm/v1", graphs: [{ id: "g", name: "Main", nodes, relations: [] }] });

describe("meanings to choose from survive import and share links", () => {
  it("keeps each sense's source and kind on import", () => {
    const out = repairImport(doc([unclear]));
    expect(out.doc.graphs[0].nodes[0].senses).toEqual(unclear.senses);
    expect(out.fixes).toEqual([]);
  });

  it("keeps them through a share link", async () => {
    const g: Graph = { id: "g", name: "Main", nodes: [unclear], relations: [] };
    const out = await decodeShare(await encodeShare(g, "P"));
    expect(out.graph.nodes[0].senses).toEqual(unclear.senses);
  });

  it("drops a malformed sense source rather than the sense", () => {
    const out = repairImport(doc([node("k", "Kernel", { status: "unclear", senses: [{ name: "K", domain: "", definition: "d", source: { title: "x", url: "javascript:alert(1)" }, kind: "Theorem" } as never] })]));
    const [s] = out.doc.graphs[0].nodes[0].senses!;
    expect(s.source).toBeUndefined();
    expect(s.kind).toBe("theorem");
  });
});

describe('"needs a definition" survives import and share links', () => {
  it("keeps an unclear concept without meanings unclear on import", () => {
    expect(repairImport(doc([needsDefinition])).doc.graphs[0].nodes[0].status).toBe("unclear");
  });

  it("keeps it through a share link", async () => {
    const g: Graph = { id: "g", name: "Main", nodes: [needsDefinition], relations: [] };
    expect((await decodeShare(await encodeShare(g, "P"))).graph.nodes[0].status).toBe("unclear");
  });

  it("an empty sense list still reads as needing a definition", () => {
    expect(repairImport(doc([{ ...needsDefinition, senses: [] }])).doc.graphs[0].nodes[0].status).toBe("unclear");
  });
});

describe("share links don't claim an interrupted check passed", () => {
  it("a running or failed check without missing prerequisites becomes 'not checked' (or 'needs a definition')", async () => {
    const g: Graph = {
      id: "g",
      name: "Main",
      nodes: [
        node("a", "A", { status: "checking", definition: "An A." }),
        node("b", "B", { status: "error", error: "timeout", definition: "A B." }),
        node("c", "C", { status: "checking" }),
      ],
      relations: [],
    };
    const out = await decodeShare(await encodeShare(g, "P"));
    expect(out.graph.nodes.map((n) => n.status)).toEqual(["pending", "pending", "unclear"]);
  });
});

describe("pending, pinned, kindByUser and source survive a JSON export/import round trip", () => {
  it("round-trips them unchanged", () => {
    const n = node("a", "A", {
      status: "pending",
      definition: "d",
      pinned: true,
      kind: "lemma",
      kindByUser: true,
      source: wiki,
    });
    const out = repairImport(JSON.parse(JSON.stringify(doc([n]))));
    expect(out.fixes).toEqual([]);
    expect(out.doc.graphs[0].nodes[0]).toEqual(n);
  });
});

describe("symbol-only concept names", () => {
  it("are matched by name, so they aren't added twice", () => {
    const a = ops.addNode(ops.emptyGraph(), { name: "∇" });
    const b = ops.addNode(a.graph, { name: "∇" });
    expect(b.existed).toBe(true);
    expect(b.graph.nodes).toHaveLength(1);
    expect(findByName(b.graph.nodes, "∫")).toBeUndefined();
  });

  it("are told apart from each other as prerequisites", () => {
    const self = ops.addNode(ops.emptyGraph(), { name: "∇", definition: "Gradient" });
    const g = ops.applyDeps(self.graph, self.id, [
      { name: "∂", role: "uses", reason: "partials", matchesExisting: null },
      { name: "∑", role: "uses", reason: "sums", matchesExisting: null },
    ]);
    expect(g.nodes[0].missingDeps.map((d) => d.name)).toEqual(["∂", "∑"]);
  });

  it("still normalise punctuation-only names to nothing", () => {
    expect(normalizeName("!!!")).toBe("");
    expect(normalizeName("  - ")).toBe("");
    expect(normalizeName("Group!")).toBe("group");
  });
});

describe("a community wiki's source survives import", () => {
  it("keeps the source of a Fandom wiki with a long name", () => {
    const name = wikiName("fandom", "a".repeat(61));
    expect(name).toHaveLength(61); // Settings accepts it
    const base = wikiBase({ site: "fandom", wiki: name })!;
    const source = { site: base.label, title: "Creeper", url: base.page("Creeper") };
    const out = repairImport(doc([node("a", "Creeper", { definition: "d", source })]));
    expect(out.doc.graphs[0].nodes[0].source).toEqual(source);
  });
});

describe("Markdown export of a looked-up source", () => {
  it("names the site and links the page", () => {
    const g: Graph = { id: "g", name: "M", nodes: [node("a", "Kernel", { definition: "d", source: wiki })], relations: [] };
    expect(toMarkdown(g)).toContain("*Source:* [Wikipedia: Kernel (algebra)](https://en.wikipedia.org/wiki/Kernel_%28algebra%29)");
    expect(sourceLabel({ site: "Wikidata", title: "Q1", url: "https://www.wikidata.org/wiki/Q1" })).toBe("Wikidata: Q1");
    expect(sourceLabel({ title: "Notes.pdf", page: 3 })).toBe("Notes.pdf, p. 3");
  });
});
