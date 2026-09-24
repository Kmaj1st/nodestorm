import type { AddressInfo } from "node:net";
import type { ChatMessage, Provider } from "@nodestorm/shared";
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
