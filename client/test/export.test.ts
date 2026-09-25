import type { DepRole, Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { exportFileName, mdEscape, mermaidEscape, studyOrder, toMarkdown, toMermaid } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";

const dep = (name: string, role: DepRole, reason: string) => ({ name, role, reason, matchesExisting: null });

/** Theorem → Isomorphism → Homomorphism dependency chain (added in reverse order), plus one mixed relation. */
function scenario() {
  const thm = ops.addNode(ops.emptyGraph("Group theory"), { name: "First Isomorphism Theorem", definition: "G/ker φ ≅ im φ" });
  const iso = ops.addNode(thm.graph, { name: "Isomorphism", aliases: ["iso"], definition: "A bijective\nhomomorphism." });
  const hom = ops.addNode(iso.graph, { name: "Homomorphism", definition: "A structure-preserving map." });
  let g = ops.applyDeps(hom.graph, hom.id, []);
  g = ops.applyDeps(g, iso.id, [dep("Homomorphism", "uses", "is a special homomorphism")]);
  g = ops.applyDeps(g, thm.id, [dep("Isomorphism", "derives", "concludes an isomorphism"), dep("Homomorphism", "uses", "starts from φ")]);
  g = ops.upsertRelation(
    g,
    hom.id,
    iso.id,
    { kind: "generalizes", explanation: "every iso is a hom" },
    { kind: "specializes", explanation: "adds bijectivity" },
  );
  return { g, thm: thm.id, iso: iso.id, hom: hom.id };
}

describe("study order", () => {
  it("puts prerequisites before the concepts that need them", () => {
    expect(studyOrder(scenario().g).map((n) => n.name)).toEqual(["Homomorphism", "Isomorphism", "First Isomorphism Theorem"]);
  });

  it("keeps every node when there is a cycle", () => {
    const { g, hom, thm } = scenario();
    const cyclic: Graph = { ...g, nodes: g.nodes.map((n) => (n.id === hom ? { ...n, dependsOn: [thm] } : n)) };
    expect(studyOrder(cyclic)).toHaveLength(3);
  });
});

describe("markdown", () => {
  it("lists concepts with aliases, definitions and prerequisites in study order", () => {
    const md = toMarkdown(scenario().g);
    expect(md).toMatch(/^# Group theory\n/);
    expect(md).toContain("1. Homomorphism\n2. Isomorphism\n3. First Isomorphism Theorem");
    expect(md).toContain("### Isomorphism\n\n*Also:* iso\n\nA bijective homomorphism.");
    expect(md).toContain("**Prerequisites:** Homomorphism, Isomorphism");
  });

  it("describes each relation in both directions, leaving out a one-way relation's \"none\" side", () => {
    const md = toMarkdown(scenario().g);
    expect(md).toContain("- Homomorphism → Isomorphism: generalizes — every iso is a hom");
    expect(md).toContain("- Isomorphism → Homomorphism: specializes — adds bijectivity");
    expect(md).toContain("- First Isomorphism Theorem → Homomorphism: using — starts from φ");
    expect(md).not.toMatch(/: none\b/);
    expect(md).not.toMatch(/ by\b/);
  });

  it("escapes markdown syntax and newlines", () => {
    expect(mdEscape("a*b_[c](d)\n# e")).toBe("a\\*b\\_\\[c\\](d) # e");
    expect(mdEscape("# Title")).toBe("\\# Title");
    expect(mdEscape("1. first")).toBe("1\\. first");
    expect(mdEscape("<script>")).toBe("\\<script\\>");
    const g = ops.addNode(ops.emptyGraph("x"), { name: "- [ ] trick\nline", definition: "two\n\nparagraphs" }).graph;
    const md = toMarkdown(g);
    expect(md).toContain("### \\- \\[ \\] trick line");
    expect(md).toContain("\ntwo paragraphs\n");
  });

  it("includes a concept's explanation and the user's notes", () => {
    const { g, hom } = scenario();
    const withExtras = ops.updateNode(g, hom, {
      explanation: {
        summary: "Maps that keep the operation.",
        intuition: "Map, then combine = combine, then map.",
        keyPoints: ["φ(e) = e"],
        examples: [{ title: "exp", body: "e^(x+y) = eˣeʸ" }],
        pitfalls: ["Need not be injective"],
        furtherReading: [{ title: "An algebra textbook", hint: "chapter on homomorphisms" }],
        level: "rigorous",
        createdAt: 0,
      },
      notes: "# Ask\nwhy *kernels*?\n\nsee lecture 3",
    });
    const md = toMarkdown(withExtras);
    const section = md.slice(md.indexOf("### Homomorphism"), md.indexOf("### Isomorphism"));
    expect(section).toContain("#### Explanation (rigorous)\n\nMaps that keep the operation.\n");
    expect(section).toContain("*Intuition:* Map, then combine = combine, then map.");
    expect(section).toContain("**Key points:**\n\n- φ(e) = e\n");
    expect(section).toContain("**Examples:**\n\n- *exp*: e^(x+y) = eˣeʸ\n");
    expect(section).toContain("**Pitfalls:**\n\n- Need not be injective\n");
    expect(section).toContain("**Further reading:**\n\n- An algebra textbook — chapter on homomorphisms\n");
    // Notes keep their own Markdown, quoted so a heading in them stays inside the concept.
    expect(section).toContain("**My notes:**\n\n> # Ask\n> why *kernels*?\n>\n> see lecture 3\n");
    expect(toMarkdown(g)).not.toMatch(/Explanation|My notes/);
  });

  it("handles an empty graph", () => {
    expect(toMarkdown(ops.emptyGraph("Empty"))).toContain("No concepts yet");
  });
});

describe("mermaid", () => {
  it("emits a flowchart with generated ids and one arrow per relation direction", () => {
    const mm = toMermaid(scenario().g);
    expect(mm.startsWith("flowchart LR\n")).toBe(true);
    expect(mm).toContain('n2["Homomorphism"]');
    expect(mm).toContain('n2 -->|"generalizes"| n1');
    expect(mm).toContain('n1 -->|"specializes"| n2');
    expect(mm).toContain('n0 -.->|"deriving"| n1'); // dependency relations are dotted, one way
    expect(mm).not.toContain('n1 -.->');
    expect(mm).not.toContain('"none"');
  });

  it("escapes quotes, brackets, newlines and entity syntax in labels", () => {
    expect(mermaidEscape('say "hi" [x] (y) {z} a|b')).toBe("say #quot;hi#quot; #91;x#93; #40;y#41; #123;z#125; a#124;b");
    expect(mermaidEscape("a\nb\r\n c")).toBe("a b c");
    expect(mermaidEscape("#quot; <b>; `x`")).toBe("#35;quot#59; #lt;b#gt;#59; #96;x#96;");
    const g = ops.addNode(ops.emptyGraph(), { name: 'Evil"]\nclick n0 "js' }).graph;
    const mm = toMermaid(g);
    expect(mm.trimEnd().split("\n")).toHaveLength(2); // header + one node line
    expect(mm).toContain('n0["Evil#quot;#93; click n0 #quot;js"]');
  });

  it("skips relations to missing nodes", () => {
    const { g } = scenario();
    const broken: Graph = { ...g, relations: [...g.relations, { ...g.relations[0], id: "x", b: "gone" }] };
    expect(toMermaid(broken)).toBe(toMermaid(g));
  });
});

it("builds a safe file name", () => {
  expect(exportFileName(ops.emptyGraph("Sandbox 2: Rings!"), new Date("2026-01-02T00:00:00Z"))).toBe(
    "nodestorm-sandbox-2-rings-2026-01-02",
  );
});
