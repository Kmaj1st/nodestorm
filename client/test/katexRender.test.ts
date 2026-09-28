import { describe, expect, it } from "vitest";
import { renderTex } from "../src/lib/katexRender";

// Formulas are typeset from untrusted text too (web pages' excerpts in the sources pop-up, imported projects), and
// KaTeX's HTML is the one thing injected as markup.

describe("security: KaTeX on untrusted formulas", () => {
  it("makes no links, images, ids, classes, styles or data attributes from \\href, \\url, \\includegraphics, \\html…", () => {
    for (const tex of [
      "\\href{javascript:alert(1)}{x}",
      "\\url{https://evil.example}",
      "\\includegraphics{https://evil.example/a.png}",
      "\\htmlClass{app}{x}",
      "\\htmlId{root}{x}",
      "\\htmlStyle{position:fixed;inset:0}{x}",
      "\\htmlData{onclick=alert(1)}{x}",
    ]) {
      const html = renderTex(tex, false) ?? "";
      // The source is only kept as the escaped MathML annotation.
      const markup = html.replace(/<annotation[\s\S]*?<\/annotation>/, "");
      expect(markup, tex).not.toMatch(/<a\b|<img|href=|javascript:|id="root"|class="app"|position:fixed|data-onclick|onclick/i);
    }
  });

  it("gives up (the source is shown) on formulas whose typeset HTML would be huge", () => {
    const matrix = `\\begin{pmatrix}${"a&".repeat(1000)}b\\end{pmatrix}`; // 2 kB in, over 600 kB out
    const fracs = `${"\\frac{".repeat(400)}${"1}{2}".repeat(400)}`;
    expect(renderTex(matrix, true)).toBeNull();
    expect(renderTex(fracs, false)).toBeNull();
    expect(renderTex(`x+${"y+".repeat(4000)}z`, false)).toBeNull(); // too long to try
  });

  it("deep nesting fails safely instead of throwing", () => {
    expect(renderTex(`${"\\sqrt{".repeat(800)}x${"}".repeat(800)}`, false)).toBeNull();
  });

  it("still typesets a long real derivation", () => {
    const line = "f(x) &= \\frac{\\partial^2 u}{\\partial x^2} + \\sum_{k=1}^{n} \\binom{n}{k} \\int_0^1 \\sqrt{1+t^2}\\,dt \\\\ ";
    expect(renderTex(`\\begin{aligned}${line.repeat(20)}\\end{aligned}`, true)).toMatch(/^<span class="katex/);
  });
});
