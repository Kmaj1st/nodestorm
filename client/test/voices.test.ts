import { beforeEach, describe, expect, it, vi } from "vitest";
import { FUN_ENDS, surprisePair } from "../src/lib/absurd";
import { explainNode } from "../src/lib/actions";
import {
  addStep,
  checksForReferee,
  editStep,
  newDerivation,
  refereeOutdated,
  setCheck,
  setReferee,
  stepsKey,
  toMarkdown,
} from "../src/lib/derivation";
import { toMarkdown as graphMarkdown } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

/** A deterministic "random" source cycling through the given values. */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe("Surprise me", () => {
  it("picks two different concepts of the graph when it has two or more", () => {
    const names = ["Group", "Ring", "Field"];
    for (let k = 0; k < 30; k++) {
      const [a, b] = surprisePair(names);
      expect(names).toContain(a);
      expect(names).toContain(b);
      expect(a).not.toBe(b);
    }
    expect(surprisePair(["Group", "group", "Ring"], undefined, seq(0.99, 0.2, 0.9)).sort()).toEqual(["Group", "Ring"]);
  });

  it("uses fun ends for an empty graph, and keeps a lone concept as one end", () => {
    const [a, b] = surprisePair([], undefined, seq(0.1, 0.5, 0.3));
    expect(FUN_ENDS).toContain(a);
    expect(FUN_ENDS).toContain(b);
    expect(a).not.toBe(b);
    for (let k = 0; k < 20; k++) {
      const [x, y] = surprisePair(["Kernel"]);
      expect(x).toBe("Kernel");
      expect(FUN_ENDS).toContain(y);
    }
    // A lone concept that is itself a fun end isn't paired with itself.
    for (let k = 0; k < 20; k++) expect(surprisePair(["Toast"])[1]).not.toBe("Toast");
  });

  it("avoids the pair already shown when there is another", () => {
    for (let k = 0; k < 20; k++) {
      const pair = surprisePair(["A", "B", "C"], ["B", "A"]);
      expect(pair.sort()).not.toEqual(["A", "B"]);
    }
    // With only two concepts there is no other pair.
    expect(surprisePair(["A", "B"], ["A", "B"]).sort()).toEqual(["A", "B"]);
  });
});

describe("referee report on a derivation", () => {
  const report = {
    verdict: "major revisions" as const,
    summary: "The author appears to believe in magic.",
    points: [
      { step: 1, severity: "major" as const, comment: "Uses normality without saying so." },
      { severity: "pedantic" as const, comment: "Too many commas." },
    ],
    grudgingPraise: "Step 1 is not wrong.",
  };

  it("sends the earlier checks numbered like the steps sent", () => {
    let d = newDerivation("p", { statement: "Show it." });
    const r1 = addStep(d, "One");
    const r2 = addStep(r1.derivation, "Two");
    d = setCheck(r2.derivation, r2.id, { verdict: "gap", comment: "Why?", missing: [], cites: [], concepts: [], solved: false });
    expect(checksForReferee(d.steps)).toEqual([{ step: 2, verdict: "gap", comment: "Why?", solved: false }]);
  });

  it("knows when a report is about older steps, and copies only an up-to-date one", () => {
    const r1 = addStep(newDerivation("p", { statement: "Show it." }), "One");
    let d = setReferee(r1.derivation, report, stepsKey(r1.derivation.steps), 5);
    expect(d.referee).toMatchObject({ verdict: "major revisions", createdAt: 5 });
    expect(refereeOutdated(d)).toBe(false);
    const md = toMarkdown(d);
    expect(md).toContain("**Referee report (Reviewer 2): Major revisions.** The author appears to believe in magic.");
    expect(md).toContain("- Step 1 (Major): Uses normality without saying so.");
    expect(md).toContain("- Whole derivation (Pedantic): Too many commas.");
    expect(md).toContain("*Step 1 is not wrong.*");
    // Not in the graph's notes.
    expect(toMarkdown(d, { hints: false })).not.toContain("Referee");
    d = editStep(d, r1.id, "One, but better");
    expect(refereeOutdated(d)).toBe(true);
    expect(toMarkdown(d)).not.toContain("Referee");
    expect(stepsKey(d.steps)).not.toBe(stepsKey(r1.derivation.steps));
  });
});

describe("voiced explanations in files", () => {
  const explanation = { summary: "S", level: "intuitive", createdAt: 1 };
  const doc = (ex: unknown) => ({
    format: "nodestorm/v1",
    graphs: [{
      id: "g", name: "Main", relations: [],
      nodes: [{ id: "a", name: "A", definition: "", aliases: [], status: "ok", position: { x: 0, y: 0 }, dependsOn: [], missingDeps: [], explanation: ex }],
    }],
  });

  it("keeps a known voice and resets an unknown one to plain, keeping the text", () => {
    const ok = repairImport(doc({ ...explanation, voice: "shakespearean" }));
    expect(ok.fixes).toEqual([]);
    expect(ok.doc.graphs[0].nodes[0].explanation?.voice).toBe("shakespearean");
    const odd = repairImport(doc({ ...explanation, voice: "pirate" }));
    expect(odd.fixes).toEqual(["reset unknown explanation narrators to the plain voice"]);
    expect(odd.doc.graphs[0].nodes[0].explanation).toMatchObject({ summary: "S" });
    expect(odd.doc.graphs[0].nodes[0].explanation?.voice).toBeUndefined();
    expect(repairImport(doc(explanation)).fixes).toEqual([]);
  });

  it("names the voice in the Markdown export", () => {
    let g = ops.emptyGraph();
    const r = ops.addNode(g, { name: "A", position: { x: 0, y: 0 } });
    g = ops.updateNode(r.graph, r.id, {
      explanation: { summary: "S", intuition: "", keyPoints: [], examples: [], pitfalls: [], furtherReading: [], level: "rigorous", voice: "noir-detective", createdAt: 1 },
    });
    expect(graphMarkdown(g)).toContain("#### Rigorous explanation (Noir detective)");
  });
});

describe("explainNode with a voice", () => {
  const store = () => useGraphStore.getState();
  beforeEach(() => {
    store().reset();
    useSettings.setState({ connection: "browser", provider: "mock" });
  });

  it("stores the voice with the explanation, and none for the plain voice", async () => {
    const r = ops.addNode(store().graphs[store().activeId], { name: "Homomorphism", position: { x: 0, y: 0 } });
    store().mutate(() => r.graph);
    await explainNode(r.id, "rigorous", store().activeId, "medieval-scholar");
    const ex = store().graphs[store().activeId].nodes[0].explanation!;
    expect(ex).toMatchObject({ level: "rigorous", voice: "medieval-scholar" });
    expect(ex.intuition).toMatch(/^Herein beginneth/);
    await explainNode(r.id, "rigorous");
    expect(store().graphs[store().activeId].nodes[0].explanation?.voice).toBeUndefined();
  });
});
