import { describe, expect, it } from "vitest";
import { AbsurdChainRequest, AbsurdChainResponse } from "../src/model";
import { cleanAbsurdChain, tasks } from "../src/ai/tasks";
import { MockProvider } from "../src/ai/mock";
import { absurdChainPrompt } from "../src/ai/prompts";
import { ProviderError, textOf, type Provider } from "../src/ai/provider";

const hop = (from: string, to: string, fact = `${from} relates to ${to}.`) => ({ from, to, kind: "leads to", fact, quip: "Wow." });
const req = { from: { name: "Fourier transform" }, to: { name: "Toast", aliases: ["toasted bread"] } };
const res = (...chain: ReturnType<typeof hop>[]) => AbsurdChainResponse.parse({ title: "T", chain, moral: "M" });

/** A provider that answers each call with the next canned reply. */
function scripted(...replies: unknown[]): Provider & { calls: number } {
  const p = {
    id: "s", label: "Scripted", model: "m", configured: true, calls: 0,
    listModels: async () => [],
    complete: async () => JSON.stringify(replies[Math.min(p.calls++, replies.length - 1)]),
  };
  return p;
}

describe("absurdChain schemas", () => {
  it("fills defaults and rejects bad requests", () => {
    const r = AbsurdChainRequest.parse({ from: { name: "A" }, to: { name: "B" } });
    expect(r).toMatchObject({ style: "deadpan", hops: { min: 3, max: 5 }, context: [], avoid: [] });
    expect(() => AbsurdChainRequest.parse({ from: { name: "Toast" }, to: { name: "toasts" } })).toThrow(/different/);
    expect(() => AbsurdChainRequest.parse({ from: { name: "A" }, to: { name: "B" }, style: "rude" })).toThrow();
    expect(() => AbsurdChainRequest.parse({ from: { name: "A" }, to: { name: "B" }, hops: { min: 5, max: 3 } })).toThrow();
    expect(() => AbsurdChainRequest.parse({ from: { name: "A" }, to: { name: "B" }, hops: { min: 1, max: 9 } })).toThrow();
    expect(() => AbsurdChainRequest.parse({ from: { name: " " }, to: { name: "B" } })).toThrow(/both ends/);
  });

  it("needs a fact on every hop; quip, kind, title and moral may be missing", () => {
    expect(() => AbsurdChainResponse.parse({ chain: [{ from: "A", to: "B", fact: "" }] })).toThrow();
    expect(() => AbsurdChainResponse.parse({ chain: [] })).toThrow();
    expect(AbsurdChainResponse.parse({ chain: [{ from: "A", to: "B", fact: "F" }] })).toEqual({
      title: "", chain: [{ from: "A", to: "B", fact: "F", kind: "", quip: "" }], moral: "", plausibility: "",
    });
  });
});

describe("cleanAbsurdChain", () => {
  it("keeps a good chain and gives its ends the requested names", () => {
    const out = cleanAbsurdChain(res(hop("fourier transforms", "Heat equation"), hop("heat equation", "Heat"), hop("Heat", "Toasted bread")), req);
    expect(out.chain.map((h) => [h.from, h.to])).toEqual([
      ["Fourier transform", "Heat equation"], ["Heat equation", "Heat"], ["Heat", "Toast"],
    ]);
    expect(out.title).toBe("T");
  });

  it("cuts the chain where it first reaches the goal, and cuts out loops", () => {
    const early = cleanAbsurdChain(res(hop("Fourier transform", "Heat"), hop("Heat", "Toast"), hop("Toast", "Butter")), req);
    expect(early.chain.map((h) => h.to)).toEqual(["Heat", "Toast"]);
    const loop = cleanAbsurdChain(
      res(hop("Fourier transform", "Heat"), hop("Heat", "Fire"), hop("Fire", "Heat", "loop"), hop("Heat", "Toast", "last")),
      req,
    );
    expect(loop.chain.map((h) => `${h.from}>${h.to}`)).toEqual(["Fourier transform>Heat", "Heat>Toast"]);
    expect(loop.chain[1].fact).toBe("last");
    const home = cleanAbsurdChain(res(hop("Fourier transform", "X"), hop("X", "Fourier transform"), hop("Fourier transform", "Toast")), req);
    expect(home.chain).toHaveLength(1);
  });

  it("names the chain after its ends when the title is missing", () => {
    const out = cleanAbsurdChain(AbsurdChainResponse.parse({ chain: [hop("Fourier transform", "Toast")] }), req);
    expect(out.title).toBe("Fourier transform → Toast");
  });

  it("rejects a gap, a wrong start, a chain that never arrives, or one far too long", () => {
    expect(() => cleanAbsurdChain(res(hop("Fourier transform", "Heat"), hop("Fire", "Toast")), req)).toThrow(/ends at "Heat" but link 2 starts at "Fire"/);
    expect(() => cleanAbsurdChain(res(hop("Laplace transform", "Toast")), req)).toThrow(ProviderError);
    expect(() => cleanAbsurdChain(res(hop("Fourier transform", "Heat")), req)).toThrow(/never reaches "Toast"/);
    const names = ["Fourier transform", ...Array.from({ length: 11 }, (_, i) => `X${i}`), "Toast"];
    const long = names.slice(1).map((n, i) => hop(names[i], n));
    expect(() => cleanAbsurdChain(res(...long), req)).toThrow(/12 links/);
  });
});

describe("absurdChain task", () => {
  const mock = new MockProvider();

  it("tells the model the facts are real and the jokes are in the telling", () => {
    const [system, user] = absurdChainPrompt(AbsurdChainRequest.parse({ ...req, style: "bureaucratic", avoid: ["Heat"] }));
    const text = textOf(system.content);
    expect(text).toContain("[task:absurdChain]");
    expect(text).toMatch(/THE FACTS ARE REAL/);
    expect(text).toMatch(/no insults/);
    expect(text).toMatch(/Bureaucratic/);
    expect(text).toContain('do not use "Heat"');
    expect(text).toContain("3-5 hops");
    expect(textOf(user.content)).toContain("From:\n- Fourier transform");
  });

  it("links Homomorphism to Toast offline through true facts", async () => {
    const out = await tasks.absurdChain(mock, { from: { name: "Homomorphism" }, to: { name: "Toast" }, style: "epic" });
    expect([out.chain[0].from, ...out.chain.map((h) => h.to)]).toEqual([
      "Homomorphism", "Exponential function", "Fourier transform", "Heat equation", "Heat", "Maillard reaction", "Toast",
    ]);
    expect(out.chain.every((h) => h.fact && h.quip && h.kind)).toBe(true);
    expect(out.title).toBe("The Saga of Homomorphism and Toast");
    expect(out.moral).toMatch(/prophecy/);
    // Deterministic: the same request gives the same chain.
    expect(await tasks.absurdChain(mock, { from: { name: "Homomorphism" }, to: { name: "Toast" }, style: "epic" })).toEqual(out);
  });

  it("offline, takes another route when asked to avoid one, and joins unknown ends through written language", async () => {
    const again = await tasks.absurdChain(mock, { from: { name: "Chicken" }, to: { name: "Toast" }, avoid: ["Egg"] });
    expect(again.chain.map((h) => h.to)).toEqual(["Egg", "Heat", "Maillard reaction", "Toast"]); // no way round Egg
    const odd = await tasks.absurdChain(mock, { from: { name: "Opera" }, to: { name: "Toast" }, style: "conspiracy" });
    expect(odd.chain.map((h) => h.to)).toEqual(["Written language", "Paper", "Heat", "Maillard reaction", "Toast"]);
    expect(odd.chain[0].fact).toContain("“Opera”");
    const both = await tasks.absurdChain(mock, { from: { name: "Opera" }, to: { name: "Jazz" } });
    expect(both.chain.map((h) => h.to)).toEqual(["Written language", "Jazz"]);
  });

  it("asks again when the chain is broken, and gives up with a ProviderError", async () => {
    const good = { title: "T", chain: [hop("Fourier transform", "Toast")], moral: "", plausibility: "" };
    const bad = { ...good, chain: [hop("Fourier transform", "Heat")] };
    const fixed = scripted(bad, good);
    expect((await tasks.absurdChain(fixed, req)).chain).toHaveLength(1);
    expect(fixed.calls).toBe(2);
    const hopeless = scripted(bad);
    await expect(tasks.absurdChain(hopeless, req)).rejects.toThrow(/malformed output.*never reaches/);
    await expect(tasks.absurdChain(hopeless, req)).rejects.toBeInstanceOf(ProviderError);
  });
});
