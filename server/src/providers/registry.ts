import type { ProvidersResponse } from "@nodestorm/shared";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { ProviderError, type Provider } from "./Provider.js";
import { createOpenAIProvider, createSiliconFlowProvider } from "./siliconflow.js";

/** Register new providers here; anything implementing Provider plugs in. */
export function createRegistry(env = process.env) {
  const providers = new Map<string, Provider>();
  for (const p of [createSiliconFlowProvider(env), new AnthropicProvider(env), createOpenAIProvider(env), new MockProvider()]) {
    providers.set(p.id, p);
  }
  const defaultId = env.AI_PROVIDER && providers.has(env.AI_PROVIDER) ? env.AI_PROVIDER : "siliconflow";

  return {
    defaultId,
    get(id?: string | null): Provider {
      const p = providers.get(id || defaultId);
      if (!p) throw new ProviderError(`Unknown provider "${id}"`, 400);
      return p;
    },
    info(): ProvidersResponse {
      return {
        default: defaultId,
        providers: [...providers.values()].map((p) => ({ id: p.id, label: p.label, model: p.model, configured: p.configured })),
      };
    },
  };
}
export type Registry = ReturnType<typeof createRegistry>;
