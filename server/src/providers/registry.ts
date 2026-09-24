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

/**
 * Server-side provider configuration comes from environment variables (server/.env): <KIND>_API_KEY,
 * <KIND>_BASE_URL and <KIND>_MODEL, e.g. SILICONFLOW_API_KEY or DEEPSEEK_MODEL.
 */
export function envConfig(kind: ProviderKind, env = process.env): ProviderConfig {
  if (kind === "mock") return {};
  const p = kind.toUpperCase();
  const cfg: ProviderConfig = { apiKey: env[`${p}_API_KEY`], baseURL: env[`${p}_BASE_URL`], model: env[`${p}_MODEL`] };
  return kind === "anthropic" ? { ...cfg, webSearch: env.ANTHROPIC_WEB_SEARCH === "1" } : cfg;
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
