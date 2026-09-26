// STUB until web search lands: the real module (the four engines, their settings, the offline demo) replaces this
// file. Only the contract's exports are here; the demo engine returns a few canned pages so the sources flow can be
// tried and tested offline with the "mock" provider.
import { CancelledError, normalizeName } from "@nodestorm/shared";
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

const DEMO: Record<string, string> = {
  group: "A set with an associative binary operation, an identity element, and inverses.",
  subgroup: "A subset of a group that is itself a group under the same operation.",
  homomorphism: "A map between algebraic structures that preserves the operations, e.g. $\\varphi(ab) = \\varphi(a)\\varphi(b)$ for groups.",
  kernel: "The set $\\ker\\varphi$ of elements a homomorphism $\\varphi$ sends to the identity.",
};

function demoPages(name: string): WebResult[] {
  const def = DEMO[normalizeName(name)];
  if (!def) return [];
  const slug = encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"));
  return [
    {
      engine: "demo",
      title: `${name} — Demo Encyclopedia`,
      url: `https://demo-encyclopedia.example/wiki/${slug}`,
      site: "demo-encyclopedia.example",
      text: `${name}. In mathematics, ${name.toLowerCase()} means the following. ${def} It is one of the basic notions of abstract algebra.`,
    },
    {
      engine: "demo",
      title: `Lecture 3: ${name}`,
      url: `https://demo-lecture-notes.example/algebra/${slug}`,
      site: "demo-lecture-notes.example",
      text: `Definition 3.1 (${name}). ${def} We will use this throughout the course.`,
    },
    {
      engine: "demo",
      title: `What is a ${name.toLowerCase()}?? - Demo Forum`,
      url: `https://demo-forum.example/t/${slug}`,
      site: "demo-forum.example",
      text: `honestly ${name.toLowerCase()} is just any set of numbers you can add up, nothing more to it. source: my teacher said so.`,
    },
  ];
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
  const results = asked.includes("demo") ? demoPages(name).slice(0, opts.max) : [];
  return { results, asked, failed: [] };
}
