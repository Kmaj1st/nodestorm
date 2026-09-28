import { describe, expect, it } from "vitest";
import { createRegistry, envConfig } from "../src/providers/registry";

// The server's providers come from server/.env. A request may pick the provider and model, never the key; the
// providers list says which are configured without ever including a key.

const env = {
  AI_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "sk-deep-secret",
  DEEPSEEK_MODEL: "deepseek-chat",
  ANTHROPIC_API_KEY: "sk-ant-secret",
  ANTHROPIC_WEB_SEARCH: "1",
  OPENAI_BASE_URL: "http://localhost:11434/v1",
};

describe("server provider registry", () => {
  it("reads <KIND>_API_KEY, _BASE_URL and _MODEL; web search only for Anthropic when switched on", () => {
    expect(envConfig("deepseek", env)).toEqual({ apiKey: "sk-deep-secret", baseURL: undefined, model: "deepseek-chat" });
    expect(envConfig("anthropic", env)).toMatchObject({ apiKey: "sk-ant-secret", webSearch: true });
    expect(envConfig("anthropic", {})).toMatchObject({ webSearch: false });
    expect(envConfig("mock", env)).toEqual({});
  });

  it("uses AI_PROVIDER as the default, and a known default otherwise", () => {
    expect(createRegistry(env).defaultId).toBe("deepseek");
    expect(createRegistry({ AI_PROVIDER: "nonsense" }).defaultId).toBe("siliconflow");
  });

  it("builds the requested provider with the requested model, and refuses unknown providers", () => {
    const r = createRegistry(env);
    expect(r.get().model).toBe("deepseek-chat");
    expect(r.get(null, "deepseek-reasoner").model).toBe("deepseek-reasoner");
    expect(r.get("anthropic").configured).toBe(true);
    expect(() => r.get("../../etc")).toThrow(/Unknown provider/);
    let err: unknown;
    try {
      r.get("nope");
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 400, info: { code: "unknownProvider" } });
  });

  it("lists every provider with whether it is configured, and no key anywhere", () => {
    const info = createRegistry(env).info();
    expect(info.default).toBe("deepseek");
    const byId = Object.fromEntries(info.providers.map((p) => [p.id, p]));
    expect(byId.deepseek.configured).toBe(true);
    expect(byId.siliconflow.configured).toBe(false);
    expect(JSON.stringify(info)).not.toMatch(/secret/);
  });
});
