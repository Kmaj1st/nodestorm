import { ProviderError, type ChatMessage, type CompleteOptions, type Provider } from "./Provider.js";

export interface OpenAICompatibleConfig {
  id: string;
  label: string;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
}

/** Generic client for any OpenAI-compatible /chat/completions endpoint. */
export class OpenAICompatibleProvider implements Provider {
  id: string;
  label: string;
  model: string;
  private baseURL: string;
  private apiKey: string | undefined;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.model = cfg.model;
    this.baseURL = cfg.baseURL.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    if (!this.apiKey) throw new ProviderError(`${this.label}: API key is not configured`, 503);
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(`${this.label} HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ProviderError(`${this.label}: empty response`);
    return content;
  }
}
