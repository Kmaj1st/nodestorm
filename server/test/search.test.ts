import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Registry } from "../src/providers/registry";

// POST /api/search/:engine forwards a web search (Brave can't be called from a page). The engines are a fake `fetch`.

describe("server: web search", () => {
  const registry = { get: () => { throw new Error("no AI here"); }, info: () => ({ default: "mock", providers: [] }) } as unknown as Registry;
  const upstream: { url: string; init: RequestInit }[] = [];
  let reply: () => Response = () => new Response("{}");
  const searchFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    upstream.push({ url: String(url), init: init ?? {} });
    return reply();
  }) as typeof fetch;
  const env: Record<string, string | undefined> = { BRAVE_API_KEY: "env-brave-key-123" };
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
  let base = "";

  beforeAll(async () => {
    server = createApp(registry, { env, searchFetch }).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    upstream.length = 0;
    reply = () =>
      new Response(
        JSON.stringify({
          web: { results: [{ title: "<strong>Group</strong>", url: "https://mathworld.wolfram.com/Group.html", description: "A group…", extra_snippets: ["More."], page_age: "2020-01-05T00:00:00" }] },
        }),
        { headers: { "content-type": "application/json" } },
      );
  });

  const search = (engine: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/search/${engine}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("forwards Brave with the key from server/.env and answers with the parsed hits", async () => {
    const res = await search("brave", { q: '"Group" definition', count: 5, lang: "en" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hits: [{ title: "<strong>Group</strong>", url: "https://mathworld.wolfram.com/Group.html", text: "A group… More.", date: "2020-01-05T00:00:00" }],
    });
    expect(upstream).toHaveLength(1);
    const u = new URL(upstream[0].url);
    expect(u.host).toBe("api.search.brave.com");
    expect(u.searchParams.get("q")).toBe('"Group" definition');
    expect(u.searchParams.get("count")).toBe("5");
    expect(upstream[0].init.headers).toMatchObject({ "x-subscription-token": "env-brave-key-123" });
  });

  it("uses a key typed in Settings instead, when one is sent", async () => {
    await search("brave", { q: "x", count: 1, lang: "en", key: "typed-key" });
    expect(upstream[0].init.headers).toMatchObject({ "x-subscription-token": "typed-key" });
  });

  it("passes a rejected key on as a coded error, without the key", async () => {
    reply = () => new Response(JSON.stringify({ error: { code: "SUBSCRIPTION_TOKEN_INVALID", detail: "The provided token env-brave-key-123 is invalid." } }), { status: 422 });
    const res = await search("brave", { q: "x", count: 1, lang: "en" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ code: "invalidKey", params: { provider: "Brave Search" } });
    expect(JSON.stringify(body)).not.toContain("env-brave-key-123");
  });

  it("rate limits and used-up quotas keep their codes", async () => {
    reply = () => new Response(JSON.stringify({ error: { code: "QUOTA_LIMITED", detail: "Monthly quota used up" } }), { status: 429 });
    expect(await (await search("brave", { q: "x", count: 1, lang: "en" })).json()).toMatchObject({ code: "quota" });
    reply = () => new Response("", { status: 429 });
    expect(await (await search("brave", { q: "x", count: 1, lang: "en" })).json()).toMatchObject({ code: "rateLimited" });
  });

  it("says there is no key when neither Settings nor server/.env has one", async () => {
    const res = await search("tavily", { q: "x", count: 1, lang: "en" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "noKey", params: { provider: "Tavily" } });
    expect(upstream).toHaveLength(0);
  });

  it("forwards SearXNG to a local instance (plain http allowed here)", async () => {
    reply = () => new Response(JSON.stringify({ results: [{ title: "G", url: "https://ncatlab.org/nlab/show/group", content: "A group…" }] }));
    const res = await search("searxng", { q: "x", count: 3, lang: "zh", url: "http://localhost:8080/" });
    expect(res.status).toBe(200);
    expect(upstream[0].url).toBe("http://localhost:8080/search?q=x&format=json&language=zh-CN");
  });

  it("refuses unknown engines and bad requests", async () => {
    expect((await search("google", { q: "x", count: 1, lang: "en" })).status).toBe(404);
    expect((await search("brave", { q: "", count: 1, lang: "en" })).status).toBe(400);
    expect((await search("brave", { q: "x", count: 500, lang: "en" })).status).toBe(400);
    expect((await search("brave", { q: "x", count: 1, lang: "en\nx" })).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("keeps the host and origin checks: other sites' pages and rebound names are refused before any search", async () => {
    expect((await search("brave", { q: "x", count: 1, lang: "en" }, { origin: "https://evil.example" })).status).toBe(403);
    const port = (server.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/api/search/brave", method: "POST", headers: { host: `rebind.example:${port}`, "content-type": "application/json" } },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on("error", reject);
      req.end(JSON.stringify({ q: "x", count: 1, lang: "en" }));
    });
    expect(status).toBe(403);
    expect(upstream).toHaveLength(0);
    expect((await search("brave", { q: "x", count: 1, lang: "en" }, { origin: `http://localhost:5173` })).status).toBe(200);
  });

  describe("security", () => {
    it("fetches only http(s) SearXNG addresses: no file:, other schemes or credentials in the URL", async () => {
      for (const url of ["file:///etc/passwd", "ftp://files.example/", "gopher://127.0.0.1:25/", "javascript:alert(1)", "http://user:pass@169.254.169.254/"]) {
        const res = await search("searxng", { q: "x", count: 1, lang: "en", url });
        expect(res.status, url).toBe(400);
        expect(await res.json()).toMatchObject({ code: "noKey" });
      }
      expect(upstream).toHaveLength(0);
    });

    it("stops reading an engine's answer past a few megabytes (a hostile SearXNG instance sending a huge body)", async () => {
      let sent = 0;
      const chunk = new Uint8Array(1 << 20).fill(0x20); // 1 MB of spaces, 64 MB in all
      reply = () =>
        new Response(
          new ReadableStream({
            pull(c) {
              if (sent >= 64 << 20) return c.close();
              sent += chunk.length;
              c.enqueue(chunk);
            },
          }),
        );
      const res = await search("searxng", { q: "x", count: 1, lang: "en", url: "https://searx.example.org" });
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "malformed" });
      expect(sent).toBeLessThan(16 << 20);
    });

    it("refuses an answer whose Content-Length is too large without reading it", async () => {
      reply = () => new Response('{"results":[]}', { headers: { "content-length": String(1 << 30) } });
      const res = await search("searxng", { q: "x", count: 1, lang: "en", url: "https://searx.example.org" });
      expect(await res.json()).toMatchObject({ code: "malformed", detail: "answer too large" });
    });

    it("keeps at most 100 hits of an answer", async () => {
      const results = Array.from({ length: 5000 }, (_, i) => ({ title: `T${i}`, url: `https://e${i}.example.org/`, content: "x" }));
      reply = () => new Response(JSON.stringify({ results }));
      const res = await search("searxng", { q: "x", count: 20, lang: "en", url: "https://searx.example.org" });
      expect((await res.json()).hits).toHaveLength(100);
    });

    it("the engines holding a key are never followed through a redirect (custom key headers survive redirects)", async () => {
      await search("brave", { q: "x", count: 1, lang: "en" });
      await search("tavily", { q: "x", count: 1, lang: "en", key: "tvly-key-123456" });
      await search("serper", { q: "x", count: 1, lang: "en", key: "serper-key-123456" });
      expect(upstream.map((u) => u.init.redirect)).toEqual(["error", "error", "error"]);
    });

    it("follows a SearXNG redirect only to the same host (or its https), at most twice: never to an internal address", async () => {
      const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
      const ok = () => new Response(JSON.stringify({ results: [{ title: "G", url: "https://ncatlab.org/nlab/show/group", content: "A group…" }] }));
      const run = async (hops: (() => Response)[], url = "http://searx.example.org/") => {
        upstream.length = 0;
        let i = 0;
        reply = () => (hops[i++] ?? ok)();
        return search("searxng", { q: "x", count: 1, lang: "en", url });
      };
      // The same host (a moved path, or its https) is followed; each request is sent without following on its own.
      let res = await run([() => redirect("/searx/search?q=x&format=json"), () => redirect("https://searx.example.org/searx/search?q=x&format=json", 301)]);
      expect(res.status).toBe(200);
      expect((await res.json()).hits).toHaveLength(1);
      expect(upstream.map((u) => u.url)).toEqual([
        "http://searx.example.org/search?q=x&format=json&language=en",
        "http://searx.example.org/searx/search?q=x&format=json",
        "https://searx.example.org/searx/search?q=x&format=json",
      ]);
      expect(upstream.map((u) => u.init.redirect)).toEqual(["manual", "manual", "manual"]);
      // A cloud metadata address, another host, a downgrade to http, another port, or a third redirect: refused.
      for (const hops of [
        [() => redirect("http://169.254.169.254/latest/meta-data/")],
        [() => redirect("https://evil.example/search")],
        [() => redirect("http://searx.example.org.evil.example/")],
        [() => redirect("http://searx.example.org:6379/")],
        [() => redirect("/a"), () => redirect("/b"), () => redirect("/c")],
      ]) {
        res = await run(hops);
        expect(res.status).toBe(502);
        expect(await res.json()).toMatchObject({ code: "unreachable", params: { provider: "SearXNG" }, detail: expect.stringContaining("redirect") });
        expect(upstream.some((u) => /169\.254|evil|6379|\/c$/.test(u.url))).toBe(false);
      }
      res = await run([() => redirect("http://searx.example.org/x")], "https://searx.example.org/");
      expect(res.status).toBe(502);
      expect(upstream).toHaveLength(1);
    });

    it("no part of a key reaches the error detail, even where the detail is cut short", async () => {
      reply = () =>
        new Response(JSON.stringify({ error: { code: "SUBSCRIPTION_TOKEN_INVALID", detail: `${"x".repeat(185)} token env-brave-key-123 is invalid` } }), { status: 422 });
      const body = JSON.stringify(await (await search("brave", { q: "x", count: 1, lang: "en" })).json());
      expect(body).toContain("invalidKey");
      expect(body).not.toMatch(/env-brav|brave-key/);
    });

    it("a rejected request doesn't echo the key it carried", async () => {
      const key = `secret-${"k".repeat(600)}`;
      const res = await search("tavily", { q: "x", count: 1, lang: "en", key });
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain("secret-kkk");
    });
  });
});
