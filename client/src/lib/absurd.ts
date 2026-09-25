import { findByName, normalizeName, type AbsurdChainResponse, type AbsurdStyle, type Graph } from "@nodestorm/shared";
import { t, useLocale } from "../i18n";
import * as ops from "./graphOps";

/**
 * "Absurd chain" (parody mode): true links between two concepts, narrated comically. Pure functions only; the dialog
 * is panels/AbsurdChainDialog.tsx and the AI call and sandbox insert live in actions.ts.
 */

export const ABSURD_STYLES: AbsurdStyle[] = ["deadpan", "conspiracy", "epic", "bureaucratic", "academic-overkill"];

/** Chain lengths offered in the dialog, as hop ranges. */
export const ABSURD_LENGTHS = { short: { min: 3, max: 4 }, medium: { min: 4, max: 5 }, long: { min: 5, max: 7 } } as const;
export type AbsurdLength = keyof typeof ABSURD_LENGTHS;

/**
 * A stop the user puts on the chain: a concept of the graph (by name or alias), or a custom one with the user's own
 * description (what it means; sent to the AI as its definition, and its definition if it is added to a sandbox).
 */
export interface AbsurdStop {
  name: string;
  description: string;
}

/** Whether a concept of the chain is one of the user's stops. */
export function isStop(name: string, stops: readonly Pick<AbsurdStop, "name">[]): boolean {
  const key = normalizeName(name);
  return stops.some((s) => normalizeName(s.name) === key);
}

/** Every concept on the chain, in order: its start, the intermediate concepts, its end. */
export function chainConcepts(res: Pick<AbsurdChainResponse, "chain">): string[] {
  return res.chain.length ? [res.chain[0].from, ...res.chain.map((h) => h.to)] : [];
}

/** The concepts between the two ends ("Roll again" asks the AI to avoid them). */
export function intermediates(res: Pick<AbsurdChainResponse, "chain">): string[] {
  return chainConcepts(res).slice(1, -1);
}

const MAX_SANDBOX_NAME = 60;

/** A sandbox name from the chain's title, kept short enough for the graph selector. */
export function sandboxName(title: string): string {
  const s = title.replace(/\s+/g, " ").trim() || t("absurd.title");
  return s.length > MAX_SANDBOX_NAME ? `${s.slice(0, MAX_SANDBOX_NAME - 1).trimEnd()}…` : s;
}

/** What a relation added from a hop explains: the fact, then its narration in quotes. */
export function hopExplanation(hop: { fact: string; quip: string }): string {
  return hop.quip ? `${hop.fact}\n\n“${hop.quip}”` : hop.fact;
}

/** The chain as plain text, for the clipboard. */
export function chainToText(res: AbsurdChainResponse): string {
  const lines = [res.title, ""];
  res.chain.forEach((h, i) => {
    lines.push(`${i + 1}. ${h.from} → ${h.to}${h.kind ? ` (${h.kind})` : ""}`);
    lines.push(`   ${t("common.label", { label: t("absurd.factLabel") })} ${h.fact}`);
    if (h.quip) lines.push(`   “${h.quip}”`);
  });
  if (res.moral) lines.push("", `${t("common.label", { label: t("absurd.moralLabel") })} ${res.moral}`);
  if (res.plausibility) lines.push(`${t("common.label", { label: t("absurd.plausibilityLabel") })} ${res.plausibility}`);
  return lines.join("\n");
}

const STEP = { x: 140, y: ops.NODE_SIZE.h + 70 };

/**
 * Put a chain into a graph (meant for a fresh sandbox): concepts not already there are added (by name or alias,
 * so the chain's ends are normally the user's own concepts), placed along the line between the ends when they
 * exist, else in a staircase from `center`; each hop becomes a relation whose forward direction is the fact (with
 * its narration) and whose other direction is "none". An existing relation between two concepts is kept as it is.
 * New concepts carry a note naming the chain. A custom stop of the user's (`stops`) that is new gets the user's
 * description as its definition, with "you" as its source. Returns the new concepts' ids with the hop fact that
 * introduced them.
 */
export function applyAbsurdChain(
  g: Graph,
  res: AbsurdChainResponse,
  center: { x: number; y: number } = { x: 0, y: 0 },
  stops: readonly AbsurdStop[] = [],
): { graph: Graph; added: { id: string; fact: string }[]; linked: number } {
  const names = chainConcepts(res);
  const n = names.length;
  const first = findByName(g.nodes, names[0])?.position;
  const last = findByName(g.nodes, names[n - 1])?.position;
  const start = first ?? (last ? { x: last.x - STEP.x * (n - 1), y: last.y - STEP.y * (n - 1) } : {
    x: center.x - (STEP.x * (n - 1)) / 2 - ops.NODE_SIZE.w / 2,
    y: center.y - (STEP.y * (n - 1)) / 2 - ops.NODE_SIZE.h / 2,
  });
  const end = last ?? { x: start.x + STEP.x * (n - 1), y: start.y + STEP.y * (n - 1) };
  const at = (i: number) => ({ x: start.x + ((end.x - start.x) * i) / (n - 1), y: start.y + ((end.y - start.y) * i) / (n - 1) });
  const note = t("absurd.note", { title: res.title });

  let out = g;
  const ids: string[] = [];
  const added: { id: string; fact: string }[] = [];
  names.forEach((name, i) => {
    const own = stops.find((s) => normalizeName(s.name) === normalizeName(name))?.description.trim();
    const r = ops.addNode(out, { name, position: at(i), ...(own ? { definition: own, source: ops.OWN_SOURCE } : {}) });
    out = r.existed ? r.graph : ops.updateNode(r.graph, r.id, { notes: note });
    ids.push(r.id);
    if (!r.existed) added.push({ id: r.id, fact: res.chain[Math.max(i - 1, 0)].fact });
  });
  let linked = 0;
  res.chain.forEach((hop, i) => {
    const [a, b] = [ids[i], ids[i + 1]];
    if (a === b || ops.findRelation(out, a, b)) return;
    out = ops.upsertRelation(out, a, b, { kind: hop.kind || t("absurd.defaultKind"), explanation: hopExplanation(hop) }, { kind: "none", explanation: "" }, "mix");
    linked++;
  });
  return { graph: out, added, linked };
}

/**
 * Ends for "Surprise me" when the graph has fewer than two concepts: things with real, well-known links to some
 * mathematics (cicadas and primes, sunflowers and the golden ratio, toast and the Maillard reaction…).
 */
export const FUN_ENDS = [
  "Fourier transform",
  "Toast",
  "Prime number",
  "Cicada",
  "Golden ratio",
  "Sunflower",
  "Möbius strip",
  "Conveyor belt",
  "Heat equation",
  "Chicken",
  "Pythagorean theorem",
  "Guitar",
  "Euler's identity",
  "Pizza",
] as const;

/** The same ends in Chinese, for a Chinese interface (the pair is typed into the dialog and may become concepts). */
export const FUN_ENDS_ZH = [
  "傅里叶变换",
  "吐司",
  "素数",
  "蝉",
  "黄金分割",
  "向日葵",
  "莫比乌斯带",
  "传送带",
  "热方程",
  "鸡",
  "勾股定理",
  "吉他",
  "欧拉恒等式",
  "披萨",
] as const;

/**
 * Two different random ends for "Surprise me": concepts of the graph when it has at least two, else its one concept
 * (always one of the ends then) and fun ends. Avoids handing back the pair already shown, either way round.
 */
export function surprisePair(
  names: string[],
  current: [string, string] = ["", ""],
  rand: () => number = Math.random,
): [string, string] {
  const seen = new Set<string>();
  const unique = (xs: readonly string[]) =>
    xs.filter((x) => {
      const k = normalizeName(x);
      return Boolean(k) && !seen.has(k) && Boolean(seen.add(k));
    });
  const own = unique(names);
  const fun = useLocale.getState().lang === "zh" ? FUN_ENDS_ZH : FUN_ENDS;
  const pool = own.length >= 2 ? own : [...own, ...unique(fun)];
  const same = (a: string, b: string) => normalizeName(a) === normalizeName(b);
  const shown = ([a, b]: [string, string]) =>
    (same(a, current[0]) && same(b, current[1])) || (same(a, current[1]) && same(b, current[0]));
  const index = (n: number) => Math.min(n - 1, Math.floor(rand() * n));
  const pick = (): [string, string] => {
    const i = own.length === 1 ? 0 : index(pool.length);
    let j = index(pool.length - 1);
    if (j >= i) j++;
    return own.length !== 1 && rand() < 0.5 ? [pool[j], pool[i]] : [pool[i], pool[j]];
  };
  let pair = pick();
  for (let tries = 0; tries < 10 && shown(pair); tries++) pair = pick();
  return pair;
}
