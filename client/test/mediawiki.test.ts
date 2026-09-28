import { CancelledError, SiteBlockedError } from "@nodestorm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wikiLookup } from "../src/lib/mediawiki";

// Community wiki look-ups (MediaWiki's API) against a stubbed fetch: the page's own intro, search hits, and failures.

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" } });

function stubWiki(handler: (params: URLSearchParams) => Response) {
  const calls: URLSearchParams[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    expect(init?.credentials).toBe("omit");
    const params = new URL(url).searchParams;
    calls.push(params);
    return handler(params);
  });
  return calls;
}

const intro = "Creepers are hostile mobs that silently approach players and explode.";

describe("community wiki look-up", () => {
  it("takes the page's own intro (following redirects) as an exact meaning, with a link to the page", async () => {
    const calls = stubWiki(() => json({ query: { pages: [{ title: "Creeper", extract: `  ${intro}\n` }] } }));
    const out = await wikiLookup({ site: "fandom", wiki: "minecraft" }, " creeper ", 3);
    expect(out).toEqual([
      {
        name: "Creeper",
        domain: "Fandom (minecraft)",
        definition: intro,
        aliases: [],
        source: { site: "Fandom (minecraft)", title: "Creeper", url: "https://minecraft.fandom.com/wiki/Creeper" },
        exact: true,
      },
    ]);
    expect(calls[0].get("titles")).toBe("creeper");
    expect(calls[0].get("origin")).toBe("*");
    expect(calls[0].get("redirects")).toBe("1");
  });

  it("without its own page, offers the search hits that have an intro, as near matches", async () => {
    stubWiki((p) => {
      if (p.get("action") === "opensearch") return json(["creep", ["Creeper", "Creeping", 42]]);
      const title = p.get("titles");
      if (title === "creep") return json({ query: { pages: [{ title: "Creep", missing: true }] } });
      if (title === "Creeper") return json({ query: { pages: [{ title: "Creeper", extract: intro }] } });
      return json({ query: { pages: [{ title: String(title), missing: true }] } });
    });
    const out = await wikiLookup({ site: "fandom", wiki: "minecraft" }, "creep", 3);
    expect(out.map((s) => [s.name, s.exact])).toEqual([["Creeper", false]]);
  });

  it("cuts a long intro at a sentence end", async () => {
    const long = `${"A sentence about the mob. ".repeat(40)}`;
    stubWiki(() => json({ query: { pages: [{ title: "Creeper", extract: long }] } }));
    const [s] = await wikiLookup({ site: "fandom", wiki: "minecraft" }, "Creeper", 1);
    expect(s.definition.length).toBeLessThanOrEqual(600);
    expect(s.definition.endsWith(".")).toBe(true);
    expect(long.startsWith(s.definition)).toBe(true);
  });

  it("a wiki that can't be reached or answers with a web page is blocked; a cancel is a cancel", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    // The first request's failure falls back to the parse request, which fails the same way.
    await expect(wikiLookup({ site: "moegirl" }, "初音未来", 1)).rejects.toBeInstanceOf(SiteBlockedError);
    vi.stubGlobal("fetch", async () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }));
    await expect(wikiLookup({ site: "moegirl" }, "初音未来", 1)).rejects.toBeInstanceOf(SiteBlockedError);
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", async () => {
      ctrl.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(wikiLookup({ site: "moegirl" }, "初音未来", 1, ctrl.signal)).rejects.toBeInstanceOf(CancelledError);
  });

  it("asks nothing for a Fandom or BWIKI wiki without a valid name", async () => {
    const calls = stubWiki(() => json({}));
    expect(await wikiLookup({ site: "fandom", wiki: "" }, "Creeper", 1)).toEqual([]);
    expect(await wikiLookup({ site: "bwiki", wiki: "../evil" }, "Creeper", 1)).toEqual([]);
    expect(calls).toEqual([]);
  });
});
