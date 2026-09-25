import { CancelledError, lookupConcept, normalizeName, type LookupSense, type LookupSite } from "@nodestorm/shared";
import { useSettings } from "../store/settingsStore";
import { baikeLookup } from "./baike";
import { wikiLookup } from "./mediawiki";
import { isOnline } from "./online";

/**
 * Every site a definition can come from: the encyclopedias in shared/src/lookup (ProofWiki, Wikipedia/Wikidata), and
 * the browser-only ones: Baidu Baike (a sandboxed JSONP call, lib/baike.ts) and the community wikis Moegirl, Fandom
 * and BWIKI (lib/mediawiki.ts).
 */
export type Site = LookupSite | "baidu" | "moegirl" | "fandom" | "bwiki";

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
const paused: Partial<Record<Site, number>> = {};

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

/**
 * The language a name is written in, by its script (whatever language Settings has the AI answer in): Baidu Baike
 * and Moegirl only know names in Chinese (or Japanese, for Moegirl).
 */
const nameLanguage = (name: string) => lookupLanguage("auto", name);

/**
 * Sites the user enabled and that aren't paused right now, most precise first. Baidu Baike only knows Chinese names,
 * so it is asked last, and only for a name in Chinese (`name` given).
 */
export function activeSites(now = Date.now(), name?: string): Site[] {
  const { lookup } = useSettings.getState();
  const sites: Site[] = [];
  if (lookup.proofwiki) sites.push("proofwiki");
  if (lookup.wikipedia) sites.push("wikipedia");
  if (lookup.baidu && name !== undefined && nameLanguage(name) === "zh") sites.push("baidu");
  return sites.filter((s) => !(paused[s] && paused[s]! > now));
}

/** Sites refused recently (for Settings to say so). */
export const pausedSites = (now = Date.now()) => (Object.keys(paused) as Site[]).filter((s) => paused[s]! > now);

/** A site's name as shown to the user. */
export const SITE_NAME: Record<Site, string> = {
  proofwiki: "ProofWiki",
  wikipedia: "Wikipedia",
  baidu: "Baidu Baike",
  moegirl: "Moegirl",
  fandom: "Fandom",
  bwiki: "BWIKI",
};

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
  /**
   * `fresh`: skip the cache ("Look up again" should see today's page). `sites`: ask exactly these (the user picked
   * one), even when look-ups before the AI are switched off in Settings or the site refused recently.
   */
  opts: { fresh?: boolean; sites?: Site[] } = {},
): Promise<LookupSense[]> {
  if (opts.sites ? !isOnline() : !lookupReady()) return [];
  return (await lookupCached(name, opts.sites ?? activeSites(Date.now(), name), max, signal, opts.fresh)).senses;
}

/** `sites` asked in order (see askSites), through the cache; sites that refused are paused. */
async function lookupCached(name: string, sites: Site[], max: number, signal?: AbortSignal, fresh = false) {
  const { language, lookup } = useSettings.getState();
  const lang = lookupLanguage(language, name);
  // A different Fandom wiki or BWIKI game is a different answer.
  const wikis = sites.includes("fandom") || sites.includes("bwiki") ? `:${lookup.fandom}|${lookup.bwiki}` : "";
  const key = `${lang}:${sites.join(",")}${wikis}:${max}:${normalizeName(name)}`;
  const hit = loadCache()[key];
  if (hit && !fresh && Date.now() - hit.at < CACHE_DAYS * 86_400_000) return { senses: hit.senses, blocked: [] as Site[] };
  const res = await askSites(name, lang, sites, max, signal);
  for (const s of res.blocked) paused[s] = Date.now() + PAUSE_MS;
  // Only a clean answer is cached: a miss caused by a refusing site should be retried later.
  if (res.senses.length || !res.blocked.length) {
    loadCache()[key] = { at: Date.now(), senses: res.senses };
    saveCache();
  }
  return res;
}

/**
 * Every enabled non-AI source for a new concept, for the user to choose from: the encyclopedias, Baidu Baike and
 * Moegirl for a Chinese (or Japanese, for Moegirl) name, and the Fandom / BWIKI wiki named in Settings.
 */
export function everySite(name: string): Site[] {
  const { lookup } = useSettings.getState();
  if (!lookup.enabled) return [];
  const lang = nameLanguage(name);
  const sites: Site[] = [];
  if (lookup.proofwiki) sites.push("proofwiki");
  if (lookup.wikipedia) sites.push("wikipedia");
  if (lookup.baidu && lang === "zh") sites.push("baidu");
  if (lang === "zh" || lang === "ja") sites.push("moegirl");
  if (lookup.fandom.trim()) sites.push("fandom");
  if (lookup.bwiki.trim()) sites.push("bwiki");
  return sites;
}

export interface LookupEverywhere {
  senses: LookupSense[];
  /** The sites asked (a paused one is not asked, and counts as failed). */
  asked: Site[];
  failed: Site[];
}

/**
 * Meanings of `name` from every source in `everySite`, asked side by side (up to `max` each): exact matches first,
 * one entry per source and title. Nothing throws but a cancel; a site that fails is listed in `failed`.
 */
export async function lookupEverywhere(name: string, max: number, signal?: AbortSignal): Promise<LookupEverywhere> {
  const sites = isOnline() ? everySite(name) : [];
  const now = Date.now();
  const failed: Site[] = sites.filter((s) => paused[s] && paused[s]! > now);
  const asked = sites.filter((s) => !failed.includes(s));
  const results = await Promise.all(
    asked.map((site) =>
      lookupCached(name, [site], max, signal).catch((e) => {
        if (e instanceof CancelledError || signal?.aborted) throw new CancelledError();
        return { senses: [] as LookupSense[], blocked: [site] };
      }),
    ),
  );
  const seen = new Set<string>();
  const senses: LookupSense[] = [];
  for (const r of results) {
    failed.push(...r.blocked);
    for (const s of r.senses) {
      const id = `${s.source?.site ?? ""}|${normalizeName(s.name)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      senses.push(s);
    }
  }
  // Exact matches first; otherwise the order of the sites (a stable sort).
  senses.sort((a, b) => Number(b.exact) - Number(a.exact));
  return { senses, asked, failed: [...new Set(failed)] };
}

/** Ask `sites` in order until one has an answer; sites that fail are reported in `blocked`. */
async function askSites(name: string, lang: string, sites: Site[], max: number, signal?: AbortSignal): Promise<{ senses: LookupSense[]; blocked: Site[] }> {
  const { lookup } = useSettings.getState();
  const blocked: Site[] = [];
  const shared = sites.filter((s): s is LookupSite => s === "proofwiki" || s === "wikipedia");
  // The shared encyclopedias first, together (lookupConcept tries them in order).
  if (shared.length && shared[0] === sites[0]) {
    const res = await lookupConcept({ name, lang, sites: shared, max }, { signal });
    blocked.push(...res.blocked);
    if (res.senses.length) return { senses: res.senses, blocked };
  }
  for (const site of sites) {
    if (site === "proofwiki" || site === "wikipedia") {
      if (shared[0] === sites[0]) continue; // already asked above
      const res = await lookupConcept({ name, lang, sites: [site], max }, { signal });
      blocked.push(...res.blocked);
      if (res.senses.length) return { senses: res.senses, blocked };
      continue;
    }
    try {
      const senses =
        site === "baidu"
          ? await baikeLookup(name, signal)
          : await wikiLookup({ site, wiki: site === "fandom" ? lookup.fandom : site === "bwiki" ? lookup.bwiki : undefined }, name, max, signal);
      if (senses.length) return { senses, blocked };
    } catch (e) {
      if (e instanceof CancelledError || signal?.aborted) throw e instanceof CancelledError ? e : new CancelledError();
      blocked.push(site);
      console.warn(`Lookup on ${site} failed:`, e);
    }
  }
  return { senses: [], blocked };
}

/** For tests. */
export function resetLookup() {
  cache = {};
  for (const k of Object.keys(paused)) delete paused[k as Site];
}
