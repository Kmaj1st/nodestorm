import type {
  AbsurdChainRequest,
  AbsurdStyle,
  AnatomyRequest,
  ClarifyRequest,
  DepsRequest,
  DeriveRequest,
  ExplainLevel,
  ExplainRequest,
  ExplainVoice,
  RefereeRequest,
  ExtractRequest,
  NameRequest,
  NodeBrief,
  QuizRequest,
  QuizStyle,
  RelateRequest,
  ReadPageRequest,
  RefChunk,
  ResolveCycleRequest,
  SplitProblemsRequest,
  TutorHintRequest,
  CheckStepRequest,
  MathlibRequest,
  ConnectRequest,
} from "../model";
import { normalizeName } from "../model";
import { normalizeLanguage, type ChatMessage } from "./provider";

export type TaskKind = "name" | "clarify" | "relate" | "deps" | "derive" | "explain" | "extract" | "quiz" | "resolveCycle"
  | "readPage" | "splitProblems" | "tutorHint" | "checkStep" | "mathlib" | "absurdChain" | "anatomy" | "refereeReport" | "connect";

export const BASE_PROMPT = `You are NodeStorm, an assistant inside a concept-graph brainstorming tool.
Nodes are concepts (definitions, theorems, ideas, techniques...). Be precise and use standard terminology of the relevant field.
Reply with a single JSON object only — no prose, no markdown fences.
Mathematical notation: in definitions, explanations, relations, examples and quiz text, write symbols and formulas as LaTeX between single dollar signs, e.g. $\\varphi(ab) = \\varphi(a)\\varphi(b)$ or $G / \\ker\\varphi \\cong \\operatorname{im}\\varphi$; use $$…$$ only for a formula on a line of its own. Plain words stay plain text, concept names never contain $, and money is written without $ (e.g. "5 USD"). In the JSON every backslash must be escaped: write "$\\\\ker\\\\varphi$", not "$\\ker\\varphi$".`;

/** The schema fragment and instruction for a concept's "kind" (see ConceptKind in model.ts). */
const KIND_VALUES = `"definition"|"theorem"|"lemma"|"proposition"|"corollary"|"axiom"|"conjecture"|"example"|"notation"|"other"`;
const KIND_GUIDE = `"kind" says what sort of statement the concept is: "definition" (introduces a notion), "theorem" / "lemma" / "proposition" / "corollary" (a proved result, by its usual standing: a major result, a helper result, a minor result, a direct consequence), "axiom" (assumed without proof), "conjecture" (believed but unproved), "example" (a specific instance), "notation" (a symbol or naming convention), "other" (an idea, technique, method or whole field). Use null if unsure.`;

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
  return { role: "system", content: `${BASE_PROMPT}\n[task:${kind}]\n\n${instructions}` };
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
  return `Output language: write every human-readable value (names, aliases, definitions, domains, relation kinds, explanations, reasons, summaries, examples, key points, pitfalls, reading hints, quiz questions, answers, hints and choices, chain titles, facts, quips, morals and notes, hypotheses, conclusions and proof ideas, referee summaries, comments and praise) in ${target}.
Keep the JSON keys, the "role" values, the referee "verdict" and "severity" values, the concept "kind" values (definition, theorem…) and the relation kind "none" exactly as in the schema, in English. Relation kinds in another language are active verb phrases too, without a passive marker (e.g. no 被). When a field refers to a concept already in the graph ("matchesExisting", "from", "to", "dependent", "prerequisite"), copy its name exactly as given. The reply must still be a single valid JSON object.`;
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
${KIND_GUIDE}
Schema: {"candidates":[{"name":string,"definition":string (one or two sentences),"aliases":string[],"kind":${KIND_VALUES}|null}]}`,
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
Each sense: "name" = display name, disambiguated with a parenthetical only if needed (e.g. "Expectation (probability)"); "domain" = short field label; "definition" = one or two sentences (for a result, its statement).
${KIND_GUIDE}
Schema: {"ambiguous":boolean,"senses":[{"name":string,"domain":string,"definition":string,"kind":${KIND_VALUES}|null}]}`,
    ),
    input(req, `${contextBlock(req.context)}\n\nName: ${req.name}${req.hint ? `\nHint: ${req.hint}` : ""}`),
  ];
}

/** How relation labels are worded: one active label, never a passive "is used by". */
const RELATION_KIND = `"kind" is a short active label in the -ing form (1-4 words), e.g. "using", "generalizing", "implying", "quoting", "providing an example of". Never a passive form ("used by", "is derived from", "quoted by", "is a special case of"): say it from the side that acts. If a direction is only the passive of the other, use kind "none" for it.`;

export function relatePrompt(req: RelateRequest): ChatMessage[] {
  return [
    sys(
      "relate",
      `Describe how two concepts relate, separately in each direction.
"aToB" = what A does to / for B (e.g. "using", "generalizing", "specializing", "implying", "deriving", "providing an example of").
"bToA" = what B does to / for A.
${RELATION_KIND} "explanation" is 1-3 sentences that are concrete about the mechanism.
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
Also classify the concept being analysed (not its prerequisites): ${KIND_GUIDE}
Schema: {"prerequisites":[{"name":string,"role":"uses"|"derives"|"assumes","reason":string,"matchesExisting":string|null}],"kind":${KIND_VALUES}|null}`,
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
${RELATION_KIND}
${KIND_GUIDE} A consequence you are not sure is true is a "conjecture".
Schema: {"proposals":[{"name":string,"definition":string,"aliases":string[],"kind":${KIND_VALUES}|null,"links":[{"to":string,"fromNew":{"kind":string,"explanation":string},"toNew":{"kind":string,"explanation":string}}]}]}`,
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

/** How each parody narrator talks. "plain" adds nothing to the prompt. */
export const VOICE_GUIDE: Record<Exclude<ExplainVoice, "plain">, string> = {
  "nature-documentary":
    "a hushed nature-documentary narrator observing the concept in its natural habitat, as if it were a rare animal",
  "sports-commentator": "an excitable live sports commentator calling the play-by-play, with replays and big moments",
  "noir-detective": "a hard-boiled 1940s noir detective narrating a case in the first person, rain on the window",
  "medieval-scholar": "a learned medieval scholar writing a solemn treatise, with archaic phrasing and humble asides",
  infomercial: 'an overexcited late-night infomercial host ("But wait, there\'s more!") selling the concept',
  shakespearean: "a Shakespearean player, in early modern English with the occasional flourish of verse",
};

/** The narration paragraph of a voiced explanation: the style may change, the mathematics may not. */
export function voiceInstruction(voice: ExplainVoice): string {
  if (voice === "plain") return "";
  return `VOICE (parody): narrate as ${VOICE_GUIDE[voice]}. The voice changes ONLY the style of the telling, never the content.
THE MATHEMATICS STAYS CORRECT: every definition, statement, example and pitfall must be exactly as true, precise and complete as in a plain explanation at the chosen level; no invented facts, names, dates or results, and no joke may contradict or blur a statement. Keep the chosen level (a rigorous explanation stays rigorous). Formulas are still written as LaTeX between $…$ and are never paraphrased away.
"summary" stays a sober, plain definition in the usual register (the learner may use it as the concept's definition); put the voice in "intuition", "keyPoints", "examples" and "pitfalls". Sources in "furtherReading" keep their real titles. Keep it kind: nothing offensive, no mocking of people, nothing political or about tragedies.
`;
}

export function explainPrompt(req: ExplainRequest): ChatMessage[] {
  const prereqs = req.prerequisites.length
    ? `Its prerequisites in the graph (the reader knows these):\n${req.prerequisites.map(brief).join("\n")}`
    : "It has no prerequisites in the graph.";
  const rels = req.relations.length
    ? `How it relates to other concepts in the graph:\n${req.relations
        .flatMap((r) => [
          ...(r.toOther.kind !== "none" ? [`- it → ${r.other}: ${r.toOther.kind}`] : []),
          ...(r.fromOther.kind !== "none" ? [`- ${r.other} → it: ${r.fromOther.kind}`] : []),
        ])
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
${voiceInstruction(req.voice)}Schema: {"summary":string,"intuition":string,"keyPoints":string[],"examples":[{"title":string,"body":string}],"pitfalls":string[],"furtherReading":[{"title":string,"hint":string}]}`,
    ),
    input(
      req,
      [`Concept to explain:\n${brief(req.node)}`, prereqs, rels, `Level: ${req.level}`, req.voice !== "plain" ? `Voice: ${req.voice}` : ""]
        .filter(Boolean)
        .join("\n\n"),
    ),
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
${KIND_GUIDE} Where the text labels a statement ("Theorem 2.1", "Lemma", "Definition"), follow its label.
"relations": relations the text states or clearly implies between two concepts (extracted ones or ones already in the graph), by exact name, separately in each direction: "aToB" = what "from" does to "to", "bToA" = what "to" does to "from"; ${RELATION_KIND} "explanation" 1-2 sentences.
"prerequisites": only where the text says one concept needs another to be stated or understood: "dependent" needs "prerequisite"; role "uses" | "derives" | "assumes"; "reason" is one sentence.
Schema: {"concepts":[{"name":string,"definition":string,"aliases":string[],"quote":string,"kind":${KIND_VALUES}|null}],"relations":[{"from":string,"to":string,"aToB":{"kind":string,"explanation":string},"bToA":{"kind":string,"explanation":string}}],"prerequisites":[{"dependent":string,"prerequisite":string,"role":"uses"|"derives"|"assumes","reason":string}]}`,
    ),
    // The text itself is only in the INPUT payload (the "text" field), so a long paste isn't sent twice.
    input(
      req,
      `${contextBlock(req.existing)}${req.focus ? `\n\nFocus: ${req.focus}` : ""}\n\nExtract from the "text" field of the INPUT below.`,
    ),
  ];
}

export function anatomyPrompt(req: AnatomyRequest): ChatMessage[] {
  const prereqs = req.prerequisites.length
    ? `Its prerequisites in the graph (the reader knows these):\n${req.prerequisites.map(brief).join("\n")}`
    : "It has no prerequisites in the graph.";
  return [
    sys(
      "anatomy",
      `Take a mathematical statement (a theorem, lemma, proposition, corollary or conjecture) apart for a learner.
"hypotheses": every assumption of the standard statement, one per entry, in the order they are usually stated (include the implicit ones, e.g. "G is finite"). For each: "text" = the hypothesis; "whyNeeded" = one sentence on what it is used for in the proof; "counterexampleIfDropped" = a concrete counterexample showing the conclusion can fail without it, or "" if dropping it is known not to matter.
"conclusion": what the statement asserts, in one or two sentences.
"proofIdea": a sketch of the key idea of the proof in 2-4 sentences: the construction or trick, not a full proof. For a conjecture, say instead what evidence or partial results support it.
"examples": 1-3 short concrete instances of the statement. "nonExamples": 1-3 short cases that look similar but where it does not apply, or common misreadings of it.
Use the prerequisites' names where they come up.
Schema: {"hypotheses":[{"text":string,"whyNeeded":string,"counterexampleIfDropped":string}],"conclusion":string,"proofIdea":string,"examples":string[],"nonExamples":string[]}`,
    ),
    input(req, [`Statement to take apart${req.node.kind ? ` (a ${req.node.kind})` : ""}:\n${brief(req.node)}`, prereqs].join("\n\n")),
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

export function resolveCyclePrompt(req: ResolveCycleRequest): ChatMessage[] {
  const n = req.links.length;
  const list = req.links
    .map((l, i) => `${i}. "${l.from.name}" needs "${l.to.name}"${l.reason ? ` — given reason: ${l.reason}` : ""}`)
    .join("\n");
  return [
    sys(
      "resolveCycle",
      `Prerequisite links in a concept graph form a cycle, which can't be right: a concept can't (even indirectly) be a
prerequisite of itself. Decide which link(s) are wrong — usually the prerequisite really goes the other way, or the
"prerequisite" is only related, not needed. Remove as few links as possible (usually exactly one), but the cycle must
be broken. Keep links that reflect how the subject is normally taught and built up.
"remove": the numbers (0-${n - 1}) of the links to remove. "reason": one or two sentences for the learner explaining why.
Schema: {"remove":number[],"reason":string}`,
    ),
    input(
      req,
      `Concepts:\n${[...new Map(req.links.flatMap((l) => [l.from, l.to]).map((c) => [c.name, c])).values()]
        .map(brief)
        .join("\n")}\n\nLinks on the cycle:\n${list}`,
    ),
  ];
}

export function readPagePrompt(req: ReadPageRequest): ChatMessage[] {
  return [
    sys(
      "readPage",
      `The image is one page of a scanned document (a textbook, lecture notes or a problem sheet). Transcribe its text
faithfully, in reading order and in the page's own language. Write every formula as LaTeX between $…$ ($$…$$ for a
displayed formula). Keep numbering of problems, theorems and equations. Leave out page headers, footers and page
numbers. Describe a figure in one short line in square brackets. Do not summarise, translate or correct anything.
Schema: {"text":string}`,
    ),
    {
      role: "user",
      content: [
        { type: "text", text: `Transcribe this page.\n\nINPUT:\n${JSON.stringify({ mediaType: req.mediaType })}` },
        { type: "image", mediaType: req.mediaType, data: req.data },
      ],
    },
  ];
}

export function splitProblemsPrompt(req: SplitProblemsRequest): ChatMessage[] {
  return [
    sys(
      "splitProblems",
      `The text is a problem sheet (exercises, homework, an exam), page by page. List every problem the learner could
work on, in order. A problem with parts (a), (b)… is one problem unless the parts ask for unrelated things; then list
each part as its own problem, with its label like "2(b)". "statement": the full statement, word for word, including
any shared setup the problem depends on (e.g. "Let G be a group…" given before several problems). "label": the
sheet's own number or name for it. "page": the page it starts on. Skip instructions, hints for the grader and answers.
Schema: {"problems":[{"label":string,"statement":string,"page":number}]}`,
    ),
    input(req, req.pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join("\n\n")),
  ];
}

function referencesBlock(refs: RefChunk[]): string {
  if (!refs.length) return "No reference passages were given; rely on standard knowledge of the field.";
  return `Reference passages from the learner's documents (cite them by number):\n${refs
    .map((r) => `[${r.n}] ${r.title}, p. ${r.page}:\n${r.text}`)
    .join("\n\n")}`;
}

function stepsBlock(steps: string[]): string {
  return steps.length ? `The learner's steps so far:\n${steps.map((s, i) => `Step ${i + 1}: ${s}`).join("\n")}` : "The learner hasn't written any steps yet.";
}

/** The rule every Derive together task shares: the learner does the work. */
export const NO_SOLUTION = "Never write out the next step, the final answer or a full proof, even when asked.";

const TUTOR = `You are a patient tutor in a "derive together" session. The learner works a problem out themselves;
you never do it for them. ${NO_SOLUTION} Base what
you say on the reference passages when they are relevant, citing them as [n] in the text and listing their numbers in
"cites"; use only numbers that were given. Use the names of concepts already in the graph when you refer to them.
"concepts": the definitions and theorems your answer relies on (name plus a one-sentence definition), so the learner
can add them to their concept graph; at most 5.`;

export function tutorHintPrompt(req: TutorHintRequest): ChatMessage[] {
  const strength =
    req.nth <= 1
      ? "This is the first hint: point in a direction (which definition, theorem or idea to look at) without saying how to use it."
      : req.nth === 2
        ? "The learner asked again: be more specific about what to consider, but still leave the step itself to them."
        : "The learner is stuck after several hints: name the exact fact or technique to apply and what it should be applied to, but do not carry it out.";
  return [
    sys(
      "tutorHint",
      `${TUTOR}
Give ONE hint for the learner's next step, one to three sentences. ${strength}
Schema: {"hint":string,"cites":number[],"concepts":[{"name":string,"definition":string}]}`,
    ),
    input(
      req,
      [`Problem: ${req.problem}`, stepsBlock(req.steps), referencesBlock(req.references), contextBlock(req.context)].join("\n\n"),
    ),
  ];
}

export function checkStepPrompt(req: CheckStepRequest): ChatMessage[] {
  return [
    sys(
      "checkStep",
      `${TUTOR}
Check the learner's newest step, given the problem and the steps before it.
"verdict": "ok" when the step is correct and justified; "gap" when it is true but relies on something the learner
hasn't justified or stated (a missing hypothesis, an unproved lemma, a skipped case); "error" when it is wrong or does
not follow; "unclear" when you can't tell what it claims.
"comment": one to three sentences for the learner. For "gap" and "error", say where the problem is and what kind of
thing is missing, but do not supply the fix. For "ok", say briefly why it holds.
"missing": the facts, hypotheses or concepts the step relies on without justification (short names), else [].
"solved": true only when, with this step, the problem is completely solved.
Schema: {"verdict":"ok"|"gap"|"error"|"unclear","comment":string,"missing":string[],"cites":number[],"concepts":[{"name":string,"definition":string}],"solved":boolean}`,
    ),
    input(
      req,
      [
        `Problem: ${req.problem}`,
        stepsBlock(req.steps),
        `Newest step to check: ${req.step}`,
        referencesBlock(req.references),
        contextBlock(req.context),
      ].join("\n\n"),
    ),
  ];
}

/** The tutor's earlier verdicts, so the referee can build on them. */
function checksBlock(checks: RefereeRequest["checks"]): string {
  if (!checks.length) return "";
  return `Earlier tutor checks (verify them yourself):\n${checks
    .map((c) => `Step ${c.step}: ${c.verdict}${c.solved ? ", completes the solution" : ""}${c.comment ? ` (${c.comment})` : ""}`)
    .join("\n")}`;
}

export function refereeReportPrompt(req: RefereeRequest): ChatMessage[] {
  return [
    sys(
      "refereeReport",
      `Parody mode: you are "Reviewer 2", the infamously pedantic, over-the-top anonymous referee, and the learner's derivation so far is the manuscript under review. Write a referee report on it.
THE TECHNICAL POINTS ARE REAL. Every point must be accurate and about the learner's actual text: a genuine gap, an unjustified or wrong step, a missing hypothesis or case, a quantifier or notation problem, an undefined symbol. Never invent an error in a correct step: for a correct step you may nitpick its presentation (as "pedantic") or grudgingly admit that it is correct. Only refer to steps that exist.
THE COMEDY IS IN THE TONE: weary sighs, "the author appears to believe", requests to cite your own (unnamed) work, excessive formality. Keep it kind: mock the prose, never the person; nothing offensive.
THE LEARNER DOES THE WORK. ${NO_SOLUTION} Say what is wrong or missing and where, not how to fix it: never supply the missing argument, the next step or the answer.
"verdict": "accept" only when the derivation completely and correctly solves the problem; "minor revisions" when it is correct but has presentation or small justification issues; "major revisions" when it has real gaps or is unfinished; "reject" when an error breaks it, or there are no steps.
"summary": two or three sentences, the report's funny opening paragraph (still accurate about the state of the derivation).
"points": at most 8, most serious first. "step": the step number it is about (1-based), or null for the derivation as a whole. "severity": "fatal" (an error that breaks the argument), "major" (a real gap), "minor" (a small omission or unclear notation), "pedantic" (true but petty). "comment": one to three sentences, in character but technically accurate.
"grudgingPraise": one sentence admitting something the learner genuinely did right (with nothing right yet, the courage to submit).
Schema: {"verdict":"accept"|"minor revisions"|"major revisions"|"reject","summary":string,"points":[{"step":number|null,"severity":"fatal"|"major"|"minor"|"pedantic","comment":string}],"grudgingPraise":string}`,
    ),
    input(
      req,
      [`Problem: ${req.problem}`, stepsBlock(req.steps), checksBlock(req.checks), referencesBlock(req.references), contextBlock(req.context)]
        .filter(Boolean)
        .join("\n\n"),
    ),
  ];
}

const ABSURD_STYLE: Record<AbsurdStyle, string> = {
  deadpan: "Deadpan: flat, understated and matter-of-fact, as if nothing about this were strange.",
  conspiracy:
    'Conspiracy: a breathless investigator connecting the dots ("Coincidence? I think not."), about harmless things only; never about real groups, people, events or health.',
  epic: "Epic: an overly dramatic saga of destiny, ages, heroes and grand pronouncements.",
  bureaucratic: "Bureaucratic: memos, forms, departments, approvals in triplicate and procedural sign-offs.",
  "academic-overkill":
    'Academic overkill: absurdly rigorous hedging, footnotes, "it can be shown that", lemmas for the obvious.',
};

export function absurdChainPrompt(req: AbsurdChainRequest): ChatMessage[] {
  const { min, max } = req.hops;
  // A stop is never on the avoid list, whatever earlier rolls went through.
  const stops = new Set(req.via.map((v) => normalizeName(v.name)));
  const avoided = req.avoid.filter((a) => !stops.has(normalizeName(a)));
  const avoid = avoided.length
    ? ` Take a different route than before: do not use ${avoided.map((a) => `"${a}"`).join(", ")} as intermediate concepts.`
    : "";
  const via = req.via.length
    ? `\nStops: the chain must pass through ${req.via.length === 1 ? "this stop" : `these ${req.via.length} stops, in this order`}: ${req.via.map((v) => `"${v.name}"`).join(" → ")}. Each stop is an intermediate concept of the chain, named exactly as given: the "to" of one hop and the "from" of the next. The links into and out of a stop are true relations of that stop as its description (under "Stops" below) defines it; a description the user wrote is what the stop means, even if the name usually means something else. There may be other concepts between stops.`
    : "";
  return [
    sys(
      "absurdChain",
      `Parody mode. Link two concepts, possibly from totally different fields, through a chain of related concepts, like a detective connecting two things that look unrelated. The chain has ${min === max ? min : `${min}-${max}`} hops: from → X1 → X2 → … → to.
THE FACTS ARE REAL. Every hop must be a genuinely true, checkable relation between its two concepts: standard knowledge that a reference work or textbook would confirm. "fact" states it soberly and accurately in one sentence: no jokes, no exaggeration, no invented dates, names, numbers or quotes. If you are not sure a link is true, take another route. Intermediate concepts are real, established things (concepts, objects, people, places, phenomena), named as they usually are, without $.
THE COMEDY IS IN THE TELLING. "quip" narrates the same hop in the requested style, in one or two sentences; "title" is a funny title for the whole chain (at most about 10 words); "moral" is a funny closing line. A quip may overdramatise the reasoning but must not contradict or embellish the fact. Keep it kind: no insults, no mocking of people or groups, nothing offensive, political, sexual or about tragedies.
Style: ${ABSURD_STYLE[req.style]}
Chain rules: the first hop's "from" is exactly "${req.from.name}"; the last hop's "to" is exactly "${req.to.name}"; each hop's "from" is exactly the previous hop's "to"; no concept appears twice.${avoid}${via}
"kind" is a short active relation label in the -ing form, read from "from" to "to" (2-5 words, e.g. "inventing a fix for", "browning", "laying"); never a passive "… by" form. "plausibility" is one sober sentence for the reader on how solid the links are (name the loosest one, if any).
Schema: {"title":string,"chain":[{"from":string,"to":string,"kind":string,"fact":string,"quip":string}],"moral":string,"plausibility":string}`,
    ),
    input(
      req,
      `${contextBlock(req.context)}\n\nFrom:\n${brief(req.from)}${req.via.length ? `\n\nStops, in order:\n${req.via.map(brief).join("\n")}` : ""}\n\nTo:\n${brief(req.to)}\n\nStyle: ${req.style}`,
    ),
  ];
}

export function mathlibPrompt(req: MathlibRequest): ChatMessage[] {
  return [
    sys(
      "mathlib",
      `Name the declarations in Lean 4's Mathlib that formalise this concept: its main definition (a structure, class,
def or predicate) or, for a theorem, the theorem itself, plus at most a few key lemmas about it. Give fully qualified
Lean 4 names exactly as they are in current Mathlib (e.g. "MonoidHom.ker", "Subgroup.Normal",
"QuotientGroup.quotientKerEquivRange"), never Lean 3 names. Every name is checked against Mathlib and names that don't
exist are thrown away, so do not guess: when unsure, give fewer names or none. At most 6, most important first.
"why": a few words on what the declaration is (e.g. "the kernel as a subgroup").
Schema: {"candidates":[{"name":string,"why":string}]}`,
    ),
    input(req, `Concept:\n${brief(req.node)}\n\n${contextBlock(req.context)}`),
  ];
}

export function connectPrompt(req: ConnectRequest): ChatMessage[] {
  const linked = req.linked.length ? `\nAlready linked (do not suggest): ${req.linked.join("; ")}` : "";
  return [
    sys(
      "connect",
      `Suggest keywords to connect a concept to: the concepts it most directly relates to. First the concepts its definition itself mentions or relies on, then what builds on it, close relatives (generalisations, special cases, duals), standard examples and the tools used with it. At most ${req.count}, most useful first. Only real, established concepts.
"name" = the concept's standard name (singular). If it is already in the graph, even under another name, use the graph's exact name.
"keyword" = the word or phrase in the given definition that points to it, copied exactly, or "" if none does.
"definition" = one sentence ("" for a concept already in the graph).
${KIND_GUIDE}
"aToB" = what the given concept does to / for the suggestion, "bToA" = what the suggestion does to / for the given concept. ${RELATION_KIND} "explanation" is one sentence.
Schema: {"suggestions":[{"name":string,"keyword":string,"definition":string,"kind":${KIND_VALUES}|null,"aToB":{"kind":string,"explanation":string},"bToA":{"kind":string,"explanation":string}}]}`,
    ),
    input(req, `Concept:\n${brief(req.node)}${linked}\n\n${contextBlock(req.existing)}`),
  ];
}
