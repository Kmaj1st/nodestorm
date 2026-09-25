import {
  ABSURD_HARD_MAX,
  AbsurdChainRequest,
  AbsurdChainResponse,
  type AbsurdHop,
  AnatomyRequest,
  AnatomyResponse,
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
  ResolveCycleRequest,
  ResolveCycleResponse,
  ReadPageRequest,
  ReadPageResponse,
  SplitProblemsRequest,
  SplitProblemsResponse,
  TutorHintRequest,
  TutorHintResponse,
  CheckStepRequest,
  CheckStepResponse,
  MathlibRequest,
  MathlibResponse,
  RefereeRequest,
  RefereeResponse,
  type SheetProblem,
  type TutorConcept,
} from "../model";
import type { z } from "zod";
import { isLeanName } from "../lookup/loogle";
import { ProviderError, type ChatMessage, type Provider, type RequestOptions } from "./provider";
import {
  absurdChainPrompt,
  anatomyPrompt,
  clarifyPrompt,
  depsPrompt,
  derivePrompt,
  explainPrompt,
  extractPrompt,
  namePrompt,
  quizPrompt,
  resolveCyclePrompt,
  readPagePrompt,
  splitProblemsPrompt,
  tutorHintPrompt,
  checkStepPrompt,
  mathlibPrompt,
  refereeReportPrompt,
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
      return parseWithTexRepair(body.slice(start, end + 1));
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
 * Parse a JSON object, repairing unescaped LaTeX only when the plain parse fails or shows its damage: a form feed or
 * backspace anywhere ("\frac", "\beta"), or a line break/tab inside a $…$ formula ("$x \neq y$"). Valid prose with
 * real line breaks ("Let\nu = x^2" meaning a new line) is never touched.
 */
function parseWithTexRepair(json: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return JSON.parse(repairTexEscapes(json));
  }
  return texDamaged(parsed) ? JSON.parse(repairTexEscapes(json)) : parsed;
}

function texDamaged(v: unknown): boolean {
  if (typeof v === "string") return /[\b\f]/.test(v) || /\$[^$]*[\n\t\r][^$]*\$/.test(v);
  if (Array.isArray(v)) return v.some(texDamaged);
  return typeof v === "object" && v !== null && Object.values(v).some(texDamaged);
}

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
  /** Further checks on a parsed answer; what it throws counts as malformed output (asked again, then reported). */
  check: (v: z.infer<S>) => z.infer<S> = (v) => v,
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
      return check(schema.parse(extractJson(text)));
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
/**
 * A passive relation label ("is used by", "quoted by", "is derived from", 被…): relation labels are active, said from
 * the side that acts.
 */
export function passiveKind(kind: string): boolean {
  const k = kind.trim().toLowerCase();
  return /\bby$/.test(k) || /^(is|was|are|were|gets?|got|being|been)\s+(\w+ )?\w+(ed|en|wn)\s+(by|from|with|in|through)\b/.test(k) || /^被/.test(k);
}

type Dir = { kind: string; explanation: string };
/** One active label per relation: a passive side becomes "none" when the other side says it actively. */
export function activeOnly<T extends Dir>(a: T, b: T): [T, T] {
  const pa = passiveKind(a.kind);
  const pb = passiveKind(b.kind);
  if (pa && !pb) return [{ ...a, kind: "none" }, b];
  if (pb && !pa) return [a, { ...b, kind: "none" }];
  return [a, b];
}

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
    relations: res.relations.filter((r) => pair(r.from, r.to)).map((r) => {
      const [aToB, bToA] = activeOnly(r.aToB, r.bToA);
      return { ...r, aToB, bToA };
    }),
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
  relate: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const res = await runStructured(p, relatePrompt(RelateRequest.parse(body)), RelateResponse, { ...o, search: true });
    const [aToB, bToA] = activeOnly(res.aToB, res.bToA);
    return { ...res, aToB, bToA };
  },
  deps: async (p: Provider, body: unknown, o?: RequestOptions) =>
    runStructured(p, depsPrompt(DepsRequest.parse(body)), DepsResponse, o),
  derive: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const res = await runStructured(p, derivePrompt(DeriveRequest.parse(body)), DeriveResponse, o);
    return {
      ...res,
      proposals: res.proposals.map((pr) => ({
        ...pr,
        links: pr.links.map((l) => {
          const [fromNew, toNew] = activeOnly(l.fromNew, l.toNew);
          return { ...l, fromNew, toNew };
        }),
      })),
    };
  },
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
  resolveCycle: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = ResolveCycleRequest.parse(body);
    const res = await runStructured(p, resolveCyclePrompt(req), ResolveCycleResponse, o);
    // Out-of-range or repeated numbers are dropped; the caller checks the rest really breaks the cycle.
    const remove = [...new Set(res.remove.filter((i) => i < req.links.length))];
    if (!remove.length) throw new ProviderError(`${p.label} didn't name a valid link to remove`);
    return { remove, reason: res.reason };
  },
  readPage: async (p: Provider, body: unknown, o?: RequestOptions) => {
    // A dense page of formulas can run long.
    const res = await runStructured(p, readPagePrompt(ReadPageRequest.parse(body)), ReadPageResponse, { ...o, maxTokens: 8192 });
    return { text: res.text.trim() };
  },
  splitProblems: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = SplitProblemsRequest.parse(body);
    const res = await runStructured(p, splitProblemsPrompt(req), SplitProblemsResponse, { ...o, maxTokens: 8192 });
    return cleanProblems(res, req.pages.map((pg) => pg.page));
  },
  tutorHint: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = TutorHintRequest.parse(body);
    const res = await runStructured(p, tutorHintPrompt(req), TutorHintResponse, o);
    return { ...res, cites: validCites(res.cites, req.references), concepts: cleanConcepts(res.concepts) };
  },
  anatomy: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const res = await runStructured(p, anatomyPrompt(AnatomyRequest.parse(body)), AnatomyResponse, o);
    return cleanAnatomy(res);
  },
  checkStep: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = CheckStepRequest.parse(body);
    const res = await runStructured(p, checkStepPrompt(req), CheckStepResponse, o);
    return {
      ...res,
      missing: [...new Set(res.missing.map((m) => m.trim()).filter(Boolean))].slice(0, MAX_TUTOR_CONCEPTS),
      cites: validCites(res.cites, req.references),
      concepts: cleanConcepts(res.concepts),
      // "Solved" only counts for a step that is itself fine.
      solved: res.solved && res.verdict === "ok",
    };
  },
  refereeReport: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = RefereeRequest.parse(body);
    return cleanReferee(await runStructured(p, refereeReportPrompt(req), RefereeResponse, o), req.steps.length);
  },
  absurdChain: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = AbsurdChainRequest.parse(body);
    // A broken chain counts as malformed output, so the model is asked once more, told what was wrong.
    return runStructured(p, absurdChainPrompt(req), AbsurdChainResponse, o, (res) => cleanAbsurdChain(res, req));
  },
  mathlib: async (p: Provider, body: unknown, o?: RequestOptions) => {
    const req = MathlibRequest.parse(body);
    const res = await runStructured(p, mathlibPrompt(req), MathlibResponse, o);
    // Plausible Lean names only, each once, at most 6: every one costs a check.
    const seen = new Set<string>();
    const candidates = res.candidates
      .map((c) => ({ name: c.name.trim().replace(/^`|`$/g, ""), why: c.why.trim().slice(0, 300) }))
      .filter((c) => isLeanName(c.name) && !seen.has(c.name) && seen.add(c.name))
      .slice(0, 6);
    return { candidates };
  },
};
export type TaskName = keyof typeof tasks;

const MAX_TUTOR_CONCEPTS = 5;

const SEVERITY_ORDER = ["fatal", "major", "minor", "pedantic"] as const;

/**
 * A referee report as the UI shows it: at most 8 points, most serious first, each once; a step number that doesn't
 * exist is dropped (the point is about the whole derivation then). Nothing to accept without any steps.
 */
export function cleanReferee(res: RefereeResponse, steps: number): RefereeResponse {
  const seen = new Set<string>();
  // Sorted by severity first, so of two copies of the same point the more severe one is kept.
  const points = res.points
    .map((pt) => ({ ...pt, comment: pt.comment.trim(), step: pt.step && pt.step <= steps ? pt.step : undefined }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .filter((pt) => pt.comment && !seen.has(pt.comment) && seen.add(pt.comment))
    .slice(0, 8);
  const verdict = steps === 0 && res.verdict === "accept" ? "reject" : res.verdict;
  return { verdict, summary: res.summary.trim(), points, grudgingPraise: res.grudgingPraise.trim() };
}

/** Citation numbers that name a reference that was given, each once, in order. */
export function validCites(cites: number[], refs: { n: number }[]): number[] {
  const known = new Set(refs.map((r) => r.n));
  return [...new Set(cites)].filter((n) => known.has(n)).sort((a, b) => a - b);
}

function cleanConcepts(cs: TutorConcept[]): TutorConcept[] {
  const out: TutorConcept[] = [];
  for (const c of cs) {
    if (out.length >= MAX_TUTOR_CONCEPTS) break;
    if (normalizeName(c.name) && !findByName(out, c.name)) out.push({ name: c.name.trim(), definition: c.definition.trim() });
  }
  return out;
}

/** Trim a theorem anatomy: at most 8 hypotheses and 3 (non-)examples, no empty entries. */
export function cleanAnatomy(res: AnatomyResponse): AnatomyResponse {
  const list = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, 3);
  return {
    hypotheses: res.hypotheses
      .map((h) => ({ text: h.text.trim(), whyNeeded: h.whyNeeded.trim(), counterexampleIfDropped: h.counterexampleIfDropped.trim() }))
      .filter((h) => h.text)
      .slice(0, 8),
    conclusion: res.conclusion.trim(),
    proofIdea: res.proofIdea.trim(),
    examples: list(res.examples),
    nonExamples: list(res.nonExamples),
  };
}

/** Drop empty and repeated statements; a page that isn't one of the sheet's pages is forgotten. */
export function cleanProblems(res: SplitProblemsResponse, pages: number[]): SplitProblemsResponse {
  const seen = new Set<string>();
  const problems: SheetProblem[] = [];
  for (const pr of res.problems) {
    const statement = pr.statement.trim();
    const key = statement.replace(/\s+/g, " ").toLowerCase();
    if (!statement || seen.has(key)) continue;
    seen.add(key);
    problems.push({ label: pr.label.trim(), statement, page: pr.page != null && pages.includes(pr.page) ? pr.page : null });
  }
  return { problems };
}

/**
 * Check and tidy an absurd chain: it must start at `from` and reach `to` (by name or alias), each hop starting where
 * the previous one ended. Repairs what is only a matter of spelling (ends get the request's exact names, a hop's
 * "from" the previous hop's exact "to"), cuts the chain where it first reaches `to`, and cuts out loops (a concept
 * visited twice). Anything else (a gap between hops, the wrong start, never arriving, far too long) throws.
 */
export function cleanAbsurdChain(
  res: AbsurdChainResponse,
  req: { from: { name: string; aliases?: string[] }; to: { name: string; aliases?: string[] } },
): AbsurdChainResponse {
  const broken = (why: string) => new ProviderError(`The chain is broken: ${why}.`);
  const hops: AbsurdHop[] = res.chain.map((h) => ({
    from: h.from.trim(),
    to: h.to.trim(),
    kind: h.kind.trim(),
    fact: h.fact.trim(),
    quip: h.quip.trim(),
  }));
  if (!hops.length) throw broken("it has no links");
  if (!findByName([req.from], hops[0].from)) throw broken(`it starts at "${hops[0].from}", not at "${req.from.name}"`);
  const end = hops.findIndex((h) => findByName([req.to], h.to));
  if (end < 0) throw broken(`it never reaches "${req.to.name}"`);
  hops.length = end + 1;
  for (let i = 1; i < hops.length; i++) {
    if (normalizeName(hops[i].from) !== normalizeName(hops[i - 1].to)) {
      throw broken(`link ${i} ends at "${hops[i - 1].to}" but link ${i + 1} starts at "${hops[i].from}"`);
    }
  }
  hops[0].from = req.from.name;
  hops[hops.length - 1].to = req.to.name;
  // Cut out loops: a hop that returns to a concept already on the chain drops everything since that concept.
  const out: AbsurdHop[] = [];
  const names = [normalizeName(req.from.name)];
  for (const h of hops) {
    const back = names.indexOf(normalizeName(h.to));
    if (back >= 0) {
      out.length = back;
      names.length = back + 1;
    } else {
      out.push(out.length ? { ...h, from: out[out.length - 1].to } : { ...h, from: req.from.name });
      names.push(normalizeName(h.to));
    }
  }
  if (!out.length) throw broken("it goes round in a circle");
  if (out.length > ABSURD_HARD_MAX) throw broken(`it has ${out.length} links, more than ${ABSURD_HARD_MAX}`);
  return {
    title: res.title.trim() || `${req.from.name} → ${req.to.name}`,
    chain: out,
    moral: res.moral.trim(),
    plausibility: res.plausibility.trim(),
  };
}
