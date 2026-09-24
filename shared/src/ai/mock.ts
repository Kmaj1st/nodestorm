import { normalizeName } from "../model";
import type { ChatMessage, ModelInfo, Provider } from "./provider";

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

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "mock-kb", label: "Built-in algebra knowledge base" }];
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const task = messages[0]?.content.match(/\[task:(\w+)\]/)?.[1];
    const inp = parseInput(messages);
    switch (task) {
      case "name":
        return JSON.stringify(this.name(String(inp.description ?? "")));
      case "relate":
        return JSON.stringify(this.relate(inp.a.name, inp.b.name));
      case "deps":
        return JSON.stringify(this.deps(inp.node.name, inp.existing ?? []));
      case "derive":
        return JSON.stringify(this.derive(inp.selected ?? []));
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
