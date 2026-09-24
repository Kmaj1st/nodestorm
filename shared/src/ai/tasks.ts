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
  QuizRequest,
  QuizResponse,
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
  quizPrompt,
  relatePrompt,
  withLanguage,
} from "./prompts";

/**
 * Pull the JSON object out of a model reply. Tolerates code fences, stray prose and the <think>…</think> block
 * reasoning models (e.g. DeepSeek-R1, Qwen3) may put before the answer; tries each "{" until one parses.
 */
export function extractJson(text: string): unknown {
  // Only a leading reasoning block is removed (with or without its opening tag); a "<think>" inside the answer — e.g.
  // quoted from the user's own text — is left alone.
  const answer = text.replace(/^\s*(?:<think>[\s\S]*?<\/think>|[^{]*?<\/think>)/i, "");
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
      return JSON.parse(repairTexEscapes(body.slice(start, end + 1)));
    } catch (e) {
      lastError = e; // e.g. braces in prose before the real answer
    }
  }
  throw lastError;
}

// After a JSON escape letter, the rest of a LaTeX command: "\frac" is a form feed + "rac" to JSON.parse. Backspace
// and form feed never belong in an answer, so \b and \f before a letter are always LaTeX; \n, \t and \r only before
// the rest of a common command followed by a non-letter ("\neq", "\times", "\rho"), since "\nThe" is a line break.
const TEX_AFTER_ESCAPE = new RegExp(
  "^(?:[bf][a-zA-Z]" +
    "|n(?:eq?|abla|eg|u|ot(?:in)?|mid|leq|geq|subseteq)(?![a-zA-Z])" +
    "|t(?:imes|heta|au|ext(?:bf|it|rm)?|o|ilde|op|frac|riangle(?:left|right)?(?:eq)?)(?![a-zA-Z])" +
    "|r(?:ho|ight(?:arrow)?|angle|floor|ceil|times|estriction|m)(?![a-zA-Z]))",
);

/**
 * Double the backslashes of LaTeX that a model put into a JSON string unescaped ("$\varphi$" instead of
 * "$\\varphi$"): invalid escapes like \v or \k would fail JSON.parse, and \frac or \times would silently become
 * control characters. Valid escapes (\\, \", \n, \uXXXX…) are kept; only the inside of strings is touched.
 */
export function repairTexEscapes(json: string): string {
  if (!json.includes("\\")) return json;
  let out = "";
  let inStr = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (!inStr || c !== "\\") {
      if (c === '"') inStr = !inStr;
      out += c;
      continue;
    }
    const next = json[i + 1] ?? "";
    const valid =
      next === '"' || next === "\\" || next === "/" ||
      (next === "u" && /^[0-9a-fA-F]{4}/.test(json.slice(i + 2, i + 6))) ||
      (next !== "" && "bfnrt".includes(next) && !TEX_AFTER_ESCAPE.test(json.slice(i + 1, i + 16)));
    if (valid) {
      out += c + next;
      i++;
    } else {
      out += "\\\\"; // a literal backslash; the command's letters follow as ordinary characters
    }
  }
  return out;
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
  opts: RequestOptions & { search?: boolean; maxTokens?: number } = {},
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

const MAX_HINTS = 3;

/**
 * Tidy a quiz question: at most three non-empty hints, and a multiple-choice set only when it really is one (four
 * distinct options and a valid correct index). Anything else falls back to a free-recall question with its answer.
 */
export function cleanQuiz(res: QuizResponse, multipleChoice: boolean): QuizResponse {
  const hints = res.hints.map((h) => h.trim()).filter(Boolean).slice(0, MAX_HINTS);
  const choices = res.choices?.map((c) => c.trim()) ?? [];
  const at = res.correctIndex ?? -1;
  const ok =
    multipleChoice &&
    choices.length === 4 &&
    choices.every(Boolean) &&
    new Set(choices.map((c) => c.toLowerCase())).size === 4 &&
    at >= 0 &&
    at < 4;
  const base = { question: res.question, answer: res.answer, hints };
  return ok ? { ...base, choices, correctIndex: at } : base;
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
    // Up to 40 concepts with quotes plus their relations: more room than the default answer budget.
    const out = await runStructured(p, extractPrompt(req), ExtractResponse, { ...o, maxTokens: 8192 });
    return cleanExtraction(out, req.existing);
  },
  quiz: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = QuizRequest.parse(body);
    return cleanQuiz(await runStructured(p, quizPrompt(req), QuizResponse, o), req.multipleChoice);
  },
};
export type TaskName = keyof typeof tasks;
