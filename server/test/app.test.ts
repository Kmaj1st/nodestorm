import type { AddressInfo } from "node:net";
import { EXTRACT_MAX_CHARS, MockProvider, type ChatMessage, type Provider } from "@nodestorm/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, parseTimeout } from "../src/app";
import type { Registry } from "../src/providers/registry";

describe("server: x-ai-language", () => {
  const prompts: ChatMessage[][] = [];
  const provider: Provider = {
    id: "rec", label: "Rec", model: "m", configured: true, listModels: async () => [],
    complete: async (m) => (prompts.push(m), '{"prerequisites":[]}'),
  };
  const registry = { get: () => provider, info: () => ({ default: "mock", providers: [] }) } as unknown as Registry;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
  let base = "";

  beforeAll(async () => {
    server = createApp(registry).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const deps = (headers: Record<string, string>) =>
    fetch(`${base}/api/deps`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ node: { name: "X" } }),
    });

  it("passes the URI-encoded language into the prompt", async () => {
    const res = await deps({ "x-ai-language": encodeURIComponent("Chinese (中文)") });
    expect(res.status).toBe(200);
    expect(prompts.at(-1)![0].content).toContain("in Chinese (中文)");
  });

  it("ignores malformed or oversized values instead of failing", async () => {
    expect((await deps({ "x-ai-language": "%E4%B8" })).status).toBe(200);
    expect(prompts.at(-1)![0].content).not.toContain("Output language");
    expect((await deps({ "x-ai-language": "x".repeat(500) })).status).toBe(200);
    expect(prompts.at(-1)![0].content).not.toContain("Output language");
  });

  it("exposes the explain task too", async () => {
    const res = await fetch(`${base}/api/explain`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai-language": "Deutsch" },
      body: JSON.stringify({ node: { name: "X" }, level: "rigorous" }),
    });
    // The recording provider answers every task with a deps reply, which has no summary.
    expect(res.status).toBe(502);
    expect(prompts.at(-1)![0].content).toMatch(/\[task:explain\][\s\S]*in Deutsch/);
    const bad = await fetch(`${base}/api/explain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ node: { name: "X" }, level: "poetic" }),
    });
    expect(bad.status).toBe(400);
  });

  it("limits the length of what reaches the prompt", async () => {
    await deps({ "x-ai-language": encodeURIComponent(`Deutsch${"!".repeat(100)}`) });
    expect(prompts.at(-1)![0].content).toContain(`in Deutsch${"!".repeat(33)}.`);
  });
});

describe("server: x-ai-timeout", () => {
  it("uses the browser's timeout, clamped to 10s–600s", () => {
    expect(parseTimeout("30000")).toBe(30_000);
    expect(parseTimeout("5")).toBe(10_000);
    expect(parseTimeout("9999999")).toBe(600_000);
  });

  it("ignores missing or invalid values", () => {
    expect(parseTimeout(undefined)).toBeUndefined();
    expect(parseTimeout("")).toBeUndefined();
    expect(parseTimeout("soon")).toBeUndefined();
  });

  it("passes it to the provider registry", async () => {
    let seen: number | undefined;
    const provider: Provider = {
      id: "rec", label: "Rec", model: "m", configured: true, listModels: async () => [],
      complete: async () => '{"prerequisites":[]}',
    };
    const registry = {
      get: (_id: unknown, _model: unknown, timeoutMs?: number) => ((seen = timeoutMs), provider),
      info: () => ({ default: "mock", providers: [] }),
    } as unknown as Registry;
    const server = createApp(registry).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await fetch(`${base}/api/deps`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai-timeout": "45000" },
      body: JSON.stringify({ node: { name: "X" } }),
    });
    server.close();
    expect(seen).toBe(45_000);
  });
});

describe("server: extract", () => {
  const registry = { get: () => new MockProvider(), info: () => ({ default: "mock", providers: [] }) } as unknown as Registry;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
  let base = "";
  beforeAll(async () => {
    server = createApp(registry).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  const extract = (body: unknown) =>
    fetch(`${base}/api/extract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("is exposed through the tasks map", async () => {
    const res = await extract({ text: "The kernel of a homomorphism is a normal subgroup.", existing: [{ name: "Homomorphism" }] });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.concepts.map((c: { name: string }) => c.name)).toEqual(["Kernel", "Homomorphism", "Normal Subgroup", "Subgroup"]);
    expect(data.prerequisites).toContainEqual(expect.objectContaining({ dependent: "Kernel", prerequisite: "Homomorphism" }));
  });

  it("rejects a text over the length cap with a 400", async () => {
    const res = await extract({ text: "x".repeat(EXTRACT_MAX_CHARS + 1) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/too long/);
  });
});

describe("server: quiz", () => {
  const registry = { get: () => new MockProvider(), info: () => ({ default: "mock", providers: [] }) } as unknown as Registry;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
  let base = "";
  beforeAll(async () => {
    server = createApp(registry).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  const quiz = (body: unknown) =>
    fetch(`${base}/api/quiz`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("is exposed through the tasks map", async () => {
    const res = await quiz({ node: { name: "Isomorphism" }, prerequisites: [{ name: "Homomorphism" }], style: "connect", multipleChoice: true });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.question).toContain("Homomorphism");
    expect(data.choices).toHaveLength(4);
    expect(data.choices[data.correctIndex]).toBe(data.answer);
  });

  it("rejects an unknown question style with a 400", async () => {
    expect((await quiz({ node: { name: "Group" }, style: "trick" })).status).toBe(400);
  });
});

describe("server: provider env config", () => {
  it("reads <KIND>_API_KEY / _BASE_URL / _MODEL for every OpenAI-compatible preset", async () => {
    const { envConfig } = await import("../src/providers/registry");
    const env = { DEEPSEEK_API_KEY: "d", DEEPSEEK_MODEL: "deepseek-reasoner", ZHIPU_BASE_URL: "https://x/v4" };
    expect(envConfig("deepseek", env)).toMatchObject({ apiKey: "d", model: "deepseek-reasoner" });
    expect(envConfig("zhipu", env)).toMatchObject({ baseURL: "https://x/v4" });
    expect(envConfig("anthropic", { ANTHROPIC_WEB_SEARCH: "1" })).toMatchObject({ webSearch: true });
    expect(envConfig("mock", env)).toEqual({});
  });
});
