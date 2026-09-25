import { AnthropicProvider } from "./anthropic";
import { providerMeta, type ProviderConfig, type ProviderKind } from "./factory";
import { MockProvider } from "./mock";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import type { Provider } from "./provider";

// Kept apart from factory.ts (the provider list) so the web client can load the provider clients, and the offline
// demo's knowledge base, only when it first calls an AI in the page.

/** Providers that speak the OpenAI chat-completions API; they only differ in endpoint, default model and key page. */
const OPENAI_COMPATIBLE = new Set<ProviderKind>(["siliconflow", "deepseek", "moonshot", "zhipu", "dashscope", "ollama", "openai"]);

export function createProvider(kind: ProviderKind, cfg: ProviderConfig = {}): Provider {
  const meta = providerMeta(kind);
  const model = cfg.model || meta.defaultModel;
  const baseURL = cfg.baseURL || meta.defaultBaseURL || "";
  if (OPENAI_COMPATIBLE.has(kind)) {
    return new OpenAICompatibleProvider({
      id: kind,
      label: meta.label,
      baseURL,
      // Ollama ignores the key but the client always sends one.
      apiKey: cfg.apiKey || (meta.needsKey ? undefined : kind),
      model,
      timeoutMs: cfg.timeoutMs,
      ...(kind === "siliconflow" ? { modelsQuery: "type=text&sub_type=chat" } : {}),
    });
  }
  switch (kind) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: cfg.apiKey, model, webSearch: cfg.webSearch, timeoutMs: cfg.timeoutMs });
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`No client for provider "${kind}"`);
  }
}
