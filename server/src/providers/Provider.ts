export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  /** Ask the provider to return a JSON object (providers that support it enforce this). */
  json?: boolean;
  /** Allow the provider to use web search if it supports it. */
  search?: boolean;
  maxTokens?: number;
}

/** A pluggable LLM backend. Implementations only need to turn messages into text. */
export interface Provider {
  id: string;
  label: string;
  model: string;
  configured: boolean;
  complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
