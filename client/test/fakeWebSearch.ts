import { MockProvider, tasks } from "@nodestorm/shared";
import type { WebSearchResult } from "../src/lib/webSearch";

/**
 * A stand-in for lib/webSearch.ts in tests (`vi.mock("../src/lib/webSearch", () => import("./fakeWebSearch"))`):
 * one engine that finds a demo encyclopedia's page for each meaning the offline demo knows for a name (its knowledge
 * base's definition; several pages for an ambiguous name such as "Expectation"), which the offline demo's source
 * check rates reliable. `fake.pages` replaces the pages, `fake.ready = false` turns search off; `fake.calls` counts.
 */
export const fake = {
  ready: true,
  calls: 0,
  pages: undefined as ((name: string) => WebSearchResult["results"]) | undefined,
};

export async function defaultPages(name: string): Promise<WebSearchResult["results"]> {
  const { senses } = await tasks.clarify(new MockProvider(), { name, count: 3 });
  return senses
    .filter((s) => s.definition)
    .map((s) => ({
      engine: "demo" as const,
      title: `${s.name} - Demo Encyclopedia`,
      url: `https://demo-encyclopedia.example/wiki/${encodeURIComponent(s.name.replace(/\s+/g, "_"))}`,
      site: "demo-encyclopedia.example",
      text: s.definition,
    }));
}

export const ENGINE_NAME = { tavily: "Tavily", serper: "Serper", brave: "Brave Search", searxng: "SearXNG", demo: "Offline demo" };
export const searchEngines = () => (fake.ready ? ["demo" as const] : []);
export const searchReady = () => fake.ready;
export async function searchWeb(name: string, opts: { max: number; signal?: AbortSignal }): Promise<WebSearchResult> {
  fake.calls++;
  const results = fake.pages ? fake.pages(name) : await defaultPages(name);
  return { results: results.slice(0, opts.max), asked: ["demo"], failed: [] };
}
