import { kbDefinition, normalizeName } from "@nodestorm/shared";
import type { WebSearchResult } from "../src/lib/webSearch";

/**
 * A stand-in for lib/webSearch.ts in tests (`vi.mock("../src/lib/webSearch", () => import("./fakeWebSearch"))`):
 * one engine that finds a demo encyclopedia's page and a lecture notes page for each meaning the offline demo knows
 * for a name (its knowledge base's definition; pages for several meanings for an ambiguous name such as
 * "Expectation"), which the offline demo's source check rates reliable. `fake.pages` replaces the pages, `fake.ready = false` turns search off; `fake.calls` counts.
 * `fake.failed` lists engines reported as failed, `fake.error` makes the search throw; `fake.fresh` is the last `fresh`.
 */
export const fake = {
  ready: true,
  calls: 0,
  pages: undefined as ((name: string) => WebSearchResult["results"]) | undefined,
  failed: [] as WebSearchResult["failed"],
  error: undefined as Error | undefined,
  fresh: undefined as boolean | undefined,
};

/** Names with several meanings (the offline demo's knowledge base has one per name). */
const AMBIGUOUS: Record<string, { name: string; definition: string }[]> = {
  expectation: [
    { name: "Expectation (probability)", definition: "The expected value $E[X]$ of a random variable: its probability-weighted average." },
    { name: "Expectation (psychology)", definition: "A belief about what will happen in the future, which shapes perception and behaviour." },
    { name: "Expectation value (quantum mechanics)", definition: "The average outcome $\\langle A \\rangle$ of measuring an observable $A$ on a quantum state." },
  ],
};

export async function defaultPages(name: string): Promise<WebSearchResult["results"]> {
  const kb = kbDefinition(name);
  return (AMBIGUOUS[normalizeName(name)] ?? (kb ? [{ name, definition: kb.definition }] : [])).flatMap((s) => {
    const slug = encodeURIComponent(s.name.replace(/\s+/g, "_"));
    return [
      { engine: "demo" as const, title: `${s.name} - Demo Encyclopedia`, url: `https://demo-encyclopedia.example/wiki/${slug}`, site: "demo-encyclopedia.example", text: s.definition },
      // A second site that agrees, so a page can be taken unasked (one no other source backs never is).
      { engine: "demo" as const, title: `${s.name} - Demo Lecture Notes`, url: `https://demo-lecture-notes.example/${slug}`, site: "demo-lecture-notes.example", text: s.definition },
    ];
  });
}

export const ENGINE_NAME = { tavily: "Tavily", serper: "Serper", brave: "Brave Search", searxng: "SearXNG", demo: "Offline demo" };
export const searchEngines = () => (fake.ready ? ["demo" as const] : []);
export const searchReady = () => fake.ready;
export async function searchWeb(name: string, opts: { max: number; signal?: AbortSignal; fresh?: boolean }): Promise<WebSearchResult> {
  fake.calls++;
  fake.fresh = opts.fresh;
  if (fake.error) throw fake.error;
  const results = fake.pages ? fake.pages(name) : await defaultPages(name);
  return { results: results.slice(0, opts.max), asked: ["demo", ...fake.failed], failed: [...fake.failed] };
}
