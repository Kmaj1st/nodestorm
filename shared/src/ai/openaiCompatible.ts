import {
  DEFAULT_TIMEOUT_MS,
  DISCOVERY_TIMEOUT_MS,
  isTransientStatus,
  parseRetryAfter,
  ProviderError,
  withDeadline,
  withRetries,
  type ChatMessage,
  type CompleteOptions,
  type ModelInfo,
  type Provider,
  type RequestOptions,
} from "./provider";

export interface OpenAICompatibleConfig {
  id: string;
  label: string;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs?: number;
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
  private timeoutMs: number;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.model = cfg.model;
    this.baseURL = cfg.baseURL.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
    this.modelsQuery = cfg.modelsQuery ?? "";
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  private async request(path: string, init: RequestInit, opts: RequestOptions & { timeoutMs: number }) {
    if (!this.apiKey) throw new ProviderError(`${this.label}: API key is not set`, 503);
    // The deadline covers the whole exchange, including reading the body and any retries.
    const deadlineAt = Date.now() + opts.timeoutMs;
    return withDeadline(this.label, opts, (signal) =>
      withRetries(this.label, signal, deadlineAt, () => this.once(path, init, signal)),
    );
  }

  /** One HTTP exchange. Rate limits, 5xx and network failures come back marked as retryable. */
  private async once(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseURL}${path}`, {
        ...init,
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, ...init.headers },
      });
    } catch (e) {
      if (signal.aborted) throw e;
      const msg = `${this.label}: could not reach ${this.baseURL} (${e instanceof Error ? e.message : e})`;
      throw new ProviderError(msg, 502, {});
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const status = res.status === 401 || res.status === 403 ? 401 : res.status === 429 ? 429 : 502;
      const retry = isTransientStatus(res.status) ? { afterMs: parseRetryAfter(res.headers.get("retry-after")) } : undefined;
      throw new ProviderError(`${this.label} HTTP ${res.status}: ${body.slice(0, 300)}`, status, retry);
    }
    return res.json();
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    if (!this.model) throw new ProviderError(`${this.label}: no model selected`, 400);
    const body = JSON.stringify({
      model: this.model,
      messages,
      temperature: 0.3,
      max_tokens: opts.maxTokens ?? 2048,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    });
    const data = (await this.request(
      "/chat/completions",
      { method: "POST", body },
      { signal: opts.signal, timeoutMs: opts.timeoutMs ?? this.timeoutMs },
    )) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ProviderError(`${this.label}: empty response`);
    const tokens = data.usage?.total_tokens;
    if (typeof tokens === "number" && tokens > 0) opts.onUsage?.(tokens);
    return content;
  }

  async listModels(opts: RequestOptions = {}): Promise<ModelInfo[]> {
    const q = this.modelsQuery ? `?${this.modelsQuery}` : "";
    const data = (await this.request(`/models${q}`, {}, {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS,
    })) as { data?: { id: string }[] };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id) => !NON_CHAT.test(id))
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id }));
  }
}
