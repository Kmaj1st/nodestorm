import type { ConceptNode, Graph, NodeExplanation, SourceRef } from "@nodestorm/shared";
import { KIND_NAME } from "./kinds";
import { splitMath } from "./math";

/** Pure formatters for sharing a graph outside the app. The Toolbar handles downloads/clipboard. */

/** "Title, p. 3", or just the title. */
export function sourceLabel(s: SourceRef): string {
  return s.page ? `${s.title}, p. ${s.page}` : s.title;
}

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

export function toMarkdown(g: Graph): string {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const ordered = studyOrder(g);
  const rank = new Map(ordered.map((n, i) => [n.id, i]));
  const lines: string[] = [`# ${mdEscape(g.name || "NodeStorm graph")}`, ""];
  if (!g.nodes.length) return [...lines, "_No concepts yet._", ""].join("\n");

  lines.push("## Study order", "");
  ordered.forEach((n, i) => lines.push(`${i + 1}. ${mdEscape(n.name)}`));
  lines.push("", "## Concepts", "");

  for (const n of ordered) {
    lines.push(`### ${mdEscape(n.name)}`, "");
    if (n.kind) lines.push(`*Kind:* ${KIND_NAME[n.kind]}`, "");
    if (n.aliases.length) lines.push(`*Also:* ${n.aliases.map(mdEscape).join(", ")}`, "");
    lines.push(n.definition.trim() ? mdEscape(n.definition) : "_No definition yet._", "");
    const prereqs = n.dependsOn
      .map((id) => byId.get(id))
      .filter((p): p is ConceptNode => !!p)
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    if (prereqs.length) lines.push(`**Prerequisites:** ${prereqs.map((p) => mdEscape(p.name)).join(", ")}`, "");
    if (n.missingDeps.length) {
      lines.push(`**Missing prerequisites:** ${n.missingDeps.map((d) => mdEscape(d.name)).join(", ")}`, "");
    }
    if (n.source) lines.push(`*Source:* ${mdEscape(sourceLabel(n.source))}`, "");
    if (n.explanation) lines.push(...explanationMd(n.explanation));
    if (n.notes?.trim()) {
      // The user's notes are Markdown-ish already: keep them as written, quoted so their headings stay inside.
      lines.push("**My notes:**", "", ...n.notes.trim().split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : ">")), "");
    }
  }

  const rels = g.relations.filter((r) => byId.has(r.a) && byId.has(r.b));
  if (rels.length) {
    lines.push("## Relations", "");
    for (const r of rels) {
      const a = mdEscape(byId.get(r.a)!.name);
      const b = mdEscape(byId.get(r.b)!.name);
      const dir = (x: string, y: string, d: { kind: string; explanation: string }) =>
        `- ${x} → ${y}: ${mdEscape(d.kind)}${d.explanation.trim() ? ` — ${mdEscape(d.explanation)}` : ""}`;
      lines.push(dir(a, b, r.aToB), dir(b, a, r.bToA));
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** A stored "Explain more" answer as a sub-section of its concept. */
function explanationMd(ex: NodeExplanation): string[] {
  const out = [`#### Explanation (${ex.level})`, "", mdEscape(ex.summary), ""];
  if (ex.intuition.trim()) out.push(`*Intuition:* ${mdEscape(ex.intuition)}`, "");
  const list = (heading: string, items: string[]) => {
    if (items.length) out.push(`**${heading}:**`, "", ...items.map((i) => `- ${i}`), "");
  };
  list("Key points", ex.keyPoints.map(mdEscape));
  list("Examples", ex.examples.map((x) => `*${mdEscape(x.title)}*${x.body.trim() ? `: ${mdEscape(x.body)}` : ""}`));
  list("Pitfalls", ex.pitfalls.map(mdEscape));
  list("Further reading", ex.furtherReading.map((r) => `${mdEscape(r.title)}${r.hint.trim() ? ` — ${mdEscape(r.hint)}` : ""}`));
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
    lines.push(`  ${a} ${arrow}|"${mermaidEscape(r.aToB.kind)}"| ${b}`);
    lines.push(`  ${b} ${arrow}|"${mermaidEscape(r.bToA.kind)}"| ${a}`);
  }
  return lines.join("\n") + "\n";
}

/** A filesystem-friendly base name, e.g. "nodestorm-main-2026-09-24". */
export function exportFileName(g: Graph, date = new Date()): string {
  const slug = g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ["nodestorm", slug, date.toISOString().slice(0, 10)].filter(Boolean).join("-");
}
