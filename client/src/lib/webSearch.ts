// STUB until web search lands: the real module (the four engines, their settings, the offline demo) replaces this
// file. Only the contract's exports are here; the demo engine returns canned pages for the names the offline demo's
// knowledge base knows, so the sources flow can be tried and tested offline with the "mock" provider.
import { CancelledError } from "@nodestorm/shared";
import { useSettings } from "../store/settingsStore";

export type Engine = "tavily" | "serper" | "brave" | "searxng" | "demo";
export interface WebResult {
  engine: Engine;
  title: string;
  url: string;
  site: string;
  text: string;
  published?: string;
}
export interface WebSearchResult { results: WebResult[]; asked: Engine[]; failed: Engine[] }

/** Three demo "sites" per meaning the offline demo knows: an encyclopedia, lecture notes and a sloppy forum post. */
async function demoPages(name: string): Promise<WebResult[]> {
  const { createProvider, tasks } = await import("./aiBrowser");
  const { senses } = await tasks.clarify(createProvider("mock", {}), { name, count: 3 });
  return senses
    .filter((s) => s.definition)
    .flatMap((s) => {
      const slug = encodeURIComponent(s.name.replace(/\s+/g, "_"));
      return [
        { engine: "demo" as const, title: `${s.name} - Demo Encyclopedia`, url: `https://demo-encyclopedia.example/wiki/${slug}`, site: "demo-encyclopedia.example", text: `${s.definition} It is a standard notion of its field.` },
        { engine: "demo" as const, title: `Lecture notes: ${s.name}`, url: `https://demo-lecture-notes.example/${slug}`, site: "demo-lecture-notes.example", text: `${s.definition} We will use this throughout the course.` },
        { engine: "demo" as const, title: `What is ${s.name}?? - Demo Forum`, url: `https://demo-forum.example/t/${slug}`, site: "demo-forum.example", text: `honestly ${s.name.toLowerCase()} is just any set of numbers you can add up, nothing more to it. source: my teacher said so.` },
      ];
    });
}

export function searchEngines(): Engine[] {
  return useSettings.getState().provider === "mock" ? ["demo"] : [];
}

export function searchReady(): boolean {
  return searchEngines().length > 0;
}

export async function searchWeb(name: string, opts: { max: number; signal?: AbortSignal }): Promise<WebSearchResult> {
  if (opts.signal?.aborted) throw new CancelledError();
  const asked = searchEngines();
  const results = asked.includes("demo") ? (await demoPages(name)).slice(0, opts.max) : [];
  if (opts.signal?.aborted) throw new CancelledError();
  return { results, asked, failed: [] };
}
