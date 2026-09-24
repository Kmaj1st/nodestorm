import { describe, expect, it } from "vitest";
import {
  definitionText,
  expandMacros,
  isDisambiguation,
  listedDefinitions,
  mathFromExtract,
  lookupConcept,
  proofWikiTitle,
  shortExtract,
} from "../src/lookup/index";

/** A fake fetch: the first route whose pattern matches the URL answers; anything else is a 404. */
function fakeFetch(routes: [RegExp, (url: URL) => Response | Promise<Response>][]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), headers: (init?.headers ?? {}) as Record<string, string> });
    for (const [re, answer] of routes) if (re.test(decodeURIComponent(url.toString().replace(/\+/g, " ")))) return answer(url);
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const parse = (title: string, wikitext: string) => json({ parse: { title, wikitext } });
/** Wikipedia's action=query answer with these pages. */
const wp = (...pages: object[]) => json({ query: { pages } });

const KERNEL = `== Definition ==
Let $\\phi: G \\to H$ be a [[Definition:Group Homomorphism|group homomorphism]].
Let $e_H$ be the [[Definition:Identity Element|identity]] of $H$.
The '''kernel''' of $\\phi$ is the [[Definition:Set|set]]:
:$\\map \\ker \\phi := \\set {x \\in G: \\map \\phi x = e_H}$<ref>Some book</ref>
{{Proofread}}
== Also see ==
* [[Kernel is Normal Subgroup of Domain]]
[[Category:Definitions/Kernels]]`;

describe("ProofWiki wikitext", () => {
  it("expands ProofWiki's macros into standard LaTeX, nested ones too", () => {
    expect(expandMacros("\\map \\ker \\phi")).toBe("\\ker\\left(\\phi\\right)");
    expect(expandMacros("\\set {x \\in G: \\map \\phi x = e}")).toBe("\\left\\{x \\in G: \\phi\\left(x\\right) = e\\right\\}");
    expect(expandMacros("\\map f {\\paren {a b} }")).toBe("f\\left(\\left(a b\\right) \\right)");
    expect(expandMacros("x \\in \\R \\setminus \\O")).toBe("x \\in \\mathbb R \\setminus \\varnothing");
    expect(expandMacros("\\Omega \\ne \\Rightarrow")).toBe("\\Omega \\ne \\Rightarrow"); // unknown macros stay
  });

  it("turns the Definition section into prose with $…$ maths", () => {
    const text = definitionText(KERNEL);
    expect(text).toBe(
      "Let $\\phi: G \\to H$ be a group homomorphism.\nLet $e_H$ be the identity of $H$.\nThe kernel of $\\phi$ is the set:\n" +
        "$\\ker\\left(\\phi\\right) := \\left\\{x \\in G: \\phi\\left(x\\right) = e_H\\right\\}$",
    );
  });

  it("keeps only the first of several numbered definitions, and caps the length", () => {
    const multi = "== Definition ==\n=== Definition 1 ===\nFirst one.\n=== Definition 2 ===\nSecond one.";
    expect(definitionText(multi)).toBe("First one.");
    const long = `== Definition ==\n${"A sentence about $x$ and more. ".repeat(60)}`;
    const t = definitionText(long);
    expect(t.length).toBeLessThan(720);
    expect(t.endsWith(" …")).toBe(true);
    expect((t.match(/\$/g) ?? []).length % 2).toBe(0);
  });

  it("recognises disambiguation pages and what they list", () => {
    const page = "{{Disambiguation}}\n* [[Definition:Kernel of Group Homomorphism]]\n* [[Definition:Kernel of Ring Homomorphism|ring]]";
    expect(isDisambiguation(page)).toBe(true);
    expect(listedDefinitions(page)).toEqual(["Definition:Kernel of Group Homomorphism", "Definition:Kernel of Ring Homomorphism"]);
    expect(isDisambiguation(KERNEL)).toBe(false);
  });

  it("builds ProofWiki titles", () => {
    expect(proofWikiTitle("kernel of group homomorphism")).toBe("Definition:Kernel of Group Homomorphism");
    expect(proofWikiTitle("  normal   subgroup ")).toBe("Definition:Normal Subgroup");
  });
});

describe("lookupConcept", () => {
  it("takes ProofWiki's definition first, with its source and the app's identification header", async () => {
    const { f, calls } = fakeFetch([[/proofwiki.*page=Definition:Kernel of Group Homomorphism/, () => parse("Definition:Kernel of Group Homomorphism", KERNEL)]]);
    const r = await lookupConcept({ name: "kernel of group homomorphism", lang: "en", sites: ["proofwiki", "wikipedia"], max: 3 }, { fetch: f });
    expect(r.blocked).toEqual([]);
    expect(r.senses).toHaveLength(1);
    expect(r.senses[0]).toMatchObject({
      name: "Kernel of Group Homomorphism",
      source: { site: "ProofWiki", title: "Definition:Kernel of Group Homomorphism", url: "https://proofwiki.org/wiki/Definition:Kernel_of_Group_Homomorphism" },
    });
    expect(r.senses[0].definition).toContain("The kernel of $\\phi$ is the set");
    // ProofWiki gets no custom header (its request stays a CORS "simple" one); Wikimedia gets Api-User-Agent.
    expect(Object.keys(calls[0].headers)).toEqual(["accept"]);
    expect(calls.every((c) => !c.url.includes("wikipedia"))).toBe(true);
  });

  it("offers each definition a ProofWiki disambiguation page lists", async () => {
    const { f } = fakeFetch([
      [/page=Definition:Kernel&/, () => parse("Definition:Kernel", "{{Disambiguation}}\n* [[Definition:Kernel of Group Homomorphism]]\n* [[Definition:Kernel of Ring Homomorphism]]")],
      [/page=Definition:Kernel of Group Homomorphism/, () => parse("Definition:Kernel of Group Homomorphism", KERNEL)],
      [/page=Definition:Kernel of Ring Homomorphism/, () => parse("Definition:Kernel of Ring Homomorphism", "== Definition ==\nThe set of elements sent to $0_S$.")],
    ]);
    const r = await lookupConcept({ name: "Kernel", lang: "en", sites: ["proofwiki"], max: 3 }, { fetch: f });
    expect(r.senses.map((s) => s.name)).toEqual(["Kernel of Group Homomorphism", "Kernel of Ring Homomorphism"]);
  });

  it("marks prefix-search hits for a different name as near matches", async () => {
    const { f } = fakeFetch([
      [/prefixsearch/, () => json({ query: { prefixsearch: [{ title: "Definition:Normal Subgroup" }] } })],
      [/page=Definition:Normal Subgroup/, () => parse("Definition:Normal Subgroup", "== Definition ==\nA subgroup invariant under conjugation.")],
    ]);
    const r = await lookupConcept({ name: "Normal", lang: "en", sites: ["proofwiki"], max: 3 }, { fetch: f });
    expect(r.senses.map((s) => [s.name, s.exact])).toEqual([["Normal Subgroup", false]]);
  });

  it("follows a transcluded definition", async () => {
    const { f } = fakeFetch([
      [/page=Definition:Group&/, () => parse("Definition:Group", "== Definition ==\n{{:Definition:Group/Definition 1}}")],
      [/page=Definition:Group\/Definition 1/, () => parse("Definition:Group/Definition 1", "A group is a semigroup with identity and inverses.")],
    ]);
    const r = await lookupConcept({ name: "group", lang: "en", sites: ["proofwiki"], max: 3 }, { fetch: f });
    expect(r.senses[0].definition).toBe("A group is a semigroup with identity and inverses.");
  });

  it("falls through to Wikipedia when ProofWiki answers with a bot check", async () => {
    const { f } = fakeFetch([
      [/proofwiki/, () => new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } })],
      [/wikipedia.org\/w\/api.php.*titles=Normal subgroup/, () =>
        wp({ title: "Normal subgroup", description: "subgroup invariant under conjugation", extract: "In abstract algebra, a normal subgroup is a subgroup that is invariant under conjugation by members of the group.", fullurl: "https://en.wikipedia.org/wiki/Normal_subgroup" })],
    ]);
    const r = await lookupConcept({ name: "Normal subgroup", lang: "en", sites: ["proofwiki", "wikipedia"], max: 3 }, { fetch: f });
    expect(r.blocked).toEqual(["proofwiki"]);
    expect(r.senses).toEqual([
      {
        name: "Normal subgroup",
        domain: "subgroup invariant under conjugation",
        definition: "In abstract algebra, a normal subgroup is a subgroup that is invariant under conjugation by members of the group.",
        aliases: [],
        source: { site: "Wikipedia", title: "Normal subgroup", url: "https://en.wikipedia.org/wiki/Normal_subgroup" },
        exact: true,
      },
    ]);
  });

  it("offers Wikidata's meanings when Wikipedia's page is a disambiguation", async () => {
    const { f, calls } = fakeFetch([
      [/titles=Expectation&/, () => wp({ title: "Expectation", pageprops: { disambiguation: "" }, extract: "Expectation may refer to:" })],
      [/wbsearchentities/, () => json({ search: [
        { id: "Q200125", label: "expected value", description: "long-run average value of a random variable" },
        { id: "Q4167410", label: "Expectation", description: "Wikimedia disambiguation page" },
        { id: "Q1", label: "expectation", description: "belief about the future" },
      ] })],
      [/wbgetentities/, () => json({ entities: { Q200125: { sitelinks: { enwiki: { title: "Expected value" } } }, Q1: { sitelinks: {} } } })],
      [/titles=Expected value/, () => wp({ title: "Expected value", extract: "In probability theory, the expected value is a generalization of the weighted average." })],
    ]);
    const r = await lookupConcept({ name: "Expectation", lang: "en", sites: ["wikipedia"], max: 3 }, { fetch: f });
    expect(r.senses.map((s) => [s.name, s.domain, s.source.site])).toEqual([
      ["Expected value", "long-run average value of a random variable", "Wikipedia"],
      ["expectation", "belief about the future", "Wikidata"],
    ]);
    expect(r.senses[0].definition).toMatch(/^In probability theory/);
    expect(calls.every((c) => c.headers["Api-User-Agent"]?.startsWith("NodeStorm"))).toBe(true);
    expect(r.senses.map((s) => s.exact)).toEqual([false, true]); // "expected value" ≠ "Expectation"; "expectation" = it
  });

  it("skips ProofWiki for names in other scripts and asks Wikipedia in the chosen language", async () => {
    const { f, calls } = fakeFetch([[/zh.wikipedia.org\/w\/api.php/, () => wp({ title: "正规子群", extract: "正规子群是在共轭作用下不变的子群。" })]]);
    const r = await lookupConcept({ name: "正规子群", lang: "zh", sites: ["proofwiki", "wikipedia"], max: 3 }, { fetch: f });
    expect(r.senses[0].definition).toBe("正规子群是在共轭作用下不变的子群。");
    expect(calls.some((c) => c.url.includes("proofwiki"))).toBe(false);
  });

  it("finds nothing without failing, and stops when cancelled", async () => {
    const { f } = fakeFetch([]);
    expect(await lookupConcept({ name: "Zorblax", lang: "en", sites: ["proofwiki", "wikipedia"], max: 3 }, { fetch: f })).toEqual({ senses: [], blocked: [] });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(lookupConcept({ name: "Group", lang: "en", sites: ["wikipedia"], max: 3 }, { fetch: f, signal: ctrl.signal })).rejects.toThrow(/Cancelled/);
  });

  it("keeps Wikipedia's formulas as $…$ and drops the MathML dump around them", () => {
    const raw = "a subgroup \n  \n    \n      \n        N\n      \n    \n    {\\displaystyle N}\n  \n of the group \n  \n    \n        g\n        ∈\n    {\\displaystyle g\\in G.}\n  \n and \n  \n    {\\displaystyle {\\frac {1}{2}}}\n  \n more";
    expect(mathFromExtract(raw)).toBe("a subgroup $N$ of the group $g\\in G$. and ${\\frac {1}{2}}$ more");
    expect(mathFromExtract("Plain text only.")).toBe("Plain text only.");
  });

  it("shortens long extracts at a sentence", () => {
    const s = `${"This is a sentence. ".repeat(40)}`;
    const out = shortExtract(s);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith(".")).toBe(true);
  });
});
