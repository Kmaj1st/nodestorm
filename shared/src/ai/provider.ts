/** Part of a multimodal message. Images are base64 without a `data:` prefix. */
export type ContentPart = { type: "text"; text: string } | { type: "image"; mediaType: string; data: string };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** Plain text, or parts when the message carries images (only user messages do). */
  content: string | ContentPart[];
}

/** The text of a message, ignoring any images. */
export function textOf(content: ChatMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n\n");
}

export interface RequestOptions {
  /** Cancels the request (user pressed Cancel, dialog closed…). */
  signal?: AbortSignal;
  /** Overrides the provider's configured timeout for this call. */
  timeoutMs?: number;
  /** Language for the human-readable text in AI answers: "auto", a language name, or undefined (no instruction). */
  language?: string;
  /** Called with the tokens a successful provider response reports using (if it reports any). */
  onUsage?: (tokens: number) => void;
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
    /** Set on transient failures (rate limit, 5xx, network) worth retrying; `afterMs` comes from Retry-After. */
    public retry?: { afterMs?: number },
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

/** Retry-After is either delta-seconds or an HTTP date; returns milliseconds from `now`, or undefined. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** HTTP statuses worth retrying: rate limited, or a transient server/gateway failure (529 = Anthropic overloaded). */
export const isTransientStatus = (status: number) =>
  status === 408 || status === 429 || status === 529 || (status >= 500 && status <= 504);

/** Resolves after `ms`, or rejects with CancelledError as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryPolicy {
  /** Retries after the first attempt. */
  retries: number;
  /** First backoff delay; it doubles each retry, plus up to as much again of random jitter. */
  baseMs: number;
}
export const DEFAULT_RETRY: RetryPolicy = { retries: 2, baseMs: 1000 };

/**
 * Run `attempt`, retrying transient failures (a ProviderError with `retry` set) with exponential backoff and
 * jitter, honouring Retry-After. Meant to run inside withDeadline: it never waits past `deadlineAt` (if the
 * next wait wouldn't fit, it gives up right away), and cancelling during a wait stops it immediately.
 */
export async function withRetries<T>(
  label: string,
  signal: AbortSignal,
  deadlineAt: number,
  attempt: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (signal.aborted || !(e instanceof ProviderError) || !e.retry) throw e;
      const wait = e.retry.afterMs ?? policy.baseMs * 2 ** i * (1 + Math.random());
      if (i < policy.retries && Date.now() + wait < deadlineAt) {
        await sleep(wait, signal);
        continue;
      }
      if (e.status === 429)
        throw new ProviderError(`Rate limited by ${label} — try again in ${Math.max(1, Math.ceil(wait / 1000))} s.`, 429);
      throw e;
    }
  }
}

/** Keep a user-chosen output language short and on one line: it is spliced into prompts and sent as a header. */
export function normalizeLanguage(lang: string | null | undefined): string | undefined {
  const s = (lang ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return s || undefined;
}
