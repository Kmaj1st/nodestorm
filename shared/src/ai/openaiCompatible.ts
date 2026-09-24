import { ProviderError, type ChatMessage, type CompleteOptions, type ModelInfo, type Provider } from "./provider";

export interface OpenAICompatibleConfig {
  id: string;
  label: string;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
  /** Extra query string for GET /models (e.g. SiliconFlow's "type=text&sub_type=chat"). */
  modelsQuery?: string;
}

// Endpoints like OpenAI's list every model; hide the ones that can't do chat.
const NON_CHAT = /embed|whisper|tts|dall-e|image|audio|moderation|rerank|transcribe|realtime|speech|vision-preview|search-/i;

/** Generic client for any OpenAI-compatible /chat/completions endpoint. */
export class OpenAICompatibleProvider implements Provider {
  id: string;
  label: string;
  model: string;
  private baseURL: string;
  private apiKey: string | undefined;
  private modelsQuery: string;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.model = cfg.model;
    this.baseURL = cfg.baseURL.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
    this.modelsQuery = cfg.modelsQuery ?? "";
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  private async request(path: string, init: RequestInit = {}) {
    if (!this.apiKey) throw new ProviderError(`${this.label}: API key is not set`, 503);
    let res: Response;
    try {
      res = await fetch(`${this.baseURL}${path}`, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, ...init.headers },
      });
    } catch (e) {
      throw new ProviderError(`${this.label}: could not reach ${this.baseURL} (${e instanceof Error ? e.message : e})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const status = res.status === 401 || res.status === 403 ? 401 : res.status === 429 ? 429 : 502;
      throw new ProviderError(`${this.label} HTTP ${res.status}: ${body.slice(0, 300)}`, status);
    }
    return res.json();
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    if (!this.model) throw new ProviderError(`${this.label}: no model selected`, 400);
    const data = (await this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    })) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ProviderError(`${this.label}: empty response`);
    return content;
  }

  async listModels(): Promise<ModelInfo[]> {
    const q = this.modelsQuery ? `?${this.modelsQuery}` : "";
    const data = (await this.request(`/models${q}`)) as { data?: { id: string }[] };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id) => !NON_CHAT.test(id))
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id }));
  }
}
