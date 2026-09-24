import { describe, expect, it } from "vitest";
import { mdEscape, toMarkdown, toMermaid } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";
import { hasMath, splitMath, type MathSegment } from "../src/lib/math";

const text = (t: string): MathSegment => ({ kind: "text", text: t });
const inl = (tex: string, raw = `$${tex}$`): MathSegment => ({ kind: "math", tex, display: false, raw });
const disp = (tex: string, raw = `$$${tex}$$`): MathSegment => ({ kind: "math", tex, display: true, raw });

describe("splitMath", () => {
  it("returns plain text as one segment and nothing for an empty string", () => {
    expect(splitMath("A group has an identity.")).toEqual([text("A group has an identity.")]);
    expect(splitMath("")).toEqual([]);
  });

  it("finds inline $…$ formulas between text", () => {
    expect(splitMath("If $\\varphi(ab) = \\varphi(a)\\varphi(b)$ then $\\ker\\varphi$ is normal.")).toEqual([
      text("If "),
      inl("\\varphi(ab) = \\varphi(a)\\varphi(b)"),
      text(" then "),
      inl("\\ker\\varphi"),
      text(" is normal."),
    ]);
    expect(splitMath("$G$")).toEqual([inl("G")]);
  });

  it("finds display $$…$$, \\[…\\] and inline \\(…\\)", () => {
    expect(splitMath("So $$G / \\ker\\varphi \\cong \\operatorname{im}\\varphi$$ holds.")).toEqual([
      text("So "),
      disp("G / \\ker\\varphi \\cong \\operatorname{im}\\varphi"),
      text(" holds."),
    ]);
    expect(splitMath("\\[ a^2 \\] and \\(b\\)")).toEqual([
      disp("a^2", "\\[ a^2 \\]"),
      text(" and "),
      inl("b", "\\(b\\)"),
    ]);
    // A TeX line break inside \[…\] doesn't end it.
    expect(splitMath("\\[a \\\\ b\\]")).toEqual([disp("a \\\\ b", "\\[a \\\\ b\\]")]);
  });

  it("turns \\$ into a literal dollar outside formulas and leaves it to KaTeX inside", () => {
    expect(splitMath("It costs \\$5.")).toEqual([text("It costs $5.")]);
    expect(splitMath("$a \\$ b$ and \\$")).toEqual([inl("a \\$ b"), text(" and $")]);
  });

  it("keeps unbalanced or empty delimiters as text", () => {
    expect(splitMath("an open $x and nothing")).toEqual([text("an open $x and nothing")]);
    expect(splitMath("$$x unclosed")).toEqual([text("$$x unclosed")]);
    expect(splitMath("\\( open")).toEqual([text("\\( open")]);
    expect(splitMath("\\[ open")).toEqual([text("\\[ open")]);
    expect(splitMath("empty $$$$ and $ $")).toEqual([text("empty $$$$ and $ $")]);
    expect(splitMath("trailing $")).toEqual([text("trailing $")]);
  });

  it("leaves prices alone (a $ before a space can't open, one after a space or before a digit can't close)", () => {
    for (const s of ["$5 and $10", "costs $5, or $10.", "between $5 and $10 each", "pay $ 5 now$", "$x $ y"]) {
      expect(splitMath(s), s).toEqual([text(s)]);
    }
    expect(hasMath("Tickets are $20 and $30")).toBe(false);
    // Only the next $ can close: the price stays text and the formula after it still renders.
    expect(splitMath("$5 for $x$")).toEqual([text("$5 for "), inl("x")]);
  });

  it("doesn't let a formula span a blank line", () => {
    expect(splitMath("$a\n\nb$")).toEqual([text("$a\n\nb$")]);
    expect(splitMath("$a\nb$")).toEqual([inl("a\nb")]);
  });

  it("keeps other backslashes as written", () => {
    expect(splitMath("C:\\path \\n")).toEqual([text("C:\\path \\n")]);
  });

  it("hasMath says whether there's anything to typeset", () => {
    expect(hasMath(undefined)).toBe(false);
    expect(hasMath("no math")).toBe(false);
    expect(hasMath("an open $x")).toBe(false);
    expect(hasMath("$\\ker\\varphi$")).toBe(true);
    expect(hasMath("\\(x\\)")).toBe(true);
  });
});

describe("exports keep LaTeX", () => {
  it("Markdown keeps formulas as written and escapes only the text around them", () => {
    expect(mdEscape("If $\\varphi(a_1) = e$ then *a* is in $\\ker\\varphi$")).toBe(
      "If $\\varphi(a_1) = e$ then \\*a\\* is in $\\ker\\varphi$",
    );
    expect(mdEscape("$$G/N$$ costs \\$5 or $10")).toBe("$$G/N$$ costs \\$5 or \\$10");
    expect(mdEscape("# $x$")).toBe("\\# $x$");
    const { graph } = ops.addNode(ops.emptyGraph("Algebra"), { name: "Kernel", definition: "The set $\\ker\\varphi$." });
    expect(toMarkdown(graph)).toContain("\n\nThe set $\\ker\\varphi$.\n");
    expect(toMermaid(graph)).toContain("Kernel");
  });
});
