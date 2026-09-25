export type ProviderKind =
  | "siliconflow"
  | "anthropic"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "dashscope"
  | "ollama"
  | "openai"
  | "mock";

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
  /** Runs on this machine, so it keeps working without an internet connection. */
  local?: boolean;
  /**
   * Model that reads scanned PDF pages (images), when the default model can't see images. Unset: the chat model is
   * used, which works for providers whose models all take images.
   */
  visionModel?: string;
}

/** Everything the UI needs to render a provider picker. Add new providers here and in createProvider (createProvider.ts). */
export const PROVIDERS: ProviderMeta[] = [
  {
    kind: "siliconflow",
    label: "SiliconFlow",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    defaultBaseURL: "https://api.siliconflow.cn/v1",
    visionModel: "Qwen/Qwen2.5-VL-72B-Instruct",
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
  // Presets for other OpenAI-compatible services. Default models are a starting point: Settings lists what the key can
  // actually use (model discovery via GET /models).
  {
    kind: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    defaultBaseURL: "https://api.deepseek.com/v1",
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    kind: "moonshot",
    label: "Moonshot (Kimi)",
    defaultModel: "moonshot-v1-8k",
    defaultBaseURL: "https://api.moonshot.cn/v1",
    visionModel: "moonshot-v1-8k-vision-preview",
    needsKey: true,
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    kind: "zhipu",
    label: "Zhipu (GLM)",
    defaultModel: "glm-4-flash",
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    visionModel: "glm-4v-flash",
    needsKey: true,
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    kind: "dashscope",
    label: "Alibaba Qwen (DashScope)",
    defaultModel: "qwen-plus",
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    visionModel: "qwen-vl-max",
    needsKey: true,
    keyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
  },
  {
    // Browser mode needs Ollama to allow the page's origin: start it with OLLAMA_ORIGINS set (see README).
    kind: "ollama",
    label: "Ollama (local)",
    defaultModel: "qwen2.5:7b",
    defaultBaseURL: "http://localhost:11434/v1",
    needsKey: false,
    local: true,
  },
  {
    kind: "openai",
    label: "OpenAI-compatible",
    defaultModel: "gpt-4o-mini",
    defaultBaseURL: "https://api.openai.com/v1",
    needsKey: true,
  },
  { kind: "mock", label: "Offline demo", defaultModel: "mock-kb", needsKey: false, local: true },
];

export const providerMeta = (kind: ProviderKind) => PROVIDERS.find((p) => p.kind === kind)!;

export const isProviderKind = (s: unknown): s is ProviderKind => PROVIDERS.some((p) => p.kind === s);
