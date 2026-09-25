import { isTheoremLike, type ConceptNode, type DirRel, type Graph, type NodeStatus } from "@nodestorm/shared";
import { t } from "../i18n";
import { studyOrder } from "./export";
import { splitMath } from "./math";
import { learningPath } from "./paths";

/**
 * Pure formatters for "Flashcards (Anki)…": the graph (or one concept's learning path) as question/answer cards, then
 * as an Anki import file (tab-separated, HTML fields, with the header lines Anki ≥ 2.1.55 reads) or as a plain CSV
 * (front,back,tags) for other apps. The card wording is in the interface language; tags are identifiers and stay as
 * they are. Quiz questions aren't stored on the concepts (only the resulting mastery is), so there are no quiz cards.
 * A theorem taken apart ("Theorem anatomy") gives anatomy cards: its full statement, and why each hypothesis is needed.
 */

export type CardKind = "definition" | "prerequisites" | "relation" | "anatomy";
export const CARD_KINDS: readonly CardKind[] = ["definition", "prerequisites", "relation", "anatomy"];

/** One card. `front`/`back` are plain text (newlines allowed, `$…$` math as typed); the writers escape them. */
export interface Flashcard {
  kind: CardKind;
  front: string;
  back: string;
  tags: string[];
}

export interface CardOptions {
  /** Which card types to make (all three when omitted). */
  kinds?: Iterable<CardKind>;
  /** Only this concept's learning path (it and everything it builds on) instead of the whole graph. */
  rootId?: string;
  /** Tagged on every card, e.g. the project name (see `tagName`). */
  project?: string;
}

/** Anki's name for our statuses ("ok" is shown as "ready" everywhere in the app). */
const STATUS_TAG: Record<NodeStatus, string> = {
  ok: "ready",
  blocked: "blocked",
  checking: "checking",
  unclear: "unclear",
  error: "error",
};

/** A name usable as one Anki tag: tags are separated by spaces, so whitespace becomes "_" ("::" nests them). */
export function tagName(s: string): string {
  return s.trim().replace(/\s+/g, "_").replace(/"/g, "");
}

/**
 * Cards in study order: a concept's cards come after those of everything it builds on, and a relation's two cards
 * come with whichever of its concepts is studied later, so both are known by then. Concepts without a definition get
 * no definition card, directions without any text no relation card.
 */
export function buildCards(g: Graph, opts: CardOptions = {}): Flashcard[] {
  const kinds = new Set(opts.kinds ?? CARD_KINDS);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const whole = studyOrder(g);
  const rank = new Map(whole.map((n, i) => [n.id, i]));
  let order: ConceptNode[] = whole;
  if (opts.rootId && byId.has(opts.rootId)) {
    order = learningPath(g, opts.rootId).steps.flatMap((s) => (s.kind === "node" ? [byId.get(s.id)!] : []));
  }
  const inScope = new Map(order.map((n, i) => [n.id, i]));
  const project = opts.project?.trim() ? tagName(opts.project) : "";
  const tags = (n: ConceptNode, kind: CardKind) =>
    [project, `status::${STATUS_TAG[n.status]}`, `card::${kind}`].filter(Boolean);

  // Relations by the endpoint studied later; both directions of each.
  const relsAt = new Map<string, { from: ConceptNode; to: ConceptNode; dir: DirRel }[]>();
  for (const r of g.relations) {
    const a = byId.get(r.a);
    const b = byId.get(r.b);
    if (!a || !b || a === b || !inScope.has(a.id) || !inScope.has(b.id)) continue;
    const later = inScope.get(a.id)! > inScope.get(b.id)! ? a.id : b.id;
    const list = relsAt.get(later) ?? [];
    list.push({ from: a, to: b, dir: r.aToB }, { from: b, to: a, dir: r.bToA });
    relsAt.set(later, list);
  }

  const cards: Flashcard[] = [];
  for (const n of order) {
    if (kinds.has("definition") && n.definition.trim()) {
      const also = n.aliases.filter((a) => a.trim());
      const back = [n.definition.trim(), ...(also.length ? ["", t("flash.cardAlso", { names: also.join(", ") })] : [])];
      cards.push({ kind: "definition", front: n.name, back: back.join("\n"), tags: tags(n, "definition") });
    }
    if (kinds.has("prerequisites")) {
      const prereqs = [...new Set(n.dependsOn)]
        .map((id) => byId.get(id))
        .filter((p): p is ConceptNode => !!p && p !== n)
        .sort((x, y) => rank.get(x.id)! - rank.get(y.id)!)
        .map((p) => p.name);
      const missing = n.missingDeps.map((d) => t("flash.cardMissing", { name: d.name }));
      const all = [...prereqs, ...missing];
      if (all.length) {
        cards.push({
          kind: "prerequisites",
          front: t("flash.cardPrereqFront", { name: n.name }),
          back: all.map((p, i) => `${i + 1}. ${p}`).join("\n"),
          tags: tags(n, "prerequisites"),
        });
      }
    }
    // Theorem anatomy (stored for theorem-like concepts): the statement with all its hypotheses, then one card per
    // hypothesis that says why it is needed (and what fails without it).
    if (kinds.has("anatomy") && n.anatomy && isTheoremLike(n.kind)) {
      const an = n.anatomy;
      const hyps = an.hypotheses.filter((h) => h.text.trim());
      if (an.conclusion.trim()) {
        cards.push({
          kind: "anatomy",
          front: t("flash.cardStatementFront", { name: n.name }),
          back: [
            ...hyps.map((h, i) => `${i + 1}. ${h.text.trim()}`),
            ...(hyps.length ? [""] : []),
            t("flash.cardThen", { conclusion: an.conclusion.trim() }),
          ].join("\n"),
          tags: tags(n, "anatomy"),
        });
      }
      for (const h of hyps) {
        if (!h.whyNeeded.trim()) continue;
        const without = h.counterexampleIfDropped.trim();
        cards.push({
          kind: "anatomy",
          front: t("flash.cardHypothesisFront", { name: n.name, hypothesis: h.text.trim() }),
          back: [h.whyNeeded.trim(), ...(without ? ["", t("flash.cardWithout", { counterexample: without })] : [])].join("\n"),
          tags: tags(n, "anatomy"),
        });
      }
    }
    if (kinds.has("relation")) {
      for (const { from, to, dir } of relsAt.get(n.id) ?? []) {
        const kind = dir.kind.trim();
        const why = dir.explanation.trim();
        if ((!kind && !why) || kind === "none") continue; // no card for the side that does nothing
        cards.push({
          kind: "relation",
          front: t("flash.cardRelationFront", { a: from.name, b: to.name }),
          back: [kind, why].filter(Boolean).join("\n"),
          tags: tags(from, "relation"),
        });
      }
    }
  }
  return cards;
}

/**
 * TeX delimiters for Anki: `$$…$$` becomes `\[…\]` and `$…$` becomes `\(…\)`, the delimiters Anki's built-in MathJax
 * renders (it ignores dollars). The formulas are found by the same parser the app typesets with (lib/math.ts), so
 * prices such as "$5 and $10" stay text there too and `\$` is a literal dollar.
 */
export function ankiMath(s: string): string {
  return splitMath(s)
    .map((seg) => (seg.kind === "text" ? seg.text : seg.display ? `\\[${seg.tex}\\]` : `\\(${seg.tex}\\)`))
    .join("");
}

/**
 * One field of the Anki file (`#html:true`): math converted, then `&`, `<`, `>` and `"` as entities, newlines as
 * <br> and tabs as spaces, so no field can contain the separator, a line break or a quote (Anki's reader would take
 * a leading `"` as CSV quoting). A leading `#` becomes `&#35;` because Anki treats lines starting with `#` as headers.
 */
export function ankiField(s: string): string {
  return ankiMath(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, " ")
    .replace(/\r\n?|\n/g, "<br>")
    .replace(/^#/, "&#35;");
}

/** A deck name for the `#deck:` header: one line, no tabs; "::" makes a subdeck, as in Anki. Falls back to NodeStorm. */
export function deckName(s: string): string {
  return s.replace(/\s+/g, " ").trim() || "NodeStorm";
}

/**
 * The Anki import file ("Notes in Plain Text", File → Import in Anki ≥ 2.1.55): header lines naming the separator,
 * HTML fields, the Basic note type, the deck and the tags column, then one note per line: Front, Back, Tags.
 *
 * No byte-order mark: Anki always reads import files as UTF-8, so a BOM adds nothing, and it would sit in front of
 * `#separator:tab` on the first line, where older importers then don't recognise the header.
 */
export function toAnki(cards: Flashcard[], deck: string): string {
  const head = ["#separator:tab", "#html:true", "#notetype:Basic", `#deck:${deckName(deck)}`, "#tags column:3"];
  const rows = cards.map((c) => [ankiField(c.front), ankiField(c.back), c.tags.map(tagName).join(" ")].join("\t"));
  return [...head, ...rows].join("\n") + "\n";
}

/** One RFC 4180 field: quoted (with doubled quotes) when it holds a comma, quote or line break, or starts with a space. */
export function csvField(raw: string): string {
  // A leading = + - @ (or tab/CR) makes spreadsheets run the field as a formula; names and definitions can come from
  // AI output or someone else's share link, so neutralise it with an apostrophe (the OWASP CSV-injection advice).
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Plain CSV for other flashcard apps (Quizlet, RemNote, a spreadsheet…): a `front,back,tags` header, then one card per
 * record, CRLF line ends (RFC 4180). Text stays plain, newlines inside quoted fields and math as typed (`$…$`).
 * Starts with a UTF-8 byte-order mark, which is how Excel tells UTF-8 apart from the local code page; CSV readers
 * skip it (Excel would otherwise garble every non-ASCII name).
 */
export function toCsv(cards: Flashcard[]): string {
  const rows = [["front", "back", "tags"], ...cards.map((c) => [c.front, c.back, c.tags.map(tagName).join(" ")])];
  return "﻿" + rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** A download name like "group-theory-anki.txt": the project name in lower case, keeping non-Latin letters. */
export function flashcardsFileName(project: string, suffix: "anki.txt" | "flashcards.csv"): string {
  const slug = project.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${slug || "nodestorm"}-${suffix}`;
}
