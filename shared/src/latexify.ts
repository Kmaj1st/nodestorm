/**
 * "Formulas → LaTeX": a definition's formulas written with Unicode symbols ("φ(ab) = φ(a)φ(b)", "x² ≤ y") rewritten as
 * LaTeX by the AI. Only the formulas may change: `onlyFormulasChanged` compares the words outside the formulas before
 * and after, and an answer that reworded anything is refused.
 */

/** Unicode characters that only appear in formulas: Greek letters, super/subscripts, arrows, operators, math symbols. */
export const UNICODE_MATH = /[Α-Ωα-ωϑϕϵ²³¹±×÷·⁰-₟←-⇿∀-⋿⨀-⫿⟨⟩‖]/u;

/** Formulas already written as LaTeX ($…$, $$…$$, \(…\), \[…\]): left out when comparing words. */
const LATEX = /\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;

/** Words that are also names of functions or operators in formulas ("sin x", "ker φ"): they may move into a formula. */
const MATH_WORDS = new Set(
  "sin cos tan cot sec csc log ln lg exp lim sup inf max min det dim ker im deg gcd lcm arg mod hom aut end tr rank span sgn var cov".split(" "),
);

/**
 * The words of `text` outside its formulas, in order: runs of 3+ letters (Latin, Cyrillic…) or single CJK characters,
 * that aren't glued to a formula symbol, digit or bracket (a variable such as "ab" in "φ(ab)" isn't a word).
 */
export function proseWords(text: string): string[] {
  const out: string[] = [];
  const plain = text.replace(LATEX, " ");
  for (const m of plain.matchAll(/[\p{L}\p{M}]+/gu)) {
    const word = m[0];
    const before = plain[m.index - 1] ?? " ";
    const after = plain[m.index + word.length] ?? " ";
    const glued = (c: string) => !/[\s.,;:!?"'“”‘’«»()（），。；：！？、—–-]/u.test(c) || c === "(" || c === ")";
    for (const part of word.split(/(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])|(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/u)) {
      if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(part)) out.push(part);
      else if (part.length >= 3 && !UNICODE_MATH.test(part) && !MATH_WORDS.has(part.toLowerCase()) && !(glued(before) || glued(after))) out.push(part.toLowerCase());
    }
  }
  return out;
}

/** True when `after` keeps every word of `before` outside the formulas, in the same order (only formulas changed). */
export function onlyFormulasChanged(before: string, after: string): boolean {
  const a = proseWords(before);
  const b = proseWords(after);
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** Whether `text` has formulas written with Unicode symbols outside any LaTeX (the button is offered then). */
export function hasUnicodeMath(text: string): boolean {
  return UNICODE_MATH.test(text.replace(LATEX, " "));
}
