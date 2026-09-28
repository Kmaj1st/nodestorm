import { describe, expect, it } from "vitest";
import { CancelledError, ProviderError } from "../src/ai/provider";
import {
  fetchWebSearch,
  parseWebSearch,
  readCapped,
  webSearchError,
  webSearchRequest,
} from "../src/lookup/webSearch";
import { searxngBase, type SearchEngineId } from "../src/lookup/searchEngines";

// Each engine's answer and failures, read the same way in the browser and the local server. The fetch is passed in.

describe("web search answers, per engine", () => {
  it("Tavily: missing title/content become empty text, a hit without a url is skipped", () => {
    const hits = parseWebSearch("tavily", {
      results: [
        { title: "Group", url: "https://a.org/g", content: "A set with…", published_date: "2021-03-03" },
        { title: null, url: "https://b.org/g", content: null },
        { title: "no url", content: "x" },
        "junk",
      ],
    });
    expect(hits).toEqual([
      { title: "Group", url: "https://a.org/g", text: "A set with…", date: "2021-03-03" },
      { title: "", url: "https://b.org/g", text: "", date: undefined },
    ]);
  });

  it("Serper: no `organic` list is a search without results; `link` and `snippet` are the url and text", () => {
    expect(parseWebSearch("serper", { searchParameters: {} })).toEqual([]);
    expect(parseWebSearch("serper", { organic: [{ title: "T", link: "https://x.org", snippet: "S", date: "Mar 3, 2021" }] })).toEqual([
      { title: "T", url: "https://x.org", text: "S", date: "Mar 3, 2021" },
    ]);
  });

  it("Brave: no `web` part is no results; the description and extra snippets are joined; page_age before age", () => {
    expect(parseWebSearch("brave", { query: {} })).toEqual([]);
    const [a, b] = parseWebSearch("brave", {
      web: {
        results: [
          { title: "A", url: "https://a.org", description: "First.", extra_snippets: ["  ", "Second."], page_age: "2020-01-01", age: "5 years ago" },
          { title: "B", url: "https://b.org", description: null, age: "2 days ago" },
        ],
      },
    });
    expect(a).toEqual({ title: "A", url: "https://a.org", text: "First. Second.", date: "2020-01-01" });
    expect(b).toEqual({ title: "B", url: "https://b.org", text: "", date: "2 days ago" });
  });

  it("SearXNG: `content` and `publishedDate`", () => {
    expect(parseWebSearch("searxng", { results: [{ title: "T", url: "https://x.org", content: "C", publishedDate: "2022-02-02" }] })).toEqual([
      { title: "T", url: "https://x.org", text: "C", date: "2022-02-02" },
    ]);
  });

  it("an answer of the wrong shape is a malformed error naming the engine", () => {
    for (const [engine, bad] of [
      ["tavily", { results: "no" }],
      ["serper", { organic: {} }],
      ["brave", { web: { results: null } }],
      ["searxng", null],
    ] as [SearchEngineId, unknown][]) {
      const err = (() => {
        try {
          parseWebSearch(engine, bad);
        } catch (e) {
          return e;
        }
      })() as ProviderError;
      expect(err, engine).toBeInstanceOf(ProviderError);
      expect(err.info?.code).toBe("malformed");
      expect(err.status).toBe(502);
    }
  });
});

describe("web search requests", () => {
  it("counts are clamped to what each engine allows, and at least one", () => {
    const body = (e: SearchEngineId, count: number) => JSON.parse(String(webSearchRequest(e, { q: "g", count, lang: "en" }, { key: "k" }).init.body));
    expect(body("tavily", 50).max_results).toBe(20);
    expect(body("tavily", 0).max_results).toBe(1);
    expect(body("serper", 500).num).toBe(100);
    expect(body("serper", Number.NaN).num).toBe(1);
    expect(body("serper", 6)).toMatchObject({ q: "g", num: 6, hl: "en" });
    expect(body("serper", 6).gl).toBeUndefined();
  });

  it("a key engine without a key, and SearXNG without an address, are noKey errors before any request", () => {
    for (const e of ["tavily", "serper", "brave"] as const) {
      expect(() => webSearchRequest(e, { q: "g", count: 5, lang: "en" }, { key: "  " })).toThrow(ProviderError);
    }
    expect(() => webSearchRequest("searxng", { q: "g", count: 5, lang: "en" }, { url: "ftp://x" })).toThrow(/no instance address/);
  });

  it("SearXNG addresses: a pasted /search page is cut off; credentials and other schemes are refused", () => {
    expect(searxngBase("search.example.org/")).toBe("https://search.example.org");
    expect(searxngBase("http://localhost:8888/searx/search?q=x")).toBe("http://localhost:8888/searx");
    expect(searxngBase("https://user:pw@search.example.org")).toBeNull();
    expect(searxngBase("javascript:alert(1)")).toBeNull();
    expect(searxngBase("file:///etc/passwd")).toBeNull();
    expect(searxngBase("   ")).toBeNull();
    const { url, init } = webSearchRequest("searxng", { q: "群", count: 5, lang: "zh" }, { url: "http://localhost:8888/search" });
    expect(url).toBe(`http://localhost:8888/search?q=${encodeURIComponent("群")}&format=json&language=zh-CN`);
    expect(init.redirect).toBe("follow");
    expect(init.credentials).toBe("omit");
  });
});

describe("web search failures", () => {
  const code = (engine: SearchEngineId, status: number, body = "") => {
    const e = webSearchError(engine, status, body, "sk-secret-key");
    return [e.info?.code, e.status];
  };

  it("used-up credits are told apart from rate limits and rejected keys", () => {
    expect(code("tavily", 432)).toEqual(["quota", 429]);
    expect(code("tavily", 433)).toEqual(["quota", 429]);
    expect(code("serper", 400, '{"message":"Not enough credits"}')).toEqual(["quota", 429]);
    expect(code("brave", 429, '{"error":{"code":"QUOTA_LIMITED","detail":"You have exceeded your plan limit"}}')).toEqual(["quota", 429]);
    expect(code("brave", 429, "slow down")).toEqual(["rateLimited", 429]);
    expect(code("serper", 403, "forbidden")).toEqual(["invalidKey", 401]);
    expect(code("brave", 422, '{"error":{"detail":"The provided subscription token is invalid"}}')).toEqual(["invalidKey", 401]);
    expect(code("brave", 422, "bad count")).toEqual(["http", 422]);
    expect(code("searxng", 403, "Forbidden")).toEqual(["declined", 403]);
    expect(code("tavily", 503, "down")).toEqual(["http", 502]);
  });

  it("keeps the engine's own words without the key, and says nothing for an HTML error page", () => {
    expect(webSearchError("tavily", 401, '{"detail":{"error":"Unauthorized: key sk-secret-key is invalid"}}', "sk-secret-key").info?.detail).toBe(
      "Unauthorized: key [key hidden] is invalid",
    );
    expect(webSearchError("searxng", 500, "<html><body>Internal Server Error</body></html>").info?.detail).toBeUndefined();
  });

  const fakeFetch = (res: () => Response | Promise<Response>) => (async () => res()) as unknown as typeof fetch;

  it("an answer that isn't JSON is malformed; a slow engine is unreachable; cancelling throws CancelledError", async () => {
    const q = { q: "g", count: 5, lang: "en" };
    await expect(fetchWebSearch("tavily", q, { key: "k" }, { fetch: fakeFetch(() => new Response("<html>")) })).rejects.toMatchObject({
      info: { code: "malformed", detail: "not JSON" },
    });
    const never = ((_: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    await expect(fetchWebSearch("tavily", q, { key: "k" }, { fetch: never, timeoutMs: 20 })).rejects.toMatchObject({
      status: 504,
      info: { code: "unreachable" },
    });
    const ctrl = new AbortController();
    const p = fetchWebSearch("tavily", q, { key: "k" }, { fetch: never, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
  });

  it("an HTTP error's body is read only in part, and becomes the coded error", async () => {
    const huge = "credit ".repeat(20_000);
    await expect(
      fetchWebSearch("serper", { q: "g", count: 5, lang: "en" }, { key: "k" }, { fetch: fakeFetch(() => new Response(huge, { status: 400 })) }),
    ).rejects.toMatchObject({ info: { code: "quota" } });
  });

  it("readCapped cuts an answer to its first bytes when asked, and refuses a longer one otherwise", async () => {
    const res = () => new Response("abcdefghij");
    expect(await readCapped(res(), 4, true)).toBe("abcd");
    expect(await readCapped(res(), 4)).toBeNull();
    expect(await readCapped(res(), 100)).toBe("abcdefghij");
  });
});
