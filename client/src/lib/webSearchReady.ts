import { SEARCH_ENGINES, searxngBase, type SearchEngineId } from "@nodestorm/shared";
import { useSettings, type Connection, type SearchSettings } from "../store/settingsStore";
import { isOnline } from "./online";

/**
 * Whether a web search can run (engines set up, online, not paused after a refusal), apart from the searching
 * itself (webSearch.ts), so adding a concept can tell without loading the engines' code.
 */

export type Engine = "tavily" | "serper" | "brave" | "searxng" | "demo";
/** An engine that rejected the key, rate-limited us or ran out of credits is left alone this long. */
const PAUSE_MS = 10 * 60_000;

/** Can `engine` run with these settings? Brave only through the local server, which may hold the key itself. */
export function engineUsable(engine: SearchEngineId, search: SearchSettings, connection: Connection): boolean {
  if (!search[engine].enabled) return false;
  if (connection === "server") return true; // keys and the SearXNG address may be in server/.env
  if (engine === "brave") return false;
  if (engine === "searxng") return Boolean(searxngBase(search.searxng.url));
  return Boolean(search[engine].apiKey?.trim());
}

/** Engines the user configured (key/URL present, enabled) and that can run here (Brave only through the local server). */
export function searchEngines(): Engine[] {
  const s = useSettings.getState();
  if (s.provider === "mock") return ["demo"];
  return SEARCH_ENGINES.filter((e) => engineUsable(e, s.search, s.connection));
}

/** True when at least one engine is usable right now (online, configured, not paused). */
export function searchReady(): boolean {
  const engines = searchEngines();
  if (engines.includes("demo")) return true;
  const now = Date.now();
  return isOnline() && engines.some((e) => !isPaused(e as SearchEngineId, now));
}

const paused = new Map<string, number>();
/** Paused per engine and key, so a corrected key is tried at once. */
const pauseId = (engine: SearchEngineId, search = useSettings.getState().search) =>
  `${engine}|${engine === "searxng" ? search.searxng.url ?? "" : search[engine].apiKey ?? ""}`;
export const isPaused = (engine: SearchEngineId, now = Date.now(), search?: SearchSettings) => (paused.get(pauseId(engine, search)) ?? 0) > now;

/** Engines paused after a refusal (for Settings to say so). */
export function pausedEngines(now = Date.now()): SearchEngineId[] {
  return SEARCH_ENGINES.filter((e) => isPaused(e, now));
}

/** Leave `engine` alone for a while after it refused (bad key, rate limit, credits used up). */
export function pauseEngine(engine: SearchEngineId, search: SearchSettings) {
  paused.set(pauseId(engine, search), Date.now() + PAUSE_MS);
}

/** A test search with these settings worked: try the engine again at once. */
export function unpauseEngine(engine: SearchEngineId, search: SearchSettings) {
  paused.delete(pauseId(engine, search));
}

/** For tests: as after a reload. */
export function clearPauses() {
  paused.clear();
}
