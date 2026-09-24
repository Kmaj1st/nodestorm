/**
 * Live smoke test: runs every AI task once against a real provider and checks the answers parse.
 * Uses the same keys as server mode (server/.env or the environment). Costs a few cents at most.
 *
 *   npm run smoke:live                      # default provider (AI_PROVIDER, else siliconflow)
 *   npm run smoke:live -- anthropic         # a specific provider
 *   npm run smoke:live -- siliconflow 中文   # …and an answer language
 */
import { isProviderKind, tasks, type ProviderKind, type TaskName } from "@nodestorm/shared";
import { createRegistry } from "../server/src/providers/registry";

const [kindArg, language] = process.argv.slice(2);
const registry = createRegistry();
const kind: ProviderKind = isProviderKind(kindArg) ? kindArg : registry.defaultId;
const provider = registry.get(kind);

if (!provider.configured) {
  console.error(`${provider.label} has no API key. Set it in server/.env (see server/.env.example) or the environment.`);
  process.exit(2);
}

const hom = { name: "Homomorphism", definition: "A map between groups that preserves the operation.", aliases: [] };
const thm = { name: "First Isomorphism Theorem", definition: "", aliases: [] };

// One realistic input per task; tasks added later without an entry here are reported as skipped.
const inputs: Partial<Record<TaskName, unknown>> = {
  name: { description: "a map between two groups that keeps the multiplication structure", context: [] },
  clarify: { name: "Expectation", context: [], count: 3 },
  relate: { a: thm, b: hom },
  deps: { node: thm, existing: [hom] },
  derive: { selected: [hom], context: [hom] },
  explain: { node: hom, level: "intuitive" },
  extract: {
    text: "A homomorphism between groups preserves the operation. Its kernel is a normal subgroup, and the first isomorphism theorem says G/ker φ is isomorphic to the image.",
    existing: [hom],
  },
};

console.log(`Provider: ${provider.label} · model ${provider.model}${language ? ` · language ${language}` : ""}\n`);
let failed = 0;
for (const name of Object.keys(tasks) as TaskName[]) {
  const input = inputs[name];
  if (input === undefined) {
    console.log(`- ${name.padEnd(8)} skipped (no sample input in scripts/live-smoke.mts)`);
    continue;
  }
  const started = Date.now();
  try {
    const out = await tasks[name](provider, input, { language });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✓ ${name.padEnd(8)} ${secs.padStart(5)}s  ${JSON.stringify(out).slice(0, 160)}…`);
  } catch (e) {
    failed++;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✗ ${name.padEnd(8)} ${secs.padStart(5)}s  ${e instanceof Error ? e.message : e}`);
  }
}
console.log(failed ? `\n${failed} task(s) failed.` : "\nAll tasks returned valid answers.");
process.exit(failed ? 1 : 0);
