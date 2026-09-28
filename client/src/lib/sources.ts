import {
  ASSESS_MAX,
  ASSESS_TEXT_MAX,
  CancelledError,
  normalizeName,
  type AssessRating,
  type LookupSense,
  type Reliability,
  type Sense,
  type SourceRef,
} from "@nodestorm/shared";
import { t } from "../i18n";
import { isReady, useSettings } from "../store/settingsStore";
import { api } from "./api";
import { errorMessage } from "./errors";
import { everySite, lookupEverywhere, lookupLanguage, SITE_NAME, type Site } from "./lookup";
import { ENGINE_NAME, searchEngines, searchReady, searchWeb, type Engine } from "./webSearch";

/**
 * Sources for a concept's definition: what the encyclopedias and wikis found (lib/lookup.ts) and what the web search
 * engines found (lib/webSearch.ts), in one list. With an AI set up, one "assess" call rates them against each other
 * and points at the passage of each that defines the concept, quoted word for word (shared/src/ai/tasks.ts checks the
 * quote really is the source's text). The AI never writes the definition: whatever the user picks is a source's own
 * words, stored with that source.
 */

export interface Source {
  id: string;
  kind: "encyclopedia" | "web";
  /** The site as shown: "Wikipedia", "Fandom (minecraft)", or a web page's host ("mathworld.wolfram.com"). */
  site: string;
  title: string;
  url?: string;
  /** The text we have of it: the encyclopedia's definition, or the search engine's excerpt of the page. */
  text: string;
  /** An encyclopedia entry's own name ("Kernel (algebra)") and short context; web pages have none. */
  name?: string;
  domain?: string;
  /** The encyclopedia page of exactly the concept's name. */
  exact?: boolean;
  /** Null when not rated (no AI, the check failed, or the AI left it out). */
  reliability: Reliability | null;
  reasons: string;
  /** The AI's short label of the meaning of the name it describes. */
  sense: string;
  /** The part of `text` that defines the concept, verbatim: the AI's pick, else the first sentence or two. */
  passage: string;
  /** True when the AI pointed at the passage (false: the non-AI default, or none). */
  pointed: boolean;
  /** How many sources the AI compared when it rated this one (set with `reliability`). */
  compared?: number;
}

export interface Gathered {
  name: string;
  /** Most reliable first, not rated last (in the order found: encyclopedias, then the search engines'). */
  sources: Source[];
  /** The AI's note on how far the sources agree ("" when not rated). */
  note: string;
  /** The AI rated them. */
  rated: boolean;
  /** Why the AI's check failed (the sources are then shown unrated). */
  assessError?: string;
  /** Sites and search engines asked, and those that failed, by their shown names. */
  asked: string[];
  failed: string[];
  /** A search engine was configured and asked (otherwise the pop-up suggests setting one up). */
  web: boolean;
}

const RANK: Record<Reliability, number> = { high: 0, medium: 1, low: 2, unusable: 3 };
const rank = (s: Source) => (s.reliability ? RANK[s.reliability] : 4);

/** Most reliable first, not rated last; otherwise in the order found (a stable sort). */
export function sortSources(sources: Source[]): Source[] {
  return [...sources].sort((a, b) => rank(a) - rank(b));
}

/** A look-up site's name as shown, with the wiki for Fandom and BWIKI. */
export function siteName(site: Site): string {
  const { lookup } = useSettings.getState();
  if (site === "fandom" && lookup.fandom) return `Fandom (${lookup.fandom})`;
  if (site === "bwiki" && lookup.bwiki) return `BWIKI (${lookup.bwiki})`;
  return SITE_NAME[site];
}

/** The host of a URL without "www.", for a web source's site. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A URL for telling duplicates apart: no fragment, no trailing slash, the host in lower case, http as https. */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim();
  }
}

/**
 * The non-AI passage of a web excerpt: its first sentence, and the second too when the first is very short. Always a
 * piece of the text itself (from its start), so it is the page's own words.
 */
export function leadSentences(text: string): string {
  const ends = [...text.matchAll(/(?<!\b(?:e\.g|i\.e|cf|etc|vs))[.!?](?=\s|$)|[。！？]/g)].map((m) => m.index! + m[0].length);
  if (!ends.length) return text.trim().slice(0, 400).trim();
  const first = ends[0];
  const end = first < 60 && ends[1] && ends[1] <= 400 ? ends[1] : first;
  return text.slice(0, end).trim();
}

/** The passage used when the AI didn't point at one: an encyclopedia's whole definition, a web page's lead. */
export function defaultPassage(s: Pick<Source, "kind" | "text">): string {
  return s.kind === "encyclopedia" ? s.text.trim() : leadSentences(s.text);
}

/** Longest AI reason kept with a chosen definition's source. */
const REASONS_MAX = 500;

/**
 * The source recorded with a definition taken from `s`: its site, title and (https) page, and the AI's rating of it
 * when it was rated (its reliability, short reason and how many sources were compared; never text for the definition).
 */
export function sourceRef(s: Pick<Source, "site" | "title" | "url"> & Partial<Pick<Source, "reliability" | "reasons" | "compared">>): SourceRef {
  const compared = Math.min(100, Math.max(1, Math.round(s.compared ?? 0)));
  return {
    site: s.site.slice(0, 100),
    title: (s.title || s.site).slice(0, 300),
    ...(s.url && /^https:\/\//.test(s.url) ? { url: s.url.slice(0, 2000) } : {}),
    ...(s.reliability && s.compared ? { rating: { reliability: s.reliability, reasons: (s.reasons ?? "").trim().slice(0, REASONS_MAX), compared } } : {}),
  };
}

/** Only https pages are linked from the pop-up (never javascript:, data: or plain http). */
const isHttps = (url: string | undefined): url is string => /^https:\/\/[^\s]/i.test(url ?? "");

function fromLookup(l: LookupSense, i: number): Source {
  const text = l.definition.trim();
  return {
    id: `e${i + 1}`,
    kind: "encyclopedia",
    site: l.source.site,
    title: l.source.title,
    url: isHttps(l.source.url) ? l.source.url : undefined,
    text,
    name: l.name,
    domain: l.domain,
    exact: l.exact,
    reliability: null,
    reasons: "",
    sense: "",
    passage: text,
    pointed: false,
  };
}

/** The sources found (unrated), merged: encyclopedias first, then the web; one per page. */
export function mergeFound(found: LookupSense[], web: { title: string; url: string; site: string; text: string }[]): Source[] {
  const out = found.filter((l) => l.definition.trim()).map(fromLookup);
  const seen = new Set(out.map((s) => s.url && urlKey(s.url)).filter(Boolean));
  web.forEach((w, i) => {
    const text = w.text.trim();
    const key = urlKey(w.url);
    if (!text || !isHttps(w.url) || seen.has(key)) return;
    seen.add(key);
    const src: Source = {
      id: `w${i + 1}`,
      kind: "web",
      site: hostOf(w.url) || w.site,
      title: w.title.trim(),
      url: w.url,
      text,
      reliability: null,
      reasons: "",
      sense: "",
      passage: "",
      pointed: false,
    };
    out.push({ ...src, passage: defaultPassage(src) });
  });
  return out;
}

/**
 * The AI's ratings merged into the sources: its reliability, reasons, meaning and passage (a passage it didn't find
 * keeps the default one, marked as not the AI's). Sources it left out stay not rated. Sorted by reliability.
 */
export function mergeRatings(sources: Source[], ratings: AssessRating[]): Source[] {
  const by = new Map(ratings.map((r) => [r.id, r]));
  const compared = sources.filter((s) => by.get(s.id)?.reliability).length;
  return sortSources(
    sources.map((s) => {
      const r = by.get(s.id);
      if (!r) return s;
      // A quote is kept only when it really is this source's text (the task checked it against the trimmed text).
      const pointed = Boolean(r.passage && s.text.includes(r.passage));
      return {
        ...s,
        reliability: r.reliability,
        reasons: r.reasons,
        sense: r.sense,
        passage: pointed ? r.passage : s.passage,
        pointed,
        ...(r.reliability ? { compared } : {}),
      };
    }),
  );
}

export interface SenseGroup {
  /** The meaning ("" for a single group, or sources without one). */
  sense: string;
  sources: Source[];
}

/**
 * The sources by meaning, when the AI says they describe different meanings of the name (groups in the order of
 * their most reliable source, sources without a meaning last); otherwise one group.
 */
export function groupBySense(sources: Source[]): SenseGroup[] {
  const label = (s: Source) => (s.reliability ? s.sense.trim() : "");
  const keys = new Set(sources.map((s) => normalizeName(label(s))).filter(Boolean));
  if (keys.size < 2) return [{ sense: "", sources }];
  const groups = new Map<string, SenseGroup>();
  const rest: Source[] = [];
  for (const s of sources) {
    const k = normalizeName(label(s));
    if (!k) rest.push(s);
    else if (groups.has(k)) groups.get(k)!.sources.push(s);
    else groups.set(k, { sense: label(s), sources: [s] });
  }
  return [...groups.values(), ...(rest.length ? [{ sense: "", sources: rest }] : [])];
}

/**
 * The passage a concept takes without asking (Settings: use the AI right away, and Install all): the most reliable
 * source's, when the AI rated it high or medium, unless equally reliable sources describe different meanings of the
 * name (the user then picks the meaning). Without a rating only an encyclopedia page of exactly the name, found alone,
 * is taken (as the look-ups always did). Undefined: the user chooses (or writes) the definition.
 */
export function autoPick(g: Pick<Gathered, "sources" | "rated">): Source | undefined {
  if (g.rated) {
    // An encyclopedia's near match (a page for another name, "Normal subgroup" for "Normal") is never taken unasked.
    const top = g.sources.find(
      (s) => s.passage && (s.reliability === "high" || s.reliability === "medium") && (s.kind === "web" || s.exact),
    );
    if (!top) return undefined;
    const peers = g.sources.filter((s) => s.passage && s.reliability === top.reliability);
    const meanings = new Set(peers.map((s) => normalizeName(s.sense)).filter(Boolean));
    return meanings.size > 1 ? undefined : top;
  }
  const [only] = g.sources;
  return g.sources.length === 1 && only.kind === "encyclopedia" && only.exact && only.passage ? only : undefined;
}

/** The sources as meanings stored on a concept waiting for a choice: each with its passage and source (never the AI). */
export function sourcesAsSenses(sources: Source[], name: string): Sense[] {
  return sources
    .filter((s) => s.reliability !== "unusable" && (s.passage || s.text.trim()))
    .map((s) => ({
      name: s.kind === "encyclopedia" && s.name?.trim() ? s.name : name,
      domain: s.sense || s.domain || "",
      definition: s.passage || defaultPassage(s),
      source: sourceRef(s),
      kind: null,
    }));
}

/**
 * Sources rebuilt from a concept's stored meanings (after a reload, when the gathered ones are gone): the stored
 * passage as their text, with the AI's rating when one was kept with it. Meanings the AI wrote (older projects) are
 * left out.
 */
export function sourcesFromSenses(senses: readonly Sense[]): Source[] {
  return senses
    .filter((s) => s.source?.site && s.source.site !== "AI" && s.definition.trim())
    .map((s, i) => ({
      id: `s${i + 1}`,
      // A web page's site is its host name; an encyclopedia's is a name ("Wikipedia", "Fandom (minecraft)").
      kind: /^[\w-]+(\.[\w-]+)+$/.test(s.source!.site!) ? ("web" as const) : ("encyclopedia" as const),
      site: s.source!.site!,
      title: s.source!.title,
      url: s.source!.url,
      text: s.definition,
      name: s.name,
      domain: s.domain,
      reliability: s.source!.rating?.reliability ?? null,
      reasons: s.source!.rating?.reasons ?? "",
      // A rated source's meaning was stored as its domain (see sourcesAsSenses).
      sense: s.source!.rating ? s.domain : "",
      passage: s.definition,
      pointed: false,
      ...(s.source!.rating ? { compared: s.source!.rating.compared } : {}),
    }));
}

type Found = Pick<Gathered, "sources" | "asked" | "failed" | "web">;
type Rating = { ratings: AssessRating[]; note: string };

type Entry = { at: number; found: Found; rating?: Rating };

/**
 * Sources found lately (a search costs the user's quota, a rating an AI call), with the AI's rating once it has one.
 * Kept in memory and in localStorage (a day, 50 names, about 500 KB), so the badge reopens the rated sources after a
 * reload without searching again. "Look up in…" and "Search the web and compare…" drop a name's entry.
 */
let cache: Map<string, Entry> | null = null;
const CACHE_MAX = 50;
const CACHE_MS = 24 * 60 * 60_000;
export const SOURCES_CACHE_KEY = "nodestorm-sources-cache";
/** Characters of JSON kept in localStorage at most (oldest names go first). */
export const SOURCES_CACHE_CHARS = 500_000;

const isStr = (v: unknown): v is string => typeof v === "string";
const RELIABILITIES = new Set(["high", "medium", "low", "unusable"]);

/** A stored source, checked field by field (the storage may hold anything: an older version's, or damaged data). */
function storedSource(v: unknown): v is Source {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    isStr(s.id) && (s.kind === "encyclopedia" || s.kind === "web") && isStr(s.site) && isStr(s.title) && isStr(s.text) &&
    (s.url === undefined || isStr(s.url)) && (s.reliability === null || RELIABILITIES.has(s.reliability as string)) &&
    isStr(s.reasons) && isStr(s.sense) && isStr(s.passage) && typeof s.pointed === "boolean"
  );
}

function storedEntry(v: unknown): v is Entry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  const f = e.found as Record<string, unknown> | undefined;
  if (typeof e.at !== "number" || !f || typeof f !== "object") return false;
  if (!Array.isArray(f.sources) || !f.sources.every(storedSource)) return false;
  if (!Array.isArray(f.asked) || !f.asked.every(isStr) || !Array.isArray(f.failed) || !f.failed.every(isStr) || typeof f.web !== "boolean") return false;
  if (e.rating === undefined) return true;
  const r = e.rating as Record<string, unknown> | null;
  return Boolean(r) && isStr(r!.note) && Array.isArray(r!.ratings) && r!.ratings.every((x) => x && typeof x === "object" && isStr((x as Record<string, unknown>).id));
}

function loadCache(): Map<string, Entry> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SOURCES_CACHE_KEY) ?? "[]");
    const now = Date.now();
    // Oldest first, as the Map keeps them: the first ones go when it is full.
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (Array.isArray(item) && isStr(item[0]) && storedEntry(item[1]) && now - item[1].at < CACHE_MS) cache.set(item[0], item[1]);
      }
    }
  } catch {
    /* unavailable or damaged: start empty */
  }
  return cache;
}

function saveCache() {
  const c = loadCache();
  const now = Date.now();
  for (const [k, e] of c) if (now - e.at >= CACHE_MS) c.delete(k);
  while (c.size > CACHE_MAX) c.delete(c.keys().next().value!);
  const entries = [...c];
  let json = JSON.stringify(entries);
  // Over the size cap (long pages), or the storage full: the oldest names go until it fits.
  while (entries.length) {
    if (json.length <= SOURCES_CACHE_CHARS) {
      try {
        localStorage.setItem(SOURCES_CACHE_KEY, json);
        return;
      } catch {
        /* full: drop more */
      }
    }
    entries.shift();
    json = JSON.stringify(entries);
  }
  try {
    localStorage.removeItem(SOURCES_CACHE_KEY);
  } catch {
    /* unavailable */
  }
}

/** Per name, language and what is asked (another site, wiki or engine set up in Settings is another answer). */
const cacheKey = (name: string) => {
  const { language, lookup } = useSettings.getState();
  return [lookupLanguage(language, name), everySite(name).join(","), lookup.fandom, lookup.bwiki, searchEngines().join(","), normalizeName(name)].join(":");
};

/** Forget what was found for `name` ("Look up in…", "Search the web and compare…": the user wants a fresh look). */
export function forgetSources(name: string) {
  const c = loadCache();
  if (c.delete(cacheKey(name))) saveCache();
}

async function find(name: string, signal?: AbortSignal): Promise<Found> {
  const web = searchReady();
  const [looked, searched] = await Promise.all([
    lookupEverywhere(name, useSettings.getState().clarify.options, signal),
    web
      ? searchWeb(name, { max: useSettings.getState().search.maxResults, signal }).catch((e) => {
          if (e instanceof CancelledError || signal?.aborted) throw new CancelledError();
          console.warn("Web search failed:", e);
          return { results: [], asked: [] as Engine[], failed: [] as Engine[], error: true };
        })
      : undefined,
  ]);
  const failedSearch = searched && "error" in searched;
  return {
    sources: mergeFound(looked.senses, searched?.results ?? []),
    asked: [...looked.asked.map(siteName), ...(searched?.asked ?? []).map((e) => ENGINE_NAME[e])],
    failed: [...looked.failed.map(siteName), ...(searched?.failed ?? []).map((e) => ENGINE_NAME[e]), ...(failedSearch ? [t("sources.webSearch")] : [])],
    web,
  };
}

export interface GatherOptions {
  signal?: AbortSignal;
  /** Why the concept is needed (an installed prerequisite), for the AI to tell which meaning is meant. */
  hint?: string;
  /** Names of related concepts in the graph. */
  context?: string[];
  /** Called when the search is done and the AI starts checking the sources (the status bar says so). */
  onChecking?: () => void;
  /** Search again instead of using this session's results. */
  fresh?: boolean;
}

/**
 * Every source for `name`: the encyclopedias and wikis, and the web search engines when one is set up, asked side by
 * side; merged (one per page) and, with an AI set up, rated by the AI in one call. Without an AI the sources are
 * unrated, in the order found, each with its default passage. Cached per name (a day, also across reloads); throws only
 * CancelledError (a failing site, engine or AI check is reported in the result).
 */
export async function gatherSources(name: string, opts: GatherOptions = {}): Promise<Gathered> {
  const { signal } = opts;
  const key = cacheKey(name);
  const cache = loadCache();
  let hit = opts.fresh ? undefined : cache.get(key);
  // Results from before a search engine was set up (or while it failed) are asked again.
  if (hit && (Date.now() - hit.at > CACHE_MS || hit.found.web !== searchReady())) hit = undefined;
  const found = hit?.found ?? (await find(name, signal));
  if (signal?.aborted) throw new CancelledError();
  if (!hit) {
    const had = cache.delete(key);
    if (!found.failed.length) {
      cache.set(key, { at: Date.now(), found });
      saveCache();
    } else if (had) saveCache();
  }
  const out: Gathered = { name, ...found, sources: sortSources(found.sources), note: "", rated: false };
  if (!found.sources.length || !isReady(useSettings.getState())) return out;
  let rating = hit?.rating;
  if (!rating) {
    opts.onChecking?.();
    const sent = found.sources.slice(0, ASSESS_MAX);
    try {
      rating = await api.assess(
        {
          name,
          hint: opts.hint,
          context: (opts.context ?? []).slice(0, 40),
          sources: sent.map((s) => ({ id: s.id, kind: s.kind, site: s.site, title: s.title, url: s.url ?? "", text: s.text.slice(0, ASSESS_TEXT_MAX) })),
        },
        signal,
      );
    } catch (e) {
      if (e instanceof CancelledError || signal?.aborted) throw new CancelledError();
      return { ...out, assessError: errorMessage(e) };
    }
    const entry = cache.get(key);
    if (entry && entry.found === found) {
      entry.rating = rating;
      saveCache();
    }
  }
  return { ...out, sources: mergeRatings(found.sources, rating.ratings), note: rating.note, rated: true };
}

/**
 * What was found (and rated) for `name` lately, also before a reload, as when it was gathered: the pop-up reopened from a
 * concept's badge shows it again without searching. Undefined when nothing is cached.
 */
export function cachedSources(name: string): Gathered | undefined {
  const hit = loadCache().get(cacheKey(name));
  if (!hit || Date.now() - hit.at > CACHE_MS) return undefined;
  // Found but not rated while an AI is set up: the rating is still running (or failed), so gather again.
  if (!hit.rating && hit.found.sources.length && isReady(useSettings.getState())) return undefined;
  const out: Gathered = { name, ...hit.found, sources: sortSources(hit.found.sources), note: "", rated: false };
  return hit.rating ? { ...out, sources: mergeRatings(hit.found.sources, hit.rating.ratings), note: hit.rating.note, rated: true } : out;
}

/** For tests: `stored` also clears localStorage's copy; otherwise the next use reads it again (as after a reload). */
export function resetSources(stored = true) {
  cache = null;
  if (!stored) return;
  try {
    localStorage.removeItem(SOURCES_CACHE_KEY);
  } catch {
    /* unavailable */
  }
}
