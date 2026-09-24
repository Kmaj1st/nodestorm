import type {
  ClarifyRequest,
  DepsRequest,
  DeriveRequest,
  ExplainLevel,
  ExplainRequest,
  ExtractRequest,
  NameRequest,
  NodeBrief,
  QuizRequest,
  QuizStyle,
  RelateRequest,
} from "../model";
import { normalizeLanguage, type ChatMessage } from "./provider";

export type TaskKind = "name" | "clarify" | "relate" | "deps" | "derive" | "explain" | "extract" | "quiz";

const BASE = `You are NodeStorm, an assistant inside a concept-graph brainstorming tool.
Nodes are concepts (definitions, theorems, ideas, techniques...). Be precise and use standard terminology of the relevant field.
Reply with a single JSON object only — no prose, no markdown fences.`;

function brief(n: NodeBrief) {
  const aka = n.aliases?.length ? ` (aka ${n.aliases.join(", ")})` : "";
  return `- ${n.name}${aka}${n.definition ? `: ${n.definition}` : ""}`;
}

function contextBlock(nodes: NodeBrief[]) {
  if (!nodes.length) return "The graph is currently empty.";
  return `Concepts already in the graph:\n${nodes.map(brief).join("\n")}`;
}

/** The marker line lets the mock provider (and logs) identify the task. */
function sys(kind: TaskKind, instructions: string): ChatMessage {
  return { role: "system", content: `${BASE}\n[task:${kind}]\n\n${instructions}` };
}

function input(payload: unknown, text: string): ChatMessage {
  return { role: "user", content: `${text}\n\nINPUT:\n${JSON.stringify(payload)}` };
}

/**
 * System-prompt paragraph that sets the language of the answer's text. "auto" follows the input; anything else is
 * a language name. JSON keys, enum values and references to existing concepts must stay as they are.
 */
export function languageInstruction(language: string | undefined): string {
  const lang = normalizeLanguage(language);
  if (!lang) return "";
  const target =
    lang.toLowerCase() === "auto" ? "the same language as the concept names and descriptions in the input" : lang;
  return `Output language: write every human-readable value (names, aliases, definitions, domains, relation kinds, explanations, reasons, summaries, examples, key points, pitfalls, reading hints, quiz questions, answers, hints and choices) in ${target}.
Keep the JSON keys, the "role" values and the kind "none" exactly as in the schema, in English. When a field refers to a concept already in the graph ("matchesExisting", "from", "to", "dependent", "prerequisite"), copy its name exactly as given. The reply must still be a single valid JSON object.`;
}

/** Add the output-language paragraph to the system message of a task prompt. */
export function withLanguage(messages: ChatMessage[], language: string | undefined): ChatMessage[] {
  const extra = languageInstruction(language);
  if (!extra) return messages;
  return messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: `${m.content}\n\n${extra}` } : m));
}

export function namePrompt(req: NameRequest): ChatMessage[] {
  return [
    sys(
      "name",
      `The user describes something they cannot name. Identify the established name(s) for it.
Return 3-5 candidates, best first. If no standard term exists, coin a short descriptive name and say so in the definition.
Schema: {"candidates":[{"name":string,"definition":string (one or two sentences),"aliases":string[]}]}`,
    ),
    input(req, `${contextBlock(req.context)}\n\nDescription: ${req.description}`),
  ];
}

export function clarifyPrompt(req: ClarifyRequest): ChatMessage[] {
  return [
    sys(
      "clarify",
      `The user added a concept by name only. Decide whether the name is ambiguous: does it have several established meanings, in different fields or within one field? (E.g. "expectation": expected value in probability, anticipation in psychology, expectation value in quantum mechanics…)
Use the concepts already in the graph and any hint: if they make one meaning clearly intended, it is NOT ambiguous.
If ambiguous: set "ambiguous": true and return exactly ${req.count} distinct senses, most likely first (given the graph).
If not ambiguous: set "ambiguous": false and return a single sense with a precise definition.
Each sense: "name" = display name, disambiguated with a parenthetical only if needed (e.g. "Expectation (probability)"); "domain" = short field label; "definition" = one or two sentences.
Schema: {"ambiguous":boolean,"senses":[{"name":string,"domain":string,"definition":string}]}`,
    ),
    input(req, `${contextBlock(req.context)}\n\nName: ${req.name}${req.hint ? `\nHint: ${req.hint}` : ""}`),
  ];
}

export function relatePrompt(req: RelateRequest): ChatMessage[] {
  return [
    sys(
      "relate",
      `Describe how two concepts relate, separately in each direction.
"aToB" = what A does to / for B (e.g. "uses definition of", "generalizes", "is a special case of", "implies", "is derived from", "provides an example of").
"bToA" = what B does to / for A.
"kind" is a short verb phrase (2-5 words); "explanation" is 1-3 sentences that are concrete about the mechanism.
If there is genuinely no relation in a direction, use kind "none" and explain briefly.
Schema: {"aToB":{"kind":string,"explanation":string},"bToA":{"kind":string,"explanation":string}}`,
    ),
    input(req, `A:\n${brief(req.a)}\n\nB:\n${brief(req.b)}`),
  ];
}

export function depsPrompt(req: DepsRequest): ChatMessage[] {
  return [
    sys(
      "deps",
      `List the direct prerequisite concepts someone must know to state, understand or use the given concept.
Only direct dependencies (not transitive ones), at most 6, most essential first. Skip universal basics (sets, functions, numbers) unless the concept is itself basic.
role: "uses" (its definition/statement relies on it), "derives" (it produces / concludes an instance of it — e.g. a theorem that yields an isomorphism derives "isomorphism"), "assumes" (a hypothesis or background assumption).
If a prerequisite is the same concept as one already in the graph (even under another name), set "matchesExisting" to that existing concept's exact name; otherwise null.
Schema: {"prerequisites":[{"name":string,"role":"uses"|"derives"|"assumes","reason":string,"matchesExisting":string|null}]}`,
    ),
    input(req, `${contextBlock(req.existing)}\n\nConcept to analyse:\n${brief(req.node)}`),
  ];
}

export function derivePrompt(req: DeriveRequest): ChatMessage[] {
  return [
    sys(
      "derive",
      `Propose 1-4 new concepts that follow from, combine, or naturally extend the selected concepts (e.g. a consequence, a construction, a generalization, a conjecture worth checking).
Do not repeat concepts already in the graph. For each proposal give links to the selected concepts by exact name:
"fromNew" = what the new concept does to that concept, "toNew" = what that concept does to the new one.
Schema: {"proposals":[{"name":string,"definition":string,"aliases":string[],"links":[{"to":string,"fromNew":{"kind":string,"explanation":string},"toNew":{"kind":string,"explanation":string}}]}]}`,
    ),
    input(
      req,
      `${contextBlock(req.context)}\n\nSelected:\n${req.selected.map(brief).join("\n")}${req.goal ? `\n\nUser goal: ${req.goal}` : ""}`,
    ),
  ];
}

const LEVEL_GUIDE: Record<ExplainLevel, string> = {
  intuitive: "Aim for intuition first: plain language, analogies and pictures in words; keep formulas to a minimum.",
  rigorous:
    "Be rigorous: state the precise definition with its hypotheses, the key properties or theorems, and why they hold (proof ideas).",
  "example-driven":
    "Teach through examples: several concrete, worked examples (including a non-example), then the general pattern they share.",
};

export function explainPrompt(req: ExplainRequest): ChatMessage[] {
  const prereqs = req.prerequisites.length
    ? `Its prerequisites in the graph (the reader knows these):\n${req.prerequisites.map(brief).join("\n")}`
    : "It has no prerequisites in the graph.";
  const rels = req.relations.length
    ? `How it relates to other concepts in the graph:\n${req.relations
        .map((r) => `- it ${r.toOther.kind} ${r.other}; ${r.other} ${r.fromOther.kind} it`)
        .join("\n")}`
    : "";
  return [
    sys(
      "explain",
      `Explain one concept to a learner in more depth than its one-line definition. ${LEVEL_GUIDE[req.level]}
Build on the prerequisites and relations given, and refer to those concepts by their exact names.
"summary": 1-3 sentences that could serve as the concept's definition. "intuition": a short paragraph on the idea behind it.
"keyPoints": 3-6 facts worth remembering. "examples": 1-4 examples, each with a short "title" and a "body" of 1-4 sentences.
"pitfalls": 1-4 common misconceptions or mistakes.
"furtherReading": 1-4 sources described in words: "title" names the kind of source or a well-known text (e.g. "Any undergraduate abstract algebra textbook, chapter on homomorphisms"), "hint" says what to look for there. Never give URLs, DOIs or page numbers, and don't invent titles you are unsure exist.
Schema: {"summary":string,"intuition":string,"keyPoints":string[],"examples":[{"title":string,"body":string}],"pitfalls":string[],"furtherReading":[{"title":string,"hint":string}]}`,
    ),
    input(req, [`Concept to explain:\n${brief(req.node)}`, prereqs, rels, `Level: ${req.level}`].filter(Boolean).join("\n\n")),
  ];
}

export function extractPrompt(req: ExtractRequest): ChatMessage[] {
  return [
    sys(
      "extract",
      `The user pasted a text (notes, a passage from a book, a list…). Turn it into concept-graph material.
"concepts": the distinct concepts the text introduces, defines or relies on (at most 30, most central first). Skip vague everyday words.
For each: "name" = its standard name (singular); "definition" = one or two sentences, from the text where it defines the concept, else the standard one; "aliases" = other names the text uses; "quote" = a short excerpt (at most ~25 words) copied verbatim from the text, in its original language, that supports it.
If a concept is already in the graph (even under another name), use the graph's exact name for it.
"relations": relations the text states or clearly implies between two concepts (extracted ones or ones already in the graph), by exact name, separately in each direction: "aToB" = what "from" does to "to", "bToA" = what "to" does to "from"; "kind" is a short verb phrase (2-5 words), "explanation" 1-2 sentences.
"prerequisites": only where the text says one concept needs another to be stated or understood: "dependent" needs "prerequisite"; role "uses" | "derives" | "assumes"; "reason" is one sentence.
Schema: {"concepts":[{"name":string,"definition":string,"aliases":string[],"quote":string}],"relations":[{"from":string,"to":string,"aToB":{"kind":string,"explanation":string},"bToA":{"kind":string,"explanation":string}}],"prerequisites":[{"dependent":string,"prerequisite":string,"role":"uses"|"derives"|"assumes","reason":string}]}`,
    ),
    // The text itself is only in the INPUT payload (the "text" field), so a long paste isn't sent twice.
    input(
      req,
      `${contextBlock(req.existing)}${req.focus ? `\n\nFocus: ${req.focus}` : ""}\n\nExtract from the "text" field of the INPUT below.`,
    ),
  ];
}

const QUIZ_GUIDE: Record<QuizStyle, string> = {
  recall: "Ask the learner to recall what the concept is: its definition, statement or defining property.",
  apply:
    "Ask the learner to apply the concept to a small concrete case (decide, compute or give an instance), answerable in a few lines.",
  connect:
    "Ask how the concept relates to ONE of its prerequisites (name it in the question): how it builds on it, uses it or produces it.",
};

export function quizPrompt(req: QuizRequest): ChatMessage[] {
  const prereqs = req.prerequisites.length
    ? `Its prerequisites (the learner has studied these):\n${req.prerequisites.map(brief).join("\n")}`
    : "It has no prerequisites in the graph.";
  // Without prerequisites there is nothing to connect to; ask a recall question instead.
  const style = req.style === "connect" && !req.prerequisites.length ? "recall" : req.style;
  const format = req.multipleChoice
    ? `Make it multiple choice: "choices" = exactly 4 short options, one correct and three plausible but wrong ones (typical misconceptions), in random order; "correctIndex" = the index (0-3) of the correct one. The question must not give the answer away.`
    : `It is a free-recall question: leave out "choices" and "correctIndex".`;
  return [
    sys(
      "quiz",
      `Write one study question about a concept, to check whether the learner really knows it. ${QUIZ_GUIDE[style]}
Base it on the concept's definition and the learner's notes; standard facts of the field are fine, obscure details are not.
${format}
"answer": the model answer in 1-3 sentences (for multiple choice: the correct option and why). "hints": 1-3 hints, from gentle to strong, none of which gives the answer away.
Schema: {"question":string,"answer":string,"hints":string[],"choices":string[],"correctIndex":number}`,
    ),
    input(
      req,
      [`Concept:\n${brief(req.node)}${req.node.notes ? `\nLearner's notes: ${req.node.notes}` : ""}`, prereqs, `Style: ${style}`].join("\n\n"),
    ),
  ];
}
