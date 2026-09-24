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

export interface ModelInfo {
  id: string;
  label?: string;
}

/** A pluggable LLM backend. Runs in the browser or in Node — implementations only use fetch / isomorphic SDKs. */
export interface Provider {
  id: string;
  label: string;
  model: string;
  configured: boolean;
  complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<string>;
  /** Models this account can use, for the model picker. */
  listModels(): Promise<ModelInfo[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
