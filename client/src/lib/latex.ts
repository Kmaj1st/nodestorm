import { isTheoremLike, type ConceptKind, type ConceptNode, type Graph } from "@nodestorm/shared";
import { paperByline, sourceLabel, studyOrder } from "./export";
import { KIND_NAME } from "./kinds";
import { splitMath } from "./math";

/**
 * "LaTeX document (.tex)": the graph as a compilable amsart article. Every concept becomes an amsthm environment
 * for its kind (definition, theorem, lemma…; concepts without a kind are "Concept"), in study order so prerequisites
 * come first, labelled so each one can say what it uses ("Uses: Definition~\ref{…}"). Text is escaped for LaTeX while
 * formulas (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`, see lib/math.ts) pass through untouched. Notes become remarks and a
 * stored theorem anatomy's proof idea becomes a proof sketch. Pure: the Toolbar downloads the result.
 */

/** The amsthm environment for each kind; "other" and untyped concepts share "concept". */
const ENV: Record<ConceptKind, string> = {
  definition: "definition",
  theorem: "theorem",
  lemma: "lemma",
  proposition: "proposition",
  corollary: "corollary",
  axiom: "axiom",
  conjecture: "conjecture",
  example: "example",
  notation: "notation",
  other: "concept",
};

const envOf = (n: Pick<ConceptNode, "kind">) => (n.kind ? ENV[n.kind] : "concept");
const wordOf = (n: Pick<ConceptNode, "kind">) => (n.kind && n.kind !== "other" ? KIND_NAME[n.kind] : "Concept");

/** Plain-text characters pdfLaTeX can't take as they are, written as LaTeX (math symbols in text mode). */
const UNICODE: Record<string, string> = {
  "→": "\\ensuremath{\\to}", "←": "\\ensuremath{\\leftarrow}", "↔": "\\ensuremath{\\leftrightarrow}",
  "⇒": "\\ensuremath{\\Rightarrow}", "⇐": "\\ensuremath{\\Leftarrow}", "⇔": "\\ensuremath{\\Leftrightarrow}",
  "↦": "\\ensuremath{\\mapsto}", "≤": "\\ensuremath{\\le}", "≥": "\\ensuremath{\\ge}", "≠": "\\ensuremath{\\ne}",
  "≈": "\\ensuremath{\\approx}", "≅": "\\ensuremath{\\cong}", "≡": "\\ensuremath{\\equiv}", "∈": "\\ensuremath{\\in}",
  "∉": "\\ensuremath{\\notin}", "⊂": "\\ensuremath{\\subset}", "⊆": "\\ensuremath{\\subseteq}", "∪": "\\ensuremath{\\cup}",
  "∩": "\\ensuremath{\\cap}", "∅": "\\ensuremath{\\emptyset}", "×": "\\ensuremath{\\times}", "·": "\\ensuremath{\\cdot}",
  "∘": "\\ensuremath{\\circ}", "∞": "\\ensuremath{\\infty}", "∀": "\\ensuremath{\\forall}", "∃": "\\ensuremath{\\exists}",
  "¬": "\\ensuremath{\\neg}", "∧": "\\ensuremath{\\wedge}", "∨": "\\ensuremath{\\vee}", "−": "\\ensuremath{-}",
  "±": "\\ensuremath{\\pm}", "√": "\\ensuremath{\\surd}", "∑": "\\ensuremath{\\sum}", "∏": "\\ensuremath{\\prod}",
  "∫": "\\ensuremath{\\int}", "∂": "\\ensuremath{\\partial}", "∇": "\\ensuremath{\\nabla}", "ℕ": "\\ensuremath{\\mathbb{N}}",
  "ℤ": "\\ensuremath{\\mathbb{Z}}", "ℚ": "\\ensuremath{\\mathbb{Q}}", "ℝ": "\\ensuremath{\\mathbb{R}}", "ℂ": "\\ensuremath{\\mathbb{C}}",
};
const GREEK = "αβγδεζηθικλμνξοπρστυφχψω";
const GREEK_NAMES = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "o", "pi", "rho", "sigma", "tau", "upsilon", "varphi", "chi", "psi", "omega"];
[...GREEK].forEach((c, i) => {
  UNICODE[c] = GREEK_NAMES[i] === "o" ? "o" : `\\ensuremath{\\${GREEK_NAMES[i]}}`;
});
Object.assign(UNICODE, { "ϕ": "\\ensuremath{\\phi}", "Γ": "\\ensuremath{\\Gamma}", "Δ": "\\ensuremath{\\Delta}", "Θ": "\\ensuremath{\\Theta}", "Λ": "\\ensuremath{\\Lambda}", "Π": "\\ensuremath{\\Pi}", "Σ": "\\ensuremath{\\Sigma}", "Φ": "\\ensuremath{\\Phi}", "Ψ": "\\ensuremath{\\Psi}", "Ω": "\\ensuremath{\\Omega}" });

// More symbols that turn up in definitions (encyclopedias especially), and capital Greek letters that look Latin.
Object.assign(UNICODE, Object.fromEntries(
  (
    [
      ["⊕", "\\oplus"], ["⊗", "\\otimes"], ["ℓ", "\\ell"], ["⟨", "\\langle"], ["⟩", "\\rangle"], ["∼", "\\sim"],
      ["′", "{}^{\\prime}"], ["ς", "\\varsigma"], ["⋯", "\\cdots"], ["…", "\\ldots"], ["≺", "\\prec"], ["≼", "\\preceq"],
      ["⊥", "\\perp"], ["⊤", "\\top"], ["∥", "\\parallel"], ["◃", "\\triangleleft"], ["⊲", "\\triangleleft"],
      ["⊴", "\\trianglelefteq"], ["⋊", "\\rtimes"], ["⋉", "\\ltimes"], ["⊢", "\\vdash"], ["⊨", "\\models"],
      ["↪", "\\hookrightarrow"], ["↠", "\\twoheadrightarrow"], ["∖", "\\setminus"], ["∣", "\\mid"], ["≃", "\\simeq"],
      ["∝", "\\propto"], ["⊊", "\\subsetneq"], ["⊇", "\\supseteq"], ["⊃", "\\supset"], ["∗", "\\ast"], ["†", "\\dagger"],
      ["‖", "\\|"], ["ℵ", "\\aleph"], ["ℏ", "\\hbar"], ["∮", "\\oint"], ["⊔", "\\sqcup"], ["⊓", "\\sqcap"],
      ["≪", "\\ll"], ["≫", "\\gg"], ["⌊", "\\lfloor"], ["⌋", "\\rfloor"], ["⌈", "\\lceil"], ["⌉", "\\rceil"],
      ["Ξ", "\\Xi"], ["Υ", "\\Upsilon"], ["ϵ", "\\epsilon"], ["ϑ", "\\vartheta"], ["ϱ", "\\varrho"], ["ϖ", "\\varpi"],
      ["ℑ", "\\Im"], ["ℜ", "\\Re"], ["℘", "\\wp"], ["⧸", "/"], ["∕", "/"],
    ] as const
  ).map(([c, cmd]) => [c, `\\ensuremath{${cmd}}`]),
));
for (const [c, latin] of Object.entries({ "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X" })) {
  UNICODE[c] = `\\ensuremath{\\mathrm{${latin}}}`;
}

/**
 * A formula with its Unicode symbols written as LaTeX commands. Each is written as `\\ensuremath{…}`, which works in
 * maths and inside `\\text{…}` alike, and being braced can't run into a following letter ("\\le" + "x"). Latin-1
 * symbols (× · ± ¬) count too: pdfLaTeX drops those in maths. A bare `%` would comment out the rest of the line.
 */
function mathUnicode(tex: string): string {
  return tex.replace(/(?<!\\)%/g, "\\%").replace(/[^\x00-\x7f]/g, (c) => UNICODE[c] ?? c);
}

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  $: "\\$",
  "%": "\\%",
  "&": "\\&",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
  "|": "\\textbar{}",
};

/** Escape plain text for LaTeX (no formulas in it). */
export function texEscapeText(s: string): string {
  return s.replace(/[\\{}#$%&_~^<>|]|[^\x00-\x7f]/g, (c) => SPECIAL[c] ?? UNICODE[c] ?? c);
}

/**
 * Escape a text for LaTeX but keep its formulas: text between them is escaped, each formula is written back as
 * `$…$` (inline) or `\[…\]` (display). Unbalanced dollars are text, as lib/math.ts reads them.
 */
export function texEscape(s: string, opts: { inline?: boolean } = {}): string {
  return splitMath(s)
    .map((seg) =>
      seg.kind === "math"
        ? seg.display && !opts.inline
          ? `\\[ ${mathUnicode(seg.tex)} \\]`
          : `$${mathUnicode(seg.tex)}$`
        : texEscapeText(seg.text),
    )
    .join("");
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A URL for `\href`: `%` and `#` escaped as hyperref expects, and characters that would break the argument (braces,
 * backslashes, spaces…) percent-encoded. Stored links are https only (see PaperWork in model.ts).
 */
export function texUrl(u: string): string {
  return u
    .replace(/[\\{}^`|"<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)
    .replace(/[%#]/g, "\\$&");
}

/** Paragraphs of a multi-line text, each escaped; blank lines separate paragraphs as in LaTeX. */
function texParagraphs(s: string): string {
  return s
    .trim()
    .split(/\n\s*\n/)
    .map((p) => texEscape(p.replace(/\s*\n\s*/g, " ")))
    .join("\n\n");
}

/** Labels like "c:first-isomorphism-theorem", unique within the document. */
export function labels(nodes: Pick<ConceptNode, "id" | "name">[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  nodes.forEach((n, i) => {
    const slug =
      n.name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || `concept-${i + 1}`;
    let label = `c:${slug}`;
    for (let k = 2; used.has(label); k++) label = `c:${slug}-${k}`;
    used.add(label);
    out.set(n.id, label);
  });
  return out;
}

const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef\u{20000}-\u{2fa1f}]/u;

export interface LatexOptions {
  /** Document title; defaults to the graph's name. */
  title?: string;
  date?: Date;
}

export function toLatex(g: Graph, opts: LatexOptions = {}): string {
  const ordered = studyOrder(g);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const rank = new Map(ordered.map((n, i) => [n.id, i]));
  const label = labels(ordered);
  const title = opts.title?.trim() || g.name || "NodeStorm graph";
  const date = (opts.date ?? new Date()).toISOString().slice(0, 10);
  const body: string[] = [];
  if (!ordered.length) body.push("This graph has no concepts yet.", "");

  for (const n of ordered) {
    const env = envOf(n);
    // The name is braced so a "]" in it can't end the optional argument early; display maths there would break it.
    body.push(`\\begin{${env}}[{${texEscape(n.name.replace(/\s+/g, " ").trim(), { inline: true })}}]\\label{${label.get(n.id)}}`);
    body.push(n.definition.trim() ? texParagraphs(n.definition) : "\\emph{No statement yet.}");
    const extra: string[] = [];
    if (n.aliases.length) extra.push(`\\emph{Also called:} ${n.aliases.map((a) => texEscape(a, { inline: true })).join(", ")}.`);
    const prereqs = n.dependsOn
      .map((id) => byId.get(id))
      .filter((p): p is ConceptNode => !!p && p.id !== n.id)
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    if (prereqs.length) {
      extra.push(`\\emph{Uses:} ${prereqs.map((p) => `${wordOf(p)}~\\ref{${label.get(p.id)}} (${texEscape(p.name, { inline: true })})`).join(", ")}.`);
    }
    if (n.missingDeps.length) {
      extra.push(`\\emph{Also needs (not in this graph):} ${n.missingDeps.map((d) => texEscape(d.name, { inline: true })).join(", ")}.`);
    }
    if (n.source) extra.push(`\\emph{Source:} ${texEscape(sourceLabel(n.source, "en"), { inline: true })}.`);
    if (extra.length) body.push("", ...extra.map((e, i) => (i ? `\\\\ ${e}` : `\\smallskip\\noindent ${e}`)));
    body.push(`\\end{${env}}`, "");

    // A stored anatomy belongs to a theorem-like concept; after a change of kind it isn't exported as a proof.
    const an = n.anatomy;
    if (an?.proofIdea.trim() && isTheoremLike(n.kind)) {
      if (n.kind === "conjecture") body.push("\\begin{remark}[Evidence]", texParagraphs(an.proofIdea), "\\end{remark}", "");
      else body.push("\\begin{proof}[Proof idea]", texParagraphs(an.proofIdea), "\\end{proof}", "");
    }
    if (n.notes?.trim()) body.push("\\begin{remark}[Notes]", texParagraphs(n.notes), "\\end{remark}", "");
    if (n.papers?.works.length) {
      const items = n.papers.works.map((w) => {
        const by = paperByline(w);
        return `  \\item \\href{${texUrl(w.url)}}{\\emph{${texEscape(oneLine(w.title), { inline: true })}}}${by ? `, ${texEscape(oneLine(by), { inline: true })}` : ""}.`;
      });
      body.push("\\begin{remark}[Further reading]", "\\leavevmode", "\\begin{itemize}", ...items, "\\end{itemize}", "\\end{remark}", "");
    }
  }
  body.push("\\end{document}", "");

  const titleTex = texEscape(title, { inline: true });
  const text = `${titleTex}\n${body.join("\n")}`;
  // Decided on everything written (aliases, sources, missing prerequisites, proof ideas too), not a few fields.
  const cjk = CJK.test(text);
  // Characters pdfLaTeX's utf8 input has no definition for (outside Latin-1, not mapped above) get a visible
  // placeholder there, so the document still compiles; xelatex and lualatex print them as they are.
  const unknown = [...new Set(text.match(/[^\x00-\xff]/gu) ?? [])].filter((c) => !CJK.test(c));
  const fallbacks = unknown.map((c) => `  \\DeclareUnicodeCharacter{${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}}{\\ensuremath{\\square}}`);

  const out: string[] = [
    "% Generated by NodeStorm. Concepts are in study order: prerequisites come first.",
    cjk
      ? "% Contains Chinese, Japanese or Korean text: compile with xelatex."
      : "% Compile with pdflatex (or xelatex / lualatex).",
    "\\documentclass{amsart}",
    "\\usepackage{iftex}",
    "\\ifPDFTeX",
    "  \\usepackage[utf8]{inputenc}",
    "  \\usepackage[T1]{fontenc}",
    ...fallbacks,
    "\\else",
    "  \\usepackage{fontspec}",
    "\\fi",
    ...(cjk ? ["\\ifXeTeX", "  \\usepackage{xeCJK}", "\\fi"] : []),
    "\\usepackage{amsmath,amssymb,amsthm}",
    "\\usepackage[hidelinks]{hyperref}",
    "",
    "\\theoremstyle{plain}",
    "\\newtheorem{theorem}{Theorem}",
    "\\newtheorem{lemma}[theorem]{Lemma}",
    "\\newtheorem{proposition}[theorem]{Proposition}",
    "\\newtheorem{corollary}[theorem]{Corollary}",
    "\\newtheorem{conjecture}[theorem]{Conjecture}",
    "\\theoremstyle{definition}",
    "\\newtheorem{definition}[theorem]{Definition}",
    "\\newtheorem{axiom}[theorem]{Axiom}",
    "\\newtheorem{example}[theorem]{Example}",
    "\\newtheorem{notation}[theorem]{Notation}",
    "\\newtheorem{concept}[theorem]{Concept}",
    "\\theoremstyle{remark}",
    "\\newtheorem*{remark}{Remark}",
    "",
    `\\title{${titleTex}}`,
    `\\date{${date}}`,
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
  ];
  out.push(...body);
  return out.join("\n");
}
