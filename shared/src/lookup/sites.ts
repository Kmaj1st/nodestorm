import { normalizeName } from "../model";
import { getJson, type LookupOptions } from "./http";
import { definitionText, isDisambiguation, listedDefinitions, titleName, transclusions } from "./wikitext";

/** One meaning of a name, found in an encyclopedia. */
export interface LookupSense {
  name: string;
  /** Short context shown in "what do you mean?" (a Wikidata description, or the site). */
  domain: string;
  definition: string;
  aliases: string[];
  source: { site: string; title: string; url: string };
  /**
   * The page of exactly this name (or a redirect to it). Otherwise a near match (a prefix or fuzzy search hit, or
   * one of the meanings a disambiguation page lists), which the user should confirm before it becomes the definition.
   */
  exact: boolean;
}

// ---------- ProofWiki ----------

const PW = "https://proofwiki.org";
const pwApi = (params: Record<string, string>) =>
  `${PW}/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params })}`;
const pwUrl = (title: string) => `${PW}/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/g, ":")}`;

/** ProofWiki capitalises every word of a title except short connecting words. */
export function proofWikiTitle(name: string): string {
  const small = new Set(["of", "on", "in", "a", "an", "the", "and", "or", "to", "for", "by", "with", "under", "over"]);
  const words = name.trim().replace(/\s+/g, " ").split(" ");
  return `Definition:${words.map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join(" ")}`;
}

async function pwWikitext(title: string, opts: LookupOptions): Promise<{ title: string; text: string } | null> {
  const r = await getJson<{ parse?: { title: string; wikitext: string }; error?: { code: string } }>(
    "ProofWiki",
    pwApi({ action: "parse", page: title, prop: "wikitext", redirects: "1" }),
    opts,
  );
  return r?.parse ? { title: r.parse.title, text: r.parse.wikitext } : null;
}

/** A definition page's text, following one level of `{{:…}}` transclusion (how ProofWiki shares definitions). */
async function pwDefinition(title: string, opts: LookupOptions): Promise<{ title: string; definition: string } | null> {
  const page = await pwWikitext(title, opts);
  if (!page) return null;
  let definition = definitionText(page.text);
  if (!definition || definition.length < 20) {
    const inner = transclusions(page.text).find((t) => t.startsWith("Definition:"));
    const sub = inner ? await pwWikitext(inner, opts) : null;
    if (sub) definition = definitionText(sub.text);
  }
  return definition ? { title: page.title, definition } : null;
}

const pwSense = (title: string, definition: string, exact: boolean): LookupSense => ({
  name: titleName(title),
  domain: "ProofWiki",
  definition,
  aliases: [],
  source: { site: "ProofWiki", title, url: pwUrl(title) },
  exact,
});

/**
 * ProofWiki: the `Definition:<Name>` page. A disambiguation page (or no page) gives the definitions whose titles
 * start with the name, up to `max`, each read from its page.
 */
export async function proofWiki(name: string, max: number, opts: LookupOptions = {}): Promise<LookupSense[]> {
  const title = proofWikiTitle(name);
  const page = await pwWikitext(title, opts);
  if (page && !isDisambiguation(page.text)) {
    const d = await pwDefinition(page.title, opts);
    if (d) return [pwSense(d.title, d.definition, true)];
  }
  let candidates = page ? listedDefinitions(page.text) : [];
  if (!candidates.length) {
    const r = await getJson<{ query?: { prefixsearch?: { title: string }[] } }>(
      "ProofWiki",
      pwApi({ action: "query", list: "prefixsearch", pssearch: title, pslimit: String(max + 2) }),
      opts,
    );
    candidates = (r?.query?.prefixsearch ?? []).map((p) => p.title).filter((t) => !t.includes("/"));
  }
  const out: LookupSense[] = [];
  for (const t of candidates.slice(0, max)) {
    const d = await pwDefinition(t, opts);
    if (d) out.push(pwSense(d.title, d.definition, normalizeName(titleName(d.title)) === normalizeName(name)));
  }
  return out;
}

// ---------- Wikipedia + Wikidata ----------

interface WikiPage {
  title: string;
  missing?: boolean;
  extract?: string;
  description?: string;
  fullurl?: string;
  pageprops?: { disambiguation?: string };
}

const MAX_EXTRACT = 500;

/**
 * TextExtracts' plain text writes each formula as a dump of its MathML (lines indented by three or more spaces, one
 * token each) followed by `{\displaystyle …}`. Keep the LaTeX as `$…$` and drop the dump; the prose lines around a
 * formula start with a single space and stay.
 */
export function mathFromExtract(text: string): string {
  const marker = "{\\displaystyle";
  const tex: string[] = [];
  let out = "";
  let i = 0;
  for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, i)) {
    let depth = 0;
    let end = -1;
    for (let j = at; j < text.length; j++) {
      if (text[j] === "\\") j++;
      else if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) break;
    out += `${text.slice(i, at)}\u0000${tex.length}\u0000`;
    tex.push(text.slice(at + marker.length, end).trim());
    i = end + 1;
  }
  out += text.slice(i);
  if (!tex.length) return text.trim();
  return out
    .split("\n")
    .filter((l) => l.includes("\u0000") || !(/^\s*$/.test(l) || /^ {3,}/.test(l)))
    .map((l) => l.trim())
    .join(" ")
    .replace(/\u0000(\d+)\u0000/g, (_, k: string) => {
      // A formula ending a sentence carries its full stop inside: move it out.
      const m = /^(.*?)\s*([.,;])$/.exec(tex[Number(k)]);
      return m ? `$${m[1]}$${m[2]}` : `$${tex[Number(k)]}$`;
    })
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:)])/g, "$1")
    .trim();
}

/** The first sentences of an extract, up to about 500 characters, never cut inside a formula. */
export function shortExtract(extract: string): string {
  const s = extract.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_EXTRACT) return s;
  const cut = s.slice(0, MAX_EXTRACT);
  let at = cut.lastIndexOf(". ");
  // A sentence end inside $…$ doesn't count.
  while (at > 0 && (cut.slice(0, at).match(/\$/g)?.length ?? 0) % 2) at = cut.lastIndexOf(". ", at - 1);
  if (at > 100) return cut.slice(0, at + 1);
  let text = cut.trim();
  if ((text.match(/\$/g)?.length ?? 0) % 2) text = text.slice(0, text.lastIndexOf("$")).trim();
  return `${text} …`;
}

/** Wikipedia pages by title (redirects followed): intro as text with $…$ maths, description, URL, disambiguation. */
async function pages(lang: string, titles: string[], opts: LookupOptions): Promise<WikiPage[]> {
  const r = await getJson<{ query?: { pages?: WikiPage[]; redirects?: unknown } }>(
    "Wikipedia",
    `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
      action: "query",
      prop: "extracts|description|pageprops|info",
      ppprop: "disambiguation",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      redirects: "1",
      titles: titles.join("|"),
      format: "json",
      formatversion: "2",
      origin: "*",
    })}`,
    opts,
  );
  return r?.query?.pages ?? [];
}

const usable = (p: WikiPage | undefined): p is WikiPage => Boolean(p && !p.missing && !p.pageprops && p.extract?.trim());

const wpSense = (lang: string, p: WikiPage, domain: string, exact: boolean, aliases: string[] = []): LookupSense => ({
  name: p.title,
  domain,
  definition: shortExtract(mathFromExtract(p.extract ?? "")),
  aliases,
  source: {
    site: "Wikipedia",
    title: p.title,
    url: p.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
  },
  exact,
});

/**
 * Wikipedia's article of that name; when there's none or it's a disambiguation page, Wikidata's matching items
 * (label + description), each with its Wikipedia summary where it has an article in this language.
 */
export async function wikipedia(name: string, lang: string, max: number, opts: LookupOptions = {}): Promise<LookupSense[]> {
  const [direct] = await pages(lang, [name], opts);
  if (usable(direct)) return [wpSense(lang, direct, direct.description ?? "Wikipedia", true)];
  const found = await getJson<{ search?: { id: string; label?: string; description?: string; aliases?: string[] }[] }>(
    "Wikidata",
    `https://www.wikidata.org/w/api.php?${new URLSearchParams({
      action: "wbsearchentities", search: name, language: lang, uselang: lang, type: "item", limit: String(max + 3), format: "json", origin: "*",
    })}`,
    opts,
  );
  const items = (found?.search ?? []).filter((i) => i.description && !/disambiguation|Wikimedia/i.test(i.description)).slice(0, max);
  if (!items.length) return [];
  const links = await getJson<{ entities?: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(
    "Wikidata",
    `https://www.wikidata.org/w/api.php?${new URLSearchParams({
      action: "wbgetentities", ids: items.map((i) => i.id).join("|"), props: "sitelinks", sitefilter: `${lang}wiki`, format: "json", origin: "*",
    })}`,
    opts,
  );
  const articles = items.map((it) => links?.entities?.[it.id]?.sitelinks?.[`${lang}wiki`]?.title);
  const wanted = articles.filter((a): a is string => Boolean(a));
  // One request for all the articles' intros.
  const got = wanted.length ? await pages(lang, wanted, opts) : [];
  // Wikidata's search is fuzzy: an item is an exact match only when its label or an alias is the name.
  const key = normalizeName(name);
  return items.map((it, k) => {
    const exact = [it.label ?? "", ...(it.aliases ?? [])].some((l) => normalizeName(l) === key);
    const page = got.find((p) => p.title === articles[k]);
    if (usable(page)) return wpSense(lang, page, it.description!, exact, it.aliases ?? []);
    return {
      name: it.label ?? name,
      domain: it.description!,
      definition: it.description!,
      aliases: it.aliases ?? [],
      source: { site: "Wikidata", title: it.id, url: `https://www.wikidata.org/wiki/${it.id}` },
      exact,
    };
  });
}
