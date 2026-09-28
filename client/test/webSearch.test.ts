import { CancelledError, MockProvider, tasks, webSearchRequest } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocale } from "../src/i18n";
import { errorMessage } from "../src/lib/errors";
import {
  clipText,
  htmlToText,
  mergeResults,
  mixedContent,
  resetWebSearch,
  searchEngines,
  searchQuery,
  searchReady,
  searchWeb,
  testSearchEngine,
  TEXT_MAX,
  toResults,
  type WebResult,
} from "../src/lib/webSearch";
import { demoResults } from "../src/lib/webSearchDemo";
import { defaultSearch, useSettings, type SearchSettings } from "../src/store/settingsStore";

// Web search engines answer from fixtures: `fetch` is replaced per test, and the real hosts are blocked by the root
// test setup anyway.

const store = vi.hoisted(() => {
  const make = () => {
    const data = new Map<string, string>();
    return {
      data,
      api: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    };
  };
  const local = make();
  const session = make();
  (globalThis as { localStorage?: unknown }).localStorage = local.api;
  (globalThis as { sessionStorage?: unknown }).sessionStorage = session.api;
  return { local: local.data, session: session.data };
});

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function answer(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return fn(url, init ?? {});
  });
}
const withSearch = (patch: Partial<SearchSettings>) => useSettings.setState({ search: { ...defaultSearch(), ...patch } });

const TAVILY = {
  query: '"group" definition',
  results: [
    { title: "Group (mathematics) - Wikipedia", url: "https://en.wikipedia.org/wiki/Group_(mathematics)", content: "In mathematics, a  group is a set\nwith an operation…", score: 0.9, published_date: "2024-03-01T10:00:00Z" },
    { title: "Groups", url: "http://insecure.example.org/groups", content: "Plain http is dropped." },
    { title: "Empty", url: "https://empty.example.org/", content: "   " },
  ],
};
const SERPER = {
  organic: [
    { title: "群 (数学) - 维基百科", link: "https://zh.wikipedia.org/wiki/群_(数学)#定义", snippet: "群是一种代数结构。", date: "Mar 3, 2021", position: 1 },
    { title: "Group", link: "https://www.example.org/group/", snippet: "A group is…", date: "2 days ago" },
  ],
};
const BRAVE = {
  web: {
    results: [
      {
        title: "<strong>Group</strong> theory",
        url: "https://mathworld.wolfram.com/Group.html",
        description: "A <strong>group</strong> G is a finite or infinite set &amp; an operation.",
        extra_snippets: ["It satisfies closure.", "Associativity holds."],
        page_age: "2020-01-05T00:00:00",
      },
    ],
  },
};
const SEARXNG = {
  results: [{ title: "Group &lt;algebra&gt;", url: "https://ncatlab.org/nlab/show/group", content: "A <b>group</b> is a monoid in which every element has an inverse.", publishedDate: null }],
};

beforeEach(() => {
  resetWebSearch();
  store.local.clear();
  store.session.clear();
  calls = [];
  useSettings.setState({ provider: "siliconflow", connection: "browser", language: "auto", rememberKeys: false, search: defaultSearch() });
  useLocale.getState().setPref("en");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("which engines", () => {
  it("none by default; an engine needs to be ticked and have its key (or SearXNG address)", () => {
    expect(searchEngines()).toEqual([]);
    expect(searchReady()).toBe(false);
    withSearch({ tavily: { enabled: true }, serper: { enabled: false, apiKey: "k" }, searxng: { enabled: true, url: "ftp://x" } });
    expect(searchEngines()).toEqual([]);
    withSearch({ tavily: { enabled: true, apiKey: "tvly-1" }, searxng: { enabled: true, url: "searx.example.org" } });
    expect(searchEngines()).toEqual(["tavily", "searxng"]);
    expect(searchReady()).toBe(true);
  });

  it("Brave only through the local server, which may hold the keys itself", () => {
    withSearch({ brave: { enabled: true, apiKey: "b" }, serper: { enabled: true } });
    expect(searchEngines()).toEqual([]);
    useSettings.setState({ connection: "server" });
    expect(searchEngines()).toEqual(["serper", "brave"]);
  });

  it("the offline demo provider searches its pretend web", () => {
    useSettings.setState({ provider: "mock" });
    expect(searchEngines()).toEqual(["demo"]);
    expect(searchReady()).toBe(true);
  });

  it("builds the query by the name's script", () => {
    expect(searchQuery(" Normal  subgroup ")).toBe('"Normal subgroup" definition');
    expect(searchQuery('Say "hi"')).toBe('"Say hi" definition');
    expect(searchQuery("群")).toBe("群 定义");
    expect(searchQuery("ベクトル空間")).toBe("ベクトル空間 定義");
    expect(searchQuery("군")).toBe("군 정의");
  });
});

describe("SearXNG on plain http", () => {
  it("is mixed content on an https page, unless it is this machine", () => {
    expect(mixedContent("http://searx.example.org", "https:")).toBe(true);
    expect(mixedContent("http://192.168.1.5:8888/search", "https:")).toBe(true);
    expect(mixedContent("https://searx.example.org", "https:")).toBe(false);
    expect(mixedContent("searx.example.org", "https:")).toBe(false); // no scheme: https is assumed
    for (const local of ["http://localhost:8888", "http://127.0.0.1:8080", "http://[::1]:8888", "http://searx.localhost"]) {
      expect(mixedContent(local, "https:")).toBe(false);
    }
    expect(mixedContent("http://searx.example.org", "http:")).toBe(false); // the page itself is http (development)
    expect(mixedContent("", "https:")).toBe(false);
    expect(mixedContent("ftp://x", "https:")).toBe(false);
  });

  it("Test says why instead of making a request the browser would block", async () => {
    const was = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { value: { protocol: "https:" }, configurable: true });
    try {
      answer(() => json({ results: [] }));
      const search = { ...defaultSearch(), searxng: { enabled: true, url: "http://searx.example.org" } };
      await expect(testSearchEngine("searxng", search, "browser")).rejects.toThrow(/mixed content/);
      expect(calls).toEqual([]);
      // Through the local server the page doesn't fetch the instance itself: no such error.
      await testSearchEngine("searxng", search, "server").catch(() => {});
      expect(calls.length).toBe(1);
    } finally {
      if (was) Object.defineProperty(globalThis, "location", was);
      else delete (globalThis as { location?: unknown }).location;
    }
  });
});

describe("engines", () => {
  it("Tavily: POST with a Bearer key, no credentials; plain text, https only, ISO date", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "tvly-secret" } });
    answer(() => json(TAVILY));
    const res = await searchWeb("Group", { max: 6 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.tavily.com/search");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("omit");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tvly-secret");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      query: '"Group" definition', search_depth: "basic", max_results: 6, include_answer: false, include_raw_content: false,
    });
    expect(res).toEqual({
      asked: ["tavily"],
      failed: [],
      results: [
        {
          engine: "tavily",
          title: "Group (mathematics) - Wikipedia",
          url: "https://en.wikipedia.org/wiki/Group_(mathematics)",
          site: "en.wikipedia.org",
          text: "In mathematics, a group is a set with an operation…",
          published: "2024-03-01",
        },
      ],
    });
  });

  it("Serper: X-API-KEY, Google's language and country for a Chinese name; the fragment and relative dates go", async () => {
    withSearch({ serper: { enabled: true, apiKey: "serper-key" } });
    answer(() => json(SERPER));
    const res = await searchWeb("群", { max: 5 });
    expect(calls[0].url).toBe("https://google.serper.dev/search");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("serper-key");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ q: "群 定义", num: 5, hl: "zh-cn", gl: "cn" });
    expect(res.results.map((r) => [r.site, r.url, r.published])).toEqual([
      ["zh.wikipedia.org", "https://zh.wikipedia.org/wiki/%E7%BE%A4_(%E6%95%B0%E5%AD%A6)", "2021-03-03"],
      ["example.org", "https://www.example.org/group/", undefined],
    ]);
  });

  it("Brave (through the local server): the key typed here goes to the server; HTML is reduced to text, snippets joined", async () => {
    useSettings.setState({ connection: "server" });
    withSearch({ brave: { enabled: true, apiKey: "brave-key" } });
    answer((url) => {
      expect(url).toBe("/api/search/brave");
      return json({ hits: [{ title: BRAVE.web.results[0].title, url: BRAVE.web.results[0].url, text: `${BRAVE.web.results[0].description} ${BRAVE.web.results[0].extra_snippets.join(" ")}`, date: "2020-01-05T00:00:00" }] });
    });
    const res = await searchWeb("Group", { max: 3 });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ q: '"Group" definition', count: 3, lang: "en", key: "brave-key" });
    expect(res.results).toEqual([
      {
        engine: "brave",
        title: "Group theory",
        url: "https://mathworld.wolfram.com/Group.html",
        site: "mathworld.wolfram.com",
        text: "A group G is a finite or infinite set & an operation. It satisfies closure. Associativity holds.",
        published: "2020-01-05",
      },
    ]);
  });

  it("Brave's own request: the subscription token header, its language codes, extra snippets", () => {
    const { url, init } = webSearchRequest("brave", { q: "群 定义", count: 50, lang: "zh" }, { key: "b" });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "群 定义", count: "20", search_lang: "zh-hans", extra_snippets: "true" });
    expect(init.headers).toMatchObject({ "x-subscription-token": "b" });
    expect(init.credentials).toBe("omit");
  });

  it("SearXNG: the instance's JSON search, entities and tags reduced to text", async () => {
    withSearch({ searxng: { enabled: true, url: "https://searx.example.org/search?q=old" } });
    answer(() => json(SEARXNG));
    const res = await searchWeb("Group", { max: 6 });
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://searx.example.org/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: '"Group" definition', format: "json", language: "en" });
    expect(res.results[0]).toMatchObject({ engine: "searxng", title: "Group <algebra>", text: "A group is a monoid in which every element has an inverse.", site: "ncatlab.org" });
    expect(res.results[0].published).toBeUndefined();
  });
});

describe("merging", () => {
  const r = (engine: WebResult["engine"], url: string): WebResult => ({ engine, url, title: url, site: new URL(url).hostname, text: "x" });

  it("one result per page (fragment, trailing slash, www. and host case don't matter), engines taking turns, at most `max`", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "t" }, serper: { enabled: true, apiKey: "s" } });
    answer((url) =>
      url.includes("tavily")
        ? json({ results: [
            { title: "A", url: "https://en.wikipedia.org/wiki/Group#top", content: "a" },
            { title: "B", url: "https://b.example.org/x", content: "b" },
            { title: "C", url: "https://c.example.org/", content: "c" },
          ] })
        : json({ organic: [
            { title: "A again", link: "https://EN.wikipedia.org/wiki/Group/", snippet: "a2" },
            { title: "D", link: "https://www.d.example.org/", snippet: "d" },
          ] }),
    );
    const res = await searchWeb("Group", { max: 3 });
    expect(res.results.map((x) => x.title)).toEqual(["A", "B", "D"]);
    expect(res.asked).toEqual(["tavily", "serper"]);
  });

  it("mergeResults dedupes www. and trailing slashes", () => {
    expect(mergeResults([[r("tavily", "https://www.x.org/a/")], [r("serper", "https://x.org/a")]], 5)).toHaveLength(1);
  });

  it("text is cut at TEXT_MAX characters, after a sentence", () => {
    const long = `${"Word ".repeat(300)}end. ${"more ".repeat(1000)}`;
    const [res] = toResults("tavily", [{ title: "T", url: "https://x.org/", text: long }]);
    expect(res.text.length).toBeLessThanOrEqual(TEXT_MAX);
    expect(clipText("short")).toBe("short");
    expect(clipText("a".repeat(5000)).length).toBe(TEXT_MAX);
  });

  it("HTML becomes text without running or keeping anything", () => {
    expect(htmlToText('<img src=x onerror="alert(1)">A <b>b</b> &lt;c&gt; &#233;<script>bad()</script>')).toBe("A b <c> é");
    // Plain-text engines keep a "<" in math.
    expect(toResults("tavily", [{ title: "T", url: "https://x.org/", text: "a<b and b>c" }])[0].text).toBe("a<b and b>c");
  });
});

describe("failures, pauses, the cache", () => {
  it("a rejected key is reported (translated), the engine is paused, and the others still answer", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "tvly-bad" }, serper: { enabled: true, apiKey: "s" } });
    answer((url) => (url.includes("tavily") ? json({ detail: { error: "Unauthorized: missing or invalid API key." } }, 401) : json(SERPER)));
    const first = await searchWeb("Group", { max: 6 });
    expect(first.failed).toEqual(["tavily"]);
    expect(first.results).toHaveLength(2);
    expect(console.warn).toHaveBeenCalled();
    // Paused: not asked again, still reported as failed; nothing was cached because of the failure.
    calls = [];
    const second = await searchWeb("Group", { max: 6 });
    expect(calls.map((c) => c.url)).toEqual(["https://google.serper.dev/search"]);
    expect(second).toMatchObject({ asked: ["serper"], failed: ["tavily"] });
    expect(searchReady()).toBe(true); // Serper still works
    // A corrected key is tried at once.
    withSearch({ tavily: { enabled: true, apiKey: "tvly-good" }, serper: { enabled: true, apiKey: "s" } });
    calls = [];
    await searchWeb("Group", { max: 6 });
    expect(calls.map((c) => c.url)).toContain("https://api.tavily.com/search");
  });

  it("Test says why, in the interface language, with the engine's own words after it (without the key)", async () => {
    const search = { ...defaultSearch(), tavily: { enabled: true, apiKey: "tvly-bad-key-123" } };
    answer(() => json({ detail: { error: "Invalid API key tvly-bad-key-123" } }, 401));
    const e = await testSearchEngine("tavily", search, "browser").catch((x) => x);
    expect(errorMessage(e)).toBe("Tavily rejected the API key. Check it in Settings. (Invalid API key [key hidden])");
    useLocale.getState().setPref("zh");
    expect(errorMessage(e)).toMatch(/^Tavily 拒绝了这个 API 密钥/);
  });

  it("used-up credits and rate limits have their own reasons", async () => {
    const serper = { ...defaultSearch(), serper: { enabled: true, apiKey: "s" } };
    answer(() => json({ message: "Not enough credits", statusCode: 400 }, 400));
    expect(errorMessage(await testSearchEngine("serper", serper, "browser").catch((x) => x))).toBe(
      "Serper: this account's searches (or credits) are used up. (Not enough credits)",
    );
    vi.restoreAllMocks();
    answer(() => new Response("{}", { status: 432 }));
    const tavily = { ...defaultSearch(), tavily: { enabled: true, apiKey: "t" } };
    expect(errorMessage(await testSearchEngine("tavily", tavily, "browser").catch((x) => x))).toMatch(/^Tavily: this account's searches/);
    vi.restoreAllMocks();
    answer(() => new Response("", { status: 429 }));
    expect(errorMessage(await testSearchEngine("tavily", tavily, "browser").catch((x) => x))).toMatch(/^Tavily is limiting how often/);
  });

  it("a network (CORS) failure is 'can't reach'; a test that works resolves", async () => {
    const tavily = { ...defaultSearch(), tavily: { enabled: true, apiKey: "t" } };
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(errorMessage(await testSearchEngine("tavily", tavily, "browser").catch((x) => x))).toMatch(/^Can't reach Tavily/);
    vi.restoreAllMocks();
    answer(() => json(TAVILY));
    expect(await testSearchEngine("tavily", tavily, "browser")).toBe(3);
  });

  it("clean answers are cached per engines, language and name", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "t" } });
    answer(() => json(TAVILY));
    await searchWeb("Group", { max: 6 });
    await searchWeb("group", { max: 6 });
    expect(calls).toHaveLength(1);
    expect(store.local.get("nodestorm-websearch-cache")).toContain("en.wikipedia.org");
    useSettings.setState({ language: "German (Deutsch)" });
    await searchWeb("Group", { max: 6 });
    expect(calls).toHaveLength(2);
  });

  it("`fresh` (an explicit Search again) asks the engines past the cache, and caches the new answer", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "t" } });
    answer(() => json(TAVILY));
    await searchWeb("Group", { max: 6 });
    await searchWeb("Group", { max: 6, fresh: true });
    expect(calls).toHaveLength(2);
    await searchWeb("Group", { max: 6 });
    expect(calls).toHaveLength(2);
  });

  it("cancelling throws CancelledError", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "t" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_u, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const ctrl = new AbortController();
    const p = searchWeb("Group", { max: 6, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    await expect(searchWeb("Group", { max: 6, signal: ctrl.signal })).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("the offline demo's pretend web", () => {
  it("three sites for a known concept, two quoting its definition word for word, one wrong", async () => {
    useSettings.setState({ provider: "mock" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await searchWeb("group", { max: 6 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.asked).toEqual(["demo"]);
    expect(res.results.map((r) => r.site)).toEqual(["demo-encyclopedia.example", "demo-lecture-notes.example", "demo-forum.example"]);
    const def = "A set with an associative binary operation, an identity element, and inverses.";
    expect(res.results[0].text).toContain(def);
    expect(res.results[1].text).toContain(def);
    expect(res.results[2].text).not.toContain(def);
    expect(res.results.every((r) => r.engine === "demo" && r.url.startsWith("https://"))).toBe(true);
    expect((await searchWeb("group", { max: 2 })).results).toHaveLength(2);
  });

  it("finds aliases, and nothing for a concept it doesn't know", () => {
    expect(demoResults("Factor group")[0].title).toBe("Quotient Group - Demo Encyclopedia");
    expect(demoResults("Banach space")).toEqual([]);
  });

  it("Chinese pages for a Chinese name (or alias), the forum still wrong; the demo's check rates them in Chinese", async () => {
    const res = demoResults("因子群");
    expect(res.map((r) => r.site)).toEqual(["zh.demo-encyclopedia.example", "zh.demo-lecture-notes.example", "zh.demo-forum.example"]);
    expect(res[0].title).toBe("商群 - 演示百科");
    const def = "正规子群 $N$ 的陪集构成的群 $G/N$，运算为 $(aN)(bN) = abN$。";
    expect(res[0].text).toContain(def);
    expect(res[1].text).toContain(def);
    expect(res[2].text).not.toContain(def);
    expect(res.every((r) => r.url.startsWith("https://") && r.engine === "demo")).toBe(true);
    expect(demoResults("拓扑空间")).toEqual([]);
    const sources = res.map((r, i) => ({ id: `w${i}`, kind: "web", site: r.site, title: r.title, url: r.url, text: r.text }));
    const rated = await tasks.assess(new MockProvider(), { name: "因子群", sources });
    expect(rated.ratings.map((r) => r.reliability)).toEqual(["high", "high", "low"]);
    expect(rated.ratings.slice(0, 2).map((r) => r.passage)).toEqual([def, def]);
    expect(rated.ratings.every((r) => /\p{Script=Han}/u.test(r.reasons))).toBe(true);
  });
});

describe("keys are stored like AI keys", () => {
  const saved = () => JSON.parse(store.local.get("nodestorm-settings") ?? "{}").state;

  it("not in localStorage unless 'remember keys' is on; 'Forget' removes them", () => {
    useSettings.getState().update({ search: { ...defaultSearch(), tavily: { enabled: true, apiKey: "tvly-secret" }, brave: { enabled: true, apiKey: "brave-secret" } } });
    expect(store.local.get("nodestorm-settings")).not.toContain("secret");
    expect(saved().search.tavily).toEqual({ enabled: true });
    expect(store.session.get("nodestorm-settings")).toContain("tvly-secret");
    useSettings.getState().update({ rememberKeys: true });
    expect(saved().search.tavily.apiKey).toBe("tvly-secret");
    useSettings.getState().forgetKeys();
    expect(store.local.get("nodestorm-settings")).not.toContain("secret");
    expect(useSettings.getState().search.tavily).toEqual({ enabled: true });
  });

  it("settings saved before web search get the defaults (all off, 6 results)", async () => {
    store.local.set("nodestorm-settings", JSON.stringify({ state: { provider: "mock", connection: "browser" }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().search).toEqual(defaultSearch());
    expect(useSettings.getState().search.maxResults).toBe(6);
    store.session.clear(); // the tab's copy (written back on rehydrate) would win
    store.local.set("nodestorm-settings", JSON.stringify({ state: { search: { tavily: { enabled: true }, maxResults: 99, serper: "junk" } }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().search).toEqual({ ...defaultSearch(), tavily: { enabled: true }, maxResults: 20 });
  });
});

describe("security: the stored cache", () => {
  const CACHE = "nodestorm-websearch-cache";

  it("storage that isn't a cache ('null', a list, junk) is ignored instead of breaking searches", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "t" } });
    answer(() => json(TAVILY));
    for (const stored of ["null", "[1,2]", '"text"', "{not json", '{"x":null}']) {
      resetWebSearch();
      store.local.set(CACHE, stored);
      const r = await searchWeb(`Group ${stored.length}`, { max: 6 });
      expect(r.results.map((x) => x.url), stored).toContain("https://en.wikipedia.org/wiki/Group_(mathematics)");
    }
  });

  it("a stored answer is checked again when read: one with a non-https page or a non-text field is searched anew", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "t" } });
    answer(() => json(TAVILY));
    await searchWeb("Group", { max: 6 });
    for (const bad of [
      (r: Record<string, unknown>) => (r.url = "javascript:alert(1)"),
      (r: Record<string, unknown>) => (r.url = "http://insecure.example.org/"),
      (r: Record<string, unknown>) => (r.text = { __html: "<img src=x onerror=alert(1)>" }),
      (r: Record<string, unknown>) => (r.title = 42),
    ]) {
      const c = JSON.parse(store.local.get(CACHE)!) as Record<string, { at: number; results: Record<string, unknown>[] }>;
      for (const e of Object.values(c)) bad(e.results[0]);
      store.local.set(CACHE, JSON.stringify(c));
      resetWebSearch();
      calls = [];
      const r = await searchWeb("Group", { max: 6 });
      expect(calls).toHaveLength(1); // not taken from the tampered cache
      expect(r.results.every((x) => x.url.startsWith("https://") && typeof x.text === "string" && typeof x.title === "string")).toBe(true);
    }
  });

  it("holds no search keys", async () => {
    withSearch({ tavily: { enabled: true, apiKey: "tvly-secret-key-1" }, searxng: { enabled: true, url: "https://searx.example.org" } });
    answer((url) => json(url.includes("tavily") ? TAVILY : SEARXNG));
    await searchWeb("Group", { max: 6 });
    expect(store.local.get(CACHE)).toBeTruthy();
    expect(store.local.get(CACHE)).not.toContain("tvly-secret");
  });
});
