import { passiveKind } from "@nodestorm/shared";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import example from "../src/data/groupTheory.json";
import exampleZh from "../src/data/groupTheory.zh.json";
import { translate } from "../src/i18n";
import { DEP_KIND } from "../src/lib/graphOps";

// Relation labels are active ("using", "quoting"), never passive ("is used by", "quoted by"): the built-in ones too.

describe("built-in relation labels", () => {
  it("are active: dependency links, the example graph and the offline demo AI", () => {
    const labels = [
      ...Object.values(DEP_KIND).map((key) => translate("en", key)),
      ...[example, exampleZh].flatMap((e) => e.relations.flatMap((r) => [r.aToB.kind, r.bToA.kind])),
      // Every label literal in the offline demo (BRIDGES, relate, extract, derive, absurd chain).
      ...[...readFileSync(new URL("../../shared/src/ai/mock.ts", import.meta.url), "utf8").matchAll(/\b(?:kind|back): "([^"]+)"/g)].map((m) => m[1]),
    ];
    expect(labels.length).toBeGreaterThan(30);
    expect(labels.filter(passiveKind)).toEqual([]);
    expect(labels.filter((l) => /\bby\b/.test(l))).toEqual([]);
  });
});
