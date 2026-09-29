import * as z from "zod/mini";
import { CancelledError, ProviderError, redactSecret, withDeadline } from "../ai/provider";
import { SEARCH_ENGINE_LABEL, searxngBase, type SearchEngineId } from "./searchEngines";

/**
 * Web search engines that find pages defining a concept (Tavily, Serper's Google results, Brave Search, a SearXNG
 * instance). This module builds each engine's request, reads its answer (zod-checked, one bad hit is skipped, not the
 * whole answer) and turns HTTP failures into coded `ProviderError`s the interface translates. It runs in the browser
 * (client/src/lib/webSearch.ts) and in the local server (`POST /api/search/:engine`), which forwards what the browser
 * can't call itself (Brave allows no cross-site requests). Text cleanup, dedupe, caching and pauses are the client's.
 */

export interface WebSearchQuery {
  q: string;
  /** Results wanted (engines cap it: Brave 20, Serper 100, Tavily 20). */
  count: number;
  /** Language code from lookupLanguage ("en", "zh", "ja"…). */
  lang: string;
}

/** What an engine needs besides the query: its API key, or (SearXNG) the instance's address. */
export interface WebSearchAuth {
  key?: string;
  url?: string;
}

/** One hit as the engine sent it. `text` may still hold HTML (Brave marks matches with <strong>). */
export interface RawWebHit {
  title: string;
  url: string;
  text: string;
  /** The engine's date, as it wrote it ("2021-03-03T00:00:00", "Mar 3, 2021", "2 days ago"). */
  date?: string;
}

const clampCount = (n: number, max: number) => Math.max(1, Math.min(max, Math.round(n) || 1));

/** Serper's Google interface language (`hl`) and country (`gl`) for a language code. */
function serperLocale(lang: string): { hl: string; gl?: string } {
  if (lang === "zh") return { hl: "zh-cn", gl: "cn" };
  if (lang === "ja") return { hl: "ja", gl: "jp" };
  if (lang === "ko") return { hl: "ko", gl: "kr" };
  return { hl: lang };
}

/** Brave's `search_lang` codes differ from ISO for Chinese and Japanese. */
const braveLang = (lang: string) => (lang === "zh" ? "zh-hans" : lang === "ja" ? "jp" : lang);

/** The HTTP request for one search. Throws a `noKey` ProviderError when the key (or SearXNG address) is missing. */
export function webSearchRequest(engine: SearchEngineId, query: WebSearchQuery, auth: WebSearchAuth): { url: string; init: RequestInit } {
  const provider = SEARCH_ENGINE_LABEL[engine];
  const key = auth.key?.trim();
  if (engine !== "searxng" && !key) {
    throw new ProviderError(`${provider}: no API key is set.`, 400, undefined, { code: "noKey", params: { provider } });
  }
  // No cookies or other credentials go along: the key is the only identification. The key engines' APIs never
  // redirect, and a redirect elsewhere would carry their custom key headers (x-api-key…) along: refused. A SearXNG
  // instance's redirects are followed (on the local server only to the same host: see `redirects` below).
  const base: RequestInit = { credentials: "omit", referrerPolicy: "no-referrer", redirect: engine === "searxng" ? "follow" : "error" };
  switch (engine) {
    case "tavily":
      return {
        url: "https://api.tavily.com/search",
        init: {
          ...base,
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            query: query.q,
            search_depth: "basic",
            max_results: clampCount(query.count, 20),
            include_answer: false,
            include_raw_content: false,
          }),
        },
      };
    case "serper":
      return {
        url: "https://google.serper.dev/search",
        init: {
          ...base,
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key! },
          body: JSON.stringify({ q: query.q, num: clampCount(query.count, 100), ...serperLocale(query.lang) }),
        },
      };
    case "brave": {
      const params = new URLSearchParams({ q: query.q, count: String(clampCount(query.count, 20)), search_lang: braveLang(query.lang), extra_snippets: "true" });
      return {
        url: `https://api.search.brave.com/res/v1/web/search?${params}`,
        init: { ...base, method: "GET", headers: { accept: "application/json", "x-subscription-token": key! } },
      };
    }
    case "searxng": {
      const root = searxngBase(auth.url);
      if (!root) throw new ProviderError(`${provider}: no instance address is set.`, 400, undefined, { code: "noKey", params: { provider } });
      const params = new URLSearchParams({ q: query.q, format: "json", language: query.lang === "zh" ? "zh-CN" : query.lang });
      return { url: `${root}/search?${params}`, init: { ...base, method: "GET", headers: { accept: "application/json" } } };
    }
  }
}

const str = z.string();
const optStr = z.nullish(z.string());
const HIT: Record<SearchEngineId, { list: (json: unknown) => unknown; item: z.ZodMiniType<RawWebHit> }> = {
  tavily: {
    list: (j) => z.object({ results: z.array(z.unknown()) }).parse(j).results,
    item: z.pipe(
      z.object({ title: optStr, url: str, content: optStr, published_date: optStr }),
      z.transform((r) => ({ title: r.title ?? "", url: r.url, text: r.content ?? "", date: r.published_date ?? undefined })),
    ),
  },
  serper: {
    // No `organic` at all is a search without results.
    list: (j) => z.object({ organic: z.optional(z.array(z.unknown())) }).parse(j).organic ?? [],
    item: z.pipe(
      z.object({ title: optStr, link: str, snippet: optStr, date: optStr }),
      z.transform((r) => ({ title: r.title ?? "", url: r.link, text: r.snippet ?? "", date: r.date ?? undefined })),
    ),
  },
  brave: {
    list: (j) => z.object({ web: z.optional(z.object({ results: z.array(z.unknown()) })) }).parse(j).web?.results ?? [],
    item: z.pipe(
      z.object({ title: optStr, url: str, description: optStr, extra_snippets: z.nullish(z.array(z.string())), page_age: optStr, age: optStr }),
      z.transform((r) => ({
        title: r.title ?? "",
        url: r.url,
        text: [r.description ?? "", ...(r.extra_snippets ?? [])].filter((s) => s.trim()).join(" "),
        date: r.page_age ?? r.age ?? undefined,
      })),
    ),
  },
  searxng: {
    list: (j) => z.object({ results: z.array(z.unknown()) }).parse(j).results,
    item: z.pipe(
      z.object({ title: optStr, url: str, content: optStr, publishedDate: optStr }),
      z.transform((r) => ({ title: r.title ?? "", url: r.url, text: r.content ?? "", date: r.publishedDate ?? undefined })),
    ),
  },
};

/** Most hits kept of one answer. */
const HITS_MAX = 100;
/** Largest answer read (engines send tens of kilobytes; a hostile SearXNG instance could send gigabytes). */
export const SEARCH_BODY_MAX = 4_000_000;

/**
 * An answer's body as text, at most `max` bytes: null when it is longer (reading stops there, and a Content-Length
 * over the limit is refused unread). With `cut`, the first `max` bytes instead (enough of an error page).
 */
export async function readCapped(res: Response, max: number, cut = false): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (!cut && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      if (!cut) return null;
      break;
    }
  }
  const all = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, all.length - at);
    all.set(part, at);
    at += part.length;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

/** The hits in an engine's JSON answer. An answer of the wrong shape is a `malformed` error; a bad hit is skipped. */
export function parseWebSearch(engine: SearchEngineId, json: unknown): RawWebHit[] {
  let list: unknown;
  try {
    list = HIT[engine].list(json);
  } catch (e) {
    const provider = SEARCH_ENGINE_LABEL[engine];
    throw new ProviderError(`${provider}'s answer couldn't be read.`, 502, undefined, {
      code: "malformed",
      params: { provider },
      detail: e instanceof Error ? e.message.slice(0, 200) : undefined,
    });
  }
  const hits: RawWebHit[] = [];
  // More hits than any request asks for (20 at most) are an instance's padding: the first HITS_MAX are enough.
  for (const raw of (list as unknown[]).slice(0, HITS_MAX)) {
    const r = HIT[engine].item.safeParse(raw);
    if (r.success) hits.push(r.data);
  }
  return hits;
}

/** The engine's own words about an error, short and without the key. */
function errorDetail(body: string, key: string | undefined): string | undefined {
  let text = body.trim();
  try {
    const j = JSON.parse(text) as any;
    const m = j?.detail?.error ?? j?.error?.detail ?? j?.error?.code ?? j?.message ?? j?.error ?? j?.detail;
    if (typeof m === "string") text = m;
  } catch {
    /* not JSON: the text itself */
  }
  if (/^\s*</.test(text)) return undefined; // an HTML error page says nothing useful
  // Hidden before it is cut short, so no piece of the key is left at the cut.
  text = redactSecret(text.replace(/\s+/g, " "), key).slice(0, 200);
  return text || undefined;
}

/**
 * A failed search as a coded error: a rejected key, a rate limit, used-up credits (Tavily 432/433, Serper's "Not
 * enough credits", Brave's quota), a SearXNG instance that refuses JSON, or any other HTTP error.
 */
export function webSearchError(engine: SearchEngineId, status: number, body: string, key?: string): ProviderError {
  const provider = SEARCH_ENGINE_LABEL[engine];
  const detail = errorDetail(body, key);
  const lower = body.toLowerCase();
  const quota = /credit|quota|plan limit|usage limit|exceeded your/.test(lower);
  const make = (code: "invalidKey" | "rateLimited" | "quota" | "declined" | "http", message: string, st = status) =>
    new ProviderError(`${provider}: ${message}`, st, undefined, { code, params: code === "http" ? { provider, status } : { provider }, detail });
  if (status === 432 || status === 433 || status === 402 || (quota && (status === 400 || status === 403 || status === 429))) {
    return make("quota", "the searches or credits of this account are used up.", 429);
  }
  if (status === 429) return make("rateLimited", "rate limited.");
  if (engine === "searxng" && status === 403) return make("declined", "the instance refused JSON output.");
  if (status === 401 || status === 403 || (engine === "brave" && status === 422 && /token/.test(lower))) {
    return make("invalidKey", "the API key was rejected.", 401);
  }
  return make("http", `HTTP ${status}.`, status >= 500 ? 502 : status);
}

export interface WebSearchFetchOptions {
  signal?: AbortSignal;
  /** Per request (default 12 s). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /**
   * How a SearXNG instance's redirects are followed. "follow" (the browser's own fetch: a page can't use the user's
   * browser to reach anything it couldn't anyway); "sameHost" (the local server, which can reach internal addresses
   * such as 169.254.169.254 a page can't): at most REDIRECTS_MAX, each to the same host and port, or from http to https
   * on the same host; any other redirect is an `unreachable` error. The key engines never follow a redirect.
   */
  redirects?: "follow" | "sameHost";
}

/** Most redirects of a SearXNG instance followed with `redirects: "sameHost"`. */
export const REDIRECTS_MAX = 2;

/** Where a redirect from `from` to `location` goes, when it stays on the same host (or moves to its https); else null. */
export function sameHostRedirect(from: string, location: string | null): string | null {
  if (!location) return null;
  try {
    const a = new URL(from);
    const b = new URL(location, a);
    if (b.username || b.password || b.hostname.toLowerCase() !== a.hostname.toLowerCase()) return null;
    if (b.protocol === a.protocol) return b.port === a.port ? b.href : null;
    // http to https on the same host: its default port, or the same port number given explicitly.
    return a.protocol === "http:" && b.protocol === "https:" && (b.port === "" || b.port === a.port) ? b.href : null;
  } catch {
    return null;
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * One search on one engine, straight to the engine. Network failures (including a browser's CORS refusal) and time-outs
 * are `unreachable`; the other failures are coded by `webSearchError`. Cancelling throws CancelledError.
 */
export async function fetchWebSearch(engine: SearchEngineId, query: WebSearchQuery, auth: WebSearchAuth, opts: WebSearchFetchOptions = {}): Promise<RawWebHit[]> {
  const provider = SEARCH_ENGINE_LABEL[engine];
  const { url, init } = webSearchRequest(engine, query, auth);
  const f = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  try {
    return await withDeadline(provider, { signal: opts.signal, timeoutMs }, async (signal) => {
      const manual = opts.redirects === "sameHost" && init.redirect === "follow";
      const send = async (to: string) => {
        try {
          return await f(to, { ...init, ...(manual ? { redirect: "manual" as const } : {}), signal });
        } catch (e) {
          if (signal.aborted) throw new CancelledError();
          throw new ProviderError(`Can't reach ${provider}.`, 502, undefined, {
            code: "unreachable",
            params: { provider },
            detail: redactSecret(e instanceof Error ? e.message : String(e), auth.key),
          });
        }
      };
      let at = url;
      let res = await send(at);
      for (let hops = 0; manual && REDIRECT_STATUS.has(res.status); hops++) {
        const next = sameHostRedirect(at, res.headers.get("location"));
        await res.body?.cancel().catch(() => {});
        if (!next || hops >= REDIRECTS_MAX) {
          throw new ProviderError(`Can't reach ${provider}.`, 502, undefined, {
            code: "unreachable",
            params: { provider },
            detail: next ? "too many redirects" : "redirect to another address refused",
          });
        }
        res = await send((at = next));
      }
      if (!res.ok) throw webSearchError(engine, res.status, (await readCapped(res, 64_000, true).catch(() => "")) ?? "", auth.key);
      const body = await readCapped(res, SEARCH_BODY_MAX).catch(() => {
        if (signal.aborted) throw new CancelledError();
        return ""; // cut off mid-answer: not JSON, below
      });
      if (body === null) {
        throw new ProviderError(`${provider}'s answer couldn't be read.`, 502, undefined, { code: "malformed", params: { provider }, detail: "answer too large" });
      }
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new ProviderError(`${provider}'s answer couldn't be read.`, 502, undefined, { code: "malformed", params: { provider }, detail: "not JSON" });
      }
      return parseWebSearch(engine, json);
    });
  } catch (e) {
    // A search engine that is slow is out of reach for our purposes; the AI time-out's advice doesn't apply.
    if (e instanceof ProviderError && e.code === "timeout") {
      throw new ProviderError(`Can't reach ${provider}.`, 504, undefined, {
        code: "unreachable",
        params: { provider },
        detail: `no answer within ${Math.round(timeoutMs / 1000)} s`,
      });
    }
    throw e;
  }
}
