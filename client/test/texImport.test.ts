import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyExtraction } from "../src/lib/extract";
import * as ops from "../src/lib/graphOps";
import { parseTexResults, refsIn, stripComments, texReview, texToText, theoremEnvs } from "../src/lib/texImport";

const paper = readFileSync(new URL("../../e2e/fixtures/homomorphisms.tex", import.meta.url), "utf8");

describe("LaTeX import", () => {
  it("reads \\newtheorem declarations and ignores comments", () => {
    const envs = theoremEnvs(stripComments(paper));
    expect(Object.fromEntries(envs)).toMatchObject({ thm: "Theorem", lem: "Lemma", defn: "Definition", rem: "Remark" });
    expect(stripComments("a 50\\% b % gone\nc")).toBe("a 50\\% b \nc");
  });

  it("finds every result with its kind, title, labels and references (statement and proof)", () => {
    const rs = parseTexResults(paper);
    expect(rs.map((r) => [r.heading, r.number, r.kind, r.title ?? null, r.labels])).toEqual([
      ["Definition", 1, "definition", null, ["def:hom"]],
      ["Definition", 2, "definition", "Kernel", ["def:ker"]],
      ["Lemma", 1, "lemma", null, ["lem:normal"]],
      ["Theorem", 1, "theorem", "First Isomorphism Theorem", ["thm:first", "eq:iso"]],
      ["Remark", 1, "other", null, []],
    ]);
    expect(rs[2].refs).toEqual(["def:ker"]); // from its proof
    expect(rs[3].refs).toEqual(["lem:normal", "def:hom", "def:ker"]);
    expect(rs[0].terms).toEqual(["homomorphism"]);
  });

  it("turns LaTeX into text with $…$ maths, leaving the maths alone", () => {
    expect(texToText("A \\emph{group} is~$G$ (see~\\ref{x}), 50\\% done \\cite{k}.", (l) => (l === "x" ? "Definition 1" : undefined))).toBe(
      "A group is $G$ (see Definition 1), 50% done.",
    );
    expect(texToText("Then \\[ a \\\\ b \\text{ ok} \\] and \\(x\\).")).toBe("Then\n$$a \\\\ b \\text{ ok}$$\nand $x$.");
    expect(texToText("\\begin{align} a &= b \\label{e} \\\\ c &= d \\end{align}")).toBe("$$\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}$$");
    expect(refsIn("\\cref{a, b} and \\eqref{c}")).toEqual(["a", "b", "c"]);
  });

  it("builds an Extract review: names, links from references, optional mention links", () => {
    const r = texReview(paper);
    expect(r.title).toBe("Notes on Group Homomorphisms");
    expect(r.items.map((i) => [i.name, i.kind])).toEqual([
      ["Homomorphism", "definition"],
      ["Kernel", "definition"],
      ["Lemma 1 (Notes on Group Homomorphisms)", "lemma"],
      ["First Isomorphism Theorem", "theorem"],
      ["Remark 1 (Notes on Group Homomorphisms)", "other"],
    ]);
    expect(r.items[1].definition).toBe("The kernel of a homomorphism $\\varphi$ (Homomorphism) is $\\ker\\varphi = \\{g \\in G : \\varphi(g) = e_H\\}$.");
    expect(r.items[0].definition).toBe("Let $G$ and $H$ be groups. A homomorphism is a map $\\varphi\\colon G \\to H$ with\n$$\\varphi(ab) = \\varphi(a)\\varphi(b) \\quad\\text{for all } a, b \\in G.$$");
    expect(r.links.map((l) => `${l.from} -> ${l.to}`)).toEqual([
      "Kernel -> Homomorphism",
      "Lemma 1 (Notes on Group Homomorphisms) -> Kernel",
      "First Isomorphism Theorem -> Lemma 1 (Notes on Group Homomorphisms)",
      "First Isomorphism Theorem -> Homomorphism",
      "First Isomorphism Theorem -> Kernel",
    ]);
    const withMentions = texReview(paper, { mentions: true });
    const extra = withMentions.links.filter((l) => !l.include).map((l) => `${l.from} -> ${l.to}`);
    expect(extra).toEqual(["Lemma 1 (Notes on Group Homomorphisms) -> Homomorphism", "Remark 1 (Notes on Group Homomorphisms) -> Homomorphism", "Remark 1 (Notes on Group Homomorphisms) -> Kernel"]);
  });

  it("goes into the graph as concepts with kinds and prerequisites", () => {
    const { graph, added } = applyExtraction(ops.emptyGraph(), texReview(paper));
    expect(added).toHaveLength(5);
    const byName = (n: string) => graph.nodes.find((x) => x.name === n)!;
    expect(byName("First Isomorphism Theorem").kind).toBe("theorem");
    expect(byName("First Isomorphism Theorem").dependsOn.map((id) => graph.nodes.find((n) => n.id === id)!.name).sort()).toEqual([
      "Homomorphism",
      "Kernel",
      "Lemma 1 (Notes on Group Homomorphisms)",
    ]);
  });

  it("copes with no theorem environments and with duplicate titles", () => {
    expect(texReview("\\begin{document}Hello\\end{document}").items).toEqual([]);
    const dup = texReview("\\begin{theorem}[Main]A\\end{theorem}\\begin{theorem}[Main]B\\end{theorem}");
    expect(dup.items.map((i) => i.name)).toEqual(["Main", "Main (Theorem 2)"]);
    // Names the graph would take for the same concept count as repeats too.
    expect(texReview("\\begin{theorem}[Main]A\\end{theorem}\\begin{theorem}[Main.]B\\end{theorem}").items.map((i) => i.name)).toEqual(["Main", "Main. (Theorem 2)"]);
  });

  it("handles braced titles, thmtools, \\\\[2pt] in maths, p-groups, and untitled results of a titled paper", () => {
    const r = texReview(
      [
        "\\title{Short}",
        "\\declaretheorem[name=Theorem, numberwithin=section]{thm}",
        "\\begin{thm}[{Hahn--Banach}]Holds.\\end{thm}",
        "\\begin{definition}A \\emph{$p$-group} is a group of order $p^n$.\\end{definition}",
        "\\begin{lemma}\\begin{align} a &= b \\\\[2pt] c &= d \\end{align}\\end{lemma}",
      ].join("\n"),
    );
    expect(r.items.map((i) => [i.name, i.kind])).toEqual([
      ["Hahn–Banach", "theorem"],
      ["P-group", "definition"],
      ["Lemma 1 (Short)", "lemma"],
    ]);
    expect(r.items[2].definition).toBe("$$\\begin{aligned}a &= b \\\\[2pt] c &= d\\end{aligned}$$");
  });
});
