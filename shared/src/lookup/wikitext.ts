/**
 * ProofWiki wikitext → NodeStorm text: prose with `$…$` LaTeX. ProofWiki writes its maths with house macros
 * (`\map f x`, `\set {…}`, `\paren {…}`…) that KaTeX doesn't know, so those are expanded into standard LaTeX here,
 * and the stored definition stays portable (Markdown export, Anki, other tools).
 */

/** Read one macro argument at `i` (skipping spaces): a `{…}` group, a `\command`, or a single character. */
function readArg(s: string, i: number): { arg: string; end: number } | null {
  while (s[i] === " ") i++;
  if (i >= s.length) return null;
  if (s[i] === "{") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "\\") {
        j++;
        continue;
      }
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) return { arg: s.slice(i + 1, j), end: j + 1 };
    }
    return null;
  }
  if (s[i] === "\\") {
    const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
    return m ? { arg: m[0], end: i + m[0].length } : null;
  }
  if (s[i] === "}" || s[i] === "$") return null;
  return { arg: s[i], end: i + 1 };
}

/** Macros with arguments: name → (arity, expansion). */
const WITH_ARGS: Record<string, [number, (a: string[]) => string]> = {
  map: [2, ([f, x]) => `${f}\\left(${x}\\right)`],
  paren: [1, ([x]) => `\\left(${x}\\right)`],
  sqbrk: [1, ([x]) => `\\left[${x}\\right]`],
  set: [1, ([x]) => `\\left\\{${x}\\right\\}`],
  size: [1, ([x]) => `\\left|${x}\\right|`],
  card: [1, ([x]) => `\\left|${x}\\right|`],
  norm: [1, ([x]) => `\\left\\|${x}\\right\\|`],
  gen: [1, ([x]) => `\\left\\langle ${x}\\right\\rangle`],
  struct: [1, ([x]) => `\\left(${x}\\right)`],
  tuple: [1, ([x]) => `\\left(${x}\\right)`],
  closedint: [2, ([a, b]) => `\\left[${a} \\,.\\,.\\, ${b}\\right]`],
  openint: [2, ([a, b]) => `\\left(${a} \\,.\\,.\\, ${b}\\right)`],
  hointr: [2, ([a, b]) => `\\left[${a} \\,.\\,.\\, ${b}\\right)`],
  hointl: [2, ([a, b]) => `\\left(${a} \\,.\\,.\\, ${b}\\right]`],
  powerset: [1, ([x]) => `\\mathcal P\\left(${x}\\right)`],
  floor: [1, ([x]) => `\\left\\lfloor ${x}\\right\\rfloor`],
  ceiling: [1, ([x]) => `\\left\\lceil ${x}\\right\\rceil`],
  cmod: [1, ([x]) => `\\left|${x}\\right|`],
  eval: [1, ([x]) => `\\left.${x}\\right|`],
  Dom: [1, ([x]) => `\\operatorname{Dom}\\left(${x}\\right)`],
  Cdm: [1, ([x]) => `\\operatorname{Cdm}\\left(${x}\\right)`],
  Img: [1, ([x]) => `\\operatorname{Im}\\left(${x}\\right)`],
  Preimg: [1, ([x]) => `\\operatorname{Im}^{-1}\\left(${x}\\right)`],
  order: [1, ([x]) => `\\left|${x}\\right|`],
  index: [2, ([a, b]) => `\\left[${a} : ${b}\\right]`],
};

/** Macros without arguments. */
const PLAIN: Record<string, string> = {
  O: "\\varnothing",
  N: "\\mathbb N",
  Z: "\\mathbb Z",
  Q: "\\mathbb Q",
  R: "\\mathbb R",
  C: "\\mathbb C",
  ds: "\\displaystyle",
  leadsto: "\\rightsquigarrow",
  divides: "\\mid",
  Ker: "\\ker",
  Rng: "\\operatorname{Rng}",
  Cl: "\\operatorname{Cl}",
  lcm: "\\operatorname{lcm}",
};

/** Expand ProofWiki's macros in one LaTeX formula (repeatedly, for nested ones). */
export function expandMacros(tex: string): string {
  let out = tex;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    let res = "";
    let i = 0;
    while (i < out.length) {
      const m = /^\\([A-Za-z]+)/.exec(out.slice(i));
      if (!m) {
        res += out[i++];
        continue;
      }
      const name = m[1];
      const after = i + m[0].length;
      const spec = WITH_ARGS[name];
      if (spec) {
        const args: string[] = [];
        let j = after;
        for (let k = 0; k < spec[0]; k++) {
          const a = readArg(out, j);
          if (!a) break;
          args.push(a.arg);
          j = a.end;
        }
        if (args.length === spec[0]) {
          res += spec[1](args);
          i = j;
          changed = true;
          continue;
        }
      } else if (name in PLAIN && PLAIN[name] && !/[A-Za-z]/.test(out[after] ?? "")) {
        res += PLAIN[name];
        i = after;
        changed = true;
        continue;
      }
      res += m[0];
      i = after;
    }
    out = res;
    if (!changed) break;
  }
  return out;
}

/** Remove `{{…}}` templates (nested ones too). */
function stripTemplates(s: string): string {
  let out = s;
  for (let pass = 0; pass < 5 && out.includes("{{"); pass++) out = out.replace(/\{\{[^{}]*\}\}/g, "");
  return out;
}

/** The `:Page` transcluded by `{{:Page}}` templates, in order. */
export function transclusions(wikitext: string): string[] {
  return [...wikitext.matchAll(/\{\{:([^{}|]+?)\s*(?:\|[^{}]*)?\}\}/g)].map((m) => m[1].trim());
}

/** The definition pages a disambiguation-style page lists (`* [[Definition:…]]` lines), in order, once each. */
export function listedDefinitions(wikitext: string): string[] {
  const out: string[] = [];
  for (const m of wikitext.matchAll(/^\s*[*#:]+.*?\[\[(Definition:[^\]|#]+)(?:[|#][^\]]*)?\]\]/gm)) {
    const title = m[1].trim();
    if (!out.includes(title)) out.push(title);
  }
  return out;
}

/** Does the page only point at other definitions (ProofWiki's disambiguation pages)? */
export function isDisambiguation(wikitext: string): boolean {
  if (/\{\{\s*(Disambiguation|DisambiguationPage)\b/i.test(wikitext)) return true;
  const body = definitionSection(wikitext);
  const prose = body.split("\n").filter((l) => l.trim() && !/^\s*[*#]/.test(l) && !/^\s*\{\{/.test(l));
  return listedDefinitions(body).length >= 2 && prose.length <= 1;
}

/** The text of the "Definition" section, or of the page up to its first heading when it has none. */
function definitionSection(wikitext: string): string {
  const m = /^==\s*Definition\s*==\s*$/im.exec(wikitext);
  const start = m ? m.index + m[0].length : 0;
  const rest = wikitext.slice(start);
  const next = /^==[^=].*==\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

const MAX = 700;

/** The first definition on a ProofWiki page, as prose with `$…$` maths, at most about 700 characters. */
export function definitionText(wikitext: string): string {
  let s = definitionSection(wikitext.replace(/<!--[\s\S]*?-->/g, ""));
  // Several numbered definitions: keep the first.
  const sub = /^===\s*Definition 1\s*===\s*$/im.exec(s);
  if (sub) {
    const rest = s.slice(sub.index + sub[0].length);
    const next = /^===.*===\s*$/m.exec(rest);
    s = next ? rest.slice(0, next.index) : rest;
  }
  s = s
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<\/?(?:onlyinclude|includeonly|noinclude|section)[^>]*>/g, "");
  s = stripTemplates(s)
    .replace(/\[\[(?:Category|File|Image):[^\]]*\]\]/g, "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, (_, t: string) => t.replace(/^Definition:/, ""))
    .replace(/'''?/g, "")
    .replace(/^=+.*=+\s*$/gm, "");
  // Maths: expand macros inside each $…$; a line that is only a formula (":$…$") stays on its own line.
  s = s.replace(/\$([^$]+)\$/g, (_, tex: string) => `$${expandMacros(tex).trim()}$`);
  const lines = s
    .split("\n")
    .map((l) => l.replace(/^[:*#;]+\s*/, "").trim())
    .filter(Boolean);
  let text = lines.join("\n").replace(/[ \t]+/g, " ").trim();
  if (text.length > MAX) {
    // Cut at the last sentence or line end before the limit, never inside a formula.
    const cut = text.slice(0, MAX);
    const at = Math.max(cut.lastIndexOf(".\n"), cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    text = (at > MAX / 3 ? cut.slice(0, at + 1) : cut).trim();
    if ((text.match(/\$/g)?.length ?? 0) % 2) text = text.slice(0, text.lastIndexOf("$")).trim();
    text += " …";
  }
  return text;
}

/** "Definition:Kernel of Group Homomorphism" → "Kernel of Group Homomorphism". */
export const titleName = (title: string) => title.replace(/^Definition:/, "").replace(/\/.*$/, "").trim();
