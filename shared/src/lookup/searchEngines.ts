/**
 * The web search engines' names and the SearXNG address check, apart from their requests and zod-checked answers
 * (webSearch.ts), so the interface can tell whether a search is set up without loading those.
 */

export type SearchEngineId = "tavily" | "serper" | "brave" | "searxng";
export const SEARCH_ENGINES: SearchEngineId[] = ["tavily", "serper", "brave", "searxng"];

export const SEARCH_ENGINE_LABEL: Record<SearchEngineId, string> = {
  tavily: "Tavily",
  serper: "Serper",
  brave: "Brave Search",
  searxng: "SearXNG",
};

/**
 * A SearXNG instance's base address, or null when it isn't an http(s) URL. A pasted `…/search` or query is cut off.
 * Plain http is allowed: a self-hosted instance often runs on this machine or the local network.
 */
export function searxngBase(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    const path = u.pathname.replace(/\/+$/, "").replace(/\/search$/, "");
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}
