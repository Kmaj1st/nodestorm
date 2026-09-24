import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import type { Provider } from "./provider";

export type ProviderKind = "siliconflow" | "anthropic" | "openai" | "mock";

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  webSearch?: boolean;
  /** Per-request deadline; defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface ProviderMeta {
  kind: ProviderKind;
  label: string;
  defaultModel: string;
  defaultBaseURL?: string;
  needsKey: boolean;
  keyUrl?: string;
}

/** Everything the UI needs to render a provider picker. Add new providers here and in createProvider. */
export const PROVIDERS: ProviderMeta[] = [
  {
    kind: "siliconflow",
    label: "SiliconFlow",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    defaultBaseURL: "https://api.siliconflow.cn/v1",
    needsKey: true,
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    kind: "anthropic",
    label: "Anthropic Claude",
    defaultModel: "claude-opus-5",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    kind: "openai",
    label: "OpenAI-compatible",
    defaultModel: "gpt-4o-mini",
    defaultBaseURL: "https://api.openai.com/v1",
    needsKey: true,
  },
  { kind: "mock", label: "Offline demo", defaultModel: "mock-kb", needsKey: false },
];

export const providerMeta = (kind: ProviderKind) => PROVIDERS.find((p) => p.kind === kind)!;

export function createProvider(kind: ProviderKind, cfg: ProviderConfig = {}): Provider {
  const meta = providerMeta(kind);
  const model = cfg.model || meta.defaultModel;
  const baseURL = cfg.baseURL || meta.defaultBaseURL || "";
  switch (kind) {
    case "siliconflow":
      return new OpenAICompatibleProvider({
        id: kind, label: meta.label, baseURL, apiKey: cfg.apiKey, model, timeoutMs: cfg.timeoutMs,
        modelsQuery: "type=text&sub_type=chat",
      });
    case "openai":
      return new OpenAICompatibleProvider({ id: kind, label: meta.label, baseURL, apiKey: cfg.apiKey, model, timeoutMs: cfg.timeoutMs });
    case "anthropic":
      return new AnthropicProvider({ apiKey: cfg.apiKey, model, webSearch: cfg.webSearch, timeoutMs: cfg.timeoutMs });
    case "mock":
      return new MockProvider();
  }
}

export const isProviderKind = (s: unknown): s is ProviderKind => PROVIDERS.some((p) => p.kind === s);
