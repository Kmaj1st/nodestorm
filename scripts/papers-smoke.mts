/**
 * Live check of "Find papers" (OpenAlex) from this machine. Free, no key.
 *
 *   npm run smoke:papers                                   # a few maths concepts
 *   npm run smoke:papers -- "Kernel" "Group homomorphism"  # a name, then context terms (prerequisites)
 *
 * Each search spends OpenAlex's keyless daily budget, shared by everyone on your network's IP address (about 100
 * searches a day; it renews at midnight UTC). A 429 means that budget is used up. Behind an HTTPS proxy, run with
 * NODE_USE_ENV_PROXY=1 (Node 22.21+).
 */
import { findPapers, papersUrl } from "@nodestorm/shared";

const [name, ...context] = process.argv.slice(2);
const cases: { name: string; context?: string[] }[] = name
  ? [{ name, context }]
  : [
      { name: "Normal subgroup", context: ["Subgroup"] },
      { name: "First isomorphism theorem", context: ["Group homomorphism", "Quotient group"] },
      { name: "Fourier transform", context: ["Lebesgue integral", "Fourier series"] },
      { name: "Banach space", context: ["Normed vector space", "Complete metric space"] },
      { name: "Kernel", context: ["Group homomorphism"] },
    ];

let failed = 0;
for (const c of cases) {
  const started = Date.now();
  try {
    const r = await findPapers({ ...c, max: 6 });
    console.log(`\n${c.name}  ${((Date.now() - started) / 1000).toFixed(1)}s\n  ${papersUrl(r.query, 6)}`);
    if (!r.works.length) console.log("  nothing found");
    for (const w of r.works) {
      console.log(`  - ${w.title}\n    ${[w.authors, w.year, w.venue].filter(Boolean).join(", ")} · cited by ${w.citedBy}${w.openAccessUrl ? " · free copy" : ""}\n    ${w.url}`);
    }
  } catch (e) {
    failed++;
    console.log(`\n${c.name}: ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(failed ? 1 : 0);
