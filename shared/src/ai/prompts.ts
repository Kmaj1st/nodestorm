import type { ClarifyRequest, DepsRequest, DeriveRequest, NameRequest, NodeBrief, RelateRequest } from "../model";
import { normalizeLanguage, type ChatMessage } from "./provider";

export type TaskKind = "name" | "clarify" | "relate" | "deps" | "derive";

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
  return `Output language: write every human-readable value (names, aliases, definitions, domains, relation kinds, explanations, reasons) in ${target}.
Keep the JSON keys, the "role" values and the kind "none" exactly as in the schema, in English. When a field refers to a concept already in the graph ("matchesExisting", "to"), copy its name exactly as given. The reply must still be a single valid JSON object.`;
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
