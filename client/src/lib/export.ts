import type { ConceptNode, ExplainLevel, Graph, NodeAnatomy, NodeExplanation, PaperWork, SourceRef } from "@nodestorm/shared";
import { listJoin, translate, useLocale, type Lang, type MessageKey } from "../i18n";
import { isUnrelated } from "./graphOps";
import { KIND_LABEL } from "./kinds";
import { splitMath } from "./math";

/**
 * Pure formatters for sharing a graph outside the app. The Toolbar handles downloads/clipboard. The Markdown notes are
 * written in the interface language (the LaTeX document stays English, see latex.ts).
 */

/** "Site: Title, p. 3", or just the title; in `lang` (default: the interface language). */
export function sourceLabel(s: SourceRef, lang: Lang = useLocale.getState().lang): string {
  if (s.site === "AI") return translate(lang, "source.ai", { model: s.title });
  if (s.site === "you") return translate(lang, "source.you");
  // A looked-up definition names its site ("Wikidata: Q83478" means little without it).
  const title = s.site && s.title ? `${s.site}: ${s.title}` : s.site || s.title;
  return s.page ? translate(lang, "dt.sourcePage", { title, page: s.page }) : title;
}

/** A message in the interface language (as `t`, without importing the component helpers). */
const t = (key: MessageKey, params?: Record<string, string | number>) => translate(useLocale.getState().lang, key, params);
/** `**Label:**` / `*Label:*`, with the colon of the interface language. */
const bold = (key: MessageKey) => `**${t("common.label", { label: t(key) })}**`;
const em = (key: MessageKey) => `*${t("common.label", { label: t(key) })}*`;

/**
 * Nodes ordered so every concept comes after its (in-graph) prerequisites. Ties keep graph order;
 * nodes caught in a dependency cycle are appended in graph order rather than dropped.
 */
export function studyOrder(g: Graph): ConceptNode[] {
  const ids = new Set(g.nodes.map((n) => n.id));
  const done = new Set<string>();
  const out: ConceptNode[] = [];
  let progress = true;
  while (progress && out.length < g.nodes.length) {
    progress = false;
    for (const n of g.nodes) {
      if (done.has(n.id)) continue;
      if (n.dependsOn.every((d) => done.has(d) || !ids.has(d) || d === n.id)) {
        done.add(n.id);
        out.push(n);
        progress = true;
      }
    }
  }
  for (const n of g.nodes) if (!done.has(n.id)) out.push(n);
  return out;
}

/** Collapse newlines/runs of whitespace so a value stays on one line. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Escape text for inline Markdown so names like "a*b" or "[x]" render literally. LaTeX formulas (lib/math.ts) are
 * kept as written, `$…$` and all, which GitHub and most Markdown editors typeset; other dollars are escaped.
 */
export function mdEscape(s: string): string {
  return splitMath(oneLine(s))
    .map((seg, i) => (seg.kind === "math" ? seg.raw : mdEscapeText(seg.text, i === 0)))
    .join("");
}

function mdEscapeText(s: string, atStart: boolean): string {
  const out = s.replace(/[\\`*_[\]<>|~$]/g, "\\$&");
  // Would otherwise start a heading/list/rule when the text begins a line.
  return atStart ? out.replace(/^[#+=-]/, "\\$&").replace(/^(\d+)([.)])/, "$1\\$2") : out;
}

/** "Authors, year, venue": a paper's byline, whichever parts it has. */
export function paperByline(w: Pick<PaperWork, "authors" | "year" | "venue">): string {
  return [w.authors, w.year ? String(w.year) : "", w.venue ?? ""].filter(Boolean).join(", ");
}

/** A URL as a Markdown link target: characters that would end it are percent-encoded. */
const mdUrl = (u: string) => u.replace(/[()<>\s\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

/** One stored paper as a Markdown list item's text: linked title, byline, citations, a free copy. */
function paperMd(w: PaperWork): string {
  const by = paperByline(w);
  const oa = w.openAccessUrl ? ` [${t("papers.free")}](${mdUrl(w.openAccessUrl)})` : "";
  return `[${mdEscape(w.title)}](${mdUrl(w.url)})${by ? ` — ${mdEscape(by)}` : ""}. ${t("md.citedBy", { n: w.citedBy })}${oa}`;
}

export function toMarkdown(g: Graph): string {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const ordered = studyOrder(g);
  const rank = new Map(ordered.map((n, i) => [n.id, i]));
  const lines: string[] = [`# ${mdEscape(g.name || t("md.untitled"))}`, ""];
  if (!g.nodes.length) return [...lines, `_${t("md.empty")}_`, ""].join("\n");

  lines.push(`## ${t("md.studyOrder")}`, "");
  ordered.forEach((n, i) => lines.push(`${i + 1}. ${mdEscape(n.name)}`));
  lines.push("", `## ${t("md.concepts")}`, "");

  for (const n of ordered) {
    lines.push(`### ${mdEscape(n.name)}`, "");
    if (n.kind) lines.push(`${em("kind.label")} ${t(KIND_LABEL[n.kind])}`, "");
    if (n.aliases.length) lines.push(`${em("md.also")} ${listJoin(n.aliases.map(mdEscape))}`, "");
    lines.push(n.definition.trim() ? mdEscape(n.definition) : `_${t("def.empty")}_`, "");
    const prereqs = n.dependsOn
      .map((id) => byId.get(id))
      .filter((p): p is ConceptNode => !!p)
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    if (prereqs.length) lines.push(`${bold("md.prereqs")} ${listJoin(prereqs.map((p) => mdEscape(p.name)))}`, "");
    if (n.missingDeps.length) {
      lines.push(`${bold("md.missing")} ${listJoin(n.missingDeps.map((d) => mdEscape(d.name)))}`, "");
    }
    if (n.source) {
      const label = mdEscape(sourceLabel(n.source));
      lines.push(`${em("node.source")} ${n.source.url ? `[${label}](${mdUrl(n.source.url)})` : label}`, "");
    }
    if (n.formal?.decls.length) lines.push(`${em("md.mathlib")} ${listJoin(n.formal.decls.map((d) => `\`${d.name}\``))}`, "");
    if (n.papers?.works.length) lines.push(t("md.papers"), "", ...n.papers.works.map((w) => `- ${paperMd(w)}`), "");
    if (n.anatomy) lines.push(...anatomyMd(n.anatomy));
    if (n.explanation) lines.push(...explanationMd(n.explanation));
    if (n.notes?.trim()) {
      // The user's notes are Markdown-ish already: keep them as written, quoted so their headings stay inside.
      lines.push(bold("node.notes"), "", ...n.notes.trim().split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : ">")), "");
    }
  }

  const rels = g.relations.filter((r) => byId.has(r.a) && byId.has(r.b));
  if (rels.length) {
    lines.push(`## ${t("node.relations")}`, "");
    for (const r of rels) {
      const a = mdEscape(byId.get(r.a)!.name);
      const b = mdEscape(byId.get(r.b)!.name);
      const dir = (x: string, y: string, d: { kind: string; explanation: string }) =>
        `- ${x} → ${y}: ${mdEscape(d.kind)}${d.explanation.trim() ? ` — ${mdEscape(d.explanation)}` : ""}`;
      // Mix found nothing either way: said once. Otherwise a "none" side (a one-way relation) isn't written out.
      if (isUnrelated(r)) {
        lines.push(`- ${a} — ${b}: ${t("md.unrelated")}${r.aToB.explanation.trim() ? ` — ${mdEscape(r.aToB.explanation)}` : ""}`);
        continue;
      }
      if (r.aToB.kind.trim() !== "none") lines.push(dir(a, b, r.aToB));
      if (r.bToA.kind.trim() !== "none") lines.push(dir(b, a, r.bToA));
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** A stored "Theorem anatomy" as a sub-section of its concept. */
function anatomyMd(an: NodeAnatomy): string[] {
  const out = [`#### ${t("anatomy.heading")}`, ""];
  if (an.hypotheses.length) {
    out.push(bold("anatomy.hypotheses"), "");
    an.hypotheses.forEach((h, i) => {
      out.push(`${i + 1}. ${mdEscape(h.text)}`);
      if (h.whyNeeded.trim()) out.push(`   *${t("anatomy.why")}* ${mdEscape(h.whyNeeded)}`);
      if (h.counterexampleIfDropped.trim()) out.push(`   *${t("anatomy.without")}* ${mdEscape(h.counterexampleIfDropped)}`);
    });
    out.push("");
  }
  out.push(`${bold("anatomy.conclusion")} ${mdEscape(an.conclusion)}`, "");
  if (an.proofIdea.trim()) out.push(`${bold("anatomy.proofIdea")} ${mdEscape(an.proofIdea)}`, "");
  if (an.examples.length) out.push(bold("anatomy.examples"), "", ...an.examples.map((x) => `- ${mdEscape(x)}`), "");
  if (an.nonExamples.length) out.push(bold("anatomy.nonExamples"), "", ...an.nonExamples.map((x) => `- ${mdEscape(x)}`), "");
  return out;
}

const LEVEL_LABEL: Record<ExplainLevel, MessageKey> = {
  intuitive: "explain.intuitive",
  rigorous: "explain.rigorous",
  "example-driven": "explain.exampleDriven",
};

/** A stored "Explain more" answer as a sub-section of its concept: "Rigorous explanation (Noir detective)". */
function explanationMd(ex: NodeExplanation): string[] {
  const heading = t("explain.heading", { level: t(LEVEL_LABEL[ex.level]) });
  const voiced =
    ex.voice && ex.voice !== "plain" ? t("md.explanationVoice", { heading, voice: t(`explain.voice.${ex.voice}` as MessageKey) }) : heading;
  const out = [`#### ${voiced}`, "", mdEscape(ex.summary), ""];
  if (ex.intuition.trim()) out.push(`${em("md.intuition")} ${mdEscape(ex.intuition)}`, "");
  const list = (heading: MessageKey, items: string[]) => {
    if (items.length) out.push(bold(heading), "", ...items.map((i) => `- ${i}`), "");
  };
  list("explain.keyPoints", ex.keyPoints.map(mdEscape));
  list("explain.examples", ex.examples.map((x) => `*${mdEscape(x.title)}*${x.body.trim() ? `: ${mdEscape(x.body)}` : ""}`));
  list("explain.pitfalls", ex.pitfalls.map(mdEscape));
  list("explain.reading", ex.furtherReading.map((r) => `${mdEscape(r.title)}${r.hint.trim() ? ` — ${mdEscape(r.hint)}` : ""}`));
  return out;
}

/**
 * Escape text for a quoted Mermaid label. Mermaid decodes `#name;`/`#123;` entity codes, so
 * quotes, brackets and anything else with syntax meaning (including `#` itself) become entities.
 */
const MERMAID_NAMED: Record<string, string> = { '"': "#quot;", "<": "#lt;", ">": "#gt;" };

export function mermaidEscape(s: string): string {
  // Single pass, so the `#`/`;` of entities we emit are never escaped again.
  return oneLine(s).replace(/[#"<>[\](){}|`;]/g, (c) => MERMAID_NAMED[c] ?? `#${c.charCodeAt(0)};`);
}

/**
 * A Mermaid flowchart: one box per concept, and one labelled arrow per relation direction.
 * Dependency relations are dotted. Node ids are generated (n0, n1…) so names never leak into syntax.
 */
export function toMermaid(g: Graph): string {
  const mid = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]));
  const lines = ["flowchart LR"];
  for (const n of g.nodes) lines.push(`  ${mid.get(n.id)}["${mermaidEscape(n.name)}"]`);
  for (const r of g.relations) {
    const a = mid.get(r.a);
    const b = mid.get(r.b);
    if (!a || !b) continue;
    const arrow = r.origin === "dependency" ? "-.->" : "-->";
    if (isUnrelated(r)) {
      lines.push(`  ${a} -.-x ${b}`); // no relation found
      continue;
    }
    if (r.aToB.kind.trim() !== "none") lines.push(`  ${a} ${arrow}|"${mermaidEscape(r.aToB.kind)}"| ${b}`);
    if (r.bToA.kind.trim() !== "none") lines.push(`  ${b} ${arrow}|"${mermaidEscape(r.bToA.kind)}"| ${a}`);
  }
  return lines.join("\n") + "\n";
}

/** A filesystem-friendly base name, e.g. "nodestorm-main-2026-09-24". */
export function exportFileName(g: Graph, date = new Date()): string {
  const slug = g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ["nodestorm", slug, date.toISOString().slice(0, 10)].filter(Boolean).join("-");
}
