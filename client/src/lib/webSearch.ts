import {
  CancelledError,
  fetchWebSearch,
  normalizeName,
  ProviderError,
  SEARCH_ENGINE_LABEL,
  SEARCH_ENGINES,
  searxngBase,
  withDeadline,
  type ProviderErrorInfo,
  type RawWebHit,
  type SearchEngineId,
  type WebSearchAuth,
  type WebSearchQuery,
} from "@nodestorm/shared";
import { t } from "../i18n";
import { useSettings, type Connection, type SearchSettings } from "../store/settingsStore";
import { lookupLanguage } from "./lookup";
import { isOnline } from "./online";
import { engineUsable, isPaused, pauseEngine, pausedEngines, searchEngines, searchReady, unpauseEngine, clearPauses, type Engine } from "./webSearchReady";

export { engineUsable, pausedEngines, searchEngines, searchReady, type Engine };

/**
 * Pages that define a concept, from the web search engines the user set up in Settings (Tavily, Serper, Brave
 * Search, a SearXNG instance), for the AI to rate and the user to quote from. The engines' requests and answers are
 * in shared/src/lookup/webSearch.ts; this module picks the engines, cleans the text (plain text only: HTML is parsed
 * and only its text kept, never inserted anywhere), removes duplicates, caches, and pauses an engine that refused.
 * In server mode every engine goes through the local server (`POST /api/search/:engine`); in browser mode the page
 * calls Tavily, Serper and SearXNG itself, and Brave (which allows no cross-site calls) is unavailable. The offline
 * demo provider searches a pretend web ("demo") built from its knowledge base (lib/webSearchDemo.ts).
 */

export interface WebResult {
  engine: Engine;
  /** Page title (plain text). */
  title: string;
  /** https URL of the page. */
  url: string;
  /** Display name of the site: the hostname without "www.". */
  site: string;
  /** The page text the engine gave (excerpt or snippets), plain text, whitespace-normalised, at most TEXT_MAX chars. */
  text: string;
  /** ISO date (YYYY-MM-DD) if the engine gives one. */
  published?: string;
}
export interface WebSearchResult {
  results: WebResult[];
  asked: Engine[];
  failed: Engine[];
}

export const TEXT_MAX = 4000;
const CACHE_KEY = "nodestorm-websearch-cache";
const CACHE_MAX = 500;
const CACHE_DAYS = 30;

/** An engine's name as shown to the user. */
export const ENGINE_NAME: Record<Engine, string> = {
  ...SEARCH_ENGINE_LABEL,
  get demo() {
    return t("settings.providerMock");
  },
};

/** Where to get a key (or, for SearXNG, how to run an instance). */
export const ENGINE_KEY_URL: Record<SearchEngineId, string> = {
  tavily: "https://tavily.com",
  serper: "https://serper.dev",
  brave: "https://brave.com/search/api/",
  searxng: "https://docs.searxng.org",
};

// ---------------------------------------------------------------------------------------------------------------
// The query

/**
 * What a search for `name` sends: `"<name>" definition` (quoted, so the engine keeps the words together), or the
 * word for "definition" after a Chinese, Japanese or Korean name.
 */
export function searchQuery(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  const script = lookupLanguage("auto", n);
  if (script === "zh") return `${n} 定义`;
  if (script === "ja") return `${n} 定義`;
  if (script === "ko") return `${n} 정의`;
  return `"${n.replace(/"/g, "")}" definition`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pauses (kept in webSearchReady.ts) and the cache

/** Failures worth leaving the engine alone for a while: asking again soon would fail the same way. */
const pausing = (e: unknown) => e instanceof ProviderError && (e.code === "invalidKey" || e.code === "rateLimited" || e.code === "quota");

type Entry = { at: number; results: WebResult[] };
let cache: Record<string, Entry> | null = null;

function loadCache(): Record<string, Entry> {
  if (cache) return cache;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    // Anything but an object of entries (another version, junk) is dropped; entries are checked when read.
    cache = {};
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [k, e] of Object.entries(stored)) if (typeof (e as Entry | null)?.at === "number") cache[k] = e as Entry;
    }
  } catch {
    cache = {};
  }
  return cache;
}

/** A stored entry as searchWeb returned it: web text as plain strings, https pages only; otherwise undefined. */
function validEntry(e: unknown): Entry | undefined {
  const entry = e as Partial<Entry> | null;
  if (!entry || typeof entry.at !== "number" || !Array.isArray(entry.results)) return undefined;
  const ok = entry.results.every(
    (r) =>
      r && typeof r === "object" && typeof r.title === "string" && typeof r.text === "string" && typeof r.site === "string" &&
      typeof r.url === "string" && pageUrl(r.url)?.href === r.url && (r.published === undefined || typeof r.published === "string"),
  );
  return ok ? (entry as Entry) : undefined;
}

function saveCache() {
  const c = loadCache();
  const byAge = () => Object.keys(c).sort((a, b) => c[a].at - c[b].at);
  const keys = byAge();
  if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete c[k];
  // Pages are longer than encyclopedia definitions: when storage is full, the oldest half goes and it tries again.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
      return;
    } catch {
      const all = byAge();
      if (!all.length) return;
      for (const k of all.slice(0, Math.ceil(all.length / 2))) delete c[k];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cleaning the engines' text

/** Plain text of an HTML fragment: parsed by the browser (never inserted into the page), only its text kept. */
export function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html;
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  }
  // Outside a browser (tests, tools): tags dropped, the common entities decoded.
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      if (named[e.toLowerCase()]) return named[e.toLowerCase()];
      const code = e[0] === "#" ? (e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : NaN;
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    });
}

/** One line of plain text: control characters and runs of whitespace become one space. */
export const normalizeSpace = (s: string) => s.replace(/[\u0000-\u001f\u007f­​﻿]/g, " ").replace(/\s+/g, " ").trim();

/** At most `max` characters, cut after a sentence (or a word) and marked with "…". */
export function clipText(s: string, max = TEXT_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > max * 0.6) return `${cut.slice(0, sentence + 1)}…`;
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** The URL of a hit when it is a plain https page (no credentials), without its #fragment; null otherwise. */
export function pageUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/** The same page whatever its fragment, trailing slash, host case or "www.". */
export function urlKey(u: URL): string {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port ? `:${u.port}` : "";
  return `${host}${port}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}

/** An engine's date as YYYY-MM-DD; relative ("2 days ago") or odd dates are dropped. */
export function isoDate(raw: string | undefined): string | undefined {
  if (!raw || /\bago\b|前/.test(raw)) return undefined;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  const d = new Date(at);
  const year = d.getUTCFullYear();
  if (year < 1990 || at > Date.now() + 86_400_000) return undefined;
  return d.toISOString().slice(0, 10);
}

/** An engine's hits as results: plain text, https pages only, without empty ones. */
export function toResults(engine: Engine, hits: RawWebHit[]): WebResult[] {
  // Brave and SearXNG mark up their snippets and titles; the others send plain text (which may contain "<").
  const html = engine === "brave" || engine === "searxng";
  const plain = (s: string) => normalizeSpace(html ? htmlToText(s) : s);
  const out: WebResult[] = [];
  for (const h of hits) {
    const u = pageUrl(h.url);
    if (!u) continue;
    const text = clipText(plain(h.text));
    if (!text) continue;
    const site = u.hostname.toLowerCase().replace(/^www\./, "");
    const published = isoDate(h.date);
    out.push({ engine, title: clipText(plain(h.title), 300) || site, url: u.href, site, text, ...(published ? { published } : {}) });
  }
  return out;
}

/** The engines' lists merged: first hits of every engine first (so one engine can't fill the list), one per page. */
export function mergeResults(lists: WebResult[][], max: number): WebResult[] {
  const seen = new Set<string>();
  const out: WebResult[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && out.length < max; i++) {
    for (const list of lists) {
      const r = list[i];
      if (!r) continue;
      const key = urlKey(new URL(r.url));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= max) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Asking the engines

function authOf(engine: SearchEngineId, search: SearchSettings): WebSearchAuth {
  return engine === "searxng" ? { url: search.searxng.url?.trim() || undefined } : { key: search[engine].apiKey?.trim() || undefined };
}

/** One search through the local server, which forwards it (with the key typed here, or its own from server/.env). */
async function serverSearch(engine: SearchEngineId, query: WebSearchQuery, auth: WebSearchAuth, signal?: AbortSignal): Promise<RawWebHit[]> {
  return withDeadline(t("api.serverLabel"), { signal, timeoutMs: 20_000 }, async (sig) => {
    let res: Response;
    try {
      res = await fetch(`/api/search/${engine}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...query, ...auth }),
        credentials: "omit",
        signal: sig,
      });
    } catch (e) {
      if (sig.aborted) throw new CancelledError();
      throw new Error(t("api.noServer"));
    }
    const data = (await res.json().catch(() => ({}))) as { hits?: RawWebHit[]; error?: string } & Partial<ProviderErrorInfo>;
    if (!res.ok) {
      if (data.code) throw new ProviderError(data.error ?? `HTTP ${res.status}`, res.status, undefined, data as ProviderErrorInfo);
      throw new Error(res.status === 404 || res.status >= 500 ? t("api.serverDown") : data.error ?? t("api.requestFailed", { status: res.status }));
    }
    return Array.isArray(data.hits) ? data.hits : [];
  });
}

/**
 * An http:// SearXNG address that the browser won't let this page reach: the page is on https, and the address isn't
 * the user's own machine (localhost and 127.x count as secure, so they are allowed). Such a request is "mixed
 * content", blocked before it leaves the browser, and fails with no useful message.
 */
export function mixedContent(url: string | undefined, page = typeof location === "undefined" ? "" : location.protocol): boolean {
  const base = searxngBase(url);
  if (!base || page !== "https:") return false;
  const { protocol, hostname } = new URL(base);
  if (protocol !== "http:") return false;
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return !(host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) || host === "::1");
}

/** One engine's hits for `q`, straight from the page or through the local server. */
function runEngine(engine: SearchEngineId, query: WebSearchQuery, search: SearchSettings, connection: Connection, signal?: AbortSignal): Promise<RawWebHit[]> {
  const auth = authOf(engine, search);
  if (connection === "server") return serverSearch(engine, query, auth, signal);
  // Say why instead of the browser's bare "Failed to fetch".
  if (engine === "searxng" && mixedContent(search.searxng.url)) return Promise.reject(new Error(t("settings.searchMixedError")));
  return fetchWebSearch(engine, query, auth, { signal });
}

/**
 * Search every configured engine in parallel for a definition of `name`, dedupe by URL, at most `max` results
 * overall. Throws CancelledError on abort; per-engine failures go to `failed`.
 */
export async function searchWeb(name: string, opts: { max: number; signal?: AbortSignal }): Promise<WebSearchResult> {
  const { signal } = opts;
  const max = Math.max(1, Math.round(opts.max) || 1);
  if (signal?.aborted) throw new CancelledError();
  const engines = searchEngines();
  if (engines.includes("demo")) {
    const demo = await import("./webSearchDemo");
    if (signal?.aborted) throw new CancelledError();
    return { results: demo.demoResults(name).slice(0, max), asked: ["demo"], failed: [] };
  }
  const real = engines as SearchEngineId[];
  if (!name.trim() || !real.length || !isOnline()) return { results: [], asked: [], failed: [] };
  const s = useSettings.getState();
  const lang = lookupLanguage(s.language, name);
  const q = searchQuery(name);
  const searx = real.includes("searxng") ? `|${s.search.searxng.url ?? ""}` : "";
  const key = `${lang}:${real.join(",")}${searx}:${max}:${normalizeName(name)}`;
  const hit = Object.hasOwn(loadCache(), key) ? validEntry(loadCache()[key]) : undefined;
  if (hit && Date.now() - hit.at < CACHE_DAYS * 86_400_000) return { results: hit.results, asked: [...real], failed: [] };

  const now = Date.now();
  const failed: Engine[] = real.filter((e) => isPaused(e, now, s.search));
  const asked = real.filter((e) => !failed.includes(e));
  const lists = await Promise.all(
    asked.map(async (engine) => {
      try {
        return toResults(engine, await runEngine(engine, { q, count: max, lang }, s.search, s.connection, signal));
      } catch (e) {
        if (e instanceof CancelledError || signal?.aborted) throw new CancelledError();
        failed.push(engine);
        if (pausing(e)) pauseEngine(engine, s.search);
        console.warn(`Web search on ${ENGINE_NAME[engine]} failed:`, e);
        return [];
      }
    }),
  );
  const results = mergeResults(lists, max);
  // Only a clean answer is cached: an engine that failed should be asked again next time.
  if (!failed.length) {
    loadCache()[key] = { at: Date.now(), results };
    saveCache();
  }
  return { results, asked, failed: SEARCH_ENGINES.filter((e) => failed.includes(e)) };
}

/**
 * Settings' "Test": one tiny search on `engine` with the settings being edited (not yet saved), past the cache and
 * any pause. Resolves with the number of results; rejects with the (coded, translatable) error.
 */
export async function testSearchEngine(engine: SearchEngineId, search: SearchSettings, connection: Connection, signal?: AbortSignal): Promise<number> {
  const hits = await runEngine(engine, { q: searchQuery("group"), count: 1, lang: "en" }, search, connection, signal);
  unpauseEngine(engine, search);
  return hits.length;
}

/** For tests: as after a reload (the cache is read from storage again). */
export function resetWebSearch() {
  cache = null;
  clearPauses();
}
