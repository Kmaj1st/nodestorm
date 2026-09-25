import { MockProvider, tasks, type AbsurdChainResponse } from "@nodestorm/shared";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BEST_KEY,
  bestFor,
  clue,
  editDistance,
  guess,
  hiddenNames,
  isOver,
  linkView,
  mask,
  matchesName,
  maxScore,
  newGame,
  pairKey,
  POINTS,
  recordBest,
  reveal,
  revealAll,
  score,
  stopsInOrder,
  tally,
  typoAllowance,
  type ChainGame,
} from "../src/lib/chainGame";

// The offline demo's deterministic chain: Homomorphism → Exponential function → Fourier transform → Heat equation →
// Heat → Maillard reaction → Toast (six links, five hidden concepts).
let chain: AbsurdChainResponse;
beforeAll(async () => {
  chain = await tasks.absurdChain(new MockProvider(), { from: { name: "Homomorphism" }, to: { name: "Toast" }, style: "deadpan" });
});

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe("guess matching", () => {
  it("measures edits, counting a swap of neighbours as one", () => {
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("heat", "heat")).toBe(0);
    expect(editDistance("heat", "heap")).toBe(1);
    expect(editDistance("fourier", "fuorier")).toBe(1);
    expect(editDistance("maillard", "maillrd")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("群同态", "群同构")).toBe(1);
  });

  it("forgives more typos in longer names, none in very short ones", () => {
    expect([2, 4, 5, 8, 9, 20].map(typoAllowance)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("ignores case, accents, punctuation, a plural and a leading article", () => {
    expect(matchesName("heat equation", "Heat equation")).toBe(true);
    expect(matchesName("  The Heat-Equations ", "Heat equation")).toBe(true);
    expect(matchesName("MAILLARD REACTIONS", "Maillard reaction")).toBe(true);
    expect(matchesName("poincare", "Poincaré")).toBe(true);
  });

  it("forgives small typos but not a different word", () => {
    expect(matchesName("Fourier transfrom", "Fourier transform")).toBe(true);
    expect(matchesName("Maillard raction", "Maillard reaction")).toBe(true);
    expect(matchesName("Mallard reacton", "Maillard reaction")).toBe(true); // two typos in 17 letters
    expect(matchesName("Toats", "Toast")).toBe(true); // one in five
    expect(matchesName("Meat", "Heat")).toBe(false); // short names must be exact
    expect(matchesName("Hat", "Heat")).toBe(false);
    expect(matchesName("Fourier series", "Fourier transform")).toBe(false);
    expect(matchesName("Heat", "Heat equation")).toBe(false);
  });

  it("accepts aliases and refuses an empty guess", () => {
    expect(matchesName("exp", "Exponential function", ["exp", "e^x"])).toBe(true);
    expect(matchesName("E^X", "Exponential function", ["e^x"])).toBe(true);
    expect(matchesName("", "Heat")).toBe(false);
    expect(matchesName("?!", "Heat")).toBe(false);
  });
});

describe("masking hidden names", () => {
  it("blanks hidden names as whole words, with plurals, whatever the case", () => {
    expect(mask("Then Heat. Heats, heat and heatwave.", ["Heat"])).toBe("Then [?]. [?], [?] and heatwave.");
    expect(mask("Toast is browned.", ["Heat"])).toBe("Toast is browned.");
  });

  it("keeps a shown longer name that contains a hidden one", () => {
    expect(mask("Heat equation leads to Heat.", ["Heat"], ["Heat equation"])).toBe("Heat equation leads to [?].");
    expect(mask("Heat equation leads to Heat.", ["Heat", "Heat equation"])).toBe("[?] leads to [?].");
  });

  it("uses the given blank and escapes names that look like patterns", () => {
    expect(mask("C++ (the language) and C", ["C++"], [], "___")).toBe("___ (the language) and C");
  });
});

describe("a game over the offline demo's chain", () => {
  it("hides the concepts between the ends and shows only the links' relations", () => {
    const g = newGame(chain);
    expect(g.stops.map((s) => s.name)).toEqual(["Exponential function", "Fourier transform", "Heat equation", "Heat", "Maillard reaction"]);
    expect(g.stops.every((s) => s.status === "hidden")).toBe(true);
    expect(maxScore(g)).toBe(15);
    expect(score(g)).toBe(0);
    expect(isOver(g)).toBe(false);
    expect(stopsInOrder(g).map((s) => s.shown)).toEqual([true, false, false, false, false, false, true]);
    const first = linkView(g, 0);
    expect(first).toEqual({ fromShown: true, toShown: false, fact: null, quip: null, clue: null });
    expect(hiddenNames(g)).toHaveLength(5);
  });

  it("takes aliases from the graph", () => {
    const g = newGame(chain, (n) => (n === "Exponential function" ? ["exp"] : []));
    expect(guess(g, "EXP").result).toEqual({ kind: "correct", stop: 0, name: "Exponential function", points: 3 });
  });

  it("plays a full game: a wrong guess, a right one, a clue, a reveal", () => {
    let g: ChainGame = newGame(chain);

    let r = guess(g, "Pizza");
    expect(r.result).toEqual({ kind: "wrong" });
    g = r.game;
    expect(g.wrong).toBe(1);

    r = guess(g, "  toast ");
    expect(r.result).toEqual({ kind: "known", name: "Toast" }); // an end is not a hidden concept, and costs nothing
    expect(r.game.wrong).toBe(1);

    r = guess(g, "fourier transfrom"); // guesses may come in any order, typos forgiven
    expect(r.result).toEqual({ kind: "correct", stop: 1, name: "Fourier transform", points: POINTS.guessed });
    g = r.game;
    expect(guess(g, "Fourier transform").result).toEqual({ kind: "known", name: "Fourier transform" });

    // Link 3 (Fourier transform → Heat equation) now has one end shown; its clue is the narration, blanked.
    g = clue(g, 2);
    expect(g.stops[2].status).toBe("clued");
    expect(linkView(g, 2).clue).toBe("From Fourier transform it is a short walk to [?]. We walked it.");
    expect(linkView(g, 2).fact).toBeNull();
    expect(clue(g, 2)).toBe(g); // a second clue changes nothing

    r = guess(g, "the heat equations");
    expect(r.result).toEqual({ kind: "correct", stop: 2, name: "Heat equation", points: POINTS.clued });
    g = r.game;
    // Both ends of link 3 are known: its fact and narration show.
    expect(linkView(g, 2).fact).toMatch(/Joseph Fourier developed Fourier analysis to solve the heat equation/);
    expect(linkView(g, 2).quip).toBe("From Fourier transform it is a short walk to Heat equation. We walked it.");
    // "Heat" is still hidden, but "Heat equation" is not: only the bare word is blanked in the clue of link 4.
    expect(linkView(clue(g, 3), 3).clue).toBe("Heat equation leads to [?]. Nobody seems surprised.");

    g = reveal(g, 3);
    expect(g.stops[3]).toMatchObject({ status: "revealed", points: 0 });
    expect(reveal(g, 1)).toBe(g); // found concepts stay found
    expect(reveal(g, 99)).toBe(g);
    expect(score(g)).toBe(5);
    expect(isOver(g)).toBe(false);

    g = guess(g, "Exponential function").game;
    g = guess(g, "Maillard reaction").game;
    expect(isOver(g)).toBe(true);
    expect(score(g)).toBe(3 + 3 + 2 + 0 + 3);
    expect(tally(g)).toEqual({ guessed: 3, clued: 1, revealed: 1 });
    expect(hiddenNames(g)).toEqual([]);
    expect(linkView(g, 5).quip).toBe("From Maillard reaction it is a short walk to Toast. We walked it.");
  });

  it("gives everything away at once", () => {
    const g = revealAll(guess(newGame(chain), "Heat").game);
    expect(isOver(g)).toBe(true);
    expect(tally(g)).toEqual({ guessed: 1, clued: 0, revealed: 4 });
    expect(score(g)).toBe(3);
  });

  it("masks other hidden names in a shown fact", () => {
    // Link 1's fact names the exponential; link 2's fact names the Fourier transform while it is still hidden.
    const g = guess(newGame(chain), "Exponential function").game;
    const v = linkView(g, 0);
    expect(v.fact).toMatch(/homomorphism from/);
    const hiddenTo = linkView(g, 1);
    expect(hiddenTo.fact).toBeNull();
    const g2 = guess(g, "Heat equation").game;
    expect(linkView(clue(g2, 1), 1).clue).toBe("Then [?]. Naturally.");
  });

  it("is over at once for a chain with nothing between its ends", () => {
    const g = newGame({ ...chain, chain: [chain.chain[0]] });
    expect(g.stops).toEqual([]);
    expect(isOver(g)).toBe(true);
    expect(maxScore(g)).toBe(0);
  });
});

describe("best scores", () => {
  it("keeps the best per ordered pair of ends", () => {
    const s = memoryStorage();
    const key = pairKey("Homomorphisms", "Toast");
    expect(key).toBe(pairKey("homomorphism", "toast"));
    expect(key).not.toBe(pairKey("Toast", "Homomorphism"));
    expect(bestFor(key, s)).toBeNull();
    expect(recordBest(key, { score: 8, max: 15 }, s)).toEqual({ previous: null, isBest: true });
    expect(recordBest(key, { score: 5, max: 15 }, s)).toEqual({ previous: { score: 8, max: 15 }, isBest: false });
    expect(bestFor(key, s)).toEqual({ score: 8, max: 15 });
    expect(recordBest(key, { score: 8, max: 18 }, s).isBest).toBe(true); // same score from a longer chain
    expect(recordBest(key, { score: 12, max: 15 }, s).isBest).toBe(true);
    expect(bestFor(key, s)).toEqual({ score: 12, max: 15 });
  });

  it("survives broken or blocked storage", () => {
    const s = memoryStorage();
    s.data.set(BEST_KEY, "{not json");
    expect(bestFor("a -> b", s)).toBeNull();
    s.data.set(BEST_KEY, JSON.stringify({ "a -> b": { score: "x" }, "c -> d": { score: 3, max: 6 } }));
    expect(bestFor("a -> b", s)).toBeNull();
    expect(bestFor("c -> d", s)).toEqual({ score: 3, max: 6 });
    const blocked = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(bestFor("a -> b", blocked)).toBeNull();
    expect(recordBest("a -> b", { score: 1, max: 3 }, blocked)).toEqual({ previous: null, isBest: true });
    expect(recordBest("a -> b", { score: 1, max: 3 }, undefined)).toEqual({ previous: null, isBest: true });
  });

  it("forgets the oldest pairs past 200", () => {
    const s = memoryStorage();
    for (let i = 0; i < 205; i++) recordBest(`p${i} -> q`, { score: 1, max: 3 }, s);
    const stored = JSON.parse(s.data.get(BEST_KEY)!);
    expect(Object.keys(stored)).toHaveLength(200);
    expect(stored["p0 -> q"]).toBeUndefined();
    expect(stored["p204 -> q"]).toEqual({ score: 1, max: 3 });
  });
});
