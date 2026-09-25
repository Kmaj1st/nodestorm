import type { ConceptKind, Graph } from "@nodestorm/shared";
import { studyOrder } from "./export";
import { splitMath } from "./math";

/**
 * "Notation…": a glossary of the symbols a graph introduces, built without the AI. Concepts of kind "notation" and
 * definitions contribute the first formula of their definition that looks like notation (see `pickSymbol`), in study
 * order. Pure; the dialog is panels/GlossaryDialog.tsx.
 */

export interface GlossaryEntry {
  nodeId: string;
  name: string;
  kind: ConceptKind;
  /** The symbol, as LaTeX without delimiters. */
  symbol: string;
  /** The formula it was taken from, when that says more than the symbol (e.g. its defining equation). */
  formula?: string;
}

/** Longest formula shown as a symbol; longer ones are statements, not notation. */
const MAX_SYMBOL = 40;

/** A lone variable ("G", "x_1", "\varphi", "N'"), which names something but is no notation of its own. */
const BARE = /^(?:[A-Za-z]|\\[A-Za-z]+)(?:_(?:\w|\{[^{}]*\}))?'*$/;

/** "LHS := …", "LHS = …", "LHS \coloneqq …", "LHS \equiv …": the left-hand side is what is being defined. */
const DEFINING = /^(.+?)\s*(?::=|\\coloneqq|\\equiv|\\stackrel\{\\mathrm\{def\}\}\{=\}|=)\s*\S/;

/**
 * The notation in a list of formulas: the left-hand side of the first defining equation, else the first formula that
 * is short and not a lone variable. Undefined when nothing qualifies.
 */
export function pickSymbol(formulas: string[]): { symbol: string; formula?: string } | undefined {
  for (const raw of formulas) {
    const tex = raw.trim();
    if (!tex || BARE.test(tex)) continue;
    const m = tex.match(DEFINING);
    const lhs = m?.[1].trim();
    if (lhs && lhs.length <= MAX_SYMBOL && !BARE.test(lhs) && balanced(lhs)) return { symbol: lhs, formula: tex };
    if (tex.length <= MAX_SYMBOL) return { symbol: tex };
  }
  return undefined;
}

/**
 * Every opener has its closer: braces, \{…\}, parentheses, brackets, \langle…\rangle, \left…\right. So a left-hand
 * side cut out of a set-builder or a presentation ("\{g \in G : g") isn't shown broken.
 */
function balanced(tex: string): boolean {
  // Whole command names first, so \\rightarrow is one token and not \\right + "arrow".
  const tokens = tex.match(/\\[A-Za-z]+|\\[{}]|\\.|[{}()[\]]/g) ?? [];
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]", "\\{": "\\}", "\\langle": "\\rangle", "\\left": "\\right" };
  const closers = new Set(Object.values(pairs));
  const stack: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // \left( … \right) is one pair (\left … \right): the delimiter right after it isn't counted again.
    if (tok === "\\left" || tok === "\\right") {
      if (tok === "\\left") stack.push("\\right");
      else if (stack.pop() !== "\\right") return false;
      if (tokens[i + 1] && /^(\\[{}]|[()[\]]|\\langle|\\rangle)$/.test(tokens[i + 1])) i++;
      continue;
    }
    if (tok in pairs) stack.push(pairs[tok]);
    else if (closers.has(tok) && stack.pop() !== tok) return false;
  }
  return stack.length === 0;
}

export function buildGlossary(g: Graph): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const n of studyOrder(g)) {
    if (n.kind !== "notation" && n.kind !== "definition") continue;
    const formulas = splitMath(n.definition).flatMap((s) => (s.kind === "math" ? [s.tex] : []));
    const pick = pickSymbol(formulas);
    if (pick) out.push({ nodeId: n.id, name: n.name, kind: n.kind, ...pick });
  }
  return out;
}
