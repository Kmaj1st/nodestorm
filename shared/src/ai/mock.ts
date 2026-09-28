import { normalizeName, type ConceptKind, type TheoremAnatomy } from "../model";
import { textOf, withDeadline, type ChatMessage, type CompleteOptions, type ModelInfo, type Provider, type RequestOptions } from "./provider";
import { ABSURD_VOICE_ZH, ANATOMY_ZH, BRIDGE_NAME_ZH, BRIDGES_ZH, EXPLAIN_VOICE_ZH, EXPLAIN_ZH, KB_ZH, MATHLIB_WHY_ZH } from "./mockZh";

/** The offline demo's Mathlib names for its concepts (real Mathlib declarations), plus one that doesn't exist. */
const MATHLIB: Record<string, { name: string; why: string }[]> = {
  group: [{ name: "Group", why: "the class of groups" }],
  subgroup: [{ name: "Subgroup", why: "subgroups as a structure" }],
  "normal subgroup": [{ name: "Subgroup.Normal", why: "the normality predicate" }],
  homomorphism: [{ name: "MonoidHom", why: "group homomorphisms (bundled monoid homomorphisms)" }],
  kernel: [
    { name: "MonoidHom.ker", why: "the kernel as a subgroup" },
    { name: "MonoidHom.normal_ker", why: "the kernel is normal" },
    { name: "MonoidHom.kernelSubgroupOfDoom", why: "a made-up name, to show it gets dropped" },
  ],
  isomorphism: [{ name: "MulEquiv", why: "group isomorphisms" }],
  "first isomorphism theorem": [{ name: "QuotientGroup.quotientKerEquivRange", why: "G / ker φ ≃ range φ" }],
};

/** What the offline demo "reads" on any scanned page. */
const SCANNED_PAGE =
  "4. Let $\\varphi: G \\to H$ be a group homomorphism. Show that $\\ker\\varphi$ is a normal subgroup of $G$.";

/**
 * Offline provider with a tiny abstract-algebra knowledge base.
 * Used for development without an API key and for automated tests.
 */
type Dep = { name: string; role: "uses" | "derives" | "assumes"; reason: string };

const KB: Record<string, { definition: string; aliases: string[]; deps: Dep[] }> = {
  group: {
    definition: "A set with an associative binary operation, an identity element, and inverses.",
    aliases: [],
    deps: [],
  },
  // A three-level chain (quotient group → normal subgroup → subgroup → group) for recursive installs.
  subgroup: {
    definition: "A subset of a group that is itself a group under the same operation.",
    aliases: [],
    deps: [{ name: "Group", role: "uses", reason: "A subgroup is a subset of a group closed under its operation." }],
  },
  "normal subgroup": {
    definition: "A subgroup $N$ of $G$ with $gNg^{-1} = N$ for every $g \\in G$.",
    aliases: [],
    deps: [{ name: "Subgroup", role: "uses", reason: "A normal subgroup is a subgroup invariant under conjugation." }],
  },
  "quotient group": {
    definition: "The group $G/N$ of cosets of a normal subgroup $N$, with $(aN)(bN) = abN$.",
    aliases: ["factor group"],
    deps: [
      { name: "Group", role: "uses", reason: "$G/N$ is built from a group $G$." },
      { name: "Normal subgroup", role: "uses", reason: "Cosets only multiply consistently when $N$ is normal." },
    ],
  },
  homomorphism: {
    definition: "A map between algebraic structures that preserves the operations, e.g. $\\varphi(ab) = \\varphi(a)\\varphi(b)$ for groups.",
    aliases: ["group homomorphism"],
    deps: [],
  },
  isomorphism: {
    definition: "A bijective homomorphism; its inverse is also a homomorphism.",
    aliases: ["group isomorphism"],
    deps: [{ name: "Homomorphism", role: "uses", reason: "An isomorphism is defined as a bijective homomorphism." }],
  },
  kernel: {
    definition: "The set $\\ker\\varphi$ of elements a homomorphism $\\varphi$ sends to the identity.",
    aliases: ["ker"],
    deps: [{ name: "Homomorphism", role: "uses", reason: "The kernel is defined for a homomorphism." }],
  },
  // Two entries that name each other as prerequisites, so the offline demo can produce a dependency cycle.
  chicken: {
    definition: "A domesticated bird that hatches from an egg.",
    aliases: [],
    deps: [{ name: "Egg", role: "uses", reason: "A chicken hatches from an egg." }],
  },
  egg: {
    definition: "An oval reproductive body laid by a bird, from which a chick hatches after incubation.",
    aliases: [],
    deps: [{ name: "Chicken", role: "uses", reason: "Eggs are laid by chickens." }],
  },
  "first isomorphism theorem": {
    definition: "For a homomorphism $\\varphi: G \\to H$, $G / \\ker\\varphi$ is isomorphic to $\\operatorname{im}\\varphi$.",
    aliases: ["fundamental homomorphism theorem"],
    deps: [
      { name: "Homomorphism", role: "uses", reason: "The theorem starts from a homomorphism $\\varphi: G \\to H$." },
      { name: "Isomorphism", role: "derives", reason: "Its conclusion is an isomorphism $G/\\ker\\varphi \\cong \\operatorname{im}\\varphi$." },
    ],
  },
  "lagrange's theorem": {
    definition: "For a finite group $G$ and a subgroup $H \\le G$, the order $|H|$ divides $|G|$.",
    aliases: [],
    deps: [{ name: "Subgroup", role: "uses", reason: "The theorem is about the order of a subgroup $H$ of $G$." }],
  },
};

/** What sort of statement each KB entry is; the rest are definitions. */
const KB_KIND: Record<string, ConceptKind> = {
  "first isomorphism theorem": "theorem",
  "lagrange's theorem": "theorem",
  chicken: "other",
  egg: "other",
};
const kindOf = (key: string): ConceptKind => KB_KIND[key] ?? "definition";

/** A kind read off a name that says what it is ("Zorn's lemma", "Axiom of choice"), else null. */
export function kindFromName(name: string): ConceptKind | null {
  const m = name.toLowerCase().match(/\b(theorem|lemma|proposition|corollary|axiom|conjecture|notation|example|definition)\b/);
  if (m) return m[1] as ConceptKind;
  // The same words in Chinese ("中值定理", "佐恩引理", "选择公理").
  const zh = name.match(/(定理|引理|命题|推论|公理|猜想|记号|例子|定义)/)?.[1];
  const ZH_KIND: Record<string, ConceptKind> = {
    定理: "theorem", 引理: "lemma", 命题: "proposition", 推论: "corollary", 公理: "axiom", 猜想: "conjecture", 记号: "notation", 例子: "example", 定义: "definition",
  };
  return zh ? ZH_KIND[zh] : null;
}

/** "Theorem anatomy" answers for the KB theorems; other theorems get one built from their definition. */
const ANATOMY: Record<string, TheoremAnatomy> = {
  "first isomorphism theorem": {
    hypotheses: [
      {
        text: "$G$ and $H$ are groups.",
        whyNeeded: "Quotients $G/N$ and images are only groups when the structures are groups.",
        counterexampleIfDropped: "For monoids, a surjective homomorphism $(\\mathbb{N}, +) \\to \\{0, 1\\}$ with $1 + 1 = 1$ has trivial kernel $\\{0\\}$ but is not injective, so the kernel alone does not determine the quotient.",
      },
      {
        text: "$\\varphi: G \\to H$ is a homomorphism.",
        whyNeeded: "The kernel is a normal subgroup, and the induced map is well defined, only because $\\varphi$ preserves products.",
        counterexampleIfDropped: "For the map $x \\mapsto x + 1$ on $\\mathbb{Z}$, the preimage of $0$ is $\\{-1\\}$, not a subgroup, so $G/\\ker\\varphi$ makes no sense.",
      },
    ],
    conclusion: "$G / \\ker\\varphi \\cong \\operatorname{im}\\varphi$, via $g\\ker\\varphi \\mapsto \\varphi(g)$.",
    proofIdea: "Define $\\bar\\varphi(g\\ker\\varphi) = \\varphi(g)$. It is well defined and injective because $\\varphi(g) = \\varphi(h)$ exactly when $g^{-1}h \\in \\ker\\varphi$. It is a homomorphism because $\\varphi$ is, and it is onto $\\operatorname{im}\\varphi$ by construction.",
    examples: [
      "$\\det: GL_n(\\mathbb{R}) \\to \\mathbb{R}^\\times$ gives $GL_n(\\mathbb{R}) / SL_n(\\mathbb{R}) \\cong \\mathbb{R}^\\times$.",
      "Reduction $\\mathbb{Z} \\to \\mathbb{Z}/n\\mathbb{Z}$ gives $\\mathbb{Z}/n\\mathbb{Z} \\cong \\mathbb{Z}/n\\mathbb{Z}$, the definition of the quotient.",
    ],
    nonExamples: [
      "It does not say $G \\cong \\ker\\varphi \\times \\operatorname{im}\\varphi$: $\\mathbb{Z}/4\\mathbb{Z} \\to \\mathbb{Z}/2\\mathbb{Z}$ has kernel and image $\\mathbb{Z}/2\\mathbb{Z}$, yet $\\mathbb{Z}/4\\mathbb{Z} \\not\\cong (\\mathbb{Z}/2\\mathbb{Z})^2$.",
    ],
  },
  "lagrange's theorem": {
    hypotheses: [
      {
        text: "$G$ is a finite group.",
        whyNeeded: "Orders are numbers only for finite groups; the cosets are counted.",
        counterexampleIfDropped: "For infinite $G$ the statement has no meaning as divisibility of integers; one uses the index $[G:H]$ instead.",
      },
      {
        text: "$H$ is a subgroup of $G$.",
        whyNeeded: "The cosets of a subgroup partition $G$ into pieces of equal size $|H|$.",
        counterexampleIfDropped: "For mere subsets it fails: any 4-element subset of $S_3$ has 4 elements, and 4 does not divide 6.",
      },
    ],
    conclusion: "$|H|$ divides $|G|$, and $|G| = [G:H]\\,|H|$.",
    proofIdea: "The left cosets $gH$ partition $G$, and $h \\mapsto gh$ is a bijection $H \\to gH$, so every coset has $|H|$ elements. Counting $G$ coset by coset gives $|G| = [G:H]\\,|H|$.",
    examples: ["In $S_3$ (order 6), the subgroups have orders 1, 2, 3 and 6."],
    nonExamples: ["The converse fails: $A_4$ has order 12 but no subgroup of order 6."],
  },
};

function anatomyOf(node: { name: string; definition?: string }, zh = false): TheoremAnatomy {
  const entry = kbGet(node.name);
  if (entry && ANATOMY[entry.key]) return zh ? ANATOMY_ZH[entry.key] : ANATOMY[entry.key];
  if (zh) {
    const statement = node.definition?.trim() || (entry && KB_ZH[entry.key].definition) || `${node.name}，如图谱中所述。`;
    // "若 A，则 B" / "对 A，B" / "设 A，B": a hypothesis and a conclusion; otherwise the whole statement concludes.
    const m = statement.match(/^(?:若|如果|对于?|设)\s*(.+?)[，,]\s*(?:则\s*)?(.+)$/);
    return {
      hypotheses: m ? [{ text: m[1], whyNeeded: "这个命题只在这个假设下成立。", counterexampleIfDropped: "" }] : [],
      conclusion: m ? m[2] : statement,
      proofIdea: `离线演示没有${node.name}的证明梗概；看看它的前置知识是如何组合起来的。`,
      examples: [],
      nonExamples: [],
    };
  }
  const statement = node.definition?.trim() || entry?.definition || `${node.name}, as stated in your graph.`;
  // Split "If A, then B" / "For A, B" into a hypothesis and a conclusion; otherwise the whole statement concludes.
  const m = statement.match(/^(?:if|for|let)\s+(.+?),\s*(?:then\s+)?(.+)$/i);
  return {
    hypotheses: m
      ? [{ text: m[1], whyNeeded: "The statement is only made under this assumption.", counterexampleIfDropped: "" }]
      : [],
    conclusion: m ? m[2] : statement,
    proofIdea: `The offline demo has no proof sketch for ${node.name}; look at how its prerequisites combine.`,
    examples: [],
    nonExamples: [],
  };
}

/** Richer "explain more" material for a few KB concepts; the others get one built from their KB entry. */
const EXPLAIN: Record<string, { intuition: string; keyPoints: string[]; examples: { title: string; body: string }[]; pitfalls: string[] }> = {
  homomorphism: {
    intuition: "a homomorphism translates one structure into another without breaking its arithmetic: combine then map, or map then combine — same result.",
    keyPoints: [
      "$\\varphi(ab) = \\varphi(a)\\varphi(b)$ for all $a, b$.",
      "It sends the identity to the identity and inverses to inverses.",
      "Its kernel is a normal subgroup and its image is a subgroup.",
    ],
    examples: [
      { title: "Exponential map", body: "$x \\mapsto e^x$ from $(\\mathbb{R}, +)$ to $(\\mathbb{R}_{>0}, \\times)$: $e^{x+y} = e^x e^y$." },
      { title: "Reduction mod n", body: "$\\mathbb{Z} \\to \\mathbb{Z}/n\\mathbb{Z}$ sends each integer to its remainder class; sums map to sums." },
      { title: "Non-example", body: "$x \\mapsto x + 1$ on $(\\mathbb{Z}, +)$ does not send $0$ to $0$, so it is not a homomorphism." },
    ],
    pitfalls: [
      "A homomorphism need not be injective or surjective — that is what isomorphisms add.",
      "Check the operations of both structures: $(\\mathbb{R}, +) \\to (\\mathbb{R}, \\times)$ is a different setting from $(\\mathbb{R}, +) \\to (\\mathbb{R}, +)$.",
    ],
  },
  isomorphism: {
    intuition: "isomorphic structures are the same structure with the elements renamed.",
    keyPoints: ["An isomorphism is a bijective homomorphism.", "Its inverse is automatically a homomorphism.", "Isomorphic groups share every group-theoretic property."],
    examples: [{ title: "Logarithm", body: "$\\log: (\\mathbb{R}_{>0}, \\times) \\to (\\mathbb{R}, +)$ is an isomorphism, inverse to $\\exp$." }],
    pitfalls: ["Having the same number of elements does not make two groups isomorphic ($\\mathbb{Z}/4\\mathbb{Z}$ vs $\\mathbb{Z}/2\\mathbb{Z} \\times \\mathbb{Z}/2\\mathbb{Z}$)."],
  },
};

/**
 * True facts linking the KB with a few everyday things, for the offline "absurd chain": a Homomorphism is three
 * links from the Fourier transform, which is four from Toast. `kind` reads from a to b, `back` from b to a; both are
 * active labels (never "is … by"), since a chain can walk a link either way.
 */
const BRIDGES: { a: string; b: string; kind: string; back: string; fact: string }[] = [
  { a: "Subgroup", b: "Group", kind: "living inside", back: "containing", fact: "A subgroup is a subset of a group that is itself a group under the same operation." },
  { a: "Normal subgroup", b: "Subgroup", kind: "being a kind of", back: "narrowing down to", fact: "A normal subgroup is a subgroup that is invariant under conjugation." },
  { a: "Quotient group", b: "Normal subgroup", kind: "building on", back: "giving rise to", fact: "The quotient group $G/N$ is made of the cosets of a normal subgroup $N$." },
  { a: "Group", b: "Homomorphism", kind: "setting the rules for", back: "preserving", fact: "A homomorphism is a map between groups that preserves the group operation." },
  { a: "Kernel", b: "Homomorphism", kind: "measuring the injectivity of", back: "determining", fact: "The kernel of a homomorphism is the set of elements it sends to the identity." },
  { a: "Isomorphism", b: "Homomorphism", kind: "being a kind of", back: "specialising to", fact: "An isomorphism is a bijective homomorphism." },
  { a: "First isomorphism theorem", b: "Homomorphism", kind: "starting from", back: "anchoring", fact: "The first isomorphism theorem starts from a homomorphism $\\varphi: G \\to H$ and describes its image." },
  { a: "Homomorphism", b: "Exponential function", kind: "including", back: "exemplifying", fact: "The exponential $x \\mapsto e^x$ is a homomorphism from $(\\mathbb{R}, +)$ to $(\\mathbb{R}_{>0}, \\times)$, since $e^{x+y} = e^x e^y$." },
  { a: "Exponential function", b: "Fourier transform", kind: "building up", back: "building on", fact: "The Fourier transform writes a function as a superposition of complex exponentials $e^{2\\pi i \\xi x}$." },
  { a: "Fourier transform", b: "Heat equation", kind: "inventing a fix for", back: "inspiring", fact: "Joseph Fourier developed Fourier analysis to solve the heat equation, in his 1822 book on the theory of heat." },
  { a: "Heat equation", b: "Heat", kind: "describing the flow of", back: "flowing according to", fact: "The heat equation $u_t = \\alpha \\nabla^2 u$ describes how heat diffuses through a material." },
  { a: "Heat", b: "Maillard reaction", kind: "speeding up", back: "needing", fact: "The Maillard reaction between amino acids and reducing sugars becomes fast at around 140 to 165 °C." },
  { a: "Maillard reaction", b: "Toast", kind: "browning", back: "getting its colour from", fact: "Toast turns brown mainly through the Maillard reaction at the surface of the bread." },
  { a: "Egg", b: "Heat", kind: "firming up in", back: "setting", fact: "When an egg is heated, its proteins denature and it sets." },
  { a: "Chicken", b: "Egg", kind: "laying", back: "hatching", fact: "Hens lay eggs." },
  // Anything the demo doesn't know joins through the page it is written on.
  { a: "Written language", b: "Paper", kind: "living on", back: "carrying", fact: "Written language has been recorded on paper for about two thousand years." },
  { a: "Paper", b: "Heat", kind: "burning in", back: "igniting", fact: "Paper catches fire when heated to roughly 230 °C." },
];
const WRITTEN = "Written language";

/**
 * "Explain more" voices for the demo: fixed wrappers around the plain explanation, so the content (and every formula)
 * is exactly the plain one. The summary is never voiced: it may become the definition.
 */
/** "It sends…" → "it sends…" after a lead-in; names ("First Isomorphism…") and formulas stay as they are. */
const decap = (x: string) => (/^[A-Z][a-z]/.test(x) && !/^[A-Z][a-z]+ [A-Z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x);

interface VoiceWrap {
  open: (name: string) => string;
  point: (text: string, i: number) => string;
  example: (body: string) => string;
  pitfall: (text: string) => string;
}
const EXPLAIN_VOICE: Record<string, VoiceWrap> = {
  "nature-documentary": {
    open: (n) => `Here, in the quiet undergrowth of mathematics, we find the ${n}. Let us observe it without disturbing it.`,
    point: (x, i) => (i === 0 ? `Observe closely: ${x}` : `Remarkably, ${decap(x)}`),
    example: (b) => `A specimen in the wild: ${b}`,
    pitfall: (x) => `Young learners often stumble here. ${x}`,
  },
  "sports-commentator": {
    open: (n) => `And we are live! ${n} takes the field, and the crowd is on its feet!`,
    point: (x, i) => (i === 0 ? `What a play: ${x}` : `Let's see that again in slow motion: ${x}`),
    example: (b) => `Instant replay: ${b}`,
    pitfall: (x) => `Oh, and that's a foul! ${x}`,
  },
  "noir-detective": {
    open: (n) => `The rain hadn't stopped for three days when the case of the ${n} landed on my desk.`,
    point: (x, i) => (i === 0 ? `First clue: ${x}` : `Another clue. ${x}`),
    example: (b) => `I'd seen one like it before. ${b}`,
    pitfall: (x) => `That's where the rookies get burned. ${x}`,
  },
  "medieval-scholar": {
    open: (n) => `Herein beginneth a humble treatise upon the ${n}, set down by an unworthy scholar.`,
    point: (x, i) => (i === 0 ? `Firstly, be it known: ${x}` : `Moreover, it is written: ${x}`),
    example: (b) => `As the ancients showed: ${b}`,
    pitfall: (x) => `Beware, gentle reader, the error of the unlearned. ${x}`,
  },
  infomercial: {
    open: (n) => `Tired of concepts that don't deliver? Introducing the ${n}!`,
    point: (x, i) => (i === 0 ? `It's that easy: ${x}` : `But wait, there's more! ${x}`),
    example: (b) => `Satisfied customers report: ${b}`,
    pitfall: (x) => `Warning, read the fine print: ${x}`,
  },
  shakespearean: {
    open: (n) => `Hark! What concept through yonder textbook breaks? It is the ${n}.`,
    point: (x, i) => (i === 0 ? `Mark this well: ${x}` : `And more, good friend: ${x}`),
    example: (b) => `Behold, an instance: ${b}`,
    pitfall: (x) => `Alas, many a scholar hath erred thus. ${x}`,
  },
};

type RefSeverity = "fatal" | "major" | "minor" | "pedantic";

type Quip = (a: string, b: string) => string;
const ABSURD_VOICE: Record<string, { title: Quip; moral: string; quips: Quip[] }> = {
  deadpan: {
    title: (a, b) => `${a} and ${b}: a perfectly ordinary connection`,
    moral: "So that is that. Everything is connected, and it is mostly fine.",
    quips: [
      (a, b) => `${a} leads to ${b}. Nobody seems surprised.`,
      (_a, b) => `Then ${b}. Naturally.`,
      (a, b) => `From ${a} it is a short walk to ${b}. We walked it.`,
    ],
  },
  conspiracy: {
    title: (a, b) => `What they don't want you to know about ${a} and ${b}`,
    moral: "Connect enough dots and you get a line. Draw your own conclusions.",
    quips: [
      (a, b) => `${a} and ${b}. Coincidence? I think not.`,
      (a, b) => `Follow the thread from ${a}: it goes straight to ${b}. Hidden in plain sight, as always.`,
      (a, b) => `Who benefits from ${a}? ${b}. Every single time.`,
    ],
  },
  epic: {
    title: (a, b) => `The Saga of ${a} and ${b}`,
    moral: "And so the prophecy was fulfilled, as prophecies in textbooks usually are.",
    quips: [
      (a, b) => `And lo, out of ${a} rose ${b}, and the ages trembled.`,
      (a, b) => `Then came ${b}, as foretold in the ancient scrolls of ${a}.`,
      (a, b) => `Bards still sing of the day ${a} met ${b}.`,
    ],
  },
  bureaucratic: {
    title: (a, b) => `Form 27-B: request to connect ${a} to ${b}`,
    moral: "Approved in triplicate. Please allow six to eight weeks for enlightenment.",
    quips: [
      (a, b) => `The Department of ${a} has forwarded your request to the Office of ${b}.`,
      (a, b) => `Link from ${a} to ${b} approved, pending a second signature.`,
      (a, b) => `Please take a number: ${b} will see ${a} shortly.`,
    ],
  },
  "academic-overkill": {
    title: (a, b) => `On the non-trivial relationship between ${a} and ${b}: a preliminary note`,
    moral: "Further research is needed. So is further funding.",
    quips: [
      (a, b) => `It can be shown (see footnote 47) that ${a} is, in a precise sense, related to ${b}.`,
      (a, b) => `Lemma: ${a} obliges us to discuss ${b}. Proof: left to the reviewer.`,
      (a, b) => `Under mild assumptions, ${b} follows from ${a}, although the authors admit they had coffee first.`,
    ],
  },
};

/** The KB entry for a name or alias, English or Chinese. */
function kbGet(name: string) {
  const key = normalizeName(name);
  const entry = Object.entries(KB).find(
    ([k, v]) =>
      normalizeName(k) === key ||
      v.aliases.some((a) => normalizeName(a) === key) ||
      [KB_ZH[k].name, ...KB_ZH[k].aliases].some((a) => normalizeName(a) === key),
  );
  return entry && { key: entry[0], ...entry[1] };
}

/** A KB entry's name, definition, aliases and prerequisite reasons in the answer's language. */
function kbText(key: string, zh: boolean) {
  const v = KB[key];
  if (!zh) return { name: title(key), definition: v.definition, aliases: v.aliases, deps: v.deps };
  const z = KB_ZH[key];
  const deps = v.deps.map((d, i) => ({ ...d, name: KB_ZH[kbGet(d.name)!.key].name, reason: z.reasons[i] ?? d.reason }));
  return { name: z.name, definition: z.definition, aliases: z.aliases, deps };
}

const HAN = /\p{Script=Han}/u;

/**
 * Whether the answer is in Chinese, as the real prompts ask (see languageInstruction in prompts.ts): a language
 * setting that names Chinese, or "auto" (or none) with names written in Chinese characters.
 */
export function answersInChinese(language: string | undefined, names: string[]): boolean {
  const lang = (language ?? "").trim();
  if (lang && lang.toLowerCase() !== "auto") return /chinese|中文|^zh\b/i.test(lang);
  return names.some((n) => HAN.test(n));
}

/**
 * The output language the prompt asks for: the request's `language` option, else the system message's
 * "Output language" paragraph ("the same language as the concept names…" is "auto").
 */
function languageOf(messages: ChatMessage[], opts: CompleteOptions): string | undefined {
  if (opts.language) return opts.language;
  const m = textOf(messages[0]?.content ?? "").match(/^Output language: [^\n]*\) in ([^\n]+)\.$/m);
  if (!m) return undefined;
  return m[1].startsWith("the same language as") ? "auto" : m[1];
}

/**
 * KB concepts named in Chinese in a text (Chinese has no spaces to find words by), with where and as what they first
 * appear. Longer names are matched first and blanked out, so "正规子群" doesn't also count as "子群" or "群".
 */
function zhMentions(text: string): { key: string; at: number; hit: string }[] {
  if (!HAN.test(text)) return [];
  const names = Object.entries(KB_ZH)
    .flatMap(([key, z]) => [z.name, ...z.aliases].map((n) => ({ key, n })))
    .sort((a, b) => b.n.length - a.n.length);
  let rest = text;
  const out: { key: string; at: number; hit: string }[] = [];
  for (const { key, n } of names) {
    const at = rest.indexOf(n);
    if (at < 0) continue;
    const seen = out.find((o) => o.key === key);
    if (!seen) out.push({ key, at, hit: n });
    else if (at < seen.at) Object.assign(seen, { at, hit: n });
    rest = rest.split(n).join("\u0000".repeat(n.length));
  }
  return out;
}

/**
 * The knowledge base's entry for a name or alias (English or Chinese): the offline demo's web search builds its pages
 * from it, in Chinese with `zh`.
 */
export function kbDefinition(name: string, zh = false): { name: string; definition: string; aliases: string[] } | null {
  const e = kbGet(name);
  if (!e) return null;
  const t = kbText(e.key, zh);
  return { name: t.name, definition: t.definition, aliases: t.aliases };
}

/** The plain demo explanation in one of the parody voices (content untouched; "plain" or unknown: as is). */
function voiced<T extends { intuition: string; keyPoints: string[]; examples: { title: string; body: string }[]; pitfalls: string[] }>(
  ex: T,
  name: string,
  voice: unknown,
  zh = false,
): T {
  const w = typeof voice === "string" ? (zh ? EXPLAIN_VOICE_ZH : EXPLAIN_VOICE)[voice] : undefined;
  if (!w) return ex;
  return {
    ...ex,
    intuition: `${w.open(name)}${zh ? "" : " "}${ex.intuition}`,
    keyPoints: ex.keyPoints.map(w.point),
    examples: ex.examples.map((x) => ({ ...x, body: w.example(x.body) })),
    pitfalls: ex.pitfalls.map(w.pitfall),
  };
}

/**
 * The offline demo's source check: encyclopedias and lecture notes rate high, a forum low (with why), other pages
 * medium; a page that never uses a word of mathematics is about another meaning. Each passage is copied from the
 * source's text: an encyclopedia's whole definition, or a page's first sentence that reads as a definition.
 */
function assessSources(name: string, sources: { id: string; kind: string; site: string; title?: string; text: string }[], zh = false) {
  const math = /\b(group|set|element|operation|homomorphism|subgroup|map|identity|theorem|function|bird)\b|\$|群|集合|元素|运算|同态|映射|单位元|定理|函数|鸟/i;
  const sentences = (text: string) => text.match(/[\s\S]*?(?:(?<!\b(?:e\.g|i\.e|cf|etc|vs))[.!?](?=\s|$)|[。！？])/g) ?? [text];
  const key = name.toLowerCase();
  const ratings = sources.map((s) => {
    const forum = /forum|reddit|quora|answers/i.test(s.site);
    const strong = s.kind === "encyclopedia" || /encyclopedia|lecture|university|\.edu\b|wiki/i.test(s.site);
    const other = !math.test(s.text);
    // An encyclopedia's text is already its definition; a web page's is the first sentence naming the concept.
    // A defining sentence reads like one ("A …", "The …", "For …, …", "If …"), not like a heading or an aside.
    const all = sentences(s.text).map((x) => x.trim());
    // A Chinese page says "定义：…" before its definition; the passage is what follows (still the page's own words).
    const labelled = all.find((x) => /^定义[：:]\s*\S/.test(x))?.replace(/^定义[：:]\s*/, "");
    const defining = labelled ?? all.find((x) => x.length >= 20 && /^(A|An|The|For|If|Let|Given)\s/.test(x));
    const first = s.kind === "encyclopedia" ? s.text : (defining ?? all.find((x) => x.toLowerCase().includes(key)) ?? all[0] ?? "");
    const reasons = zh
      ? forum
        ? "论坛帖子：没有编辑审核，而且说法与百科和讲义不一致。"
        : other
          ? "讲的是这个名称的另一个含义；就那个含义而言是可靠的页面。"
          : strong
            ? "百科或课程页面；与其他来源一致。"
            : "普通网页；与其他来源一致，但没有列出参考文献。"
      : forum
        ? "A forum post: no editorial review, and its wording disagrees with the encyclopedia and the lecture notes."
        : other
          ? "Describes another meaning of the name; a reliable page for that meaning."
          : strong
            ? "An encyclopedia or course page; agrees with the other sources."
            : "A general web page; agrees with the other sources but names no references.";
    // Another meaning is labelled by the page's first words (the demo can't tell meanings apart any better).
    const otherSense = HAN.test(s.text.slice(0, 20))
      ? s.text.split(/[，。：；,.;:\s]/)[0].slice(0, 8)
      : s.text.split(/\s+/).slice(0, 3).join(" ").replace(/[.,;:]$/, "");
    return {
      id: s.id,
      reliability: forum ? "low" : strong ? "high" : "medium",
      reasons,
      sense: other ? otherSense : zh ? "数学" : "mathematics",
      passage: first.trim(),
    };
  });
  const low = ratings.filter((r) => r.reliability === "low").map((r) => sources.find((s) => s.id === r.id)!.site);
  const note = zh
    ? low.length
      ? `这些来源对定义的说法一致，只有 ${low.join("、")} 与其他来源矛盾。`
      : "这些来源对定义的说法一致。"
    : low.length
      ? `The sources agree on the definition, except ${low.join(", ")}, which contradicts the others.`
      : "The sources agree on the definition.";
  return { ratings, note };
}

/** Title case: each word's first letter, not a letter after an apostrophe ("Lagrange's Theorem", not "Lagrange'S"). */
function title(s: string) {
  return s.replace(/(?<![\w'’])\w/g, (c) => c.toUpperCase());
}

function parseInput(messages: ChatMessage[]): any {
  const user = [...messages].reverse().find((m) => m.role === "user" && textOf(m.content).includes("INPUT:"));
  const raw = user ? textOf(user.content).split("INPUT:\n").pop()! : "{}";
  return JSON.parse(raw);
}

export class MockProvider implements Provider {
  id = "mock";
  label = "Mock (offline)";
  model = "mock-kb";
  configured = true;

  async listModels(_opts?: RequestOptions): Promise<ModelInfo[]> {
    return [{ id: "mock-kb", label: "Built-in algebra knowledge base" }];
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    // Honour cancellation like a real provider; the answer itself is instant.
    return withDeadline(this.label, { signal: opts.signal, timeoutMs: opts.timeoutMs ?? 10_000 }, async () =>
      this.answer(messages, languageOf(messages, opts)),
    );
  }

  private answer(messages: ChatMessage[], language: string | undefined): string {
    const task = textOf(messages[0]?.content ?? "").match(/\[task:(\w+)\]/)?.[1];
    const inp = parseInput(messages);
    // Chinese or English, by the language setting or ("auto") the script of the names the task is about.
    const zhFor = (...xs: unknown[]) => answersInChinese(language, xs.map((x) => String(x ?? "")));
    const nodeZh = () => zhFor(inp.node?.name);
    switch (task) {
      case "name":
        return JSON.stringify(this.name(String(inp.description ?? ""), zhFor(inp.description)));
      case "relate":
        return JSON.stringify(this.relate(inp.a.name, inp.b.name, zhFor(inp.a.name, inp.b.name)));
      case "deps":
        return JSON.stringify(this.deps(inp.node.name, inp.existing ?? [], nodeZh()));
      case "derive": {
        const selected: { name: string }[] = inp.selected ?? [];
        return JSON.stringify(this.derive(selected, zhFor(...selected.map((s) => s.name))));
      }
      case "explain": {
        const zh = nodeZh();
        return JSON.stringify(
          voiced(this.explain(inp.node, inp.prerequisites ?? [], String(inp.level ?? "intuitive"), zh), inp.node?.name ?? "", inp.voice, zh),
        );
      }
      case "extract":
        return JSON.stringify(this.extract(String(inp.text ?? ""), inp.existing ?? [], zhFor(inp.text)));
      case "resolveCycle": {
        const links: { from: { name: string }; to: { name: string } }[] = inp.links ?? [];
        return JSON.stringify(this.resolveCycle(links, zhFor(...links.flatMap((l) => [l.from?.name, l.to?.name]))));
      }
      case "quiz":
        return JSON.stringify(this.quiz(inp.node, inp.prerequisites ?? [], String(inp.style ?? "recall"), Boolean(inp.multipleChoice), nodeZh()));
      case "connect":
        return JSON.stringify(this.connect(inp, nodeZh()));
      case "mathlib": {
        // The names are Lean identifiers in any language; only the "why" is translated.
        const name = String(inp.node?.name ?? "");
        const found = MATHLIB[kbGet(name)?.key ?? normalizeName(name)] ?? [];
        return JSON.stringify({ candidates: nodeZh() ? found.map((c) => ({ ...c, why: MATHLIB_WHY_ZH[c.name] ?? c.why })) : found });
      }
      case "readPage":
        return JSON.stringify({ text: SCANNED_PAGE });
      case "splitProblems":
        return JSON.stringify(this.splitProblems(inp.pages ?? []));
      case "tutorHint":
        return JSON.stringify(this.tutorHint(inp));
      case "checkStep":
        return JSON.stringify(this.checkStep(inp));
      case "refereeReport":
        return JSON.stringify(this.referee(inp));
      case "absurdChain":
        return JSON.stringify(this.absurdChain(inp, zhFor(inp.from?.name, inp.to?.name)));
      case "anatomy":
        return JSON.stringify(anatomyOf(inp.node ?? { name: "" }, nodeZh()));
      case "assess":
        return JSON.stringify(assessSources(String(inp.name ?? ""), inp.sources ?? [], zhFor(inp.name)));
      default:
        return "{}";
    }
  }

  /**
   * The shortest route through BRIDGES (avoiding earlier rolls' concepts when another route exists). An end the demo
   * doesn't know joins through "Written language" (its name is written with letters, which is true of anything).
   * The narration comes from the style's templates; a "Roll again" (with an avoid list) starts one template later.
   * The user's stops (`via`) are visited in order, one shortest route per leg, never through a concept an earlier leg
   * used; a leg with no such route (two unknown stops in a row both need "Written language") is one generic hop.
   */
  private absurdChain(inp: { from: { name: string }; to: { name: string }; via?: { name: string }[]; style?: string; avoid?: string[] }, zh = false) {
    const from = inp.from.name;
    const to = inp.to.name;
    const via = (inp.via ?? []).map((v) => v.name);
    const named = [from, ...via, to];
    // The links in the answer's language; a name in the other language (or a KB alias) still finds its concept.
    const bridges = zh
      ? BRIDGES.map((l, i) => ({ a: BRIDGE_NAME_ZH[l.a], b: BRIDGE_NAME_ZH[l.b], ...BRIDGES_ZH[i] }))
      : BRIDGES;
    const written = zh ? BRIDGE_NAME_ZH[WRITTEN] : WRITTEN;
    const english = [...new Set(BRIDGES.flatMap((l) => [l.a, l.b]))];
    const known = (name: string) => {
      const k = normalizeName(name);
      // A Chinese alias of a KB concept ("同态核", "鸡蛋") finds it too.
      const kb = HAN.test(name) ? kbGet(name)?.key : undefined;
      const en = english.find(
        (n) => normalizeName(n) === k || normalizeName(BRIDGE_NAME_ZH[n]) === k || (kb !== undefined && kbGet(n)?.key === kb),
      );
      return en && (zh ? BRIDGE_NAME_ZH[en] : en);
    };
    /** The chain's own name for a stop it knows, else the stop's name. */
    const canonical = (name: string) => known(name) ?? name;
    const stops = named.map(canonical);
    type Edge = { next: string; kind: string; fact: string };
    type Hop = { from: string; to: string; kind: string; fact: string };
    const edges = new Map<string, Edge[]>();
    const add = (x: string, e: Edge) => edges.set(normalizeName(x), [...(edges.get(normalizeName(x)) ?? []), e]);
    for (const l of bridges) {
      add(l.a, { next: l.b, kind: l.kind, fact: l.fact });
      add(l.b, { next: l.a, kind: l.back, fact: l.fact });
    }
    for (const end of stops) {
      if (known(end)) continue;
      const fact = zh ? `名称“${end}”是用某种文字系统的字符写成的。` : `The name “${end}” is written with the letters of a writing system.`;
      add(end, { next: written, kind: zh ? "借用字符于" : "using the letters of", fact });
      add(written, { next: end, kind: zh ? "书写" : "writing", fact });
    }
    /** The shortest route from `a` to `b` that passes through none of `blocked`. */
    const route = (a: string, b: string, blocked: Set<string>): Hop[] | null => {
      const prev = new Map<string, { at: string; edge: Edge }>();
      const queue = [a];
      const seen = new Set([normalizeName(a)]);
      while (queue.length) {
        const at = queue.shift()!;
        if (normalizeName(at) === normalizeName(b)) break;
        for (const e of edges.get(normalizeName(at)) ?? []) {
          const k = normalizeName(e.next);
          if (seen.has(k) || (blocked.has(k) && k !== normalizeName(b))) continue;
          seen.add(k);
          prev.set(k, { at, edge: e });
          queue.push(e.next);
        }
      }
      const hops: Hop[] = [];
      for (let k = normalizeName(b); prev.has(k); ) {
        const { at, edge } = prev.get(k)!;
        hops.unshift({ from: at, to: edge.next, kind: edge.kind, fact: edge.fact });
        k = normalizeName(at);
      }
      return hops.length ? hops : null;
    };
    const avoid = inp.avoid ?? [];
    const avoided = avoid.map((a) => normalizeName(canonical(a)));
    const used = new Set<string>();
    const hops: Hop[] = [];
    for (let s = 0; s + 1 < stops.length; s++) {
      const [a, b] = [stops[s], stops[s + 1]];
      // Never through a concept already on the chain, nor through a stop still to come.
      const blocked = new Set([...used, ...stops.slice(s + 2).map(normalizeName)]);
      const leg = route(a, b, new Set([...blocked, ...avoided])) ??
        route(a, b, blocked) ?? [
          zh
            ? { from: a, to: b, kind: "同句提及", fact: `“${named[s]}”和“${named[s + 1]}”可以在同一个句子里提到，就像这句话一样。` }
            : { from: a, to: b, kind: "sharing a sentence with", fact: `“${named[s]}” and “${named[s + 1]}” can be named in the same sentence, as this one does.` },
        ];
      for (const h of leg) used.add(normalizeName(h.from));
      // The ends and stops keep the names the user gave them.
      leg[0] = { ...leg[0], from: named[s] };
      leg[leg.length - 1] = { ...leg[leg.length - 1], to: named[s + 1] };
      hops.push(...leg);
    }
    const voice = (zh ? ABSURD_VOICE_ZH : ABSURD_VOICE)[inp.style ?? "deadpan"] ?? (zh ? ABSURD_VOICE_ZH : ABSURD_VOICE).deadpan;
    const n = voice.quips.length;
    return {
      title: voice.title(from, to),
      chain: hops.map((h, i) => ({
        ...h,
        quip: voice.quips[(i + (avoid.length ? 1 : 0)) % n](h.from, h.to),
      })),
      moral: voice.moral,
      plausibility: zh
        ? "离线演示：连线来自一份内置的简短真实事实列表，笑话来自模板。"
        : "Offline demo: the links come from a short built-in list of true facts, and the jokes from templates.",
    };
  }

  /** Problems numbered "1." or "2)" at the start of a line or after a sentence. */
  private splitProblems(pages: { page: number; text: string }[]) {
    const problems: { label: string; statement: string; page: number }[] = [];
    for (const pg of pages) {
      for (const m of pg.text.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+([\s\S]+?)(?=\s\d{1,2}[.)]\s|$)/g)) {
        problems.push({ label: m[1], statement: m[2].replace(/\s+/g, " ").trim(), page: pg.page });
      }
    }
    return { problems };
  }

  /**
   * KB concepts named in the text, in the order they appear. Longer names are matched first, so "normal subgroup"
   * doesn't also count as "subgroup".
   */
  private mentioned(text: string) {
    const t = ` ${normalizeName(text)} `;
    const found: { name: string; definition: string; at: number }[] = [];
    for (const k of Object.keys(KB).sort((a, b) => b.length - a.length)) {
      const at = Math.min(...[k, ...KB[k].aliases].map((n) => t.indexOf(` ${normalizeName(n)} `)).filter((i) => i >= 0));
      if (Number.isFinite(at) && !found.some((f) => normalizeName(f.name).includes(normalizeName(k)))) {
        found.push({ name: title(k), definition: KB[k].definition, at });
      }
    }
    return found.sort((a, b) => a.at - b.at).slice(0, 5).map(({ name, definition }) => ({ name, definition }));
  }

  private tutorHint(inp: { problem: string; steps?: string[]; references?: { n: number }[]; nth?: number }) {
    const concepts = this.mentioned(`${inp.problem} ${(inp.steps ?? []).join(" ")}`);
    const first = concepts[0]?.name ?? "the definitions involved";
    const nth = inp.nth ?? 1;
    const hint =
      nth <= 1
        ? `Start from the definition of ${first}: what does it say, and which part of the problem does it apply to?`
        : nth === 2
          ? `Write down what membership in ${first} means as an equation, then see what the other hypothesis gives you.`
          : `Take an arbitrary element and conjugate it; use that a homomorphism preserves products and inverses.`;
    const cites = inp.references?.length ? [inp.references[0].n] : [];
    return { hint: cites.length ? `${hint} See [${cites[0]}].` : hint, cites, concepts };
  }

  /**
   * Deterministic stand-in for checking a step: a step with a question mark or under 8 characters is unclear, one
   * that says "wrong" is an error, one that gives a reason (because/since/by, or uses φ) is fine, anything else has
   * a gap: the first concept of the problem it doesn't mention.
   */
  private checkStep(inp: { problem: string; step: string; references?: { n: number }[] }) {
    const step = inp.step.trim();
    const lower = step.toLowerCase();
    const concepts = this.mentioned(`${inp.problem} ${step}`);
    const cites = inp.references?.length ? [inp.references[0].n] : [];
    if (step.length < 8 || step.includes("?")) {
      return { verdict: "unclear", comment: "I can't tell what this step claims; write it as a statement.", missing: [], cites: [], concepts: [], solved: false };
    }
    if (/\bwrong\b/.test(lower)) {
      return { verdict: "error", comment: "This does not follow from the previous steps.", missing: [], cites, concepts, solved: false };
    }
    if (/\b(because|since|by)\b|\\varphi|φ/.test(lower)) {
      const solved = /\b(hence|therefore|thus)\b/.test(lower);
      return { verdict: "ok", comment: "Correct, and the reason is stated.", missing: [], cites, concepts, solved };
    }
    const gap = this.mentioned(inp.problem).find((c) => !lower.includes(c.name.toLowerCase()))?.name ?? "a justification";
    return {
      verdict: "gap",
      comment: `The claim is plausible, but you use a property of ${gap} without saying so.`,
      missing: [gap],
      cites,
      concepts,
      solved: false,
    };
  }

  /**
   * "Reviewer 2" for the demo: each step gets the tutor's earlier verdict or, without one, the demo's own check
   * (see checkStep), and the report follows from those verdicts: an error is fatal, a gap major, an unclear step
   * minor, and a correct step gets a pedantic remark about its presentation. Never says how to fix anything.
   */
  private referee(inp: { problem: string; steps?: string[]; checks?: { step: number; verdict: string; comment?: string; solved?: boolean }[] }) {
    const steps = inp.steps ?? [];
    if (!steps.length) {
      return {
        verdict: "reject",
        summary: "The manuscript under review consists of a problem statement and a great deal of white space. I have read it twice, in case I missed something.",
        points: [{ step: null, severity: "fatal", comment: "There are no steps. A derivation, as I have repeatedly pointed out in my own work, needs at least one." }],
        grudgingPraise: "The author has, admittedly, chosen a problem worth solving.",
      };
    }
    const verdicts = steps.map((text, i) => {
      const earlier = inp.checks?.find((c) => c.step === i + 1);
      if (earlier) return { verdict: earlier.verdict, missing: [] as string[], solved: Boolean(earlier.solved) };
      const c = this.checkStep({ problem: inp.problem, step: text });
      return { verdict: c.verdict, missing: c.missing, solved: c.solved };
    });
    const points: { step: number | null; severity: RefSeverity; comment: string }[] = [];
    verdicts.forEach((v, i) => {
      const n = i + 1;
      if (v.verdict === "error") {
        points.push({ step: n, severity: "fatal", comment: `Step ${n} does not follow from what precedes it. The author states it with a confidence the argument does not share.` });
      } else if (v.verdict === "gap") {
        const what = v.missing[0] ? `a property of ${v.missing[0]}` : "a fact";
        points.push({ step: n, severity: "major", comment: `Step ${n} relies on ${what} that is used but never stated. I am not a mind reader, whatever my colleagues say.` });
      } else if (v.verdict === "unclear") {
        points.push({ step: n, severity: "minor", comment: `I cannot tell what step ${n} claims. Is it a statement, a question, or a cry for help? Please write it as a statement.` });
      } else {
        points.push({ step: n, severity: "pedantic", comment: `Step ${n} is correct, which I mention only because the reason is given in words where a displayed equation would have been more dignified.` });
      }
    });
    const has = (v: string) => verdicts.some((x) => x.verdict === v);
    const solved = verdicts.at(-1)?.solved === true && !has("error") && !has("gap");
    if (!solved && !has("error")) {
      points.push({ step: null, severity: "major", comment: "The derivation stops before the claim is established. The conclusion is, I assume, left as an exercise for the referee." });
    }
    const verdict = has("error") ? "reject" : !solved ? "major revisions" : has("unclear") ? "minor revisions" : "accept";
    const ok = verdicts.findIndex((v) => v.verdict === "ok");
    const summary =
      verdict === "reject"
        ? `The author submits ${steps.length === 1 ? "a single step" : `${steps.length} steps`}, at least one of which does not follow. I have seen bolder claims, but not recently.`
        : verdict === "accept"
          ? "Against my every instinct, I find the derivation complete and correct. I have checked it three times, out of spite."
          : `The author submits ${steps.length === 1 ? "a single step" : `${steps.length} steps`} toward the claim. The direction is promising; the arrival is not yet documented.`;
    const praise = ok >= 0 ? `Step ${ok + 1} is, I concede through gritted teeth, correct.` : "The author has shown the courage to submit, which is more than some of my co-referees.";
    return { verdict, summary, points: points.slice(0, 8), grudgingPraise: praise };
  }

  private name(desc: string, zh = false) {
    const d = desc.toLowerCase();
    const pick = (k: string) => {
      const t = kbText(k, zh);
      return { name: t.name, definition: t.definition, aliases: t.aliases, kind: kindOf(k) };
    };
    if (d.includes("bijective") || d.includes("same structure") || /双射|相同的结构|同样的结构/.test(d)) {
      return { candidates: [pick("isomorphism"), pick("homomorphism")] };
    }
    if (d.includes("preserv") || d.includes("保持")) return { candidates: [pick("homomorphism"), pick("isomorphism")] };
    if ((d.includes("identity") && d.includes("send")) || (d.includes("单位元") && /映|送/.test(d))) return { candidates: [pick("kernel")] };
    if (zh && HAN.test(desc)) {
      // Chinese has no spaces between words: the description's first phrase, cut short.
      const words = desc.trim().split(/[，。；：、,.;:!?！？\s]/)[0].slice(0, 8);
      return { candidates: [{ name: words || "未命名的想法", definition: desc, aliases: [], kind: kindFromName(desc) }] };
    }
    const words = desc.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
    return { candidates: [{ name: title(words || (zh ? "未命名的想法" : "Unnamed idea")), definition: desc, aliases: [], kind: kindFromName(desc) }] };
  }

  /**
   * Offline answer: drop the link whose prerequisite is the "bigger" idea (longer definition, i.e. the less basic
   * concept) — a stand-in for judgement that's deterministic for tests.
   */
  private resolveCycle(links: { from: { name: string; definition?: string }; to: { name: string; definition?: string } }[], zh = false) {
    let worst = 0;
    links.forEach((l, i) => {
      if ((l.to.definition ?? "").length > (links[worst].to.definition ?? "").length) worst = i;
    });
    const l = links[worst];
    if (zh) return { remove: [worst], reason: l ? `“${l.to.name}”建立在“${l.from.name}”之上，而不是反过来。` : "没有要删除的连线。" };
    return {
      remove: [worst],
      reason: l ? `"${l.to.name}" builds on "${l.from.name}", not the other way round.` : "No link to remove.",
    };
  }

  private relate(a: string, b: string, zh = false) {
    const ka = kbGet(a)?.key;
    const kb = kbGet(b)?.key;
    const depOf = (x?: string, y?: string) => {
      if (!x || !y) return undefined;
      const i = KB[x].deps.findIndex((d) => normalizeName(d.name) === normalizeName(y));
      return i < 0 ? undefined : kbText(x, zh).deps[i];
    };
    const ab = depOf(ka, kb);
    const ba = depOf(kb, ka);
    // One active label on the side that does something; the other side is "none" (no passive "is used by").
    const phrase = (d: Dep) =>
      zh
        ? d.role === "derives" ? "推导出" : d.role === "uses" ? "使用" : "假设"
        : d.role === "derives" ? "deriving an instance of" : d.role === "uses" ? "using" : "assuming";
    const inverse = (_d: Dep) => "none";
    const block = (x: string, y: string, d: Dep) => (zh ? `${x}是${y}的构件：${d.reason}` : `${x} is a building block of ${y}: ${d.reason}`);
    const unknown = (x: string, y: string) =>
      zh ? `离线模型不知道${x}对${y}有什么直接影响。` : `No direct influence of ${x} on ${y} is known to the offline model.`;
    return {
      aToB: ab
        ? { kind: phrase(ab), explanation: ab.reason }
        : ba
          ? { kind: inverse(ba), explanation: block(a, b, ba) }
          : { kind: "none", explanation: unknown(a, b) },
      bToA: ba
        ? { kind: phrase(ba), explanation: ba.reason }
        : ab
          ? { kind: inverse(ab), explanation: block(b, a, ab) }
          : { kind: "none", explanation: unknown(b, a) },
    };
  }

  /**
   * Suggested connections from the KB: what the concept's definition mentions, what it builds on, and what builds on
   * it. An existing concept keeps the graph's name; the demo's relation labels are active ("using"), one side "none".
   */
  private connect(inp: { node: { name: string; definition?: string }; existing?: { name: string; aliases?: string[] }[]; count?: number }, zh = false) {
    const self = kbGet(inp.node.name);
    const definition = inp.node.definition ?? (self ? kbText(self.key, zh).definition : "");
    const text = ` ${normalizeName(definition)} `;
    const graphName = (key: string) =>
      (inp.existing ?? []).find((e) => [e.name, ...(e.aliases ?? [])].some((n) => kbGet(n)?.key === key))?.name ?? kbText(key, zh).name;
    const out: { name: string; keyword: string; definition: string; kind: ConceptKind; aToB: { kind: string; explanation: string }; bToA: { kind: string; explanation: string } }[] = [];
    const add = (key: string, keyword: string, uses: boolean, why: string) => {
      if (key === self?.key || out.some((o) => normalizeName(o.name) === normalizeName(graphName(key)))) return;
      const none = { kind: "none", explanation: "" };
      const rel = { kind: zh ? "使用" : "using", explanation: why };
      out.push({ name: graphName(key), keyword, definition: kbText(key, zh).definition, kind: kindOf(key), aToB: uses ? rel : none, bToA: uses ? none : rel });
    };
    const zhHits = zhMentions(definition);
    for (const [k, v] of Object.entries(KB)) {
      const hit = [k, ...v.aliases].find((n) => text.includes(` ${normalizeName(n)} `)) ?? zhHits.find((h) => h.key === k)?.hit;
      if (hit) add(k, hit, true, zh ? `它的定义提到了“${hit}”。` : `Its definition mentions ${hit}.`);
    }
    for (const d of self ? kbText(self.key, zh).deps : []) {
      const key = kbGet(d.name)?.key;
      if (key) add(key, "", true, d.reason);
    }
    for (const [k, v] of Object.entries(KB)) {
      if (self && v.deps.some((d) => kbGet(d.name)?.key === self.key)) {
        add(k, "", false, zh ? `${graphName(k)}建立在${inp.node.name}之上。` : `${title(k)} builds on ${inp.node.name}.`);
      }
    }
    return { suggestions: out.slice(0, Number(inp.count ?? 8)) };
  }

  private deps(name: string, existing: { name: string; aliases?: string[] }[], zh = false) {
    const entry = kbGet(name);
    return {
      prerequisites: (entry ? kbText(entry.key, zh).deps : []).map((d) => {
        const key = kbGet(d.name)?.key;
        // By name or alias, or (in the other language) by the KB concept the existing one names.
        const match =
          existing.find(
            (e) => normalizeName(e.name) === normalizeName(d.name) || (e.aliases ?? []).some((a) => normalizeName(a) === normalizeName(d.name)),
          ) ?? existing.find((e) => [e.name, ...(e.aliases ?? [])].some((n) => key !== undefined && kbGet(n)?.key === key));
        return { ...d, matchesExisting: match?.name ?? null };
      }),
      kind: entry ? kindOf(entry.key) : kindFromName(name),
    };
  }

  private explain(node: { name: string; definition?: string }, prereqs: { name: string }[], level: string, zh = false) {
    if (zh) return this.explainZh(node, prereqs, level);
    const entry = kbGet(node.name);
    const extra = entry && EXPLAIN[entry.key];
    const style =
      level === "rigorous"
        ? "Formally: "
        : level === "example-driven"
          ? "Look at the examples first: "
          : "Intuitively: ";
    const builds = prereqs.length ? ` It builds on ${prereqs.map((p) => p.name).join(", ")}.` : "";
    if (entry) {
      return {
        summary: entry.definition,
        intuition: style + (extra?.intuition ?? `${title(entry.key)} is a basic notion of abstract algebra.`) + builds,
        keyPoints: extra?.keyPoints ?? [entry.definition, ...entry.deps.map((d) => d.reason)],
        examples: extra?.examples ?? [],
        pitfalls: extra?.pitfalls ?? [],
        furtherReading: [
          { title: "Any undergraduate abstract algebra textbook", hint: `The chapter that introduces “${title(entry.key)}”.` },
        ],
      };
    }
    const definition = node.definition?.trim();
    return {
      summary: definition || `${node.name} is not in the offline model's knowledge base.`,
      intuition: `${style}the offline demo can only restate what the graph says about ${node.name}.${builds}`,
      keyPoints: definition ? [definition] : [],
      examples: [],
      pitfalls: [],
      furtherReading: [{ title: `An introductory text on ${node.name}`, hint: "Look for its definition and a first example." }],
    };
  }

  /** The explanation in Chinese: the same material as `explain`, from the KB's Chinese entries. */
  private explainZh(node: { name: string; definition?: string }, prereqs: { name: string }[], level: string) {
    const entry = kbGet(node.name);
    const extra = entry && EXPLAIN_ZH[entry.key];
    const style = level === "rigorous" ? "严格地说：" : level === "example-driven" ? "先看例子：" : "直观地说：";
    const builds = prereqs.length ? `它建立在${prereqs.map((p) => p.name).join("、")}之上。` : "";
    if (entry) {
      const t = kbText(entry.key, true);
      return {
        summary: t.definition,
        intuition: style + (extra?.intuition ?? `${t.name}是抽象代数的一个基本概念。`) + builds,
        keyPoints: extra?.keyPoints ?? [t.definition, ...t.deps.map((d) => d.reason)],
        examples: extra?.examples ?? [],
        pitfalls: extra?.pitfalls ?? [],
        furtherReading: [{ title: "任何一本本科抽象代数教材", hint: `介绍“${t.name}”的那一章。` }],
      };
    }
    const definition = node.definition?.trim();
    return {
      summary: definition || `${node.name}不在离线模型的知识库中。`,
      intuition: `${style}离线演示只能复述图谱中关于${node.name}的内容。${builds}`,
      keyPoints: definition ? [definition] : [],
      examples: [],
      pitfalls: [],
      furtherReading: [{ title: `一本关于${node.name}的入门读物`, hint: "找找它的定义和第一个例子。" }],
    };
  }

  /**
   * A question built from the concept's definition (or KB entry), its KB dependency reasons and examples. Multiple
   * choice takes three other KB definitions as the wrong options; the right one's position depends on the name only.
   */
  private quiz(node: { name: string; definition?: string }, prereqs: { name: string }[], style: string, choice: boolean, zh = false) {
    const entry = kbGet(node.name);
    const kb = entry && kbText(entry.key, zh);
    const name = node.name;
    const definition = node.definition?.trim() || kb?.definition || (zh ? `${name}，如图谱中所述。` : `${name}, as described in your graph.`);
    const pre = prereqs[0];
    let question: string;
    let answer: string;
    let hints: string[];
    if (style === "connect" && pre) {
      const i = entry?.deps.findIndex((d) => normalizeName(d.name) === normalizeName(pre.name) || kbGet(d.name)?.key === kbGet(pre.name)?.key) ?? -1;
      const dep = i >= 0 ? kb!.deps[i] : undefined;
      if (zh) {
        question = `${name}是如何建立在${pre.name}之上的？`;
        answer = dep?.reason ?? `${name}依赖于${pre.name}：${definition}`;
        hints = [`回忆一下${pre.name}是什么。`, `在${name}的定义中找找${pre.name}。`];
      } else {
        question = `How does ${name} build on ${pre.name}?`;
        answer = dep?.reason ?? `${name} relies on ${pre.name}: ${definition}`;
        hints = [`Recall what ${pre.name} is.`, `Look for ${pre.name} in the definition of ${name}.`];
      }
    } else if (style === "apply") {
      const ex = entry && (zh ? EXPLAIN_ZH : EXPLAIN)[entry.key]?.examples[0];
      if (zh) {
        question = `举一个${name}的具体例子，并对照定义检验它。`;
        answer = ex ? `${ex.title}：${ex.body}` : `任何满足定义的东西：${definition}`;
        hints = [`从${name}的定义出发。`, ...(pre ? [`从${pre.name}的一个例子构造它。`] : [])];
      } else {
        question = `Give a concrete example of ${name} and check it against the definition.`;
        answer = ex ? `${ex.title}: ${ex.body}` : `Anything that satisfies the definition: ${definition}`;
        hints = [`Start from the definition of ${name}.`, ...(pre ? [`Build it from an example of ${pre.name}.`] : [])];
      }
    } else if (zh) {
      question = choice ? `下面哪一项是${name}的定义？` : `什么是${name}？`;
      answer = definition;
      // The definition's first phrase, cut short, without splitting a formula.
      let lead = definition.split(/[，。；：,;:]/)[0].slice(0, 10);
      if ((lead.match(/\$/g) ?? []).length % 2) lead = lead.slice(0, lead.lastIndexOf("$")).trim();
      hints = [pre ? `它建立在${pre.name}之上。` : "它是所在领域的基本概念之一。", `它以“${lead}”开头……`];
    } else {
      question = choice ? `Which statement defines ${name}?` : `What is ${name}?`;
      answer = definition;
      hints = [
        pre ? `It builds on ${pre.name}.` : "It is one of the basic notions of its field.",
        `It starts with “${definition.split(/\s+/).slice(0, 3).join(" ")}…”`,
      ];
    }
    if (!choice) return { question, answer, hints };
    const wrong = Object.keys(KB)
      .map((k) => [k, kbText(k, zh).definition] as const)
      .filter(([k, def]) => k !== entry?.key && normalizeName(def) !== normalizeName(answer))
      .map(([, def]) => def)
      .slice(0, 3);
    const correctIndex = name.length % 4;
    const choices = [...wrong];
    choices.splice(correctIndex, 0, answer);
    return { question, answer, hints, choices, correctIndex };
  }

  /**
   * Knowledge-base concepts named in the text (by name or alias, plural allowed; Chinese names anywhere in the text),
   * plus terms the text marks as new by quoting or bolding them. Relations and prerequisites come from the KB's
   * dependencies between concepts found in the text or already in the graph; a marked term is related to the first KB
   * concept of its sentence.
   */
  private extract(text: string, existing: { name: string; aliases?: string[] }[], zh = false) {
    // Chinese sentences end at 。！？ with no space after them.
    const sentences = text.split(/(?<=[.!?。！？])\s+|(?<=[。！？])|\n+/).map((s) => s.trim()).filter(Boolean);
    const sentenceOf = (i: number) => {
      let at = 0;
      for (const s of sentences) {
        at = text.indexOf(s, at);
        if (i >= at && i < at + s.length) return s;
        at += s.length;
      }
      return text.trim();
    };
    const quoteAt = (i: number) => {
      const s = sentenceOf(i);
      return s.length > 200 ? `${s.slice(0, 199)}…` : s;
    };
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found: { key: string; at: number; re: RegExp }[] = [];
    const zhHits = zhMentions(text);
    for (const [key, v] of Object.entries(KB)) {
      const re = new RegExp(`\\b(?:${[key, ...v.aliases].map(escape).join("|")})s?\\b`, "i");
      const at = text.search(re);
      const zhAt = zhHits.find((h) => h.key === key)?.at ?? -1;
      if (at >= 0 || zhAt >= 0) {
        const names = [KB_ZH[key].name, ...KB_ZH[key].aliases].map(escape).join("|");
        found.push({
          key,
          at: at >= 0 && (zhAt < 0 || at < zhAt) ? at : zhAt,
          re: zhAt >= 0 ? new RegExp(`${re.source}|${names}`, "i") : re,
        });
      }
    }
    found.sort((a, b) => a.at - b.at);
    // Where a concept is already in the graph, answer with the graph's exact name (as the prompt asks).
    const display = (key: string) => {
      const e = existing.find((x) => kbGet(x.name)?.key === key || (x.aliases ?? []).some((a) => kbGet(a)?.key === key));
      return e?.name ?? kbText(key, zh).name;
    };
    const concepts: { name: string; definition: string; aliases: string[]; quote: string; kind: ConceptKind | null }[] = found.map((f) => ({
      name: display(f.key),
      definition: kbText(f.key, zh).definition,
      aliases: kbText(f.key, zh).aliases,
      quote: quoteAt(f.at),
      kind: kindOf(f.key),
    }));
    const relations: { from: string; to: string; aToB: { kind: string; explanation: string }; bToA: { kind: string; explanation: string } }[] = [];
    for (const m of text.matchAll(/["“]([^"”\n]{2,60})["”]|\*\*([^*\n]{2,60})\*\*|「([^」\n]{1,60})」/g)) {
      const term = (m[1] ?? m[2] ?? m[3]).trim();
      if (kbGet(term) || concepts.some((c) => normalizeName(c.name) === normalizeName(term))) continue;
      const quote = quoteAt(m.index ?? 0);
      concepts.push({ name: title(term), definition: quote, aliases: [], quote, kind: kindFromName(term) });
      const sentence = sentenceOf(m.index ?? 0).replace(m[0], "");
      const near = found.find((f) => f.re.test(sentence));
      if (near) {
        const [t, n] = [title(term), display(near.key)];
        relations.push({
          from: t,
          to: n,
          aToB: zh
            ? { kind: "伴随出现", explanation: `文中在介绍${n}时一并引入了${t}。` }
            : { kind: "appearing alongside", explanation: `The text introduces ${t} alongside ${n}.` },
          bToA: zh
            ? { kind: "提供背景", explanation: `${n}是文中引入${t}的背景。` }
            : { kind: "setting the context for", explanation: `${n} is the setting in which the text introduces ${t}.` },
        });
      }
    }
    // KB dependencies between concepts in the text, or from one in the text to one already in the graph.
    const inGraph = Object.keys(KB).filter((k) => existing.some((e) => kbGet(e.name)?.key === k));
    const prerequisites: { dependent: string; prerequisite: string; role: Dep["role"]; reason: string }[] = [];
    for (const f of found) {
      for (const d of kbText(f.key, zh).deps) {
        const dk = kbGet(d.name)!.key;
        if (!found.some((x) => x.key === dk) && !inGraph.includes(dk)) continue;
        prerequisites.push({ dependent: display(f.key), prerequisite: display(dk), role: d.role, reason: d.reason });
      }
    }
    return { concepts, relations, prerequisites };
  }

  private derive(selected: { name: string }[], zh = false) {
    const names = selected.map((s) => s.name);
    if (names.some((n) => kbGet(n)?.key === "homomorphism")) {
      const kernel = kbText("kernel", zh);
      return {
        proposals: [
          {
            name: kernel.name,
            definition: kernel.definition,
            aliases: kernel.aliases,
            kind: "definition",
            links: [
              {
                to: names.find((n) => kbGet(n)?.key === "homomorphism")!,
                fromNew: zh
                  ? { kind: "衡量单射性", explanation: "核是单位元在同态下的原像。" }
                  : { kind: "measuring the injectivity of", explanation: "The kernel is the preimage of the identity under a homomorphism." },
                toNew: zh
                  ? { kind: "决定", explanation: "每个同态都有核，它是定义域的一个正规子群。" }
                  : { kind: "determining", explanation: "Every homomorphism has a kernel, a normal subgroup of its domain." },
              },
            ],
          },
        ],
      };
    }
    if (zh) {
      return {
        proposals: [
          {
            name: `${names.join("与")}的综合`,
            definition: `综合了${names.join("、")}的一个想法。`,
            aliases: [],
            kind: "other",
            links: names.map((n) => ({
              to: n,
              fromNew: { kind: "拓展", explanation: `拓展了${n}。` },
              toNew: { kind: "促成", explanation: `${n}提供了这个综合的一部分。` },
            })),
          },
        ],
      };
    }
    return {
      proposals: [
        {
          name: `Synthesis of ${names.join(" & ")}`,
          definition: `A combined idea drawing on ${names.join(", ")}.`,
          aliases: [],
          kind: "other",
          links: names.map((n) => ({
            to: n,
            fromNew: { kind: "building on", explanation: `Extends ${n}.` },
            toNew: { kind: "contributing to", explanation: `${n} supplies part of the synthesis.` },
          })),
        },
      ],
    };
  }
}
