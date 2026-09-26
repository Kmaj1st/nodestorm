import { lookupLanguage } from "./lookup";

/**
 * How a concept card wraps its name: the name's language (by its script) so the browser hyphenates a long word with
 * the right rules and draws Chinese / Japanese with the right glyphs, and how long its longest word is, so a single
 * long word ("Zusammenhangskomponente") is set a little smaller instead of being cut into many pieces.
 */
export interface NameWrap {
  lang: string;
  /** "long": the longest word has 13+ letters, "xlong": 20+. Words of CJK text don't count (they wrap anywhere). */
  size?: "long" | "xlong";
}

export function nameWrap(name: string): NameWrap {
  const lang = lookupLanguage("auto", name);
  const longest = Math.max(0, ...name.split(/[\s\-‐–—/]+/).map((w) => (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w) ? 0 : [...w].length)));
  return { lang, size: longest >= 20 ? "xlong" : longest >= 13 ? "long" : undefined };
}
