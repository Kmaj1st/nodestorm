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
const kernelProblem = "Show that the kernel of a group homomorphism is a normal subgroup.";
const notes = { n: 1, title: "Lecture notes", page: 4, text: "The kernel of a homomorphism $\\varphi: G \\to H$ is $\\{g \\in G : \\varphi(g) = e\\}$." };

// One realistic input per task; tasks added later without an entry here are reported as skipped.
const inputs: Partial<Record<TaskName, unknown>> = {
  name: { description: "a map between two groups that keeps the multiplication structure", context: [] },
  clarify: { name: "Expectation", context: [], count: 3 },
  relate: { a: thm, b: hom },
  deps: { node: thm, existing: [hom] },
  derive: { selected: [hom], context: [hom] },
  explain: { node: hom, level: "intuitive" },
  resolveCycle: {
    links: [
      { from: hom, to: thm, reason: "The theorem is about homomorphisms." },
      { from: thm, to: hom, reason: "The theorem starts from a homomorphism." },
    ],
  },
  extract: {
    text: "A homomorphism between groups preserves the operation. Its kernel is a normal subgroup, and the first isomorphism theorem says G/ker φ is isomorphic to the image.",
    existing: [hom],
  },
  quiz: { node: thm, prerequisites: [hom], style: "connect", multipleChoice: true },
  mathlib: { node: { name: "Kernel", definition: "The elements a group homomorphism sends to the identity.", aliases: [] }, context: [hom] },
  splitProblems: {
    pages: [
      { page: 1, text: "Sheet 3\n1. Show that the kernel of a group homomorphism is a normal subgroup.\n2. (a) Show that the image is a subgroup. (b) Give an example where it is not normal." },
    ],
  },
  tutorHint: { problem: kernelProblem, steps: ["Let $k \\in \\ker\\varphi$ and $g \\in G$."], references: [notes], context: [hom], nth: 1 },
  absurdChain: {
    from: { name: "Fourier transform", definition: "", aliases: [] },
    to: { name: "Toast", definition: "", aliases: [] },
    style: "conspiracy",
    hops: { min: 3, max: 5 },
    context: [hom],
  },
  checkStep: { problem: kernelProblem, steps: ["Let $k \\in \\ker\\varphi$ and $g \\in G$."], step: "Then $gkg^{-1} \\in \\ker\\varphi$.", references: [notes], context: [hom] },
};
// readPage needs a page image and a vision model: check it by importing a scanned PDF in the app.

console.log(`Provider: ${provider.label} · model ${provider.model}${language ? ` · language ${language}` : ""}\n`);
let failed = 0;
for (const name of Object.keys(tasks) as TaskName[]) {
  const input = inputs[name];
  if (input === undefined) {
    console.log(`- ${name.padEnd(13)} skipped (no sample input in scripts/live-smoke.mts)`);
    continue;
  }
  const started = Date.now();
  try {
    const out = await tasks[name](provider, input, { language });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✓ ${name.padEnd(13)} ${secs.padStart(5)}s  ${JSON.stringify(out).slice(0, 160)}…`);
  } catch (e) {
    failed++;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✗ ${name.padEnd(13)} ${secs.padStart(5)}s  ${e instanceof Error ? e.message : e}`);
  }
}
console.log(failed ? `\n${failed} task(s) failed.` : "\nAll tasks returned valid answers.");
process.exit(failed ? 1 : 0);
