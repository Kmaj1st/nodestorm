import {
  createProvider,
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
import { useSettings } from "../store/settingsStore";

/** Thrown when an AI call can't run until the user fills in Settings. */
export class NeedsSetupError extends Error {}

function browserProvider(kind: ProviderKind, cfg: ProviderConfig): Provider {
  if (providerMeta(kind).needsKey && !cfg.apiKey) {
    throw new NeedsSetupError(`Add your ${providerMeta(kind).label} API key in Settings to use AI features.`);
  }
  return createProvider(kind, cfg);
}

async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, init);
  } catch {
    throw new Error("Can't reach the NodeStorm server. Start it with `npm run dev`, or switch Settings to 'Directly from browser'.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback = res.status === 404 || res.status >= 500 ? "NodeStorm server is not running" : `Request failed (${res.status})`;
    throw new Error((data as { error?: string }).error ?? fallback);
  }
  return data as T;
}

type TaskResult<N extends TaskName> = Awaited<ReturnType<(typeof tasks)[N]>>;

/** Run an AI task either in the page (browser mode) or through the local server. */
async function run<N extends TaskName>(name: N, req: unknown): Promise<TaskResult<N>> {
  const s = useSettings.getState();
  if (s.connection === "browser") {
    const provider = browserProvider(s.provider, s.configs[s.provider]);
    return (await tasks[name](provider, req)) as unknown as TaskResult<N>;
  }
  const model = s.serverModels[s.provider];
  return serverFetch<TaskResult<N>>(name, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-provider": s.provider,
      ...(model ? { "x-ai-model": model } : {}),
    },
    body: JSON.stringify(req),
  });
}

export const api = {
  name: (req: NameRequest) => run("name", req),
  relate: (req: RelateRequest) => run("relate", req),
  deps: (req: DepsRequest) => run("deps", req),
  derive: (req: DeriveRequest) => run("derive", req),

  /** Providers configured on the local server (server mode only). */
  serverProviders: () => serverFetch<ProvidersResponse>("providers"),

  /** Discover models for a provider using the given (unsaved) settings. */
  async listModels(kind: ProviderKind, cfg: ProviderConfig, connection: "browser" | "server"): Promise<ModelInfo[]> {
    if (connection === "browser") return browserProvider(kind, cfg).listModels();
    const r = await serverFetch<{ models: ModelInfo[] }>(`models?provider=${kind}`);
    return r.models;
  },
};
