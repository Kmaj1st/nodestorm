import {
  createProvider,
  isProviderKind,
  PROVIDERS,
  ProviderError,
  type Provider,
  type ProviderConfig,
  type ProviderKind,
  type ProvidersResponse,
} from "@nodestorm/shared";

/** Server-side provider configuration comes from environment variables (server/.env). */
export function envConfig(kind: ProviderKind, env = process.env): ProviderConfig {
  switch (kind) {
    case "siliconflow":
      return { apiKey: env.SILICONFLOW_API_KEY, baseURL: env.SILICONFLOW_BASE_URL, model: env.SILICONFLOW_MODEL };
    case "anthropic":
      return { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, webSearch: env.ANTHROPIC_WEB_SEARCH === "1" };
    case "openai":
      return { apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL };
    case "mock":
      return {};
  }
}

export function createRegistry(env = process.env) {
  const defaultId: ProviderKind = isProviderKind(env.AI_PROVIDER) ? env.AI_PROVIDER : "siliconflow";

  return {
    defaultId,
    /** Build a provider from server env; the client may pick the provider and model, never the key. */
    get(id?: string | null, model?: string | null, timeoutMs?: number): Provider {
      const kind = id || defaultId;
      if (!isProviderKind(kind)) throw new ProviderError(`Unknown provider "${id}"`, 400);
      const cfg = envConfig(kind, env);
      return createProvider(kind, { ...cfg, model: model || cfg.model, timeoutMs: timeoutMs ?? cfg.timeoutMs });
    },
    info(): ProvidersResponse {
      return {
        default: defaultId,
        providers: PROVIDERS.map((m) => {
          const p = createProvider(m.kind, envConfig(m.kind, env));
          return { id: p.id, label: p.label, model: p.model, configured: p.configured };
        }),
      };
    },
  };
}
export type Registry = ReturnType<typeof createRegistry>;
