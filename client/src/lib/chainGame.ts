import { normalizeName, type AbsurdChainResponse } from "@nodestorm/shared";
import { chainConcepts } from "./absurd";

/**
 * "Guess the chain", the game mode of the Absurd chain dialog. The chain is built as usual, but the concepts between
 * the two ends are hidden: the player sees the ends, how many links there are and each link's relation, and guesses
 * the hidden concepts (in any order). A clue shows the narration of the link that arrives at a concept, with every
 * still-hidden name blanked out; a reveal gives the concept away. Pure functions only; the board is
 * panels/ChainGame.tsx.
 */

/** A hidden concept's state: still hidden, hidden with its clue shown, found by the player, or given away. */
export type StopStatus = "hidden" | "clued" | "guessed" | "revealed";

export interface GameStop {
  /** The concept's name as the chain gives it. */
  name: string;
  /** Other names that count as right (the aliases of a concept of the graph with that name). */
  aliases: string[];
  status: StopStatus;
  /** Points won for it, once it is guessed or revealed. */
  points: number;
}

export interface ChainGame {
  chain: AbsurdChainResponse;
  /** The concepts between the ends: stop i is where link i arrives (and link i + 1 leaves). */
  stops: GameStop[];
  /** Wrong guesses so far (they cost nothing; the summary counts them). */
  wrong: number;
}

/** Points for a concept found without help, found after its clue, and given away. */
export const POINTS = { guessed: 3, clued: 2, revealed: 0 } as const;

/** A new game over a chain. `aliasesOf` gives the extra names accepted for a concept (from the graph). */
export function newGame(chain: AbsurdChainResponse, aliasesOf: (name: string) => string[] = () => []): ChainGame {
  const names = chainConcepts(chain).slice(1, -1);
  return {
    chain,
    stops: names.map((name) => ({ name, aliases: aliasesOf(name), status: "hidden", points: 0 })),
    wrong: 0,
  };
}

/** Whether a stop is still a secret (hidden, with or without its clue). */
export const isOpen = (s: GameStop): boolean => s.status === "hidden" || s.status === "clued";

/** The game ends when no concept is left to find. */
export const isOver = (g: ChainGame): boolean => !g.stops.some(isOpen);

export const score = (g: ChainGame): number => g.stops.reduce((sum, s) => sum + s.points, 0);

export const maxScore = (g: ChainGame): number => g.stops.length * POINTS.guessed;

/** How many concepts were found unaided, found after a clue, and given away. */
export function tally(g: ChainGame): { guessed: number; clued: number; revealed: number } {
  const out = { guessed: 0, clued: 0, revealed: 0 };
  for (const s of g.stops) {
    if (s.status === "revealed") out.revealed++;
    else if (s.status === "guessed") out[s.points === POINTS.guessed ? "guessed" : "clued"]++;
  }
  return out;
}

const update = (g: ChainGame, i: number, patch: Partial<GameStop>): ChainGame => ({
  ...g,
  stops: g.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)),
});

/** Show a hidden concept's clue. Anything else (out of range, already clued or found) leaves the game as it is. */
export function clue(g: ChainGame, i: number): ChainGame {
  return g.stops[i]?.status === "hidden" ? update(g, i, { status: "clued" }) : g;
}

/** Give a concept away (no points). A concept already found stays as it is. */
export function reveal(g: ChainGame, i: number): ChainGame {
  return g.stops[i] && isOpen(g.stops[i]) ? update(g, i, { status: "revealed", points: POINTS.revealed }) : g;
}

/** Give every remaining concept away ("Show the answer"). */
export function revealAll(g: ChainGame): ChainGame {
  return g.stops.reduce((acc, _s, i) => reveal(acc, i), g);
}

/**
 * Edit distance with adjacent transpositions (optimal string alignment): "fourier" and "fuorier" are 1 apart. Works
 * on code points, so it is fair to non-Latin names too.
 */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array<number>(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[x.length][y.length];
}

/**
 * Typos forgiven for a name of this many characters: none up to 4 (so "Heat" never accepts "Meat"), one up to 8, two
 * beyond.
 */
export const typoAllowance = (length: number): number => (length <= 4 ? 0 : length <= 8 ? 1 : 2);

/** A name for comparing guesses: `normalizeName` without a leading article ("the Heat equation"). */
const key = (s: string) => normalizeName(s).replace(/^(?:the|a|an) /, "");

/**
 * Whether a guess names a concept, leniently: case, accents, punctuation, a plural "s" and a leading article don't
 * matter, any alias counts, and a small typo is forgiven (see `typoAllowance`, measured on the name).
 */
export function matchesName(guess: string, name: string, aliases: string[] = []): boolean {
  const g = key(guess);
  if (!g) return false;
  return [name, ...aliases].some((n) => {
    const k = key(n);
    if (!k) return false;
    if (k === g) return true;
    const allowed = typoAllowance([...k].length);
    return allowed > 0 && Math.abs([...k].length - [...g].length) <= allowed && editDistance(g, k) <= allowed;
  });
}

export type GuessResult =
  | { kind: "empty" }
  | { kind: "correct"; stop: number; name: string; points: number }
  /** A concept already shown: one of the ends, or one found or revealed before. */
  | { kind: "known"; name: string }
  | { kind: "wrong" };

/**
 * Check a guess against every concept still hidden (the player may guess in any order). A right guess reveals that
 * concept and scores `POINTS.guessed`, or `POINTS.clued` after its clue; a wrong one is counted.
 */
export function guess(g: ChainGame, text: string): { game: ChainGame; result: GuessResult } {
  if (!key(text)) return { game: g, result: { kind: "empty" } };
  const i = g.stops.findIndex((s) => isOpen(s) && matchesName(text, s.name, s.aliases));
  if (i >= 0) {
    const s = g.stops[i];
    const points = s.status === "clued" ? POINTS.clued : POINTS.guessed;
    return { game: update(g, i, { status: "guessed", points }), result: { kind: "correct", stop: i, name: s.name, points } };
  }
  const ends = chainConcepts(g.chain);
  const shown = [ends[0], ends[ends.length - 1], ...g.stops.filter((s) => !isOpen(s)).map((s) => s.name)];
  const known = shown.find((n) => n !== undefined && matchesName(text, n));
  if (known) return { game: g, result: { kind: "known", name: known } };
  return { game: { ...g, wrong: g.wrong + 1 }, result: { kind: "wrong" } };
}

/** Every concept on the chain in order, with whether the player can see it (the ends always). */
export function stopsInOrder(g: ChainGame): { name: string; shown: boolean; stop: number | null }[] {
  const all = chainConcepts(g.chain);
  return all.map((name, i) => {
    const stop = i === 0 || i === all.length - 1 ? null : i - 1;
    return { name, shown: stop === null || !isOpen(g.stops[stop]), stop };
  });
}

/** The names still hidden, and their aliases: what `mask` blanks out. */
export function hiddenNames(g: ChainGame): string[] {
  return g.stops.filter(isOpen).flatMap((s) => [s.name, ...s.aliases]);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Blank out hidden names in a text (a clue, or a fact next to a still-hidden concept). Every name on the chain is
 * found, longest first and case-insensitively, with an optional plural "s" or "es", as a whole word; only the hidden
 * ones are replaced, so a shown "Heat equation" keeps its "Heat" even while "Heat" is hidden.
 */
export function mask(text: string, hidden: string[], shown: string[] = [], blank = "[?]"): string {
  const hiddenKeys = new Set(hidden.map(normalizeName));
  const names = [...new Set([...hidden, ...shown].map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!names.some((n) => hiddenKeys.has(normalizeName(n)))) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join("|")})(?:e?s)?(?![\\p{L}\\p{N}])`, "giu");
  return text.replace(re, (m) => {
    const bare = names.find((n) => m.toLowerCase().startsWith(n.toLowerCase()) && m.length - n.length <= 2);
    return bare && hiddenKeys.has(normalizeName(bare)) ? blank : m;
  });
}

/**
 * What link i shows: whether each end is visible, and its fact and narration once both ends are (still masking any
 * other hidden name), or only the masked narration as a clue while the concept it arrives at is clued.
 */
export function linkView(
  g: ChainGame,
  i: number,
  blank = "[?]",
): { fromShown: boolean; toShown: boolean; fact: string | null; quip: string | null; clue: string | null } {
  const order = stopsInOrder(g);
  const hop = g.chain.chain[i];
  const fromShown = order[i].shown;
  const toShown = order[i + 1].shown;
  const hidden = hiddenNames(g);
  const shown = order.filter((o) => o.shown).map((o) => o.name);
  const m = (s: string) => mask(s, hidden, shown, blank);
  if (fromShown && toShown) return { fromShown, toShown, fact: m(hop.fact), quip: hop.quip ? m(hop.quip) : null, clue: null };
  const arriving = order[i + 1].stop;
  const clued = arriving !== null && g.stops[arriving].status === "clued";
  return { fromShown, toShown, fact: null, quip: null, clue: clued ? m(hop.quip || hop.fact) : null };
}

// ---------- Best scores (per pair of ends, kept in the browser) ----------

export const BEST_KEY = "nodestorm-chain-game";
const MAX_PAIRS = 200;

export interface Best {
  score: number;
  max: number;
}

/** The key of a pair of ends, in order (Toast → Homomorphism is another game). */
export const pairKey = (from: string, to: string): string => `${normalizeName(from)} -> ${normalizeName(to)}`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function readAll(storage: StorageLike | undefined): Record<string, Best> {
  try {
    const raw = JSON.parse(storage?.getItem(BEST_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, Best> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const b = v as Partial<Best> | null;
      if (b && Number.isFinite(b.score) && Number.isFinite(b.max)) out[k] = { score: b.score!, max: b.max! };
    }
    return out;
  } catch {
    return {};
  }
}

const defaultStorage = (): StorageLike | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The best score so far for a pair of ends, if any. */
export function bestFor(pair: string, storage: StorageLike | undefined = defaultStorage()): Best | null {
  return readAll(storage)[pair] ?? null;
}

/**
 * Record a finished game's score. A higher score, or the same score out of a longer chain, is the new best. Returns
 * the best before this game (null the first time) and whether this one beat it. Storage errors are ignored: the
 * score is simply not remembered.
 */
export function recordBest(
  pair: string,
  result: Best,
  storage: StorageLike | undefined = defaultStorage(),
): { previous: Best | null; isBest: boolean } {
  const all = readAll(storage);
  const previous = all[pair] ?? null;
  const isBest = !previous || result.score > previous.score || (result.score === previous.score && result.max > previous.max);
  if (isBest) {
    delete all[pair];
    all[pair] = result;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAIRS))) delete all[k];
    try {
      storage?.setItem(BEST_KEY, JSON.stringify(all));
    } catch {
      // private window or full storage: forget it
    }
  }
  return { previous, isBest };
}
