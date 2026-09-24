import { describe, expect, it } from "vitest";
import { CancelledError } from "../src/ai/provider";
import { SiteBlockedError } from "../src/lookup/http";
import { findPapers, openAlexSearchUrl, paperSearch, papersUrl, searchPhrase, toPaper } from "../src/lookup/openalex";
import { NodePapers } from "../src/model";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const work = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/W${n}`,
  doi: `https://doi.org/10.1000/x${n}`,
  display_name: `Paper ${n}`,
  publication_year: 2000 + n,
  authorships: [{ author: { display_name: "A. One" } }],
  primary_location: { landing_page_url: `https://example.org/${n}`, source: { display_name: "Journal of Algebra" } },
  cited_by_count: 10 * n,
  open_access: { oa_url: null },
  ...extra,
});

/** A fake fetch that records the requests and answers with the given pages, one per request. */
function fake(pages: unknown[][]) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const f = (async (u: string, init?: RequestInit) => {
    calls.push({ url: new URL(u), headers: (init?.headers ?? {}) as Record<string, string> });
    return json({ meta: { count: 1 }, results: pages[calls.length - 1] ?? [] });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("OpenAlex query", () => {
  it("searches the name as a phrase in titles and abstracts, with neighbouring concepts to tell the field apart", () => {
    expect(paperSearch({ name: "Normal subgroup" })).toBe('"normal subgroup"');
    expect(paperSearch({ name: "Kernel", context: ["Group homomorphism", "Quotient group", "kernel"] })).toBe(
      '"kernel" AND ("group homomorphism" OR "quotient group")',
    );
  });

  it("keeps filter syntax and operators out of names", () => {
    // , ends a filter, | is OR, quotes and parentheses group, upper-case AND/OR/NOT are operators.
    expect(searchPhrase('Sylow "p"-subgroups, (finite) | AND $G$')).toBe("sylow p -subgroups finite and g");
    expect(searchPhrase("Hahn–Banach theorem")).toBe("hahn banach theorem");
    expect(searchPhrase("Lagrange's theorem")).toBe("lagrange's theorem");
    expect(searchPhrase("拉格朗日定理")).toBe("拉格朗日定理");
    expect(searchPhrase("$$")).toBe("");
  });

  it("asks for readable literature only, not retracted, with just the fields shown", () => {
    const u = new URL(papersUrl('"banach space"', 8));
    expect(u.origin + u.pathname).toBe("https://api.openalex.org/works");
    const filter = u.searchParams.get("filter")!;
    expect(filter.startsWith('title_and_abstract.search:"banach space",')).toBe(true);
    expect(filter).toContain(",is_retracted:false,");
    expect(filter).toMatch(/,type:!paratext\|erratum\|retraction\|/);
    expect(u.searchParams.get("per_page")).toBe("8");
    expect(u.searchParams.get("select")).toBe("id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,open_access");
    // No mailto: OpenAlex has ignored it since its polite pool gave way to API keys (February 2026).
    expect(u.searchParams.has("mailto")).toBe(false);
    expect(openAlexSearchUrl("Banach space")).toBe("https://openalex.org/works?search=%22banach+space%22");
  });
});

describe("OpenAlex works", () => {
  it("reads a work: bare DOI, DOI link, first three authors, venue, open-access copy", () => {
    const p = toPaper(
      work(1, {
        display_name: "On the <i>stability</i> of   linear maps &amp; more",
        authorships: ["Ann", "Bob", "Cy", "Di"].map((display_name) => ({ author: { display_name } })),
        open_access: { oa_url: "https://arxiv.org/pdf/1234" },
      }),
    );
    expect(p).toEqual({
      id: "W1",
      title: "On the stability of linear maps & more",
      year: 2001,
      authors: "Ann, Bob, Cy et al.",
      venue: "Journal of Algebra",
      doi: "10.1000/x1",
      url: "https://doi.org/10.1000/x1",
      citedBy: 10,
      openAccessUrl: "https://arxiv.org/pdf/1234",
    });
    expect(NodePapers.safeParse({ works: [p], query: "q", checkedAt: 1 }).success).toBe(true);
  });

  it("falls back to the landing page, then the OpenAlex page, and never keeps a non-https link", () => {
    const noDoi = toPaper(work(2, { doi: null, open_access: { oa_url: "http://insecure.example/x.pdf" } }))!;
    expect(noDoi.url).toBe("https://example.org/2");
    expect(noDoi.doi).toBeUndefined();
    expect(noDoi.openAccessUrl).toBeUndefined();
    const bare = toPaper(work(3, { doi: null, primary_location: { landing_page_url: "javascript:alert(1)" }, authorships: [], publication_year: null }))!;
    expect(bare).toEqual({ id: "W3", title: "Paper 3", authors: "", url: "https://openalex.org/W3", citedBy: 30 });
    // An open-access copy that is the same link as the title's isn't repeated.
    expect(toPaper(work(4, { open_access: { oa_url: "https://doi.org/10.1000/x4" } }))!.openAccessUrl).toBeUndefined();
    expect(toPaper(work(5, { display_name: "" }))).toBeNull();
    expect(toPaper(work(6, { id: "https://openalex.org/A6" }))).toBeNull();
  });
});

describe("findPapers", () => {
  it("sends one request with no custom header when the context finds enough", async () => {
    const { f, calls } = fake([[1, 2, 3, 4].map((n) => work(n))]);
    const r = await findPapers({ name: "Kernel", context: ["Group homomorphism"], max: 4 }, { fetch: f });
    expect(r.works.map((w) => w.id)).toEqual(["W1", "W2", "W3", "W4"]);
    expect(r.query).toBe('"kernel" AND ("group homomorphism")');
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get("filter")).toContain('title_and_abstract.search:"kernel" AND ("group homomorphism"),');
    // OpenAlex's CORS allows only standard headers: anything custom would fail the browser's preflight.
    expect(Object.keys(calls[0].headers).map((h) => h.toLowerCase())).toEqual(["accept"]);
  });

  it("fills up from the name alone when the context finds too few, without duplicates", async () => {
    const { f, calls } = fake([[work(1)], [work(1), work(7), work(8)]]);
    const r = await findPapers({ name: "Kernel", context: ["Group homomorphism"], max: 4 }, { fetch: f });
    expect(calls.map((c) => c.url.searchParams.get("filter")!.split(",")[0])).toEqual([
      'title_and_abstract.search:"kernel" AND ("group homomorphism")',
      'title_and_abstract.search:"kernel"',
    ]);
    expect(r.works.map((w) => w.id)).toEqual(["W1", "W7", "W8"]);
    expect(r.query).toBe('"kernel" AND ("group homomorphism")');
    // Nothing with the context: the list (and the query shown) is the name alone.
    const none = fake([[], [work(9)]]);
    expect(await findPapers({ name: "Kernel", context: ["Group homomorphism"] }, { fetch: none.f })).toMatchObject({ query: '"kernel"', works: [{ id: "W9" }] });
  });

  it("searches a name of several words alone: it is specific already", async () => {
    const { f, calls } = fake([[work(1)]]);
    const r = await findPapers({ name: "Banach space", context: ["Normed vector space"] }, { fetch: f });
    expect(calls.map((c) => c.url.searchParams.get("filter")!.split(",")[0])).toEqual(['title_and_abstract.search:"banach space"']);
    expect(r.query).toBe('"banach space"');
  });

  it("asks nothing for an empty name, and caps the count", async () => {
    const { f, calls } = fake([]);
    expect(await findPapers({ name: " $ " }, { fetch: f })).toEqual({ works: [], query: "" });
    expect(calls).toHaveLength(0);
    const big = fake([[]]);
    await findPapers({ name: "Group", max: 500 }, { fetch: big.f });
    expect(big.calls[0].url.searchParams.get("per_page")).toBe("25");
  });

  it("reports a spent daily budget (429) as the site refusing, and a cancel as a cancel", async () => {
    const limited = (async () => json({ error: "Rate limit exceeded" }, 429)) as unknown as typeof fetch;
    await expect(findPapers({ name: "Group" }, { fetch: limited })).rejects.toThrow(SiteBlockedError);
    await expect(findPapers({ name: "Group" }, { fetch: limited })).rejects.toThrow(/rate limited/);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(findPapers({ name: "Group" }, { fetch: fake([[work(1)]]).f, signal: ctrl.signal })).rejects.toThrow(CancelledError);
  });
});
