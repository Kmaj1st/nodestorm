import type Anthropic from "@anthropic-ai/sdk";
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

export interface AnthropicConfig {
  apiKey: string | undefined;
  model: string;
  /** Let Claude use server-side web search to ground names/relations. */
  webSearch?: boolean;
  timeoutMs?: number;
}

type Sdk = typeof Anthropic;
let sdk: Promise<Sdk> | null = null;

/**
 * The SDK is imported on first use: in the browser it is a chunk of its own (the app's biggest dependency by far)
 * that only loads when someone actually talks to Claude. A failed load (e.g. offline) is tried again next time.
 */
function loadSdk(): Promise<Sdk> {
  sdk ??= import("@anthropic-ai/sdk").then(
    (m) => m.default,
    (err) => {
      sdk = null;
      throw new ProviderError(`Anthropic: could not load the SDK (${err instanceof Error ? err.message : err})`, 502);
    },
  );
  return sdk;
}

/** Claude adapter. Works in Node and, with the user's own key, directly from the browser. */
export class AnthropicProvider implements Provider {
  id = "anthropic";
  label = "Anthropic Claude";
  model: string;
  private apiKey: string | undefined;
  private client: Anthropic | null = null;
  private webSearch: boolean;
  private timeoutMs: number;

  constructor(cfg: AnthropicConfig) {
    this.model = cfg.model;
    this.webSearch = Boolean(cfg.webSearch);
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.apiKey = cfg.apiKey || undefined;
  }

  get configured() {
    return this.apiKey !== undefined;
  }

  /** The SDK and a client for this key, created on the first request. */
  private async api(): Promise<{ client: Anthropic; Anthropic: Sdk }> {
    if (!this.apiKey) throw new ProviderError("Anthropic: API key is not set", 503);
    const Anthropic = await loadSdk();
    this.client ??= new Anthropic({
      apiKey: this.apiKey,
      // Retries go through withRetries, which keeps them inside the overall deadline.
      maxRetries: 0,
      // The key is the user's own, entered into their own browser; nothing is shared with other users.
      dangerouslyAllowBrowser: true,
    });
    return { client: this.client, Anthropic };
  }

  private wrap(err: unknown, Anthropic: Sdk): never {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic: invalid API key", 401);
    if (err instanceof Anthropic.PermissionDeniedError)
      throw new ProviderError("Anthropic: this key can't use that model", 401);
    if (err instanceof Anthropic.NotFoundError)
      throw new ProviderError(`Anthropic: model "${this.model}" not found`, 400);
    if (err instanceof Anthropic.APIUserAbortError) throw err;
    // Rate limits, overload/5xx and network failures are marked retryable; withRetries decides whether to wait.
    const retryAfter = () => ({
      afterMs: parseRetryAfter(err instanceof Anthropic.APIError ? err.headers?.get("retry-after") : null),
    });
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic: rate limited", 429, retryAfter());
    if (err instanceof Anthropic.APIConnectionError) throw new ProviderError("Anthropic: could not reach the API", 502, {});
    if (err instanceof Anthropic.APIError) {
      const retry = err.status !== undefined && isTransientStatus(err.status) ? retryAfter() : undefined;
      throw new ProviderError(`Anthropic API error ${err.status}: ${err.message}`, 502, retry);
    }
    throw err;
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    const { client, Anthropic } = await this.api();
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const initial: Anthropic.Beta.BetaMessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    const tools: Anthropic.Beta.BetaToolUnion[] =
      opts.search && this.webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }] : [];

    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const deadlineAt = Date.now() + timeoutMs;
    const attempt = async (signal: AbortSignal) => {
      const convo = [...initial];
      try {
        // Server tools may return pause_turn; resume by sending the partial turn back.
        for (let i = 0; i < 4; i++) {
          const res = await client.beta.messages.create(
            {
              model: this.model,
              max_tokens: opts.maxTokens ?? 16000,
              system,
              messages: convo,
              output_config: { effort: "medium" },
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              ...(tools.length ? { tools } : {}),
            },
            { signal, timeout: Math.max(1, deadlineAt - Date.now()) },
          );
          const used = (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);
          if (used > 0) opts.onUsage?.(used);
          if (res.stop_reason === "pause_turn") {
            convo.push({ role: "assistant", content: res.content });
            continue;
          }
          if (res.stop_reason === "refusal") throw new ProviderError("Anthropic: request was declined");
          const text = res.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
          if (!text) throw new ProviderError("Anthropic: empty response");
          return text;
        }
        throw new ProviderError("Anthropic: too many pause_turn continuations");
      } catch (err) {
        this.wrap(err, Anthropic);
      }
    };
    return withDeadline(this.label, { signal: opts.signal, timeoutMs }, (signal) =>
      withRetries(this.label, signal, deadlineAt, () => attempt(signal)),
    );
  }

  async listModels(opts: RequestOptions = {}): Promise<ModelInfo[]> {
    const { client, Anthropic } = await this.api();
    const timeoutMs = opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
    return withDeadline(this.label, { signal: opts.signal, timeoutMs }, async (signal) => {
      try {
        const out: ModelInfo[] = [];
        for await (const m of client.models.list({}, { signal, timeout: timeoutMs }))
          out.push({ id: m.id, label: m.display_name });
        return out;
      } catch (err) {
        this.wrap(err, Anthropic);
      }
    });
  }
}
