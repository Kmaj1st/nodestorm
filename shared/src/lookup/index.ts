import { CancelledError } from "../ai/provider";
import { SiteBlockedError, type LookupOptions } from "./http";
import { proofWiki, wikipedia, type LookupSense } from "./sites";

export { DEFAULT_USER_AGENT, SiteBlockedError, type LookupOptions } from "./http";
export { mathFromExtract, proofWiki, proofWikiTitle, shortExtract, wikipedia, type LookupSense } from "./sites";
export { definitionText, expandMacros, isDisambiguation, listedDefinitions } from "./wikitext";

export type LookupSite = "proofwiki" | "wikipedia";

export interface LookupRequest {
  name: string;
  /** Wikipedia/Wikidata language code ("en", "zh"…). ProofWiki is English only. */
  lang: string;
  /** Sites to ask, in order. */
  sites: LookupSite[];
  /** Most meanings to offer when a name has several. */
  max: number;
}

export interface LookupResult {
  senses: LookupSense[];
  /** Sites that refused (bot check, rate limit, network): the caller may stop asking them for a while. */
  blocked: LookupSite[];
}

/** Latin script only: ProofWiki has no pages under names in other scripts. */
const latin = (s: string) => !/[^\p{Script=Latin}\p{N}\p{P}\p{Zs}]/u.test(s);

/**
 * Definitions for a concept name from encyclopedias, most precise first: the first site with an answer wins. Sites
 * that fail are skipped (and reported in `blocked`); cancelling stops everything.
 */
export async function lookupConcept(req: LookupRequest, opts: LookupOptions = {}): Promise<LookupResult> {
  const name = req.name.trim();
  const blocked: LookupSite[] = [];
  if (!name) return { senses: [], blocked };
  for (const site of req.sites) {
    try {
      let senses: LookupSense[] = [];
      if (site === "proofwiki" && latin(name)) senses = await proofWiki(name, req.max, opts);
      else if (site === "wikipedia") senses = await wikipedia(name, req.lang, req.max, opts);
      senses = senses.filter((s) => s.definition.trim());
      if (senses.length) return { senses, blocked };
    } catch (e) {
      if (e instanceof CancelledError || opts.signal?.aborted) throw e instanceof CancelledError ? e : new CancelledError();
      blocked.push(site);
      if (!(e instanceof SiteBlockedError)) console.warn(`Lookup on ${site} failed:`, e);
    }
  }
  return { senses: [], blocked };
}
export { isLeanName, loogleDeclaration, loogleSearchUrl, mathlibDocUrl, type LeanDecl } from "./loogle";
