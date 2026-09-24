import type { DepRole } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { useLocale } from "../src/i18n";
import {
  ankiField,
  ankiMath,
  buildCards,
  csvField,
  deckName,
  flashcardsFileName,
  tagName,
  toAnki,
  toCsv,
  type Flashcard,
} from "../src/lib/flashcards";
import * as ops from "../src/lib/graphOps";

const dep = (name: string, role: DepRole, reason: string) => ({ name, role, reason, matchesExisting: null });

/**
 * Theorem → Isomorphism → Homomorphism (added in reverse order), one mixed relation, a missing prerequisite on the
 * theorem, and an unrelated Group without a definition.
 */
function scenario() {
  const thm = ops.addNode(ops.emptyGraph("Group theory"), { name: "First Isomorphism Theorem", definition: "$G/\\ker φ ≅ \\operatorname{im} φ$" });
  const iso = ops.addNode(thm.graph, { name: "Isomorphism", aliases: ["iso", "bijective hom"], definition: "A bijective\nhomomorphism." });
  const hom = ops.addNode(iso.graph, { name: "Homomorphism", definition: "A structure-preserving map." });
  const grp = ops.addNode(hom.graph, { name: "Group", definition: "" });
  let g = ops.applyDeps(grp.graph, hom.id, []);
  g = ops.applyDeps(g, iso.id, [dep("Homomorphism", "uses", "is a special homomorphism")]);
  g = ops.applyDeps(g, thm.id, [
    dep("Isomorphism", "derives", "concludes an isomorphism"),
    dep("Homomorphism", "uses", "starts from φ"),
    dep("Kernel", "uses", "quotients by it"),
  ]);
  g = ops.upsertRelation(
    g,
    hom.id,
    iso.id,
    { kind: "generalizes", explanation: "every iso is a hom" },
    { kind: "specializes", explanation: "adds bijectivity" },
  );
  return { g, thm: thm.id, iso: iso.id, hom: hom.id, grp: grp.id };
}

const fronts = (cards: Flashcard[]) => cards.map((c) => c.front);

describe("buildCards", () => {
  it("makes definition cards in study order, with aliases on the back, skipping concepts without a definition", () => {
    const cards = buildCards(scenario().g, { kinds: ["definition"] });
    expect(fronts(cards)).toEqual(["Homomorphism", "Isomorphism", "First Isomorphism Theorem"]);
    expect(cards[1].back).toBe("A bijective\nhomomorphism.\n\nAlso called: iso, bijective hom");
    expect(cards[0].back).toBe("A structure-preserving map.");
  });

  it("lists a concept's prerequisites in study order, then the missing ones", () => {
    const cards = buildCards(scenario().g, { kinds: ["prerequisites"] });
    expect(fronts(cards)).toEqual(["What does Isomorphism build on?", "What does First Isomorphism Theorem build on?"]);
    expect(cards[1].back).toBe("1. Homomorphism\n2. Isomorphism\n3. Kernel (not in the graph yet)");
  });

  it("makes one card per relation direction, after both of its concepts", () => {
    const cards = buildCards(scenario().g, { kinds: ["relation"] });
    expect(cards.find((c) => c.front === "How does Homomorphism relate to Isomorphism?")?.back).toBe("generalizes\nevery iso is a hom");
    expect(cards.find((c) => c.front === "How does Isomorphism relate to Homomorphism?")?.back).toBe("specializes\nadds bijectivity");
    // Dependency links are relations too; every relation between the three concepts gives two cards.
    expect(cards).toHaveLength(scenario().g.relations.length * 2);
    const all = buildCards(scenario().g);
    const pos = (front: string) => all.findIndex((c) => c.front === front);
    expect(pos("How does Homomorphism relate to Isomorphism?")).toBeGreaterThan(pos("Isomorphism"));
    expect(pos("How does First Isomorphism Theorem relate to Isomorphism?")).toBeGreaterThan(pos("First Isomorphism Theorem"));
    expect(pos("Isomorphism")).toBeGreaterThan(pos("Homomorphism"));
  });

  it("orders all card types concept by concept", () => {
    const kinds = buildCards(scenario().g).map((c) => `${c.kind}:${c.front.slice(0, 12)}`);
    expect(kinds.slice(0, 2)).toEqual(["definition:Homomorphism", "definition:Isomorphism"]);
    expect(kinds[2]).toBe("prerequisites:What does Is");
  });

  it("skips relation directions without any text", () => {
    const { g, hom, grp } = scenario();
    const withEmpty = ops.upsertRelation(g, grp, hom, { kind: "", explanation: " " }, { kind: "acts on", explanation: "" });
    const cards = buildCards(withEmpty, { kinds: ["relation"] }).filter((c) => c.front.includes("Group"));
    expect(cards.map((c) => [c.front, c.back])).toEqual([["How does Homomorphism relate to Group?", "acts on"]]);
  });

  it("limits the cards to a learning path", () => {
    const { g, iso } = scenario();
    const cards = buildCards(g, { rootId: iso });
    expect(fronts(cards)).toEqual([
      "Homomorphism",
      "Isomorphism",
      "What does Isomorphism build on?",
      ...cards.slice(3).map((c) => c.front),
    ]);
    expect(cards.every((c) => !c.front.includes("Theorem") && !c.back.includes("Theorem"))).toBe(true);
    expect(cards.filter((c) => c.kind === "relation")).toHaveLength(2); // the mixed relation merged into the dependency link: one card per direction
  });

  it("tags cards with the project, the concept's status and the card type", () => {
    const cards = buildCards(scenario().g, { project: "Group theory" });
    expect(cards.find((c) => c.front === "Homomorphism")?.tags).toEqual(["Group_theory", "status::ready", "card::definition"]);
    expect(cards.find((c) => c.front === "First Isomorphism Theorem")?.tags).toContain("status::blocked");
    expect(buildCards(scenario().g)[0].tags).toEqual(["status::ready", "card::definition"]);
  });

  it("makes no cards from an empty graph or with no card type", () => {
    expect(buildCards(ops.emptyGraph("x"))).toEqual([]);
    expect(buildCards(scenario().g, { kinds: [] })).toEqual([]);
    expect(toAnki([], "x").split("\n").filter((l) => l && !l.startsWith("#"))).toEqual([]);
    expect(toCsv([])).toBe("﻿front,back,tags\r\n");
  });

  it("words the cards in the interface language", () => {
    useLocale.getState().setPref("zh");
    try {
      const cards = buildCards(scenario().g, { kinds: ["prerequisites"] });
      expect(cards[0].front).toBe("Isomorphism 建立在哪些知识之上？");
    } finally {
      useLocale.getState().setPref("en");
    }
  });
});

describe("Anki file", () => {
  it("converts $…$ and $$…$$ to the delimiters Anki's MathJax renders", () => {
    expect(ankiMath("if $a^2 = b$ then $$\\sum_i x_i$$")).toBe("if \\(a^2 = b\\) then \\[\\sum_i x_i\\]");
    expect(ankiMath("costs $5 and $10")).toBe("costs $5 and $10");
    expect(ankiMath("a \\$ sign and $x$")).toBe("a $ sign and \\(x\\)");
    expect(ankiMath("$ spaced $ not math")).toBe("$ spaced $ not math");
    expect(ankiMath("$x$5")).toBe("$x$5");
    expect(ankiMath("$\\{x \\mid x \\$ y\\}$")).toBe("\\(\\{x \\mid x \\$ y\\}\\)");
  });

  it("escapes HTML, tabs, newlines, quotes and a leading #", () => {
    expect(ankiField("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
    expect(ankiField("one\ttwo\nthree\r\nfour")).toBe("one two<br>three<br>four");
    expect(ankiField('"quoted"')).toBe("&quot;quoted&quot;");
    expect(ankiField("#P vs #NP")).toBe("&#35;P vs #NP");
    expect(ankiField("<b>$x<y$</b>")).toBe("&lt;b&gt;\\(x&lt;y\\)&lt;/b&gt;");
  });

  it("starts with the header lines and has one tab-separated line per card", () => {
    const cards = buildCards(scenario().g, { project: "Group theory" });
    const text = toAnki(cards, "Maths::Group theory");
    const lines = text.trimEnd().split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "#separator:tab",
      "#html:true",
      "#notetype:Basic",
      "#deck:Maths::Group theory",
      "#tags column:3",
    ]);
    expect(text.startsWith("﻿")).toBe(false);
    expect(lines).toHaveLength(5 + cards.length);
    for (const l of lines.slice(5)) expect(l.split("\t")).toHaveLength(3);
    expect(lines).toContain("Isomorphism\tA bijective<br>homomorphism.<br><br>Also called: iso, bijective hom\tGroup_theory status::ready card::definition");
    expect(lines).toContain("First Isomorphism Theorem\t\\(G/\\ker φ ≅ \\operatorname{im} φ\\)\tGroup_theory status::blocked card::definition");
  });

  it("keeps the deck header on one line", () => {
    expect(deckName("  My\tdeck\nname ")).toBe("My deck name");
    expect(deckName("   ")).toBe("NodeStorm");
    expect(toAnki([], "a\nb")).toContain("#deck:a b\n");
  });
});

describe("CSV", () => {
  it("quotes fields per RFC 4180", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(" padded")).toBe('" padded"');
  });

  it("writes a header and one record per card, with CRLF line ends and plain-text math", () => {
    const cards: Flashcard[] = [
      { kind: "definition", front: "Kernel, of φ", back: 'Elements sent to "e"\n$\\ker φ$', tags: ["Group theory", "status::ready"] },
    ];
    expect(toCsv(cards)).toBe('﻿front,back,tags\r\n"Kernel, of φ","Elements sent to ""e""\n$\\ker φ$",Group_theory status::ready\r\n');
  });

  it("parses back to the same cards", () => {
    const cards = buildCards(scenario().g, { project: "Group theory" });
    const rows = parseCsv(toCsv(cards).slice(1));
    expect(rows[0]).toEqual(["front", "back", "tags"]);
    expect(rows.slice(1)).toEqual(cards.map((c) => [c.front, c.back, c.tags.join(" ").replace("Group theory", "Group_theory")]));
  });
});

describe("names", () => {
  it("makes tags and file names from the project name", () => {
    expect(tagName("  Group  theory ")).toBe("Group_theory");
    expect(flashcardsFileName("Group theory", "anki.txt")).toBe("group-theory-anki.txt");
    expect(flashcardsFileName("群论 笔记", "flashcards.csv")).toBe("群论-笔记-flashcards.csv");
    expect(flashcardsFileName("!!!", "anki.txt")).toBe("nodestorm-anki.txt");
  });
});

/** A small RFC 4180 reader for the round trip. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      (row = []), (field = ""), i++;
    } else field += c;
  }
  return rows;
}

describe("CSV formula injection (final review)", () => {
  it("neutralises fields a spreadsheet would run as formulas", () => {
    expect(csvField('=HYPERLINK("http://x","a")')).toBe(`"'=HYPERLINK(""http://x"",""a"")"`);
    expect(csvField("-2+3")).toBe("'-2+3");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("plain text")).toBe("plain text");
  });
});
