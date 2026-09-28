import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../src/ai/anthropic";
import { ProviderError } from "../src/ai/provider";

// The Claude adapter against a fake Messages API (the SDK is real; its fetch is stubbed, so nothing leaves the test).

afterEach(() => vi.unstubAllGlobals());

const KEY = "sk-ant-test-0123456789abcdef";

interface Call {
  url: string;
  body: Record<string, unknown> | null;
  headers: Headers;
}

function stubFetch(...responses: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const call = { url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return next(call);
  });
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const message = (content: unknown[], stop_reason = "end_turn", usage = { input_tokens: 10, output_tokens: 5 }) => () =>
  json({ id: "msg_1", type: "message", role: "assistant", model: "claude-test", content, stop_reason, usage });

const provider = (over: Partial<ConstructorParameters<typeof AnthropicProvider>[0]> = {}) =>
  new AnthropicProvider({ apiKey: KEY, model: "claude-test", timeoutMs: 5000, ...over });

describe("Anthropic provider: requests", () => {
  it("sends system messages as the system prompt, images as base64 blocks, and reports the tokens used", async () => {
    const calls = stubFetch(message([{ type: "text", text: "Hello" }, { type: "text", text: " there" }]));
    const used: number[] = [];
    const out = await provider().complete(
      [
        { role: "system", content: "Be brief." },
        { role: "system", content: "Answer in JSON." },
        { role: "user", content: [{ type: "text", text: "Read this" }, { type: "image", mediaType: "image/png", data: "AAAA" }] },
      ],
      { onUsage: (n) => used.push(n) },
    );
    expect(out).toBe("Hello there");
    expect(used).toEqual([15]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/v1\/messages/);
    expect(calls[0].headers.get("x-api-key")).toBe(KEY);
    const body = calls[0].body!;
    expect(body.system).toBe("Be brief.\n\nAnswer in JSON.");
    expect(body.model).toBe("claude-test");
    expect(body.tools).toBeUndefined();
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Read this" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        ],
      },
    ]);
  });

  it("offers web search only when both the provider and the request allow it", async () => {
    const calls = stubFetch(message([{ type: "text", text: "ok" }]));
    await provider({ webSearch: true }).complete([{ role: "user", content: "q" }], { search: true });
    await provider({ webSearch: true }).complete([{ role: "user", content: "q" }]);
    await provider({ webSearch: false }).complete([{ role: "user", content: "q" }], { search: true });
    expect(calls.map((c) => (c.body!.tools as { name: string }[] | undefined)?.map((t) => t.name))).toEqual([["web_search"], undefined, undefined]);
  });

  it("resumes a paused turn by sending the partial answer back", async () => {
    const partial = [{ type: "server_tool_use", id: "t1", name: "web_search", input: { query: "q" } }];
    const calls = stubFetch(message(partial, "pause_turn"), message([{ type: "text", text: "done" }]));
    expect(await provider().complete([{ role: "user", content: "q" }])).toBe("done");
    expect(calls).toHaveLength(2);
    expect(calls[1].body!.messages).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: partial },
    ]);
  });

  it("gives up after too many pauses, and reports refusals and empty answers with their own codes", async () => {
    stubFetch(message([], "pause_turn"));
    await expect(provider().complete([{ role: "user", content: "q" }])).rejects.toMatchObject({ info: { code: "continuations" } });
    stubFetch(message([{ type: "text", text: "" }], "refusal"));
    await expect(provider().complete([{ role: "user", content: "q" }])).rejects.toMatchObject({ info: { code: "declined" } });
    stubFetch(message([]));
    await expect(provider().complete([{ role: "user", content: "q" }])).rejects.toMatchObject({ info: { code: "empty" } });
  });

  it("needs a key before any request is made", async () => {
    const calls = stubFetch(message([{ type: "text", text: "ok" }]));
    const p = provider({ apiKey: "" });
    expect(p.configured).toBe(false);
    await expect(p.complete([{ role: "user", content: "q" }])).rejects.toMatchObject({ status: 503, info: { code: "noKey" } });
    expect(calls).toHaveLength(0);
  });
});

describe("Anthropic provider: errors", () => {
  const apiError = (status: number, headers: Record<string, string> = {}) => () =>
    json({ type: "error", error: { type: "error", message: `bad request with ${KEY}` } }, status, headers);

  it("maps HTTP errors to codes the interface translates, never repeating the key", async () => {
    for (const [status, code, httpStatus] of [
      [401, "invalidKey", 401],
      [403, "modelDenied", 401],
      [404, "modelNotFound", 400],
      [400, "http", 502],
    ] as const) {
      stubFetch(apiError(status));
      const err = (await provider()
        .complete([{ role: "user", content: "q" }])
        .catch((e) => e)) as ProviderError;
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.info?.code).toBe(code);
      expect(err.status).toBe(httpStatus);
      expect(JSON.stringify({ m: err.message, i: err.info })).not.toContain(KEY);
    }
  });

  it("retries a rate limit after the server's Retry-After, and a transient server error", async () => {
    let calls = stubFetch(apiError(429, { "retry-after": "0" }), message([{ type: "text", text: "ok" }]));
    expect(await provider().complete([{ role: "user", content: "q" }])).toBe("ok");
    expect(calls).toHaveLength(2);
    calls = stubFetch(apiError(529, { "retry-after": "0" }), message([{ type: "text", text: "ok" }]));
    expect(await provider().complete([{ role: "user", content: "q" }])).toBe("ok");
    expect(calls).toHaveLength(2);
    // A client error is not retried.
    calls = stubFetch(apiError(400));
    await expect(provider().complete([{ role: "user", content: "q" }])).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(1);
  });

  it("a network failure is reported as unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(provider({ timeoutMs: 1500 }).complete([{ role: "user", content: "q" }])).rejects.toMatchObject({
      info: { code: "unreachable" },
    });
  });
});

describe("Anthropic provider: models", () => {
  it("lists every page of models with their display names", async () => {
    const calls = stubFetch(
      () => json({ data: [{ id: "claude-a", display_name: "A", type: "model", created_at: "2026-01-01T00:00:00Z" }], has_more: true, first_id: "claude-a", last_id: "claude-a" }),
      () => json({ data: [{ id: "claude-b", display_name: "B", type: "model", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "claude-b", last_id: "claude-b" }),
    );
    expect(await provider().listModels()).toEqual([
      { id: "claude-a", label: "A" },
      { id: "claude-b", label: "B" },
    ]);
    expect(calls[1].url).toMatch(/after_id=claude-a/);
  });

  it("reports a bad key while listing models", async () => {
    stubFetch(() => json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));
    await expect(provider().listModels()).rejects.toMatchObject({ status: 401, info: { code: "invalidKey" } });
  });
});
