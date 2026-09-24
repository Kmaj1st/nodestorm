import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "../src/ai/factory";
import { CancelledError, ProviderError, withDeadline, type Provider } from "../src/ai/provider";
import { tasks } from "../src/ai/tasks";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("model discovery", () => {
  it("SiliconFlow lists chat models with its type filter and the user's key", async () => {
    const calls = stubFetch(() => json({ data: [{ id: "Qwen/Qwen3-8B" }, { id: "deepseek-ai/DeepSeek-V3" }] }));
    const p = createProvider("siliconflow", { apiKey: "sk-test" });
    const models = await p.listModels();
    expect(models.map((m) => m.id)).toEqual(["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-8B"]);
    expect(calls[0].url).toBe("https://api.siliconflow.cn/v1/models?type=text&sub_type=chat");
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("OpenAI-compatible endpoints hide non-chat models and honour a custom base URL", async () => {
    const calls = stubFetch(() =>
      json({ data: [{ id: "gpt-4o" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }, { id: "tts-1" }] }),
    );
    const p = createProvider("openai", { apiKey: "k", baseURL: "http://localhost:11434/v1/" });
    expect((await p.listModels()).map((m) => m.id)).toEqual(["gpt-4o"]);
    expect(calls[0].url).toBe("http://localhost:11434/v1/models");
  });

  it("reports a bad key as an auth error", async () => {
    stubFetch(() => json({ error: "invalid key" }, 401));
    const p = createProvider("siliconflow", { apiKey: "bad" });
    await expect(p.listModels()).rejects.toMatchObject({ status: 401 });
  });

  it("refuses to call without a key", async () => {
    const calls = stubFetch(() => json({}));
    await expect(createProvider("siliconflow", {}).listModels()).rejects.toThrow(/API key/);
    expect(calls).toHaveLength(0);
  });

  it("chat uses the chosen model", async () => {
    const calls = stubFetch(() => json({ choices: [{ message: { content: "{}" } }] }));
    await createProvider("siliconflow", { apiKey: "k", model: "Qwen/Qwen3-8B" }).complete([{ role: "user", content: "hi" }]);
    expect(JSON.parse(String(calls[0].init?.body)).model).toBe("Qwen/Qwen3-8B");
  });

  it("mock provider needs no key", async () => {
    expect(await createProvider("mock").listModels()).toHaveLength(1);
  });
});

describe("timeouts and cancellation", () => {
  // A server that accepts the request and never answers (but honours abort, like real fetch).
  const hangingFetch = () =>
    vi.stubGlobal(
      "fetch",
      (_url: string, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );

  it("a request that never answers fails with a timeout error", async () => {
    hangingFetch();
    const p = createProvider("siliconflow", { apiKey: "k", timeoutMs: 50 });
    const err = await p.complete([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(504);
    expect(err.message).toMatch(/didn't respond within/);
  });

  it("settles even if the underlying call ignores the abort signal", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const p = createProvider("openai", { apiKey: "k", timeoutMs: 50 });
    await expect(p.listModels({ timeoutMs: 50 })).rejects.toMatchObject({ status: 504 });
  });

  it("caller cancellation surfaces as CancelledError, not a failure", async () => {
    hangingFetch();
    const ctrl = new AbortController();
    const p = createProvider("siliconflow", { apiKey: "k" });
    const pending = p.complete([{ role: "user", content: "hi" }], { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
  });

  it("an already-cancelled signal never sends the request", async () => {
    const calls = stubFetch(() => json({}));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(createProvider("siliconflow", { apiKey: "k" }).listModels({ signal: ctrl.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
    expect(calls).toHaveLength(0);
  });

  it("timeouts are not retried as malformed output", async () => {
    let calls = 0;
    const slow: Provider = {
      id: "slow", label: "Slow", model: "m", configured: true, listModels: async () => [],
      complete: (_m, o) => withDeadline("Slow", { signal: o?.signal, timeoutMs: 30 }, () => { calls++; return new Promise(() => {}); }),
    };
    await expect(tasks.deps(slow, { node: { name: "X" } })).rejects.toMatchObject({ status: 504 });
    expect(calls).toBe(1);
  });
});

describe("reasoning models and JSON mode", () => {
  it("extracts the answer after a <think> block that contains braces", async () => {
    const { extractJson } = await import("../src/ai/tasks");
    expect(extractJson('<think>maybe {x} or {"y": 1 …</think>\n{"prerequisites": []}')).toEqual({ prerequisites: [] });
    expect(extractJson('Plan: use {a, b}. Answer: {"ok": true}')).toEqual({ ok: true });
    expect(extractJson('reasoning without the opening tag</think>{"ok": 1}')).toEqual({ ok: 1 });
  });

  it("retries without response_format when a model rejects JSON mode, and remembers it", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.response_format) return json({ message: "response_format json_object is not supported for this model" }, 400);
      return json({ choices: [{ message: { content: '{"ok":true}' } }] });
    });
    const p = () => createProvider("siliconflow", { apiKey: "k", model: "deepseek-ai/DeepSeek-R1-test" });
    expect(await p().complete([{ role: "user", content: "hi" }], { json: true })).toBe('{"ok":true}');
    expect(bodies.map((b) => Boolean(b.response_format))).toEqual([true, false]);
    // A new provider instance (as in browser mode) goes straight to the fallback.
    await p().complete([{ role: "user", content: "hi" }], { json: true });
    expect(bodies.map((b) => Boolean(b.response_format))).toEqual([true, false, false]);
  });

  it("an empty answer explains the likely cause", async () => {
    stubFetch(() => json({ choices: [{ message: { content: "" } }] }));
    await expect(createProvider("siliconflow", { apiKey: "k" }).complete([{ role: "user", content: "hi" }])).rejects.toThrow(
      /max_tokens/,
    );
  });
});

describe("third review: reasoning-model handling doesn't touch real content", () => {
  it("keeps </think> and <think> text that is part of the answer", async () => {
    const { extractJson } = await import("../src/ai/tasks");
    const quoted = { concepts: [{ name: "Think tag", quote: "close the block with </think> before answering" }] };
    expect(extractJson(JSON.stringify(quoted))).toEqual(quoted);
    const wrapped = { quote: "wrap it in <think>scratch</think> tags" };
    expect(extractJson(JSON.stringify(wrapped))).toEqual(wrapped);
    // …while a leading reasoning block is still skipped.
    expect(extractJson(`<think>{draft}</think>${JSON.stringify(wrapped)}`)).toEqual(wrapped);
  });

  it("a 400 about something else doesn't switch JSON mode off", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch((_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ error: { message: "Failed to deserialize the JSON body: max_tokens must be <= 2048" } }, 400);
    });
    const p = createProvider("siliconflow", { apiKey: "k", model: "some/other-model" });
    await expect(p.complete([{ role: "user", content: "hi" }], { json: true })).rejects.toThrow(/HTTP 400/);
    expect(bodies).toHaveLength(1); // no plain retry
    await expect(p.complete([{ role: "user", content: "hi" }], { json: true })).rejects.toThrow();
    expect(Boolean(bodies[1].response_format)).toBe(true); // still asks for JSON mode
  });

  it("the JSON-mode fallback is only remembered when the plain request works", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return json({ message: body.response_format ? "response_format is not supported" : "server busy" }, body.response_format ? 400 : 500);
    });
    const p = createProvider("siliconflow", { apiKey: "k", model: "flaky/model", timeoutMs: 2000 });
    await expect(p.complete([{ role: "user", content: "hi" }], { json: true })).rejects.toThrow();
    const before = bodies.length;
    stubFetch((_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ choices: [{ message: { content: "{}" } }] });
    });
    await p.complete([{ role: "user", content: "hi" }], { json: true });
    expect(Boolean(bodies[before].response_format)).toBe(true); // tried JSON mode again
  });
});
