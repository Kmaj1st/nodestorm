import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "../src/ai/factory";

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
