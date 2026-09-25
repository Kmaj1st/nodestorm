import { normalizeName, type ConceptKind } from "@nodestorm/shared";
import { t as tr } from "../i18n";
import type { ExtractItem, ExtractLink, ExtractReview } from "./extract";

/**
 * Import a LaTeX paper or lecture notes: every theorem-like environment (definition, theorem, lemma…, including the
 * ones a `\newtheorem` declares) becomes a candidate concept, and a result that `\ref`s another one (in its statement
 * or its proof) needs it. No AI: this reads the structure the author already wrote. The result is an Extract-style
 * review (lib/extract.ts), so the user picks what goes in, and it is one undo step.
 */

/** Kind by the environment's printed name ("Theorem", "Lemma"…) or its usual short names. */
const KIND_BY_WORD: [RegExp, ConceptKind][] = [
  [/^(definition|defn|dfn|def|defi)$/i, "definition"],
  [/^(theorem|thm|theo)$/i, "theorem"],
  [/^(lemma|lem|lma|claim|sublemma)$/i, "lemma"],
  [/^(proposition|prop|fact|observation)$/i, "proposition"],
  [/^(corollary|cor|coro)$/i, "corollary"],
  [/^(axiom|ax|postulate)$/i, "axiom"],
  [/^(conjecture|conj|hypothesis|question|problem)$/i, "conjecture"],
  [/^(example|ex|exa|exmp|counterexample)$/i, "example"],
  [/^(notation|nota|convention)$/i, "notation"],
  [/^(remark|rem|rmk|note)$/i, "other"],
];

function kindOf(word: string): ConceptKind | null {
  const w = word.trim().replace(/\*$/, "");
  return KIND_BY_WORD.find(([re]) => re.test(w))?.[1] ?? null;
}

/** Blank out a match, keeping its line breaks (so line-based rules and offsets still hold). */
const blank = (m: string) => m.replace(/[^\n]/g, " ");

/** Environments whose content is not LaTeX to read: code listings and commented-out blocks. */
const VERBATIM = /\\begin\{(verbatim|Verbatim|BVerbatim|lstlisting|minted|comment|filecontents)(\*?)\}[\s\S]*?\\end\{\1\2\}/g;

/**
 * The source without comments: an unescaped `%` to the end of the line (after `\\` a `%` is a comment again),
 * listings and `comment` environments, `\verb|…|`, and `\iffalse … \fi` blocks.
 */
export function stripComments(tex: string): string {
  return tex
    .replace(VERBATIM, blank)
    .replace(/\\verb\*?([^A-Za-z\s])[^\n]*?\1/g, blank)
    .replace(/(^|[^\\])((?:\\\\)*)%.*$/gm, "$1$2")
    .replace(/\\iffalse\b[\s\S]*?\\fi\b/g, blank);
}

/** How an environment is numbered: the counter it steps, the sectioning level that resets it, or not at all. */
export interface TheoremEnv {
  /** Printed name ("Theorem"). */
  name: string;
  /** Counter it steps (shared with `\newtheorem{lem}[thm]{Lemma}`); undefined when unnumbered (`\newtheorem*`). */
  counter?: string;
  /** Sectioning level it is numbered within (`\newtheorem{thm}{Theorem}[section]` prints "2.1"). */
  within?: string;
}

/** Declared environments, from `\newtheorem{env}[counter]{Name}`, `\newtheorem*{env}{Name}`, `\newtheorem{env}{Name}[section]` and thmtools' `\declaretheorem`. */
export function theoremDecls(tex: string): Map<string, TheoremEnv> {
  const envs = new Map<string, TheoremEnv>();
  const shared = (c: string) => envs.get(c)?.counter ?? c;
  const withinOf = (c: string) => envs.get(c)?.within;
  for (const m of tex.matchAll(/\\newtheorem(\*?)\s*\{([^}]+)\}\s*(?:\[([^\]]*)\]\s*)?(?:\{([^}]+)\})?(?:\s*\[([^\]]*)\])?/g)) {
    const env = m[2].trim();
    const name = (m[4] ?? m[2]).trim();
    if (m[1]) envs.set(env, { name });
    else if (m[3]) envs.set(env, { name, counter: shared(m[3].trim()), within: withinOf(m[3].trim()) });
    else envs.set(env, { name, counter: env, within: m[5]?.trim() || undefined });
  }
  for (const m of tex.matchAll(/\\declaretheorem(\*?)\s*(?:\[([^\]]*)\]\s*)?\{([^}]+)\}(?:\s*\[([^\]]*)\])?/g)) {
    const opts = `${m[2] ?? ""},${m[4] ?? ""}`;
    const opt = (key: string) => new RegExp(`(?:^|,)\\s*(?:${key})\\s*=\\s*\\{?([^,}]+)\\}?`).exec(opts)?.[1].trim();
    const env = m[3].trim();
    const name = opt("name") ?? env.charAt(0).toUpperCase() + env.slice(1);
    const sibling = opt("sibling|numberlike|sharenumber");
    if (m[1] || /^(no|false|unless unique)$/i.test(opt("numbered") ?? "")) envs.set(env, { name });
    else if (sibling) envs.set(env, { name, counter: shared(sibling), within: withinOf(sibling) });
    else envs.set(env, { name, counter: env, within: opt("numberwithin|parent|within") });
  }
  return envs;
}

/** Environment name → printed name (see theoremDecls). */
export function theoremEnvs(tex: string): Map<string, string> {
  return new Map([...theoremDecls(tex)].map(([env, d]) => [env, d.name]));
}

/** A theorem-like environment in the document. */
export interface TexResult {
  env: string;
  kind: ConceptKind | null;
  /** The printed name of the environment ("Theorem"). */
  heading: string;
  /** The optional title, `\begin{theorem}[First Isomorphism Theorem]`. */
  title?: string;
  labels: string[];
  /** The statement as NodeStorm text ($…$ maths kept). */
  statement: string;
  /** Labels it refers to, in its statement and in the proof right after it. */
  refs: string[];
  /** For definitions: the terms it defines (\emph, \textbf, \textit, \index). */
  terms: string[];
  /** Its printed number ("3", or "2.1" when numbered within sections); "" when unnumbered. */
  number: string;
}

/** Read a balanced `{…}` group starting at `i` (which must be `{`); returns its content and the index after it. */
function group(s: string, i: number): { text: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

/** The optional `[…]` argument at `i` (brackets may nest, e.g. a citation `[\cite[p.~3]{x}]`). */
function optional(s: string, i: number): { text: string; end: number } | null {
  let k = i;
  while (s[k] === " " || s[k] === "\n") k++;
  if (s[k] !== "[") return null;
  let depth = 0;
  for (let j = k; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "[") depth++;
    else if (s[j] === "]" && --depth === 0) return { text: s.slice(k + 1, j), end: j + 1 };
  }
  return null;
}

/** Words that name what a \\ref points to ("Theorem~\\ref{…}"); dropped when the reference becomes a name. */
const REF_WORDS = "Definitions?|Defs?|Theorems?|Thms?|Lemmas?|Lems?|Propositions?|Props?|Corollar(?:y|ies)|Cors?|Axioms?|Conjectures?|Examples?|Remarks?|Notations?|Claims?";

const REF = /\\(?:ref|cref|Cref|autoref|eqref|pageref|namecref|nameref|vref|thmref)\*?\s*\{([^}]*)\}/g;

/** Every label a piece of LaTeX refers to (`\cref{a,b}` counts twice). */
export function refsIn(tex: string): string[] {
  const out: string[] = [];
  for (const m of tex.matchAll(REF)) for (const l of m[1].split(",")) if (l.trim()) out.push(l.trim());
  return out;
}

/** Commands whose argument is kept as plain text. */
const KEEP_ARG = /\\(?:emph|textbf|textit|textsl|textsc|texttt|textrm|textsf|underline|mbox|text|hbox|index)\s*\{/;

/** Prose (not maths) → plain text: formatting commands keep their text, references read as names, citations go. */
function proseToText(s: string, nameOf: (label: string) => string | undefined): string {
  let out = s
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/~?\\(?:cite|citep|citet|parencite|textcite|footcite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{[^}]*\}/g, "")
    // "Definition~\ref{def:hom}" reads "Homomorphism" when the label is a known result; a bare \ref too.
    .replace(new RegExp(`(?:\\b(?:${REF_WORDS})\\.?[~ ]?)?${REF.source}`, "g"), (whole: string, ls: string) => {
      const labels = ls.split(",").map((l) => l.trim());
      const names = labels.map((l) => nameOf(l));
      if (names.every(Boolean)) return names.join(", ");
      return whole.replace(REF, (_m: string, x: string) => x.split(",").map((l) => nameOf(l.trim()) ?? l.trim()).join(", "));
    })
    .replace(/\\footnote\s*\{[^}]*\}/g, "")
    .replace(/\\begin\{(itemize|enumerate|description)\}(\[[^\]]*\])?/g, "\n")
    .replace(/\\end\{(itemize|enumerate|description)\}/g, "\n")
    .replace(/\\item(\[[^\]]*\])?\s*/g, (_, lab?: string) => `\n- ${lab ? `${lab.slice(1, -1)} ` : ""}`);
  // Formatting commands keep their argument (\index drops it); repeated for nesting.
  for (let pass = 0; pass < 4 && KEEP_ARG.test(out); pass++) {
    let res = "";
    let i = 0;
    for (;;) {
      const m = KEEP_ARG.exec(out.slice(i));
      if (!m) break;
      const at = i + m.index;
      const g = group(out, at + m[0].length - 1);
      if (!g) {
        res += out.slice(i, at + m[0].length);
        i = at + m[0].length;
        continue;
      }
      res += out.slice(i, at) + (m[0].startsWith("\\index") ? "" : g.text);
      i = g.end;
    }
    out = res + out.slice(i);
  }
  return out
    .replace(/(?<!\\)~/g, " ")
    .replace(/\\(?:noindent|medskip|smallskip|bigskip|newline|par|qedhere|hfill|centering)\b/g, " ")
    .replace(/\\\\/g, "\n")
    .replace(/``|''/g, '"')
    .replace(/\\([%&#_{}$])/g, "$1")
    .replace(/[ \t]+([.,;:)])/g, "$1");
}

/**
 * LaTeX → NodeStorm text: inline maths stays `$…$`, display maths (\[…\], equation, align…) becomes `$$…$$`, and
 * the prose between is cleaned up (see proseToText). Maths itself is never touched.
 */
export function texToText(tex: string, nameOf: (label: string) => string | undefined = () => undefined): string {
  let s = tex
    // As in LaTeX, a single line break is a space; a blank line starts a paragraph.
    .replace(/[ \t]*\n(?![ \t]*\n)[ \t]*/g, " ")
    // (Not "\\\\[2pt]", a line break with extra space, which also contains "\\[".)
    .replace(/(?<!\\)\\\[([\s\S]*?)\\\]/g, (_, m: string) => `\n$$${m.trim()}$$\n`)
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_, env: string, m: string) => {
      const body = m.replace(/\\label\{[^}]*\}/g, "").replace(/\\(?:nonumber|notag)\b/g, "").trim();
      return `\n$$${/^(align|eqnarray)/.test(env) ? `\\begin{aligned}${body}\\end{aligned}` : body}$$\n`;
    })
    .replace(/(?<!\\)\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m}$`);
  // Prose and maths apart: $$…$$ and $…$ (not \$) are kept as they are.
  const parts = s.split(/(\$\$[\s\S]*?\$\$|(?<!\\)\$(?:[^$\\]|\\.)*\$)/);
  s = parts.map((p, i) => (i % 2 ? p.replace(/\s*\n\s*/g, " ") : proseToText(p, nameOf))).join("");
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}(?=\$\$)/g, "\n")
    .replace(/(\$\$)\n{2,}/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The terms a definition defines: its emphasised words (outside maths). */
function definedTerms(body: string): string[] {
  const terms: string[] = [];
  for (const m of body.matchAll(/\\(?:emph|textbf|textit|index|defn|term)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    // Maths in a term keeps its letters: "$p$-group" is the "p-group".
    const t = texToText(m[1]).replace(/\$([^$]*)\$/g, (_, x: string) => x.replace(/\\[A-Za-z]+\s*/g, "").replace(/[{}^_]/g, "")).replace(/\s+/g, " ").trim();
    if (t && t.length <= 60 && /\p{L}/u.test(t) && !terms.includes(t)) terms.push(t);
  }
  return terms;
}

/** Sectioning levels, outermost first (for numbers like "2.1"). */
const LEVELS = ["part", "chapter", "section", "subsection", "subsubsection"];

/** Every theorem-like environment of the document, in order, with the proof that follows each. */
export function parseTexResults(source: string): TexResult[] {
  const tex = stripComments(source);
  const declared = theoremDecls(tex);
  const decl = (env: string) => declared.get(env) ?? declared.get(env.replace(/\*$/, ""));
  const envName = (env: string) => decl(env)?.name ?? env;
  const isResultEnv = (env: string) => env !== "proof" && Boolean(kindOf(envName(env)) ?? kindOf(env) ?? (decl(env) ? "other" : null));
  const counts = new Map<string, number>();
  const sections = LEVELS.map(() => 0);
  const out: TexResult[] = [];
  // Results and the numbered sectioning commands that reset their counters, in document order.
  const token = /\\begin\{([A-Za-z*]+)\}|\\(part|chapter|section|subsection|subsubsection)(\*?)\s*(?:\[[^\]]*\]\s*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(tex))) {
    if (m[2]) {
      if (m[3]) continue; // \section* is unnumbered
      const level = LEVELS.indexOf(m[2]);
      sections[level]++;
      for (let i = level + 1; i < LEVELS.length; i++) sections[i] = 0;
      // A counter numbered within this level (or a deeper one) starts again.
      for (const [c] of counts) if (c.endsWith(`@${m[2]}`) || LEVELS.slice(level + 1).some((l) => c.endsWith(`@${l}`))) counts.delete(c);
      continue;
    }
    const env = m[1];
    if (!isResultEnv(env)) continue;
    const endTag = `\\end{${env}}`;
    const endAt = tex.indexOf(endTag, token.lastIndex);
    if (endAt < 0) continue;
    let bodyStart = token.lastIndex;
    const opt = optional(tex, bodyStart);
    let title: string | undefined;
    if (opt && !/^\s*$/.test(opt.text)) {
      // [{Hahn--Banach}] braces the title so a "]" can't end it: the braces aren't part of it.
      title = texToText(opt.text.trim().replace(/^\{([\s\S]*)\}$/, "$1")).replace(/--/g, "–").replace(/\s+/g, " ").trim() || undefined;
      bodyStart = opt.end;
    } else if (opt) bodyStart = opt.end;
    const body = tex.slice(bodyStart, endAt);
    // A \label right after \end{…} still names it; a proof right after it (only whitespace or labels between) belongs to it.
    const after = tex.slice(endAt + endTag.length);
    const trailing = /^(?:\s*\\label\{[^}]*\})*/.exec(after)![0];
    const proof = /^\s*\\begin\{proof\}(\[[^\]]*\])?([\s\S]*?)\\end\{proof\}/.exec(after.slice(trailing.length));
    const declaredName = envName(env).replace(/\*$/, "");
    // Undeclared (built-in) environments print their name capitalised: "theorem" → "Theorem".
    const heading = declaredName.charAt(0).toUpperCase() + declaredName.slice(1);
    const d = decl(env);
    // Starred environments and \newtheorem* are unnumbered; an undeclared one counts by its printed name.
    const numbered = !env.endsWith("*") && (d ? Boolean(d.counter) : true);
    let number = "";
    if (numbered) {
      const within = d?.within && LEVELS.includes(d.within) ? d.within : undefined;
      const key = `${d?.counter ?? heading}${within ? `@${within}` : ""}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      // "2.1": the section's number (with its chapter's, when the document has chapters; parts don't show) before the result's.
      const prefix = within ? sections.slice(sections.findIndex((x, i) => i > 0 && (x > 0 || i === LEVELS.indexOf(within))), LEVELS.indexOf(within) + 1) : [];
      number = [...prefix, n].join(".");
    }
    const kind = kindOf(heading) ?? kindOf(env) ?? "other";
    out.push({
      env,
      kind,
      heading,
      title,
      labels: [...body.matchAll(/\\label\{([^}]*)\}/g), ...trailing.matchAll(/\\label\{([^}]*)\}/g)].map((x) => x[1].trim()),
      statement: body,
      refs: [...new Set([...refsIn(body), ...(proof ? refsIn(proof[2]) : [])])],
      terms: kind === "definition" || kind === "notation" ? definedTerms(body) : [],
      number,
    });
    token.lastIndex = endAt + endTag.length;
  }
  return out;
}

/** "Theorem 3", or just "Remark" when unnumbered. */
export const resultLabel = (r: TexResult) => (r.number ? `${r.heading} ${r.number}` : r.heading);

/** A concept name for a result: its title, else what a definition defines, else "Theorem 3". */
export function resultName(r: TexResult, docTitle?: string): string {
  if (r.title) return r.title.replace(/\s*\\cite.*$/, "").trim();
  if (r.terms.length) return r.terms[0].charAt(0).toUpperCase() + r.terms[0].slice(1);
  // "Lemma 1" alone would clash with another paper's Lemma 1 in the same graph.
  const short = docTitle && (docTitle.length > 40 ? `${docTitle.slice(0, 39).trimEnd()}…` : docTitle);
  return short ? `${resultLabel(r)} (${short})` : resultLabel(r);
}

/** Above this many results, no mention links (they would take seconds and make a review list nobody can read). */
const MENTIONS_MAX = 200;

/** Plain text of the document's title (for the review heading and sources). */
export function texTitle(source: string): string | undefined {
  const m = /\\title\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(stripComments(source));
  return m ? texToText(m[1]).replace(/\s+/g, " ").replace(/\\\\/g, " ").trim() || undefined : undefined;
}

/**
 * The review for an imported document: one candidate per result (names made unique), and a prerequisite link
 * wherever a result refers to another's label. With `mentions`, a result that uses a term a definition defines
 * (as a whole word, at least four letters) also needs that definition; those links start unticked.
 */
export function texReview(source: string, opts: { mentions?: boolean } = {}): ExtractReview & { title?: string; results: number } {
  const results = parseTexResults(source);
  const byLabel = new Map<string, number>();
  results.forEach((r, i) => r.labels.forEach((l) => byLabel.set(l, i)));
  const title = texTitle(source);
  // Unique names (as the graph compares them: "Main" and "Main." are the same): a repeated one gets its number.
  const names: string[] = [];
  const taken = (n: string) => names.some((x) => normalizeName(x) === normalizeName(n));
  for (const r of results) {
    const base = resultName(r, title);
    let n = base;
    if (taken(n) && r.number) n = `${base} (${resultLabel(r)})`;
    for (let k = 2; taken(n); k++) n = `${base} (${k})`;
    names.push(n);
  }
  const nameOf = (label: string) => {
    const i = byLabel.get(label);
    return i === undefined ? undefined : names[i];
  };
  const items: ExtractItem[] = results.map((r, i) => ({
    source: names[i],
    name: names[i],
    definition: texToText(r.statement, nameOf),
    aliases: r.title && r.terms.length && r.terms[0].toLowerCase() !== names[i].toLowerCase() ? [r.terms[0]] : [],
    kind: r.kind,
    include: true,
  }));
  const links: ExtractLink[] = [];
  const seen = new Set<string>();
  const link = (from: number, to: number, why: string, include: boolean) => {
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    links.push({
      from: names[from],
      to: names[to],
      aToB: { kind: "uses", explanation: why },
      bToA: { kind: "", explanation: "" },
      role: results[from].kind === "example" ? "assumes" : "uses",
      include,
    });
  };
  results.forEach((r, i) => {
    for (const l of r.refs) {
      const j = byLabel.get(l);
      if (j !== undefined) link(i, j, tr(results[j].title ? "texImport.refersToTitled" : "texImport.refersTo", { label: resultLabel(results[j]), title: results[j].title ?? "" }), true);
    }
  });
  // Mention links compare every result with every definition: skipped for very large documents.
  if (opts.mentions && results.length <= MENTIONS_MAX) {
    results.forEach((r, i) => {
      const text = texToText(r.statement).replace(/\$[^$]*\$/g, " ").toLowerCase();
      results.forEach((d, j) => {
        if (j >= i) return; // only earlier definitions: a paper defines before it uses
        for (const term of d.terms) {
          const low = term.toLowerCase();
          if (low.length < 4) continue;
          const re = new RegExp(`(^|[^\\p{L}])${low.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?([^\\p{L}]|$)`, "u");
          if (re.test(text)) link(i, j, tr("texImport.mentions", { term }), false);
        }
      });
    });
  }
  // The new concepts' definitions come from the paper: it is their source.
  return { items, links, title, results: results.length, ...(title ? { origin: { title: title.slice(0, 300) } } : {}) };
}
