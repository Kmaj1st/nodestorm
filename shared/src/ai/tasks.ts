import {
  ClarifyRequest,
  ClarifyResponse,
  DepsRequest,
  DepsResponse,
  DeriveRequest,
  DeriveResponse,
  ExplainRequest,
  ExplainResponse,
  ExtractRequest,
  ExtractResponse,
  findByName,
  normalizeName,
  NameRequest,
  NameResponse,
  RelateRequest,
  RelateResponse,
} from "../model";
import type { z } from "zod";
import { ProviderError, type ChatMessage, type Provider, type RequestOptions } from "./provider";
import {
  clarifyPrompt,
  depsPrompt,
  derivePrompt,
  explainPrompt,
  extractPrompt,
  namePrompt,
  relatePrompt,
  withLanguage,
} from "./prompts";

/** Pull the first JSON object out of a model reply (tolerates code fences and stray prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  // Walk forward to the matching closing brace, respecting strings.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in reply");
}

async function runStructured<S extends z.ZodTypeAny>(
  provider: Provider,
  messages: ChatMessage[],
  schema: S,
  opts: RequestOptions & { search?: boolean } = {},
): Promise<z.infer<S>> {
  let lastErr = "";
  messages = withLanguage(messages, opts.language);
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0
      ? messages
      : [...messages, { role: "user" as const, content: `Your previous reply was invalid (${lastErr}). Reply again with only the JSON object matching the schema.` }];
    // Timeouts and cancellation propagate straight out; only malformed output is retried.
    const text = await provider.complete(msgs, { ...opts, json: true });
    try {
      return schema.parse(extractJson(text));
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 300) : String(e);
    }
  }
  throw new ProviderError(`${provider.label} returned malformed output: ${lastErr}`);
}

const MAX_EXTRACTED = 40;
const MAX_QUOTE = 300;

/**
 * Tidy an extraction: one entry per concept name (case/plural-insensitive, first wins), quotes kept short, and only
 * relations and prerequisites whose two ends are different known concepts (extracted or already in the graph).
 */
export function cleanExtraction(res: ExtractResponse, existing: { name: string; aliases?: string[] }[] = []): ExtractResponse {
  const concepts: ExtractResponse["concepts"] = [];
  for (const c of res.concepts) {
    if (concepts.length >= MAX_EXTRACTED) break;
    if (!normalizeName(c.name) || findByName(concepts, c.name)) continue;
    const quote = c.quote?.trim();
    concepts.push({ ...c, quote: quote ? (quote.length > MAX_QUOTE ? `${quote.slice(0, MAX_QUOTE - 1)}…` : quote) : undefined });
  }
  const known = (name: string) => Boolean(findByName(concepts, name) ?? findByName(existing, name));
  const pair = (a: string, b: string) => known(a) && known(b) && normalizeName(a) !== normalizeName(b);
  return {
    concepts,
    relations: res.relations.filter((r) => pair(r.from, r.to)),
    prerequisites: res.prerequisites.filter((p) => pair(p.dependent, p.prerequisite)),
  };
}

export const tasks = {
  name: async (p: Provider, body: unknown, o?: RequestOptions) =>
    runStructured(p, namePrompt(NameRequest.parse(body)), NameResponse, { ...o, search: true }),
  clarify: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = ClarifyRequest.parse(body);
    const res = await runStructured(p, clarifyPrompt(req), ClarifyResponse, { ...o, search: true });
    // Models sometimes flag ambiguity but return only one sense; that's not a real choice.
    const ambiguous = res.ambiguous && res.senses.length > 1;
    return { ambiguous, senses: ambiguous ? res.senses.slice(0, req.count) : res.senses.slice(0, 1) };
  },
  relate: async (p: Provider, body: unknown, o?: RequestOptions) =>
    runStructured(p, relatePrompt(RelateRequest.parse(body)), RelateResponse, { ...o, search: true }),
  deps: async (p: Provider, body: unknown, o?: RequestOptions) =>
    runStructured(p, depsPrompt(DepsRequest.parse(body)), DepsResponse, o),
  derive: async (p: Provider, body: unknown, o?: RequestOptions) =>
    runStructured(p, derivePrompt(DeriveRequest.parse(body)), DeriveResponse, o),
  explain: async (p: Provider, body: unknown, o?: RequestOptions) =>
    runStructured(p, explainPrompt(ExplainRequest.parse(body)), ExplainResponse, o),
  extract: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = ExtractRequest.parse(body);
    return cleanExtraction(await runStructured(p, extractPrompt(req), ExtractResponse, o), req.existing);
  },
};
export type TaskName = keyof typeof tasks;
