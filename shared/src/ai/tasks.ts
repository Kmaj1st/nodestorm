import {
  ClarifyRequest,
  ClarifyResponse,
  DepsRequest,
  DepsResponse,
  DeriveRequest,
  DeriveResponse,
  ExplainRequest,
  ExplainResponse,
  NameRequest,
  NameResponse,
  RelateRequest,
  RelateResponse,
} from "../model";
import type { z } from "zod";
import { ProviderError, type ChatMessage, type Provider, type RequestOptions } from "./provider";
import { clarifyPrompt, depsPrompt, derivePrompt, explainPrompt, namePrompt, relatePrompt, withLanguage } from "./prompts";

/**
 * Pull the JSON object out of a model reply. Tolerates code fences, stray prose and the <think>…</think> block
 * reasoning models (e.g. DeepSeek-R1, Qwen3) may put before the answer; tries each "{" until one parses.
 */
export function extractJson(text: string): unknown {
  const answer = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "");
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : answer;
  let lastError: unknown = new Error("no JSON object in reply");
  for (let start = body.indexOf("{"); start >= 0; start = body.indexOf("{", start + 1)) {
    const end = matchingBrace(body, start);
    if (end < 0) {
      lastError = new Error("unterminated JSON object in reply");
      continue;
    }
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch (e) {
      lastError = e; // e.g. braces in prose before the real answer
    }
  }
  throw lastError;
}

/** Index of the "}" closing the "{" at `start`, respecting strings; -1 when it never closes. */
function matchingBrace(body: string, start: number): number {
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
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
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
};
export type TaskName = keyof typeof tasks;
