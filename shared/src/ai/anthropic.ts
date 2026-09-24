import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type ChatMessage, type CompleteOptions, type ModelInfo, type Provider } from "./provider";

export interface AnthropicConfig {
  apiKey: string | undefined;
  model: string;
  /** Let Claude use server-side web search to ground names/relations. */
  webSearch?: boolean;
}

/** Claude adapter. Works in Node and, with the user's own key, directly from the browser. */
export class AnthropicProvider implements Provider {
  id = "anthropic";
  label = "Anthropic Claude";
  model: string;
  private client: Anthropic | null;
  private webSearch: boolean;

  constructor(cfg: AnthropicConfig) {
    this.model = cfg.model;
    this.webSearch = Boolean(cfg.webSearch);
    this.client = cfg.apiKey
      ? new Anthropic({
          apiKey: cfg.apiKey,
          // The key is the user's own, entered into their own browser; nothing is shared with other users.
          dangerouslyAllowBrowser: true,
        })
      : null;
  }

  get configured() {
    return this.client !== null;
  }

  private get api() {
    if (!this.client) throw new ProviderError("Anthropic: API key is not set", 503);
    return this.client;
  }

  private wrap(err: unknown): never {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic: invalid API key", 401);
    if (err instanceof Anthropic.PermissionDeniedError) throw new ProviderError("Anthropic: this key can't use that model", 401);
    if (err instanceof Anthropic.NotFoundError) throw new ProviderError(`Anthropic: model "${this.model}" not found`, 400);
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic: rate limited", 429);
    if (err instanceof Anthropic.APIConnectionError) throw new ProviderError("Anthropic: could not reach the API");
    if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error ${err.status}: ${err.message}`);
    throw err;
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    const client = this.api;
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo: Anthropic.Beta.BetaMessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const tools: Anthropic.Beta.BetaToolUnion[] =
      opts.search && this.webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }] : [];

    try {
      // Server tools may return pause_turn; resume by sending the partial turn back.
      for (let i = 0; i < 4; i++) {
        const res = await client.beta.messages.create({
          model: this.model,
          max_tokens: opts.maxTokens ?? 16000,
          system,
          messages: convo,
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          ...(tools.length ? { tools } : {}),
        });
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
      this.wrap(err);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const out: ModelInfo[] = [];
      for await (const m of this.api.models.list()) out.push({ id: m.id, label: m.display_name });
      return out;
    } catch (err) {
      this.wrap(err);
    }
  }
}
