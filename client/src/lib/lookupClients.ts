/**
 * The encyclopedia clients (ProofWiki, Wikipedia/Wikidata, Baidu Baike, the MediaWiki wikis). Only a look-up that
 * misses the cache needs them, so lib/lookup.ts imports this module on first use and it stays out of the
 * first-paint bundle.
 */
export { lookupConcept } from "@nodestorm/shared";
export { baikeLookup } from "./baike";
export { wikiLookup } from "./mediawiki";
