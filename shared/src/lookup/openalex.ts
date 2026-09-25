import type { PaperWork } from "../model";
import { getJson, type LookupOptions } from "./http";

export interface PaperQuery {
  /** The concept's name. */
  name: string;
  /**
   * Terms from the concept's neighbourhood (its prerequisites' names, say) that tell its field apart: "Kernel" next
   * to "Group homomorphism" should not find kernel methods in machine learning. Used for one-word names only (see
   * `findPapers`).
   */
  context?: string[];
  /** Most works to return (1-25, default 8). */
  max?: number;
}

const OPENALEX = "https://api.openalex.org/works";

/**
 * Work types that aren't literature to read: covers, errata, retraction notices, reviews of a submission…
 * (`!a|b` is "none of these" in OpenAlex's filter syntax.)
 */
const NOT_READING = "paratext|erratum|retraction|peer-review|editorial|dataset|supplementary-material|grant";

/** Only the fields shown: smaller, faster answers. */
const FIELDS = "id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,open_access";

/**
 * A name as a search phrase. OpenAlex filter values can't hold `,` (next filter), `|` (or) or quotes, and upper-case
 * AND/OR/NOT are operators, so only letters, digits, spaces, hyphens and apostrophes are kept, in lower case.
 */
export function searchPhrase(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

/**
 * The search expression: the name as a phrase in title or abstract and, with context, at least one context phrase too.
 * `title_and_abstract.search` rather than `search=`, which also reads full texts: there "normal subgroup" finds
 * medical studies of a "normal" patient "subgroup".
 */
export function paperSearch(q: Pick<PaperQuery, "name" | "context">): string {
  const name = searchPhrase(q.name);
  const ctx = [...new Set((q.context ?? []).map(searchPhrase))].filter((c) => c && c !== name).slice(0, 5);
  return ctx.length ? `"${name}" AND (${ctx.map((c) => `"${c}"`).join(" OR ")})` : `"${name}"`;
}

/** The request for one search, most relevant first (OpenAlex's relevance counts citations too). */
export function papersUrl(search: string, max: number): string {
  const params = new URLSearchParams({
    filter: `title_and_abstract.search:${search},is_retracted:false,type:!${NOT_READING}`,
    per_page: String(max),
    select: FIELDS,
  });
  return `${OPENALEX}?${params}`;
}

/** Search OpenAlex yourself (its website), for the same phrase. */
export const openAlexSearchUrl = (name: string) => `https://openalex.org/works?${new URLSearchParams({ search: `"${searchPhrase(name)}"` })}`;

interface RawWork {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null;
  cited_by_count?: number | null;
  open_access?: { oa_url?: string | null } | null;
}

const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Titles can carry markup (`<i>`, `<sub>`, MathML): keep the text. */
const plain = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** A link we can show: https only (never `javascript:` or plain http). */
function httpsUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" && u.length <= 1000 ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** One OpenAlex work in our shape, or null when it has no title or id. Lengths fit what a stored result may hold. */
export function toPaper(w: RawWork): PaperWork | null {
  const id = w.id?.split("/").pop() ?? "";
  const title = plain(w.display_name ?? "");
  if (!/^W\d+$/.test(id) || !title) return null;
  const names = (w.authorships ?? []).map((a) => plain(a?.author?.display_name ?? "")).filter(Boolean);
  const authors = cut(names.slice(0, 3).join(", ") + (names.length > 3 ? " et al." : ""), 300);
  const doi = w.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  const venue = plain(w.primary_location?.source?.display_name ?? "");
  const url = (doi ? httpsUrl(`https://doi.org/${doi}`) : undefined) ?? httpsUrl(w.primary_location?.landing_page_url) ?? `https://openalex.org/${id}`;
  const oa = httpsUrl(w.open_access?.oa_url);
  return {
    id,
    title: cut(title, 500),
    ...(Number.isInteger(w.publication_year) && w.publication_year! > 0 && w.publication_year! <= 3000 ? { year: w.publication_year! } : {}),
    authors,
    ...(venue ? { venue: cut(venue, 300) } : {}),
    ...(doi && doi.length <= 300 ? { doi } : {}),
    url,
    citedBy: Math.max(0, Math.floor(w.cited_by_count ?? 0)),
    ...(oa && oa !== url ? { openAccessUrl: oa } : {}),
  };
}

async function search(expr: string, max: number, opts: LookupOptions): Promise<PaperWork[]> {
  const r = await getJson<{ results?: RawWork[] }>("OpenAlex", papersUrl(expr, max), opts);
  return (r?.results ?? []).map(toPaper).filter((p): p is PaperWork => p !== null);
}

/** One word ("Kernel", "Ring", "Field") is what usually means different things in different fields. */
const ambiguous = (name: string) => !searchPhrase(name).includes(" ");

/**
 * Real papers about a concept, from OpenAlex: works with the name as a phrase in their title or abstract, most
 * relevant first (OpenAlex's relevance counts citations too).
 *
 * A one-word name is searched with its `context`: works must also mention a neighbouring concept. When that finds
 * fewer than half of `max`, the name alone fills the list (a second request). Longer names ("Banach space", "First
 * isomorphism theorem") are specific already, and requiring a prerequisite's name in the abstract there only swaps
 * the standard references for obscure ones, so they are searched alone.
 *
 * Each search spends OpenAlex's keyless daily budget (about 100 searches per network a day), so this only runs when
 * asked. Returns the works and the expression that found the first of them.
 */
export async function findPapers(q: PaperQuery, opts: LookupOptions = {}): Promise<{ works: PaperWork[]; query: string }> {
  const max = Math.min(25, Math.max(1, Math.floor(q.max ?? 8)));
  if (!searchPhrase(q.name)) return { works: [], query: "" };
  const plainQuery = paperSearch({ name: q.name });
  const first = ambiguous(q.name) ? paperSearch(q) : plainQuery;
  let works = await search(first, max, opts);
  let query = first;
  if (first !== plainQuery && works.length < Math.ceil(max / 2)) {
    const seen = new Set(works.map((w) => w.id));
    if (!works.length) query = plainQuery;
    works = [...works, ...(await search(plainQuery, max, opts)).filter((w) => !seen.has(w.id))].slice(0, max);
  }
  return { works, query };
}
