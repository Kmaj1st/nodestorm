import { ProviderError } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, NeedsSetupError } from "../src/lib/api";
import { useSettings } from "../src/store/settingsStore";

// AI calls through the local server (Settings: "Through the NodeStorm server"): what is sent, and how the server's
// failures reach the user. fetch is stubbed; nothing leaves the test.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

interface Call {
  url: string;
  init?: RequestInit;
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const headers = (c: Call) => c.init!.headers as Record<string, string>;
const nameReq = { input: "group", context: [] } as never;

let initial: ReturnType<typeof useSettings.getState>;
beforeEach(() => {
  initial ??= useSettings.getState();
  useSettings.setState({ ...initial, connection: "server", provider: "anthropic", serverModels: {}, visionModels: {}, language: "auto" });
});
afterEach(() => vi.unstubAllGlobals());

describe("AI calls through the server", () => {
  it("posts the request with the provider, timeout, chosen model and output language as headers", async () => {
    useSettings.setState({ serverModels: { anthropic: "claude-x" }, language: "简体中文" });
    const calls = stubFetch(() => json({ name: "Group", definition: "d" }));
    const out = await api.name(nameReq);
    expect(out).toEqual({ name: "Group", definition: "d" });
    expect(calls[0].url).toBe("/api/name");
    expect(calls[0].init!.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init!.body))).toEqual(nameReq);
    expect(headers(calls[0])).toMatchObject({ "x-ai-provider": "anthropic", "x-ai-model": "claude-x", "x-ai-language": encodeURIComponent("简体中文") });
    expect(Number(headers(calls[0])["x-ai-timeout"])).toBeGreaterThan(0);
    // Header values must be ASCII.
    expect(Object.values(headers(calls[0])).every((v) => /^[\x20-\x7e]*$/.test(v))).toBe(true);
  });

  it("leaves the model header out when none is set, and reads scanned pages with the vision model", async () => {
    const calls = stubFetch(() => json({ text: "page" }));
    useSettings.setState({ language: "  " });
    await api.name(nameReq);
    expect(headers(calls[0])["x-ai-model"]).toBeUndefined();
    expect(headers(calls[0])["x-ai-language"]).toBeUndefined();
    useSettings.setState({ serverModels: { anthropic: "claude-x" }, visionModels: { anthropic: " claude-eyes " } });
    await api.readPage({ image: "data:image/png;base64,AAAA" } as never);
    expect(calls[1].url).toBe("/api/readPage");
    expect(headers(calls[1])["x-ai-model"]).toBe("claude-eyes");
  });

  it("says the server is not running when it can't be reached or answers 404/5xx", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.name(nameReq)).rejects.toThrow(/Can't reach the NodeStorm server/);
    stubFetch(() => new Response("<html>", { status: 502 }));
    await expect(api.name(nameReq)).rejects.toThrow("NodeStorm server is not running");
    stubFetch(() => json({}, 404));
    await expect(api.name(nameReq)).rejects.toThrow("NodeStorm server is not running");
  });

  it("passes on the server's own message, and keeps a provider error's code so it is shown translated", async () => {
    stubFetch(() => json({ error: "Input too long" }, 400));
    await expect(api.name(nameReq)).rejects.toThrow("Input too long");
    stubFetch(() => json({}, 413));
    await expect(api.name(nameReq)).rejects.toThrow("Request failed (413)");
    stubFetch(() => json({ error: "Anthropic: invalid API key", code: "invalidKey", params: { provider: "Anthropic" } }, 401));
    const err = await api.name(nameReq).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 401, info: { code: "invalidKey" } });
  });

  it("a cancelled call rejects without being reported as a missing server", async () => {
    stubFetch(({ init }) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const ctrl = new AbortController();
    const p = api.name(nameReq, ctrl.signal).catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    ctrl.abort();
    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message)).not.toMatch(/Can't reach the NodeStorm server/);
  });

  it("lists the server's models for a provider", async () => {
    const calls = stubFetch(() => json({ models: [{ id: "m1", label: "M1" }] }));
    expect(await api.listModels("openai", {} as never, "server")).toEqual([{ id: "m1", label: "M1" }]);
    expect(calls[0].url).toBe("/api/models?provider=openai");
  });
});

describe("AI calls in the browser", () => {
  it("need the user's own key for a provider that requires one, and make no request without it", async () => {
    const calls = stubFetch(() => json({}));
    useSettings.setState({ connection: "browser", provider: "anthropic", configs: { ...initial.configs, anthropic: { ...initial.configs.anthropic, apiKey: "" } } });
    await expect(api.name(nameReq)).rejects.toBeInstanceOf(NeedsSetupError);
    await expect(api.listModels("anthropic", { apiKey: "" } as never, "browser")).rejects.toBeInstanceOf(NeedsSetupError);
    expect(calls).toHaveLength(0);
  });
});
