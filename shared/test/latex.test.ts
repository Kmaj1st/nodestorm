import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/ai/mock";
import { BASE_PROMPT, namePrompt, relatePrompt } from "../src/ai/prompts";
import type { Provider } from "../src/ai/provider";
import { extractJson, repairTexEscapes, tasks } from "../src/ai/tasks";

const reply = (text: string): Provider => ({
  id: "stub", label: "Stub", model: "m", configured: true, listModels: async () => [], complete: async () => text,
});

describe("LaTeX in model replies", () => {
  it("keeps correctly escaped LaTeX (\\\\ in JSON) as single backslashes", () => {
    const json = String.raw`{"definition":"$\\varphi(ab) = \\varphi(a)\\varphi(b)$, $\\frac{a}{b}$, $a \\neq b$, $x \\times y$"}`;
    expect(extractJson(json)).toEqual({
      definition: String.raw`$\varphi(ab) = \varphi(a)\varphi(b)$, $\frac{a}{b}$, $a \neq b$, $x \times y$`,
    });
  });

  it("repairs LaTeX whose backslashes the model forgot to escape", () => {
    // \v, \k, \c, \o are invalid JSON escapes; \f, \b, \n, \t, \r would silently become control characters.
    const json = String.raw`{"d":"$G/\ker\varphi \cong \operatorname{im}\varphi$, $\frac12$, $\beta$, $a \neq b$, $\nabla$, $\theta \to \tau$, $\times$, $\text{if}$, $\rho$, $\rightarrow$, $\{e\}$"}`;
    expect(extractJson(json)).toEqual({
      d: String.raw`$G/\ker\varphi \cong \operatorname{im}\varphi$, $\frac12$, $\beta$, $a \neq b$, $\nabla$, $\theta \to \tau$, $\times$, $\text{if}$, $\rho$, $\rightarrow$, $\{e\}$`,
    });
  });

  it("leaves real JSON escapes alone", () => {
    const json = String.raw`{"a":"line one\nline two\tTabbed\r\n","b":"say \"hi\" \\ \/ é","c":"\nThe end"}`;
    expect(extractJson(json)).toEqual({ a: "line one\nline two\tTabbed\r\n", b: 'say "hi" \\ / é', c: "\nThe end" });
    expect(repairTexEscapes(json)).toBe(json);
    expect(repairTexEscapes('{"a":1}')).toBe('{"a":1}');
  });

  it("\\u only counts as an escape before four hex digits", () => {
    expect(extractJson(String.raw`{"a":"$\underline{x} \uparrow$ A"}`)).toEqual({ a: String.raw`$\underline{x} \uparrow$ A` });
  });

  it("goes through a whole task: zod gets the LaTeX intact", async () => {
    const res = await tasks.name(
      reply(String.raw`{"candidates":[{"name":"Kernel","definition":"The set $\\ker\\varphi = \{g : \varphi(g) = e\}$.","aliases":[]}]}`),
      { description: "what a homomorphism sends to the identity" },
    );
    expect(res.candidates[0].definition).toBe(String.raw`The set $\ker\varphi = \{g : \varphi(g) = e\}$.`);
  });

  it("the offline demo's formulas survive the JSON round trip", async () => {
    const res = await tasks.clarify(new MockProvider(), { name: "First isomorphism theorem" });
    expect(res.senses[0].definition).toContain(String.raw`$G / \ker\varphi$`);
  });
});

describe("prompts ask for LaTeX", () => {
  it("every task's system prompt explains the $…$ notation and JSON escaping", () => {
    const brief = (name: string) => ({ name, definition: "", aliases: [] });
    for (const m of [namePrompt({ description: "x", context: [] }), relatePrompt({ a: brief("A"), b: brief("B") })]) {
      expect(m[0].content).toContain(BASE_PROMPT);
    }
    expect(BASE_PROMPT).toContain(String.raw`$\varphi(ab) = \varphi(a)\varphi(b)$`);
    expect(BASE_PROMPT).toContain(String.raw`write "$\\ker\\varphi$", not "$\ker\varphi$"`);
  });
});

describe("TeX repair never touches valid prose (final review)", () => {
  it.each([
    "Let\nu = x^2",
    "constant:\ne = 2.718",
    "Examples:\ne.g. groups",
    "x\ne y",
    "Plan:\nmid-term",
    "Cols:\to the right",
  ])("keeps the real line break/tab in %j", (text) => {
    expect(extractJson(JSON.stringify({ d: text }))).toEqual({ d: text });
  });

  it("still repairs unescaped TeX inside a formula", () => {
    expect(extractJson('{"d": "$x \\neq y$ and $\\frac{a}{b}$"}')).toEqual({ d: "$x \\neq y$ and $\\frac{a}{b}$" });
  });
});
