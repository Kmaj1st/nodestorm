import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type ChatMessage, type CompleteOptions, type Provider } from "./Provider.js";

/** Claude adapter. Optionally lets Claude use server-side web search to ground names/relations. */
export class AnthropicProvider implements Provider {
  id = "anthropic";
  label = "Anthropic Claude";
  model: string;
  private client: Anthropic | null;
  private webSearch: boolean;

  constructor(env = process.env) {
    this.model = env.ANTHROPIC_MODEL || "claude-opus-5";
    this.webSearch = env.ANTHROPIC_WEB_SEARCH === "1";
    this.client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  }

  get configured() {
    return this.client !== null;
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    if (!this.client) throw new ProviderError("Anthropic: API key is not configured", 503);
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo: Anthropic.Beta.BetaMessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const tools: Anthropic.Beta.BetaToolUnion[] =
      opts.search && this.webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }] : [];

    try {
      // Server tools may return pause_turn; resume by sending the partial turn back.
      for (let i = 0; i < 4; i++) {
        const res = await this.client.beta.messages.create({
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
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic: invalid API key", 401);
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic: rate limited", 429);
      if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error ${err.status}: ${err.message}`);
      throw err;
    }
  }
}
