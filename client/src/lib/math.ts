/**
 * Splits user/AI text into plain-text and LaTeX segments for rendering with KaTeX (see panels/MathText.tsx).
 * Pure and dependency-free, so it runs on every card without loading KaTeX.
 *
 * Delimiters: `$…$` and `\(…\)` inline, `$$…$$` and `\[…\]` display. The rules:
 * - `\$` in text is a literal dollar (the backslash is dropped); inside math it's left to KaTeX (`\$` is a dollar
 *   there too).
 * - An opening delimiter without its closing one is plain text, as is an empty formula (`$$` alone, `$ $`).
 * - Currency heuristic for single `$` (the rule Pandoc uses): the opening `$` must be followed by a non-space, the
 *   closing `$` must be preceded by a non-space and not followed by a digit. So "$5 and $10" and "costs $5, or $10."
 *   stay text, while "$G$" and "$a + b$" are math. Only the next unescaped `$` can close a formula, so in
 *   "$5 for $x$" only "$x$" is math. A formula can't span a blank line.
 * Everything else, including a lone backslash, is text as written.
 */
export type MathSegment =
  | { kind: "text"; text: string }
  /** `raw` is the source with its delimiters, shown when KaTeX isn't loaded (yet) or can't render it. */
  | { kind: "math"; tex: string; display: boolean; raw: string };

const PAIRS = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
] as const;

/** Cheap pre-check: can `text` contain math at all? False means splitMath would return it as one text segment. */
export function mayContainMath(text: string): boolean {
  return text.includes("$") || text.includes("\\(") || text.includes("\\[");
}

/** Index of `close` at or after `from`, skipping backslash-escaped characters (so `\$` never closes a formula). */
function findClose(text: string, close: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text.startsWith(close, i)) return i;
    if (text[i] === "\\") i++; // `\$`, and `\\` (a TeX line break, not the start of a closing `\)`)
  }
  return -1;
}

/** Closing `$` of an inline formula opened at `start` (the heuristic above), or -1. */
function findInlineClose(text: string, start: number): number {
  if (!/\S/.test(text[start + 1] ?? "")) return -1; // "$ 5" or "$" at the end
  for (let i = start + 1; i < text.length; i++) { // text[start + 1] is never "$": "$$" is matched first
    const ch = text[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "\n" && text[i + 1] === "\n") return -1;
    if (ch !== "$") continue;
    // The next `$` decides: if it can't close ("$5 and $10"), this `$` opens nothing, and the next one gets its turn.
    return /\s/.test(text[i - 1]) || /\d/.test(text[i + 1] ?? "") ? -1 : i;
  }
  return -1;
}

export function splitMath(text: string): MathSegment[] {
  if (!mayContainMath(text)) return text ? [{ kind: "text", text }] : [];
  const out: MathSegment[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf });
    buf = "";
  };
  // A closing delimiter that isn't found from one opener won't be found from any later one either: remember that, so
  // text full of unmatched "\(" stays linear instead of rescanning to the end for each opener.
  const unclosed = new Set<string>();
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "$") { buf += "$"; i += 2; continue; }
    const pair = PAIRS.find((p) => text.startsWith(p.open, i));
    if (pair) {
      const end = unclosed.has(pair.close) ? -1 : findClose(text, pair.close, i + pair.open.length);
      if (end < 0) unclosed.add(pair.close);
      const tex = end < 0 ? "" : text.slice(i + pair.open.length, end);
      if (tex.trim()) {
        flush();
        const stop = end + pair.close.length;
        out.push({ kind: "math", tex: tex.trim(), display: pair.display, raw: text.slice(i, stop) });
        i = stop;
        continue;
      }
      buf += pair.open; // unbalanced or empty: the delimiter is text
      i += pair.open.length;
      continue;
    }
    if (ch === "$") {
      const end = findInlineClose(text, i);
      if (end > 0) {
        flush();
        out.push({ kind: "math", tex: text.slice(i + 1, end), display: false, raw: text.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** True when `text` has at least one formula (the check that decides whether KaTeX gets loaded). */
export function hasMath(text: string | undefined): boolean {
  return !!text && mayContainMath(text) && splitMath(text).some((s) => s.kind === "math");
}
