import { lookupConcept, normalizeName, type LookupSense, type LookupSite } from "@nodestorm/shared";
import { useSettings } from "../store/settingsStore";
import { isOnline } from "./online";

/**
 * Definitions from encyclopedias (ProofWiki, then Wikipedia/Wikidata) before the AI is asked, with the user's
 * Settings, a cache, and a pause for sites that refused us. The site clients themselves are in shared/src/lookup/.
 */

const CACHE_KEY = "nodestorm-lookup-cache";
const CACHE_MAX = 500;
const CACHE_DAYS = 30;
/** A site that refused (bot check, rate limit, network) is left alone this long. */
const PAUSE_MS = 10 * 60_000;

type Entry = { at: number; senses: LookupSense[] };
let cache: Record<string, Entry> | null = null;
const paused: Partial<Record<LookupSite, number>> = {};

function loadCache(): Record<string, Entry> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, Entry>;
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache() {
  const c = loadCache();
  const keys = Object.keys(c);
  if (keys.length > CACHE_MAX) {
    for (const k of keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - CACHE_MAX)) delete c[k];
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* full or unavailable: the cache just doesn't survive the tab */
  }
}

/** Wikipedia language for the answer-language setting; "auto" goes by the name's script. */
export function lookupLanguage(language: string, name: string): string {
  const named: [RegExp, string][] = [
    [/chinese|中文/i, "zh"], [/spanish|español/i, "es"], [/french|français/i, "fr"], [/german|deutsch/i, "de"],
    [/japanese|日本語/i, "ja"], [/russian|русский/i, "ru"], [/korean|한국어/i, "ko"], [/english/i, "en"],
  ];
  if (language && language !== "auto") return named.find(([re]) => re.test(language))?.[1] ?? "en";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) return "ja";
  if (/\p{Script=Hangul}/u.test(name)) return "ko";
  if (/\p{Script=Han}/u.test(name)) return "zh";
  if (/\p{Script=Cyrillic}/u.test(name)) return "ru";
  return "en";
}

/** Sites the user enabled and that aren't paused right now, most precise first. */
export function activeSites(now = Date.now()): LookupSite[] {
  const { lookup } = useSettings.getState();
  const sites: LookupSite[] = [];
  if (lookup.proofwiki) sites.push("proofwiki");
  if (lookup.wikipedia) sites.push("wikipedia");
  return sites.filter((s) => !(paused[s] && paused[s]! > now));
}

/** Sites refused recently (for Settings to say so). */
export const pausedSites = (now = Date.now()) => (Object.keys(paused) as LookupSite[]).filter((s) => paused[s]! > now);

/** True when a lookup can run at all: enabled, online, and some site to ask. */
export function lookupReady(): boolean {
  return useSettings.getState().lookup.enabled && isOnline() && activeSites().length > 0;
}

/**
 * Meanings of `name` from the enabled encyclopedias (up to `max`), cached per name and language. An empty list
 * means nothing was found (or every site refused); the caller then asks the AI.
 */
export async function lookupDefinitions(
  name: string,
  max: number,
  signal?: AbortSignal,
  /** `fresh`: skip the cache ("Look up again" should see today's page). */
  opts: { fresh?: boolean } = {},
): Promise<LookupSense[]> {
  if (!lookupReady()) return [];
  const lang = lookupLanguage(useSettings.getState().language, name);
  const sites = activeSites();
  const key = `${lang}:${sites.join(",")}:${max}:${normalizeName(name)}`;
  const hit = loadCache()[key];
  if (hit && !opts.fresh && Date.now() - hit.at < CACHE_DAYS * 86_400_000) return hit.senses;
  const res = await lookupConcept({ name, lang, sites, max }, { signal });
  for (const s of res.blocked) paused[s] = Date.now() + PAUSE_MS;
  // Only a clean answer is cached: a miss caused by a refusing site should be retried later.
  if (res.senses.length || !res.blocked.length) {
    loadCache()[key] = { at: Date.now(), senses: res.senses };
    saveCache();
  }
  return res.senses;
}

/** For tests. */
export function resetLookup() {
  cache = {};
  for (const k of Object.keys(paused)) delete paused[k as LookupSite];
}
