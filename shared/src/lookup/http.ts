import { CancelledError, withDeadline } from "../ai/provider";

/** How lookups reach the network: `fetch` is injectable so tests never touch the real sites. */
export interface LookupOptions {
  signal?: AbortSignal;
  /** Per request (default 10 s). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Identifies the app to Wikipedia and Wikidata, as Wikimedia's API rules ask (browsers can't set User-Agent). */
  userAgent?: string;
}

export const DEFAULT_USER_AGENT = "NodeStorm/0.1 (https://github.com/Kmaj1st/nodestorm)";

/** The site answered with a bot check (Cloudflare) or refused: it won't work for this session. */
export class SiteBlockedError extends Error {
  constructor(public site: string, detail: string) {
    super(`${site} blocked the request (${detail})`);
    this.name = "SiteBlockedError";
  }
}

/**
 * The header that identifies the app, per site: what each site's CORS allows (any other custom header makes the
 * browser's preflight fail). Wikimedia asks for `Api-User-Agent`; Loogle allows `X-Loogle-Client`; ProofWiki and
 * OpenAlex (which allows only standard headers such as Accept and Authorization) get none, so their requests stay
 * "simple" ones.
 */
function identify(site: string, opts: LookupOptions): Record<string, string> {
  if (site === "Wikipedia" || site === "Wikidata") return { "Api-User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT };
  if (site === "Loogle") return { "X-Loogle-Client": "NodeStorm" };
  return {};
}

/** GET a JSON API. 404 is `null` (nothing there); a bot check or a refusal is `SiteBlockedError`. */
export async function getJson<T>(site: string, url: string, opts: LookupOptions = {}): Promise<T | null> {
  const f = opts.fetch ?? globalThis.fetch;
  return withDeadline(site, { signal: opts.signal, timeoutMs: opts.timeoutMs ?? 10_000 }, async (signal) => {
    let res: Response;
    try {
      // No cookies go along: a site's own session must neither change nor identify a look-up (as for web searches).
      res = await f(url, {
        signal,
        credentials: "omit",
        headers: { accept: "application/json", ...identify(site, opts) },
      });
    } catch (e) {
      if (signal.aborted) throw new CancelledError();
      // In a browser a Cloudflare challenge usually surfaces as a CORS failure: a TypeError with no details.
      throw new SiteBlockedError(site, e instanceof Error ? e.message : String(e));
    }
    if (res.status === 404) return null;
    const type = res.headers.get("content-type") ?? "";
    if (res.headers.get("cf-mitigated") || (!res.ok && res.status !== 429) || !type.includes("json")) {
      throw new SiteBlockedError(site, `HTTP ${res.status}`);
    }
    if (res.status === 429) throw new SiteBlockedError(site, "rate limited");
    return (await res.json()) as T;
  });
}
