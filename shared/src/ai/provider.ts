export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RequestOptions {
  /** Cancels the request (user pressed Cancel, dialog closed…). */
  signal?: AbortSignal;
  /** Overrides the provider's configured timeout for this call. */
  timeoutMs?: number;
}

export interface CompleteOptions extends RequestOptions {
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
  listModels(opts?: RequestOptions): Promise<ModelInfo[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** Thrown when the caller cancelled the request. Not a failure — the UI shouldn't report it as one. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

/** Generous by default: reasoning models (e.g. DeepSeek-R1) can take a minute or more. */
export const DEFAULT_TIMEOUT_MS = 90_000;
export const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Run `fn` with a signal that aborts when the caller cancels or the deadline passes, and make sure the
 * returned promise settles by then even if `fn` ignores the signal. Aborts surface as CancelledError
 * (caller cancelled) or a 504 ProviderError (timed out) — never as a hang.
 */
export async function withDeadline<T>(
  label: string,
  opts: RequestOptions & { timeoutMs: number },
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const outer = opts.signal;
  if (outer?.aborted) throw new CancelledError();
  const ctrl = new AbortController();
  let timedOut = false;
  let rejectAbort!: (e: unknown) => void;
  const aborted = new Promise<never>((_, reject) => (rejectAbort = reject));
  const fail = () =>
    timedOut
      ? new ProviderError(
          `${label} didn't respond within ${Math.round(opts.timeoutMs / 1000)}s — the model may be overloaded or slow. Try again, pick a faster model, or raise the timeout in Settings.`,
          504,
        )
      : new CancelledError();
  const onAbort = () => {
    ctrl.abort();
    rejectAbort(fail());
  };
  const timer = setTimeout(() => {
    timedOut = true;
    onAbort();
  }, opts.timeoutMs);
  outer?.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([fn(ctrl.signal), aborted]);
  } catch (e) {
    // Whatever fn threw while being aborted (AbortError, SDK abort error…) is reported as the abort reason.
    if (ctrl.signal.aborted) throw fail();
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}
