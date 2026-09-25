import { describe, expect, it } from "vitest";
import {
  ExplainRequest,
  ExplainVoice,
  NodeExplanation,
  RefereeRequest,
  RefereeResponse,
} from "../src/model";
import { MockProvider } from "../src/ai/mock";
import { textOf } from "../src/ai/provider";
import {
  NO_SOLUTION,
  checkStepPrompt,
  explainPrompt,
  languageInstruction,
  refereeReportPrompt,
  tutorHintPrompt,
  VOICE_GUIDE,
} from "../src/ai/prompts";
import { cleanReferee, tasks } from "../src/ai/tasks";

const mock = new MockProvider();
const hom = { name: "Homomorphism", definition: "", aliases: [] };
const problem = "Show that the kernel of a group homomorphism is a normal subgroup.";
const sysText = (m: { content: unknown }[]) => textOf(m[0].content as string);

describe("Explain more voices", () => {
  it("defaults to the plain voice, and stored explanations from before voices still parse", () => {
    expect(ExplainRequest.parse({ node: hom }).voice).toBe("plain");
    const old = { summary: "S", level: "rigorous", createdAt: 1 };
    expect(NodeExplanation.parse(old).voice).toBeUndefined();
    expect(NodeExplanation.parse({ ...old, voice: "noir-detective" }).voice).toBe("noir-detective");
    expect(NodeExplanation.safeParse({ ...old, voice: "pirate" }).success).toBe(false);
  });

  it("has a narration guide for every parody voice", () => {
    for (const v of ExplainVoice.options.filter((v) => v !== "plain")) {
      expect(VOICE_GUIDE[v as Exclude<ExplainVoice, "plain">].length).toBeGreaterThan(20);
    }
  });

  it("the plain prompt has no voice paragraph", () => {
    const [sys, user] = explainPrompt(ExplainRequest.parse({ node: hom, level: "rigorous" }));
    expect(textOf(sys.content)).not.toContain("VOICE");
    expect(textOf(user.content)).not.toContain("Voice:");
  });

  it("a voiced prompt keeps the mathematics correct and at the level, with formulas in $…$", () => {
    const [sys, user] = explainPrompt(ExplainRequest.parse({ node: hom, level: "rigorous", voice: "sports-commentator" }));
    const s = textOf(sys.content);
    expect(s).toContain(VOICE_GUIDE["sports-commentator"]);
    expect(s).toContain("changes ONLY the style");
    expect(s).toContain("THE MATHEMATICS STAYS CORRECT");
    expect(s).toContain("Keep the chosen level");
    expect(s).toContain("LaTeX between $…$");
    expect(s).toMatch(/"summary" stays a sober, plain definition/);
    expect(s).toContain("Be rigorous");
    expect(s).toContain("Schema:");
    expect(textOf(user.content)).toContain("Voice: sports-commentator");
  });

  it("the demo wraps the plain explanation without changing its content", async () => {
    const plain = await tasks.explain(mock, { node: hom, level: "intuitive" });
    for (const voice of ExplainVoice.options.filter((v) => v !== "plain")) {
      const res = await tasks.explain(mock, { node: hom, level: "intuitive", voice });
      expect(res.summary).toBe(plain.summary);
      expect(res.intuition).toContain(plain.intuition);
      expect(res.intuition).not.toBe(plain.intuition);
      expect(res.keyPoints).toHaveLength(plain.keyPoints.length);
      // A lead-in may lower-case the first word ("Remarkably, it sends…"); nothing else changes.
      res.keyPoints.forEach((k, i) => expect(k.toLowerCase()).toContain(plain.keyPoints[i].toLowerCase()));
      res.examples.forEach((x, i) => {
        expect(x.title).toBe(plain.examples[i].title);
        expect(x.body).toContain(plain.examples[i].body);
      });
      res.pitfalls.forEach((p, i) => expect(p).toContain(plain.pitfalls[i]));
      // Deterministic.
      expect(await tasks.explain(mock, { node: hom, level: "intuitive", voice })).toEqual(res);
    }
    const noir = await tasks.explain(mock, { node: hom, level: "intuitive", voice: "noir-detective" });
    expect(noir.intuition).toMatch(/^The rain hadn't stopped/);
    expect(noir.keyPoints[0]).toContain("$\\varphi(ab) = \\varphi(a)\\varphi(b)$");
  });
});

describe("Reviewer 2", () => {
  it("parses lenient verdicts and severities", () => {
    const r = RefereeResponse.parse({
      verdict: "Major_Revisions",
      summary: "Sigh.",
      points: [
        { step: null, severity: "PEDANTIC", comment: "x" },
        { step: 2, severity: "catastrophic", comment: "y" },
      ],
    });
    expect(r.verdict).toBe("major revisions");
    expect(r.points[0]).toMatchObject({ severity: "pedantic" });
    expect(r.points[0].step).toBeUndefined();
    expect(r.points[1]).toMatchObject({ step: 2, severity: "minor" });
    expect(r.grudgingPraise).toBe("");
    expect(RefereeResponse.safeParse({ verdict: "maybe", summary: "s" }).success).toBe(false);
  });

  it("the prompt demands accurate points and never solving, like the tutor tasks", () => {
    const req = RefereeRequest.parse({
      problem,
      steps: ["Let $k \\in \\ker\\varphi$."],
      checks: [{ step: 1, verdict: "gap", comment: "Which $g$?" }],
    });
    const [sys, user] = refereeReportPrompt(req);
    const s = textOf(sys.content);
    expect(s).toContain("[task:refereeReport]");
    expect(s).toContain("Reviewer 2");
    expect(s).toContain("THE TECHNICAL POINTS ARE REAL");
    expect(s).toContain("Never invent an error in a correct step");
    expect(s).toContain(NO_SOLUTION);
    expect(s).toContain("never supply the missing argument");
    expect(s).toMatch(/"accept" only when the derivation completely and correctly solves/);
    const u = textOf(user.content);
    expect(u).toContain("Step 1: Let $k \\in \\ker\\varphi$.");
    expect(u).toContain("Step 1: gap (Which $g$?)");
    // The same rule is in the tutor tasks.
    expect(sysText(tutorHintPrompt({ problem, steps: [], references: [], context: [], nth: 1 }))).toContain(NO_SOLUTION);
    expect(sysText(checkStepPrompt({ problem, steps: [], step: "x", references: [], context: [] }))).toContain(NO_SOLUTION);
  });

  it("keeps the referee enums in English in other languages", () => {
    expect(languageInstruction("中文")).toContain('referee "verdict" and "severity" values');
  });

  it("cleanReferee sorts, dedupes, caps and drops steps that don't exist", () => {
    const points = [
      { severity: "pedantic" as const, comment: "p", step: 1 },
      { severity: "fatal" as const, comment: "f", step: 9 },
      { severity: "major" as const, comment: "m", step: 2 },
      { severity: "major" as const, comment: "m", step: 2 },
      ...Array.from({ length: 10 }, (_, i) => ({ severity: "minor" as const, comment: `n${i}`, step: 1 })),
    ];
    const r = cleanReferee({ verdict: "reject", summary: " s ", points, grudgingPraise: " g " }, 2);
    expect(r.points).toHaveLength(8);
    expect(r.points[0]).toEqual({ severity: "fatal", comment: "f", step: undefined });
    expect(r.points[1]).toEqual({ severity: "major", comment: "m", step: 2 });
    expect(r.points.filter((p) => p.comment === "m")).toHaveLength(1);
    expect(r.summary).toBe("s");
    expect(r.grudgingPraise).toBe("g");
    expect(cleanReferee({ verdict: "accept", summary: "s", points: [], grudgingPraise: "" }, 0).verdict).toBe("reject");
  });

  it("the demo rejects an empty derivation", async () => {
    const r = await tasks.refereeReport(mock, { problem });
    expect(r.verdict).toBe("reject");
    expect(r.points[0]).toMatchObject({ severity: "fatal" });
    expect(r.grudgingPraise).toBeTruthy();
  });

  it("the demo reports from the steps' checks, deterministically", async () => {
    // A step without a reason has a gap (the demo's checkStep), and the derivation is unfinished.
    const gap = await tasks.refereeReport(mock, { problem, steps: ["Let $k$ be in the kernel and $g$ in G, then $gkg^{-1}$ is in it too."] });
    expect(gap.verdict).toBe("major revisions");
    expect(gap.points[0]).toMatchObject({ step: 1, severity: "major" });
    expect(gap.points.some((p) => p.step === undefined && /stops before/.test(p.comment))).toBe(true);
    expect(await tasks.refereeReport(mock, { problem, steps: ["Let $k$ be in the kernel and $g$ in G, then $gkg^{-1}$ is in it too."] })).toEqual(gap);

    const wrong = await tasks.refereeReport(mock, { problem, steps: ["By definition, $\\varphi(k) = e$.", "This is wrong somehow."] });
    expect(wrong.verdict).toBe("reject");
    expect(wrong.points[0]).toMatchObject({ step: 2, severity: "fatal" });
    expect(wrong.grudgingPraise).toContain("Step 1");

    const solved = await tasks.refereeReport(mock, {
      problem,
      steps: ["Since $\\varphi(gkg^{-1}) = \\varphi(g)\\varphi(g)^{-1} = e$, hence the kernel is normal."],
    });
    expect(solved.verdict).toBe("accept");
    expect(solved.points.every((p) => p.severity === "pedantic")).toBe(true);
  });

  it("the demo trusts the tutor's earlier checks", async () => {
    const r = await tasks.refereeReport(mock, {
      problem,
      steps: ["Some step", "Another step"],
      checks: [
        { step: 1, verdict: "ok" },
        { step: 2, verdict: "ok", solved: true },
      ],
    });
    expect(r.verdict).toBe("accept");
    const unclear = await tasks.refereeReport(mock, {
      problem,
      steps: ["Hmm", "Final step"],
      checks: [{ step: 2, verdict: "ok", solved: true }],
    });
    expect(unclear.verdict).toBe("minor revisions");
    expect(unclear.points[0]).toMatchObject({ step: 1, severity: "minor" });
  });
});

describe("referee report: review-3 fixes", () => {
  it("keeps the more severe of two copies of a point, and reads step 0 as the whole derivation", () => {
    const res = RefereeResponse.parse({
      verdict: "major revisions",
      summary: "s",
      points: [
        { step: 1, severity: "minor", comment: "Same point." },
        { step: 1, severity: "fatal", comment: "Same point." },
        { step: 0, severity: "major", comment: "Whole thing." },
      ],
      grudgingPraise: "",
    });
    const out = cleanReferee(res, 2);
    expect(out.points.map((p) => [p.severity, p.step ?? null])).toEqual([["fatal", 1], ["major", null]]);
  });
});
