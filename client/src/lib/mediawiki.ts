import { CancelledError, normalizeName, SiteBlockedError, type LookupSense } from "@nodestorm/shared";
import { wikiName, type WikiSite } from "./wikiName";

/**
 * Definitions from community wikis that run MediaWiki and allow anonymous cross-site reads (`origin=*`): Moegirl
 * (萌娘百科), a Fandom wiki and a BWIKI (wiki.biligame.com) wiki the user names in Settings. Plain GET requests
 * without custom headers, so the browser needs no preflight. The page's summary is its intro as plain text
 * (TextExtracts where the wiki has it, else the first real paragraph of the rendered intro, infoboxes and tables left
 * out).
 */

export { wikiName, type WikiSite } from "./wikiName";

export interface WikiTarget {
  site: WikiSite;
  /** The Fandom subdomain ("minecraft") or the BWIKI game path ("ys"); unused for Moegirl. */
  wiki?: string;
}

export function wikiBase({ site, wiki }: WikiTarget): { api: string; page: (title: string) => string; label: string } | null {
  const path = (title: string) => encodeURIComponent(title.replace(/ /g, "_"));
  if (site === "moegirl") {
    return { api: "https://zh.moegirl.org.cn/api.php", page: (t) => `https://zh.moegirl.org.cn/${path(t)}`, label: "Moegirl" };
  }
  const name = wiki ? wikiName(site, wiki) : "";
  if (!name) return null;
  if (site === "fandom") {
    return { api: `https://${name}.fandom.com/api.php`, page: (t) => `https://${name}.fandom.com/wiki/${path(t)}`, label: `Fandom (${name})` };
  }
  return { api: `https://wiki.biligame.com/${name}/api.php`, page: (t) => `https://wiki.biligame.com/${name}/${path(t)}`, label: `BWIKI (${name})` };
}

async function api(base: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params })}`;
  let res: Response;
  try {
    res = await fetch(url, { signal, credentials: "omit" });
  } catch (e) {
    if (signal?.aborted) throw new CancelledError();
    throw new SiteBlockedError("wiki", e instanceof Error ? e.message : String(e));
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new SiteBlockedError("wiki", `HTTP ${res.status}`);
  return res.json();
}

/** The intro of rendered page HTML as plain text: the first paragraph that is prose (not an infobox or a table). */
export function introText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("aside, table, figure, style, script, sup, .infobox, .portable-infobox, .navbox, .mw-empty-elt, .toc").forEach((el) => el.remove());
  for (const p of doc.querySelectorAll("p")) {
    const text = (p.textContent ?? "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
    // Prose: long enough, and more than numbers and labels.
    if (text.length >= 30 && /[.。!！?？;；]|[\p{L}]{4}/u.test(text)) return text;
  }
  return "";
}

const clip = (text: string) => {
  if (text.length <= 600) return text;
  const cut = text.slice(0, 600);
  const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "));
  return end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
};

/** The summary of one page (following redirects), or null when the page doesn't exist or has no usable intro. */
async function pageSummary(base: string, title: string, signal?: AbortSignal): Promise<{ title: string; text: string } | null> {
  const q = await api(base, { action: "query", prop: "extracts", exintro: "1", explaintext: "1", redirects: "1", titles: title }, signal).catch((e) => {
    if (e instanceof CancelledError) throw e;
    return null; // a wiki without TextExtracts answers with a warning: fall back to parsing below
  });
  const page = q?.query?.pages?.[0];
  if (page?.missing) return null;
  const found = page?.title ?? title;
  const extract = typeof page?.extract === "string" ? page.extract.replace(/\s+/g, " ").trim() : "";
  if (extract.length >= 30) return { title: found, text: extract };
  const p = await api(base, { action: "parse", page: found, prop: "text", section: "0", redirects: "1", disablelimitreport: "1", disableeditsection: "1" }, signal);
  if (p?.error) return null;
  const html = typeof p?.parse?.text === "string" ? p.parse.text : p?.parse?.text?.["*"];
  const text = typeof html === "string" ? introText(html) : "";
  return text ? { title: p.parse.title ?? found, text } : null;
}

/**
 * Meanings of `name` from a community wiki: its own page when there is one (exact), else the first few search hits
 * that have a usable intro (near matches, for the user to confirm).
 */
export async function wikiLookup(target: WikiTarget, name: string, max: number, signal?: AbortSignal): Promise<LookupSense[]> {
  const base = wikiBase(target);
  if (!base) return [];
  const sense = (title: string, text: string, exact: boolean): LookupSense => ({
    name: title,
    domain: base.label,
    definition: clip(text),
    aliases: [],
    source: { site: base.label, title, url: base.page(title) },
    exact,
  });
  const own = await pageSummary(base.api, name.trim(), signal);
  if (own) return [sense(own.title, own.text, normalizeName(own.title) === normalizeName(name))];
  const search = await api(base.api, { action: "opensearch", search: name.trim(), limit: String(Math.max(1, max)), namespace: "0" }, signal);
  const titles: string[] = Array.isArray(search?.[1]) ? search[1].filter((t: unknown): t is string => typeof t === "string") : [];
  const out: LookupSense[] = [];
  for (const title of titles.slice(0, Math.max(1, max))) {
    const s = await pageSummary(base.api, title, signal);
    if (s) out.push(sense(s.title, s.text, false));
  }
  return out;
}
