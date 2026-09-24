import {
  DEFAULT_TIMEOUT_MS,
  createProvider,
  normalizeLanguage,
  withDeadline,
  type ClarifyRequest,
  providerMeta,
  tasks,
  type DepsRequest,
  type DeriveRequest,
  type ModelInfo,
  type NameRequest,
  type Provider,
  type ProviderConfig,
  type ProviderKind,
  type ProvidersResponse,
  type RelateRequest,
  type TaskName,
} from "@nodestorm/shared";
import { useGraphStore } from "../store/graphStore";
import { DEFAULT_CONCURRENCY, useSettings } from "../store/settingsStore";
import { addUsage } from "../store/usageStore";
import { createLimiter } from "./aiQueue";

/** Thrown when an AI call can't run until the user fills in Settings. */
export class NeedsSetupError extends Error {}

function browserProvider(kind: ProviderKind, cfg: ProviderConfig): Provider {
  if (providerMeta(kind).needsKey && !cfg.apiKey) {
    throw new NeedsSetupError(`Add your ${providerMeta(kind).label} API key in Settings to use AI features.`);
  }
  return createProvider(kind, cfg);
}

async function serverFetch<T>(path: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  return withDeadline("The NodeStorm server", { signal, timeoutMs }, async (sig) => {
    let res: Response;
    try {
      res = await fetch(`/api/${path}`, { ...init, signal: sig });
    } catch (e) {
      if (sig.aborted) throw e;
      throw new Error("Can't reach the NodeStorm server. Start it with `npm run dev`, or switch Settings to 'Directly from browser'.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fallback = res.status === 404 || res.status >= 500 ? "NodeStorm server is not running" : `Request failed (${res.status})`;
      throw new Error((data as { error?: string }).error ?? fallback);
    }
    return data as T;
  });
}

type TaskResult<N extends TaskName> = Awaited<ReturnType<(typeof tasks)[N]>>;

/** At most `aiConcurrency` AI calls run at once; the rest wait (shown as "queued", still cancellable). */
const queue = createLimiter(() => useSettings.getState().aiConcurrency ?? DEFAULT_CONCURRENCY);

function run<N extends TaskName>(name: N, req: unknown, signal?: AbortSignal): Promise<TaskResult<N>> {
  return queue.run(() => runNow(name, req, signal), {
    signal,
    onState: (state) => useGraphStore.getState().setBusyState(signal, state),
  });
}

/** Run an AI task either in the page (browser mode) or through the local server. */
async function runNow<N extends TaskName>(name: N, req: unknown, signal?: AbortSignal): Promise<TaskResult<N>> {
  // Settings are read when the call starts, so a queued call uses the latest ones.
  const s = useSettings.getState();
  const timeoutMs = s.configs[s.provider]?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const language = normalizeLanguage(s.language);
  if (s.connection === "browser") {
    const provider = browserProvider(s.provider, s.configs[s.provider]);
    return (await tasks[name](provider, req, { signal, language, onUsage: addUsage })) as unknown as TaskResult<N>;
  }
  const model = s.serverModels[s.provider];
  return serverFetch<TaskResult<N>>(
    name,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-provider": s.provider,
        ...(model ? { "x-ai-model": model } : {}),
        // Header values must be ASCII; the server decodes this.
        ...(language ? { "x-ai-language": encodeURIComponent(language) } : {}),
      },
      body: JSON.stringify(req),
    },
    signal,
    // The server enforces its own deadline too; give it a moment to report that before we give up.
    timeoutMs + 5_000,
  );
}

export const api = {
  name: (req: NameRequest, signal?: AbortSignal) => run("name", req, signal),
  clarify: (req: Partial<ClarifyRequest> & { name: string }, signal?: AbortSignal) => run("clarify", req, signal),
  relate: (req: RelateRequest, signal?: AbortSignal) => run("relate", req, signal),
  deps: (req: DepsRequest, signal?: AbortSignal) => run("deps", req, signal),
  derive: (req: DeriveRequest, signal?: AbortSignal) => run("derive", req, signal),

  /** Providers configured on the local server (server mode only). */
  serverProviders: () => serverFetch<ProvidersResponse>("providers"),

  /** Discover models for a provider using the given (unsaved) settings. */
  async listModels(
    kind: ProviderKind,
    cfg: ProviderConfig,
    connection: "browser" | "server",
    signal?: AbortSignal,
  ): Promise<ModelInfo[]> {
    if (connection === "browser") return browserProvider(kind, cfg).listModels({ signal });
    const r = await serverFetch<{ models: ModelInfo[] }>(`models?provider=${kind}`, {}, signal, 20_000);
    return r.models;
  },
};
