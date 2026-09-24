import {
  DepsRequest,
  DepsResponse,
  DeriveRequest,
  DeriveResponse,
  NameRequest,
  NameResponse,
  RelateRequest,
  RelateResponse,
} from "../model";
import type { z } from "zod";
import { ProviderError, type ChatMessage, type Provider } from "./provider";
import { depsPrompt, derivePrompt, namePrompt, relatePrompt } from "./prompts";

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
  search = false,
): Promise<z.infer<S>> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0
      ? messages
      : [...messages, { role: "user" as const, content: `Your previous reply was invalid (${lastErr}). Reply again with only the JSON object matching the schema.` }];
    const text = await provider.complete(msgs, { json: true, search });
    try {
      return schema.parse(extractJson(text));
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 300) : String(e);
    }
  }
  throw new ProviderError(`${provider.label} returned malformed output: ${lastErr}`);
}

export const tasks = {
  name: async (p: Provider, body: unknown) => runStructured(p, namePrompt(NameRequest.parse(body)), NameResponse, true),
  relate: async (p: Provider, body: unknown) => runStructured(p, relatePrompt(RelateRequest.parse(body)), RelateResponse, true),
  deps: async (p: Provider, body: unknown) => runStructured(p, depsPrompt(DepsRequest.parse(body)), DepsResponse),
  derive: async (p: Provider, body: unknown) => runStructured(p, derivePrompt(DeriveRequest.parse(body)), DeriveResponse),
};
export type TaskName = keyof typeof tasks;
