import { describe, expect, it } from "vitest";
import { cleanAssessment, matchPassage, tasks } from "../src/ai/tasks";
import { MockProvider } from "../src/ai/mock";
import { assessPrompt } from "../src/ai/prompts";
import type { ChatMessage, Provider } from "../src/ai/provider";

// "Assess sources": the AI rates sources and points at passages; a passage is only ever the source's own words.

const TEXT =
  "Group theory basics.  In mathematics, a  “group” is a set\nwith an associative operation — an identity and inverses. Groups are everywhere.";

describe("matchPassage", () => {
  it("keeps a verbatim passage as it is", () => {
    expect(matchPassage(TEXT, "Groups are everywhere.")).toBe("Groups are everywhere.");
  });

  it("finds a passage whose whitespace differs and returns the source's own characters", () => {
    expect(matchPassage(TEXT, "In mathematics, a “group” is a set with an associative operation")).toBe(
      "In mathematics, a  “group” is a set\nwith an associative operation",
    );
  });

  it("tolerates straight quotes, plain dashes and case, mapping back to the source's characters", () => {
    expect(matchPassage(TEXT, 'in mathematics, a "group" is a set with an associative operation - an identity and inverses.')).toBe(
      "In mathematics, a  “group” is a set\nwith an associative operation — an identity and inverses.",
    );
  });

  it("drops quotes or an ellipsis around the quote", () => {
    expect(matchPassage(TEXT, "“Groups are everywhere.”")).toBe("Groups are everywhere.");
    expect(matchPassage(TEXT, "…Groups are everywhere.")).toBe("Groups are everywhere.");
  });

  it("drops text the AI wrote (a paraphrase, a translation, an elision)", () => {
    expect(matchPassage(TEXT, "A group is a set with an associative binary operation.")).toBe("");
    expect(matchPassage(TEXT, "群是一个集合")).toBe("");
    expect(matchPassage(TEXT, "In mathematics, a group … inverses.")).toBe("");
    expect(matchPassage(TEXT, "")).toBe("");
    expect(matchPassage(TEXT, "a")).toBe("");
  });
});

describe("cleanAssessment", () => {
  const sources = [
    { id: "e1", kind: "encyclopedia" as const, site: "Wikipedia", title: "Group", url: "https://en.wikipedia.org/wiki/Group", text: TEXT },
    { id: "w1", kind: "web" as const, site: "demo-forum.example", title: "Forum", url: "https://demo-forum.example/t/1", text: "lol a group is just some numbers." },
  ];

  it("keeps one rating per known source, checks every passage and ignores unknown ids", () => {
    const res = cleanAssessment(
      {
        note: " They agree. ",
        ratings: [
          { id: "e1", reliability: "high", reasons: " Encyclopedia. ", sense: "algebra", passage: "Groups  are everywhere." },
          { id: "e1", reliability: "low", reasons: "repeat", sense: "", passage: "" },
          { id: "zz", reliability: "high", reasons: "unknown", sense: "", passage: "" },
          { id: "w1", reliability: "low", reasons: "Forum.", sense: "algebra", passage: "A group is a set of numbers with rules." },
        ],
      },
      { sources },
    );
    expect(res.note).toBe("They agree.");
    expect(res.ratings).toEqual([
      { id: "e1", reliability: "high", reasons: "Encyclopedia.", sense: "algebra", passage: "Groups are everywhere." },
      // Invented text is dropped, never kept.
      { id: "w1", reliability: "low", reasons: "Forum.", sense: "algebra", passage: "" },
    ]);
  });

  it("leaves out sources the AI didn't rate", () => {
    const res = cleanAssessment({ note: "", ratings: [{ id: "w1", reliability: "low", reasons: "", sense: "", passage: "" }] }, { sources });
    expect(res.ratings.map((r) => r.id)).toEqual(["w1"]);
  });
});

describe("assess task", () => {
  const sources = [
    { id: "e1", kind: "encyclopedia", site: "Wikipedia", title: "Group", url: "https://en.wikipedia.org/wiki/Group", text: TEXT },
    { id: "w1", kind: "web", site: "demo-forum.example", title: "Forum", url: "https://demo-forum.example/t/1", text: "A group is basically any set of numbers. Trust me." },
    { id: "w2", kind: "web", site: "demo-lecture-notes.example", title: "Notes", url: "https://demo-lecture-notes.example/groups", text: "Definition. A group is a set with an associative operation, an identity and inverses." },
  ];

  it("the offline demo rates the forum low with a reason and quotes each source verbatim", async () => {
    const res = await tasks.assess(new MockProvider(), { name: "Group", sources });
    const by = Object.fromEntries(res.ratings.map((r) => [r.id, r]));
    expect(by.w1.reliability).toBe("low");
    expect(by.w1.reasons).toMatch(/forum/i);
    expect(by.e1.reliability).toBe("high");
    for (const r of res.ratings) {
      const text = sources.find((s) => s.id === r.id)!.text;
      expect(r.passage && text.includes(r.passage)).toBeTruthy();
    }
    expect(res.note).toMatch(/demo-forum\.example/);
  });

  it("an answer with an invented passage and an odd reliability is cleaned, not rejected", async () => {
    const fake: Provider = {
      id: "fake",
      label: "Fake",
      model: "x",
      configured: true,
      listModels: async () => [],
      complete: async (_m: ChatMessage[]) =>
        JSON.stringify({ ratings: [{ id: "e1", reliability: "Very high", reasons: "r", sense: "s", passage: "I wrote this myself." }], note: "n" }),
    };
    const res = await tasks.assess(fake, { name: "Group", sources });
    expect(res.ratings).toEqual([{ id: "e1", reliability: null, reasons: "r", sense: "s", passage: "" }]);
  });

  it("the prompt says to quote only and to compare the sources", () => {
    const [sys] = assessPrompt({ name: "Group", context: [], sources: sources as never });
    expect(sys.content).toContain("[task:assess]");
    expect(sys.content).toMatch(/VERBATIM/);
    expect(sys.content).toMatch(/never paraphrase/);
    expect(sys.content).toMatch(/comparing the sources against each other/);
    expect(sys.content).toMatch(/Different meanings of the name are not errors/);
  });
});
