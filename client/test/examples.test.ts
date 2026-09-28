import { GraphExport } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { loadLang, useLocale } from "../src/i18n";
import { buildExample, EXAMPLES_BY_LANG } from "../src/lib/examples";
import * as ops from "../src/lib/graphOps";

// The example graph is written once per interface language; both versions are the same graph.

const en = EXAMPLES_BY_LANG.en.groupTheory;
const zh = EXAMPLES_BY_LANG.zh.groupTheory;
const han = /\p{Script=Han}/u;

describe("example graph in each language", () => {
  it("has the same concepts, kinds, prerequisites and relations in the same order", () => {
    expect(zh.concepts).toHaveLength(en.concepts.length);
    expect(zh.relations).toHaveLength(en.relations.length);
    const index = (d: typeof en) => new Map(d.concepts.map((c, i) => [c.name, i]));
    const [ie, iz] = [index(en), index(zh)];
    en.concepts.forEach((c, i) => {
      const z = zh.concepts[i];
      expect(z.kind).toBe(c.kind);
      expect((z.dependsOn ?? []).map((d) => [iz.get(d.name), d.role])).toEqual((c.dependsOn ?? []).map((d) => [ie.get(d.name), d.role]));
      expect((z.missing ?? []).map((d) => d.role)).toEqual((c.missing ?? []).map((d) => d.role));
    });
    en.relations.forEach((r, i) => {
      const z = zh.relations[i];
      expect([iz.get(z.a), iz.get(z.b)]).toEqual([ie.get(r.a), ie.get(r.b)]);
    });
  });

  it("is written in Chinese: every concept has a Chinese name and definition, every relation Chinese labels", () => {
    expect(zh.name).toBe("群论");
    for (const c of zh.concepts) {
      expect(c.name).toMatch(han);
      expect(c.definition).toMatch(han);
      for (const d of [...(c.dependsOn ?? []), ...(c.missing ?? [])]) expect(d.reason).toMatch(han);
      for (const d of c.missing ?? []) expect(d.name).toMatch(han);
    }
    for (const r of zh.relations) for (const side of [r.aToB, r.bToA]) expect(side.kind + side.explanation).toMatch(han);
  });

  it("builds a valid graph with Chinese prerequisite labels", async () => {
    const prev = useLocale.getState().lang;
    await loadLang("zh");
    useLocale.setState({ lang: "zh" });
    try {
      const g = buildExample(ops.emptyGraph(), zh);
      expect(g.nodes).toHaveLength(zh.concepts.length);
      expect(g.nodes.filter((n) => n.status === "blocked").map((n) => n.name)).toEqual(["第一同构定理"]);
      expect(g.relations.filter((r) => r.origin === "dependency").every((r) => r.aToB.kind === "使用")).toBe(true);
      expect(() => GraphExport.parse({ format: "nodestorm/v1", graphs: [g] })).not.toThrow();
    } finally {
      useLocale.setState({ lang: prev });
    }
  });
});
