import { normalizeName } from "../model";
import { withDeadline, type ChatMessage, type CompleteOptions, type ModelInfo, type Provider, type RequestOptions } from "./provider";

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
    definition: "A subgroup N of G with gNg⁻¹ = N for every g in G.",
    aliases: [],
    deps: [{ name: "Subgroup", role: "uses", reason: "A normal subgroup is a subgroup invariant under conjugation." }],
  },
  "quotient group": {
    definition: "The group G/N of cosets of a normal subgroup N, with (aN)(bN) = abN.",
    aliases: ["factor group"],
    deps: [
      { name: "Group", role: "uses", reason: "G/N is built from a group G." },
      { name: "Normal subgroup", role: "uses", reason: "Cosets only multiply consistently when N is normal." },
    ],
  },
  homomorphism: {
    definition: "A map between algebraic structures that preserves the operations, e.g. φ(ab) = φ(a)φ(b) for groups.",
    aliases: ["group homomorphism"],
    deps: [],
  },
  isomorphism: {
    definition: "A bijective homomorphism; its inverse is also a homomorphism.",
    aliases: ["group isomorphism"],
    deps: [{ name: "Homomorphism", role: "uses", reason: "An isomorphism is defined as a bijective homomorphism." }],
  },
  kernel: {
    definition: "The set of elements a homomorphism sends to the identity.",
    aliases: ["ker"],
    deps: [{ name: "Homomorphism", role: "uses", reason: "The kernel is defined for a homomorphism." }],
  },
  "first isomorphism theorem": {
    definition: "For a homomorphism φ: G → H, G / ker φ is isomorphic to im φ.",
    aliases: ["fundamental homomorphism theorem"],
    deps: [
      { name: "Homomorphism", role: "uses", reason: "The theorem starts from a homomorphism φ: G → H." },
      { name: "Isomorphism", role: "derives", reason: "Its conclusion is an isomorphism G/ker φ ≅ im φ." },
    ],
  },
};

/** Names with several meanings, for exercising the "what do you mean?" flow offline. */
const AMBIGUOUS: Record<string, { name: string; domain: string; definition: string }[]> = {
  expectation: [
    { name: "Expectation (probability)", domain: "probability theory", definition: "The expected value E[X] of a random variable: its probability-weighted average." },
    { name: "Expectation (psychology)", domain: "psychology", definition: "A belief about what will happen in the future, which shapes perception and behaviour." },
    { name: "Expectation value (quantum mechanics)", domain: "physics", definition: "The average outcome ⟨A⟩ of measuring an observable A on a quantum state." },
    { name: "Expectation (economics)", domain: "economics", definition: "Agents' forecasts of future economic variables, as in rational expectations." },
    { name: "Expectation (sociology)", domain: "sociology", definition: "A social norm about how a person in a given role ought to behave." },
  ],
};

/** Richer "explain more" material for a few KB concepts; the others get one built from their KB entry. */
const EXPLAIN: Record<string, { intuition: string; keyPoints: string[]; examples: { title: string; body: string }[]; pitfalls: string[] }> = {
  homomorphism: {
    intuition: "a homomorphism translates one structure into another without breaking its arithmetic: combine then map, or map then combine — same result.",
    keyPoints: [
      "φ(ab) = φ(a)φ(b) for all a, b.",
      "It sends the identity to the identity and inverses to inverses.",
      "Its kernel is a normal subgroup and its image is a subgroup.",
    ],
    examples: [
      { title: "Exponential map", body: "x ↦ eˣ from (ℝ, +) to (ℝ₊, ×): e^(x+y) = eˣ·eʸ." },
      { title: "Reduction mod n", body: "ℤ → ℤ/nℤ sends each integer to its remainder class; sums map to sums." },
      { title: "Non-example", body: "x ↦ x + 1 on (ℤ, +) does not send 0 to 0, so it is not a homomorphism." },
    ],
    pitfalls: [
      "A homomorphism need not be injective or surjective — that is what isomorphisms add.",
      "Check the operations of both structures: (ℝ, +) → (ℝ, ×) is a different setting from (ℝ, +) → (ℝ, +).",
    ],
  },
  isomorphism: {
    intuition: "isomorphic structures are the same structure with the elements renamed.",
    keyPoints: ["An isomorphism is a bijective homomorphism.", "Its inverse is automatically a homomorphism.", "Isomorphic groups share every group-theoretic property."],
    examples: [{ title: "Logarithm", body: "log: (ℝ₊, ×) → (ℝ, +) is an isomorphism, inverse to exp." }],
    pitfalls: ["Having the same number of elements does not make two groups isomorphic (ℤ/4ℤ vs ℤ/2ℤ × ℤ/2ℤ)."],
  },
};

function kbGet(name: string) {
  const key = normalizeName(name);
  const entry = Object.entries(KB).find(
    ([k, v]) => normalizeName(k) === key || v.aliases.some((a) => normalizeName(a) === key),
  );
  return entry && { key: entry[0], ...entry[1] };
}

function title(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseInput(messages: ChatMessage[]): any {
  const user = [...messages].reverse().find((m) => m.role === "user" && m.content.includes("INPUT:"));
  const raw = user?.content.split("INPUT:\n").pop() ?? "{}";
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
      this.answer(messages),
    );
  }

  private answer(messages: ChatMessage[]): string {
    const task = messages[0]?.content.match(/\[task:(\w+)\]/)?.[1];
    const inp = parseInput(messages);
    switch (task) {
      case "name":
        return JSON.stringify(this.name(String(inp.description ?? "")));
      case "clarify":
        return JSON.stringify(this.clarify(String(inp.name ?? ""), Number(inp.count ?? 3)));
      case "relate":
        return JSON.stringify(this.relate(inp.a.name, inp.b.name));
      case "deps":
        return JSON.stringify(this.deps(inp.node.name, inp.existing ?? []));
      case "derive":
        return JSON.stringify(this.derive(inp.selected ?? []));
      case "explain":
        return JSON.stringify(this.explain(inp.node, inp.prerequisites ?? [], String(inp.level ?? "intuitive")));
      case "extract":
        return JSON.stringify(this.extract(String(inp.text ?? ""), inp.existing ?? []));
      case "quiz":
        return JSON.stringify(this.quiz(inp.node, inp.prerequisites ?? [], String(inp.style ?? "recall"), Boolean(inp.multipleChoice)));
      default:
        return "{}";
    }
  }

  private name(desc: string) {
    const d = desc.toLowerCase();
    const pick = (k: string) => ({ name: title(k), definition: KB[k].definition, aliases: KB[k].aliases });
    if (d.includes("bijective") || d.includes("same structure")) return { candidates: [pick("isomorphism"), pick("homomorphism")] };
    if (d.includes("preserv")) return { candidates: [pick("homomorphism"), pick("isomorphism")] };
    if (d.includes("identity") && d.includes("send")) return { candidates: [pick("kernel")] };
    const words = desc.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
    return { candidates: [{ name: title(words || "Unnamed idea"), definition: desc, aliases: [] }] };
  }

  private clarify(name: string, count: number) {
    const senses = AMBIGUOUS[normalizeName(name)];
    if (senses) return { ambiguous: true, senses: senses.slice(0, count) };
    const entry = kbGet(name);
    return {
      ambiguous: false,
      senses: [{ name, domain: entry ? "algebra" : "general", definition: entry?.definition ?? "" }],
    };
  }

  private relate(a: string, b: string) {
    const ka = kbGet(a)?.key;
    const kb = kbGet(b)?.key;
    const depOf = (x?: string, y?: string) => (x && y ? KB[x].deps.find((d) => normalizeName(d.name) === normalizeName(y)) : undefined);
    const ab = depOf(ka, kb);
    const ba = depOf(kb, ka);
    const phrase = (d: Dep) => (d.role === "derives" ? "derives an instance of" : d.role === "uses" ? "uses definition of" : "assumes");
    const inverse = (d: Dep) => (d.role === "derives" ? "is produced by" : d.role === "uses" ? "is used by" : "is assumed by");
    return {
      aToB: ab
        ? { kind: phrase(ab), explanation: ab.reason }
        : ba
          ? { kind: inverse(ba), explanation: `${a} is a building block of ${b}: ${ba.reason}` }
          : { kind: "none", explanation: `No direct influence of ${a} on ${b} is known to the offline model.` },
      bToA: ba
        ? { kind: phrase(ba), explanation: ba.reason }
        : ab
          ? { kind: inverse(ab), explanation: `${b} is a building block of ${a}: ${ab.reason}` }
          : { kind: "none", explanation: `No direct influence of ${b} on ${a} is known to the offline model.` },
    };
  }

  private deps(name: string, existing: { name: string; aliases?: string[] }[]) {
    const entry = kbGet(name);
    return {
      prerequisites: (entry?.deps ?? []).map((d) => {
        const match = existing.find(
          (e) => normalizeName(e.name) === normalizeName(d.name) || (e.aliases ?? []).some((a) => normalizeName(a) === normalizeName(d.name)),
        );
        return { ...d, matchesExisting: match?.name ?? null };
      }),
    };
  }

  private explain(node: { name: string; definition?: string }, prereqs: { name: string }[], level: string) {
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

  /**
   * A question built from the concept's definition (or KB entry), its KB dependency reasons and examples. Multiple
   * choice takes three other KB definitions as the wrong options; the right one's position depends on the name only.
   */
  private quiz(node: { name: string; definition?: string }, prereqs: { name: string }[], style: string, choice: boolean) {
    const entry = kbGet(node.name);
    const name = node.name;
    const definition = node.definition?.trim() || entry?.definition || `${name}, as described in your graph.`;
    const pre = prereqs[0];
    let question: string;
    let answer: string;
    let hints: string[];
    if (style === "connect" && pre) {
      const dep = entry?.deps.find((d) => normalizeName(d.name) === normalizeName(pre.name));
      question = `How does ${name} build on ${pre.name}?`;
      answer = dep?.reason ?? `${name} relies on ${pre.name}: ${definition}`;
      hints = [`Recall what ${pre.name} is.`, `Look for ${pre.name} in the definition of ${name}.`];
    } else if (style === "apply") {
      const ex = entry && EXPLAIN[entry.key]?.examples[0];
      question = `Give a concrete example of ${name} and check it against the definition.`;
      answer = ex ? `${ex.title}: ${ex.body}` : `Anything that satisfies the definition: ${definition}`;
      hints = [`Start from the definition of ${name}.`, ...(pre ? [`Build it from an example of ${pre.name}.`] : [])];
    } else {
      question = choice ? `Which statement defines ${name}?` : `What is ${name}?`;
      answer = definition;
      hints = [
        pre ? `It builds on ${pre.name}.` : "It is one of the basic notions of its field.",
        `It starts with “${definition.split(/\s+/).slice(0, 3).join(" ")}…”`,
      ];
    }
    if (!choice) return { question, answer, hints };
    const wrong = Object.entries(KB)
      .filter(([k, v]) => k !== entry?.key && normalizeName(v.definition) !== normalizeName(answer))
      .map(([, v]) => v.definition)
      .slice(0, 3);
    const correctIndex = name.length % 4;
    const choices = [...wrong];
    choices.splice(correctIndex, 0, answer);
    return { question, answer, hints, choices, correctIndex };
  }

  /**
   * Knowledge-base concepts named in the text (by name or alias, plural allowed), plus terms the text marks as new
   * by quoting or bolding them. Relations and prerequisites come from the KB's dependencies between concepts found in
   * the text or already in the graph; a marked term is related to the first KB concept of its sentence.
   */
  private extract(text: string, existing: { name: string; aliases?: string[] }[]) {
    const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
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
    for (const [key, v] of Object.entries(KB)) {
      const re = new RegExp(`\\b(?:${[key, ...v.aliases].map(escape).join("|")})s?\\b`, "i");
      const at = text.search(re);
      if (at >= 0) found.push({ key, at, re });
    }
    found.sort((a, b) => a.at - b.at);
    // Where a concept is already in the graph, answer with the graph's exact name (as the prompt asks).
    const display = (key: string) => {
      const e = existing.find((x) => kbGet(x.name)?.key === key || (x.aliases ?? []).some((a) => kbGet(a)?.key === key));
      return e?.name ?? title(key);
    };
    const concepts: { name: string; definition: string; aliases: string[]; quote: string }[] = found.map((f) => ({
      name: display(f.key),
      definition: KB[f.key].definition,
      aliases: KB[f.key].aliases,
      quote: quoteAt(f.at),
    }));
    const relations: { from: string; to: string; aToB: { kind: string; explanation: string }; bToA: { kind: string; explanation: string } }[] = [];
    for (const m of text.matchAll(/["“]([^"”\n]{2,60})["”]|\*\*([^*\n]{2,60})\*\*/g)) {
      const term = (m[1] ?? m[2]).trim();
      if (kbGet(term) || concepts.some((c) => normalizeName(c.name) === normalizeName(term))) continue;
      const quote = quoteAt(m.index ?? 0);
      concepts.push({ name: title(term), definition: quote, aliases: [], quote });
      const sentence = sentenceOf(m.index ?? 0).replace(m[0], "");
      const near = found.find((f) => f.re.test(sentence));
      if (near) {
        relations.push({
          from: title(term),
          to: display(near.key),
          aToB: { kind: "is introduced with", explanation: `The text introduces ${title(term)} alongside ${display(near.key)}.` },
          bToA: { kind: "is context for", explanation: `${display(near.key)} is the setting in which the text introduces ${title(term)}.` },
        });
      }
    }
    // KB dependencies between concepts in the text, or from one in the text to one already in the graph.
    const inGraph = Object.keys(KB).filter((k) => existing.some((e) => kbGet(e.name)?.key === k));
    const prerequisites: { dependent: string; prerequisite: string; role: Dep["role"]; reason: string }[] = [];
    for (const f of found) {
      for (const d of KB[f.key].deps) {
        const dk = kbGet(d.name)!.key;
        if (!found.some((x) => x.key === dk) && !inGraph.includes(dk)) continue;
        prerequisites.push({ dependent: display(f.key), prerequisite: display(dk), role: d.role, reason: d.reason });
      }
    }
    return { concepts, relations, prerequisites };
  }

  private derive(selected: { name: string }[]) {
    const names = selected.map((s) => s.name);
    if (names.some((n) => kbGet(n)?.key === "homomorphism")) {
      return {
        proposals: [
          {
            name: "Kernel",
            definition: KB.kernel.definition,
            aliases: KB.kernel.aliases,
            links: [
              {
                to: names.find((n) => kbGet(n)?.key === "homomorphism")!,
                fromNew: { kind: "is defined by", explanation: "The kernel is the preimage of the identity under a homomorphism." },
                toNew: { kind: "determines", explanation: "Every homomorphism has a kernel, a normal subgroup of its domain." },
              },
            ],
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
          links: names.map((n) => ({
            to: n,
            fromNew: { kind: "builds on", explanation: `Extends ${n}.` },
            toNew: { kind: "contributes to", explanation: `${n} supplies part of the synthesis.` },
          })),
        },
      ],
    };
  }
}
