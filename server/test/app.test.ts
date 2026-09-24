import type { AddressInfo } from "node:net";
import type { ChatMessage, Provider } from "@nodestorm/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
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

  it("limits the length of what reaches the prompt", async () => {
    await deps({ "x-ai-language": encodeURIComponent(`Deutsch${"!".repeat(100)}`) });
    expect(prompts.at(-1)![0].content).toContain(`in Deutsch${"!".repeat(33)}.`);
  });
});
