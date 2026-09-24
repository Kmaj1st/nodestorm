/**
 * Live check of the encyclopedia lookups (ProofWiki, Wikipedia, Wikidata) from this machine. Free, no keys.
 *
 *   npm run smoke:lookup                 # a few maths concepts, in English
 *   npm run smoke:lookup -- zh 正规子群   # a language and names of your own
 *
 * ProofWiki sits behind a Cloudflare bot check: if it says "blocked" here, the app will skip it too and use
 * Wikipedia. Datacenter/cloud machines are often rate-limited by Wikimedia; run this from your own computer.
 */
import { lookupConcept } from "@nodestorm/shared";

const [lang = "en", ...names] = process.argv.slice(2);
const list = names.length ? names : ["Kernel of Group Homomorphism", "Normal subgroup", "Expectation", "Isomorphism"];

let failed = 0;
for (const name of list) {
  const started = Date.now();
  try {
    const r = await lookupConcept({ name, lang, sites: ["proofwiki", "wikipedia"], max: 3 });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const blocked = r.blocked.length ? `  (blocked: ${r.blocked.join(", ")})` : "";
    console.log(`\n${name}  ${secs}s${blocked}`);
    if (!r.senses.length) console.log("  nothing found");
    for (const s of r.senses) console.log(`  - [${s.source.site}] ${s.name} (${s.domain})\n    ${s.definition.slice(0, 200).replace(/\n/g, " ")}\n    ${s.source.url}`);
  } catch (e) {
    failed++;
    console.log(`\n${name}: ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(failed ? 1 : 0);
