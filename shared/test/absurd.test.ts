import { describe, expect, it } from "vitest";
import { AbsurdChainRequest, AbsurdChainResponse, normalizeName } from "../src/model";
import { cleanAbsurdChain, tasks } from "../src/ai/tasks";
import { MockProvider } from "../src/ai/mock";
import { absurdChainPrompt } from "../src/ai/prompts";
import { ProviderError, textOf, type ChatMessage, type Provider } from "../src/ai/provider";

const hop = (from: string, to: string, fact = `${from} relates to ${to}.`) => ({ from, to, kind: "leads to", fact, quip: "Wow." });
const req = { from: { name: "Fourier transform" }, to: { name: "Toast", aliases: ["toasted bread"] } };
const res = (...chain: ReturnType<typeof hop>[]) => AbsurdChainResponse.parse({ title: "T", chain, moral: "M" });

/** A provider that answers each call with the next canned reply (and keeps the last message of each call). */
function scripted(...replies: unknown[]): Provider & { calls: number; last: string[] } {
  const p = {
    id: "s", label: "Scripted", model: "m", configured: true, calls: 0, last: [] as string[],
    listModels: async () => [],
    complete: async (msgs: ChatMessage[]) => {
      p.last.push(textOf(msgs[msgs.length - 1].content));
      return JSON.stringify(replies[Math.min(p.calls++, replies.length - 1)]);
    },
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
      "Homomorphism", "Exponential function", "Fourier transform", "Heat equation", "Heat", "Toast",
    ]);
    // A length that fits the demo's main route takes it, without shortcuts.
    const long = await tasks.absurdChain(mock, { from: { name: "Homomorphism" }, to: { name: "Toast" }, hops: { min: 5, max: 7 } });
    expect(long.chain.map((h) => h.to)).toEqual(["Exponential function", "Fourier transform", "Heat equation", "Heat", "Maillard reaction", "Toast"]);
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

  it("offline, keeps to the length asked for, and says so when no chain of that length exists", async () => {
    const ends = { from: { name: "Homomorphism" }, to: { name: "Toast" } };
    for (const [min, max] of [[3, 4], [4, 5], [5, 7]]) {
      const out = await tasks.absurdChain(mock, { ...ends, hops: { min, max } });
      expect(out.chain.length).toBeGreaterThanOrEqual(min);
      expect(out.chain.length).toBeLessThanOrEqual(max);
      expect(out.plausibility).not.toMatch(/no chain of/);
      // Each concept at most once.
      const all = [out.chain[0].from, ...out.chain.map((h) => h.to)];
      expect(new Set(all.map(normalizeName)).size).toBe(all.length);
    }
    // A stop, and a medium length: the chain passes through it and still fits.
    const via = await tasks.absurdChain(mock, { ...ends, via: [{ name: "Heat equation" }], hops: { min: 4, max: 5 } });
    expect(via.chain.length).toBeGreaterThanOrEqual(4);
    expect(via.chain.length).toBeLessThanOrEqual(5);
    expect(via.chain.map((h) => h.to)).toContain("Heat equation");
    // Too short to be possible: the shortest there is, and a note.
    const short = await tasks.absurdChain(mock, { ...ends, hops: { min: 1, max: 2 } });
    expect(short.chain.map((h) => h.to)).toEqual(["Exponential function", "Heat equation", "Heat", "Toast"]);
    expect(short.plausibility).toContain("no chain of 1–2 links here, so this one has 4");
    // Too long to be possible: Jazz is only ever two links from Opera.
    const long = await tasks.absurdChain(mock, { from: { name: "Opera" }, to: { name: "Jazz" }, hops: { min: 5, max: 7 } });
    expect(long.chain).toHaveLength(2);
    expect(long.plausibility).toMatch(/this one has 2\.$/);
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

describe("absurd chain stops (via)", () => {
  const mock = new MockProvider();
  const viaReq = { ...req, via: [{ name: "Heat equation" }, { name: "Crumb", aliases: ["bread crumb"] }] };
  const names = (r: { chain: { from: string; to: string }[] }) => [r.chain[0].from, ...r.chain.map((h) => h.to)];

  it("defaults to no stops, rejects repeated or empty ones, and widens the hop range to fit them", () => {
    expect(AbsurdChainRequest.parse(req).via).toEqual([]);
    const four = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
    expect(AbsurdChainRequest.parse({ ...req, via: four, hops: { min: 3, max: 4 } }).hops).toEqual({ min: 5, max: 5 });
    expect(AbsurdChainRequest.parse({ ...req, via: [{ name: "A" }], hops: { min: 3, max: 5 } }).hops).toEqual({ min: 3, max: 5 });
    expect(() => AbsurdChainRequest.parse({ ...req, via: [{ name: "toast" }] })).toThrow(/differ/);
    expect(() => AbsurdChainRequest.parse({ ...req, via: [{ name: "A" }, { name: "a" }] })).toThrow(/differ/);
    expect(() => AbsurdChainRequest.parse({ ...req, via: [{ name: " " }] })).toThrow(/every stop/);
    expect(() => AbsurdChainRequest.parse({ ...req, via: Array.from({ length: 7 }, (_, i) => ({ name: `S${i}` })) })).toThrow();
  });

  it("keeps a chain through every stop in order, giving the stops their exact names", () => {
    const out = cleanAbsurdChain(
      res(hop("Fourier transform", "heat equations"), hop("heat equations", "Bread crumb"), hop("Bread crumb", "Toast")),
      viaReq,
    );
    expect(out.chain.map((h) => `${h.from}>${h.to}`)).toEqual(["Fourier transform>Heat equation", "Heat equation>Crumb", "Crumb>Toast"]);
    // Other concepts may sit between the stops.
    const longer = cleanAbsurdChain(
      res(hop("Fourier transform", "Heat equation"), hop("Heat equation", "Oven"), hop("Oven", "Crumb"), hop("Crumb", "Toast")),
      viaReq,
    );
    expect(longer.chain).toHaveLength(4);
  });

  it("rejects a chain that misses a stop or takes them out of order", () => {
    expect(() => cleanAbsurdChain(res(hop("Fourier transform", "Heat equation"), hop("Heat equation", "Toast")), viaReq)).toThrow(
      /never passes through the stop "Crumb".*in this order: "Heat equation", "Crumb"/,
    );
    expect(() =>
      cleanAbsurdChain(res(hop("Fourier transform", "Crumb"), hop("Crumb", "Heat equation"), hop("Heat equation", "Toast")), viaReq),
    ).toThrow(/the stop "Crumb" comes before "Heat equation"/);
    // A stop cut out with a loop no longer counts.
    const loop = res(hop("Fourier transform", "Heat equation"), hop("Heat equation", "Crumb"), hop("Crumb", "Heat equation"), hop("Heat equation", "Toast"));
    expect(() => cleanAbsurdChain(loop, viaReq)).toThrow(ProviderError);
  });

  it("asks the model again with a note naming the missed stop, then gives up", async () => {
    const bad = { title: "T", chain: [hop("Fourier transform", "Toast")] };
    const good = { title: "T", chain: [hop("Fourier transform", "Heat equation"), hop("Heat equation", "Crumb"), hop("Crumb", "Toast")] };
    const p = scripted(bad, good);
    expect((await tasks.absurdChain(p, viaReq)).chain.map((h) => h.to)).toEqual(["Heat equation", "Crumb", "Toast"]);
    expect(p.last[1]).toMatch(/never passes through the stop "Heat equation"/);
    await expect(tasks.absurdChain(scripted(bad), viaReq)).rejects.toThrow(/malformed output.*stop/);
  });

  it("tells the model the stops, in order, with the user's descriptions, and never to avoid them", () => {
    const oven = { name: "Grandma's oven", definition: "The oven in my grandmother's kitchen." };
    const [system, user] = absurdChainPrompt(AbsurdChainRequest.parse({ ...req, via: [{ name: "Heat" }, oven], avoid: ["Heat", "Egg"] }));
    const text = textOf(system.content);
    expect(text).toContain('these 2 stops, in this order: "Heat" → "Grandma\'s oven"');
    expect(text).toContain('do not use "Egg" as');
    expect(textOf(user.content)).toContain("Stops, in order:\n- Heat\n- Grandma's oven: The oven in my grandmother's kitchen.");
    expect(textOf(absurdChainPrompt(AbsurdChainRequest.parse(req))[0].content)).not.toContain("Stops");
  });

  it("offline, passes through known and custom stops in order", async () => {
    const out = await tasks.absurdChain(mock, { from: { name: "Homomorphism" }, to: { name: "Toast" }, via: [{ name: "Group" }, { name: "Grandma's oven" }] });
    const all = names(out);
    expect(all.indexOf("Group")).toBeGreaterThan(0);
    expect(all.indexOf("Grandma's oven")).toBeGreaterThan(all.indexOf("Group"));
    expect(all.at(-1)).toBe("Toast");
    expect(new Set(all.map(normalizeName)).size).toBe(all.length);
    // Two unknown stops in a row: the second can't also go through "Written language", so it gets a generic link.
    const two = await tasks.absurdChain(mock, { from: { name: "Opera" }, to: { name: "Toast" }, via: [{ name: "Jazz" }, { name: "Blues" }] });
    expect(names(two).slice(0, 4)).toEqual(["Opera", "Written language", "Jazz", "Blues"]);
    expect(two.chain[2].fact).toContain("same sentence");
    // With no stops it is the chain it always was.
    const plain = await tasks.absurdChain(mock, { from: { name: "Chicken" }, to: { name: "Toast" }, via: [] });
    expect(plain.chain.map((h) => h.to)).toEqual(["Egg", "Heat", "Maillard reaction", "Toast"]);
  });
});
