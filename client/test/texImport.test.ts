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
      // One shared counter, numbered within sections, as the paper prints them; \newtheorem* is unnumbered.
      ["Definition", "1.1", "definition", null, ["def:hom"]],
      ["Definition", "1.2", "definition", "Kernel", ["def:ker"]],
      ["Lemma", "1.3", "lemma", null, ["lem:normal"]],
      ["Theorem", "1.4", "theorem", "First Isomorphism Theorem", ["thm:first", "eq:iso"]],
      ["Remark", "", "other", null, []],
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
      ["Lemma 1.3 (Notes on Group Homomorphisms)", "lemma"],
      ["First Isomorphism Theorem", "theorem"],
      ["Remark (Notes on Group Homomorphisms)", "other"],
    ]);
    expect(r.items[1].definition).toBe("The kernel of a homomorphism $\\varphi$ (Homomorphism) is $\\ker\\varphi = \\{g \\in G : \\varphi(g) = e_H\\}$.");
    expect(r.items[0].definition).toBe("Let $G$ and $H$ be groups. A homomorphism is a map $\\varphi\\colon G \\to H$ with\n$$\\varphi(ab) = \\varphi(a)\\varphi(b) \\quad\\text{for all } a, b \\in G.$$");
    expect(r.links.map((l) => `${l.from} -> ${l.to}`)).toEqual([
      "Kernel -> Homomorphism",
      "Lemma 1.3 (Notes on Group Homomorphisms) -> Kernel",
      "First Isomorphism Theorem -> Lemma 1.3 (Notes on Group Homomorphisms)",
      "First Isomorphism Theorem -> Homomorphism",
      "First Isomorphism Theorem -> Kernel",
    ]);
    const withMentions = texReview(paper, { mentions: true });
    const extra = withMentions.links.filter((l) => !l.include).map((l) => `${l.from} -> ${l.to}`);
    expect(extra).toEqual(["Lemma 1.3 (Notes on Group Homomorphisms) -> Homomorphism", "Remark (Notes on Group Homomorphisms) -> Homomorphism", "Remark (Notes on Group Homomorphisms) -> Kernel"]);
  });

  it("goes into the graph as concepts with kinds and prerequisites", () => {
    const { graph, added } = applyExtraction(ops.emptyGraph(), texReview(paper));
    expect(added).toHaveLength(5);
    const byName = (n: string) => graph.nodes.find((x) => x.name === n)!;
    expect(byName("First Isomorphism Theorem").kind).toBe("theorem");
    expect(byName("First Isomorphism Theorem").dependsOn.map((id) => graph.nodes.find((n) => n.id === id)!.name).sort()).toEqual([
      "Homomorphism",
      "Kernel",
      "Lemma 1.3 (Notes on Group Homomorphisms)",
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

  it("numbers like LaTeX: shared counters, within sections and chapters, starred and unnumbered", () => {
    const doc = String.raw`
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{corollary}{Corollary}
\declaretheorem[name=Proposition, sibling=theorem]{prop}
\declaretheorem[name=Remark, numbered=no]{rem}
\section{One}
\begin{theorem}A\end{theorem}
\begin{lemma}B\end{lemma}
\section*{Aside}
\begin{prop}C\end{prop}
\section{Two}
\begin{lemma}D\end{lemma}
\begin{corollary}E\end{corollary}
\begin{theorem*}F\end{theorem*}
\begin{rem}G\end{rem}
\begin{corollary}H\end{corollary}`;
    expect(parseTexResults(doc).map((r) => `${r.heading} ${r.number}`.trim())).toEqual([
      "Theorem 1.1", "Lemma 1.2", "Proposition 1.3", "Lemma 2.1", "Corollary 1", "Theorem", "Remark", "Corollary 2",
    ]);
    const book = String.raw`\newtheorem{thm}{Theorem}[section]
\chapter{A}\section{x}\begin{thm}a\end{thm}\chapter{B}\section{y}\section{z}\begin{thm}b\end{thm}`;
    expect(parseTexResults(book).map((r) => r.number)).toEqual(["1.1.1", "2.2.1"]);
    // Unnumbered results of an untitled paper still get unique names.
    expect(texReview("\\newtheorem*{rem}{Remark}\\begin{rem}a\\end{rem}\\begin{rem}b\\end{rem}").items.map((i) => i.name)).toEqual(["Remark", "Remark (2)"]);
  });

  it("takes a \\label placed after \\end, and the proof after it", () => {
    const doc = "\\begin{definition}A \\emph{widget}.\\end{definition}\\label{d}\n\\begin{lemma}Uses \\ref{d}.\\end{lemma}\n\\label{l}\n\\begin{proof}By \\ref{d}.\\end{proof}\\begin{theorem}By \\ref{l}.\\end{theorem}";
    const rs = parseTexResults(doc);
    expect(rs.map((r) => r.labels)).toEqual([["d"], ["l"], []]);
    expect(rs[1].refs).toEqual(["d"]);
    expect(texReview(doc).links.map((l) => `${l.from} -> ${l.to}`)).toEqual(["Lemma 1 -> Widget", "Theorem 1 -> Lemma 1"]);
  });

  it("skips listings, comment blocks, \\iffalse and \\verb; a % after \\\\ is a comment", () => {
    const doc = String.raw`\begin{verbatim}
\begin{theorem}[Fake]x\end{theorem}
\end{verbatim}
\begin{lstlisting}\begin{lemma}no\end{lemma}\end{lstlisting}
\begin{comment}\begin{lemma}no\end{lemma}\end{comment}
\iffalse \begin{lemma}no\end{lemma} \fi
\verb|\begin{lemma}| and
\begin{theorem}[Real]a\\% gone
b\end{theorem}`;
    const rs = parseTexResults(doc);
    expect(rs.map((r) => r.title)).toEqual(["Real"]);
    expect(rs[0].statement).not.toContain("gone");
    expect(stripComments("50\\% kept \\\\% gone")).toBe("50\\% kept \\\\");
  });
});
