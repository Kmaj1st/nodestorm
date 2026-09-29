import {
  DEFAULT_TIMEOUT_MS,
  normalizeLanguage,
  ProviderError,
  withDeadline,
  type ProviderErrorInfo,
  type AbsurdChainRequest,
  type AnatomyRequest,
  type ConnectRequest,
  providerMeta,
  type tasks,
  type DepsRequest,
  type DeriveRequest,
  type ExtractRequest,
  type ExplainRequest,
  type ModelInfo,
  type NameRequest,
  type Provider,
  type ProviderConfig,
  type ProviderKind,
  type ProvidersResponse,
  type QuizRequest,
  type ResolveCycleRequest,
  type ReadPageRequest,
  type SplitProblemsRequest,
  type TutorHintRequest,
  type CheckStepRequest,
  type MathlibRequest,
  type RefereeRequest,
  type RelateRequest,
  type TaskName,
  type AssessRequest,
  type LatexifyRequest,
} from "@nodestorm/shared";
import { t } from "../i18n";
import { useGraphStore } from "../store/graphStore";
import { DEFAULT_CONCURRENCY, useSettings } from "../store/settingsStore";
import { addUsage } from "../store/usageStore";
import { createLimiter } from "./aiQueue";
import { isOnline, offlineBlocks, OfflineError } from "./online";

/** Thrown when an AI call can't run until the user fills in Settings. */
export class NeedsSetupError extends Error {}

/** The provider clients and tasks, fetched on the first browser-mode call (see aiBrowser.ts). */
const loadAi = () => import("./aiBrowser");

async function browserProvider(kind: ProviderKind, cfg: ProviderConfig): Promise<Provider> {
  if (providerMeta(kind).needsKey && !cfg.apiKey) {
    throw new NeedsSetupError(t("api.needsKey", { provider: providerMeta(kind).label }));
  }
  return (await loadAi()).createProvider(kind, cfg);
}

async function serverFetch<T>(path: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  return withDeadline(t("api.serverLabel"), { signal, timeoutMs }, async (sig) => {
    let res: Response;
    try {
      res = await fetch(`/api/${path}`, { ...init, signal: sig });
    } catch (e) {
      if (sig.aborted) throw e;
      throw new Error(t("api.noServer"));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fallback = res.status === 404 || res.status >= 500 ? t("api.serverDown") : t("api.requestFailed", { status: res.status });
      const err = data as { error?: string } & Partial<ProviderErrorInfo>;
      // A provider error keeps its code, so it is shown in the interface language (see errorMessage).
      if (err.code) throw new ProviderError(err.error ?? fallback, res.status, undefined, err as ProviderErrorInfo);
      throw new Error(err.error ?? fallback);
    }
    return data as T;
  });
}

type TaskResult<N extends TaskName> = Awaited<ReturnType<(typeof tasks)[N]>>;

/** At most `aiConcurrency` AI calls run at once; the rest wait (shown as "queued", still cancellable). */
const queue = createLimiter(() => useSettings.getState().aiConcurrency ?? DEFAULT_CONCURRENCY);

function run<N extends TaskName>(name: N, req: unknown, signal?: AbortSignal): Promise<TaskResult<N>> {
  // Offline: fail now instead of after the request timeout (the offline demo provider still works).
  if (offlineBlocks(useSettings.getState().provider, isOnline())) return Promise.reject(new OfflineError());
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
  // Scanned pages go to a model that can see images.
  const vision = name === "readPage" ? visionModel(s.provider) : undefined;
  if (s.connection === "browser") {
    const cfg = s.configs[s.provider];
    const provider = await browserProvider(s.provider, vision ? { ...cfg, model: vision } : cfg);
    const { tasks } = await loadAi();
    return (await tasks[name](provider, req, { signal, language, onUsage: addUsage })) as unknown as TaskResult<N>;
  }
  const model = vision ?? s.serverModels[s.provider];
  return serverFetch<TaskResult<N>>(
    name,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-provider": s.provider,
        "x-ai-timeout": String(timeoutMs),
        ...(model ? { "x-ai-model": model } : {}),
        // Header values must be ASCII; the server decodes this.
        ...(language ? { "x-ai-language": encodeURIComponent(language) } : {}),
      },
      body: JSON.stringify(req),
    },
    signal,
    // The server applies this timeout to each AI attempt and may retry once on malformed output;
    // give it room for both plus a moment to report before we give up.
    2 * timeoutMs + 5_000,
  );
}

/** The model that reads scanned pages for this provider, or undefined to use the chat model. */
export function visionModel(kind: ProviderKind): string | undefined {
  return useSettings.getState().visionModels[kind]?.trim() || providerMeta(kind).visionModel;
}

export const api = {
  name: (req: NameRequest, signal?: AbortSignal) => run("name", req, signal),
  relate: (req: RelateRequest, signal?: AbortSignal) => run("relate", req, signal),
  deps: (req: DepsRequest, signal?: AbortSignal) => run("deps", req, signal),
  derive: (req: DeriveRequest, signal?: AbortSignal) => run("derive", req, signal),
  explain: (req: ExplainRequest, signal?: AbortSignal) => run("explain", req, signal),
  anatomy: (req: AnatomyRequest, signal?: AbortSignal) => run("anatomy", req, signal),
  extract: (req: ExtractRequest, signal?: AbortSignal) => run("extract", req, signal),
  quiz: (req: Partial<QuizRequest> & Pick<QuizRequest, "node">, signal?: AbortSignal) => run("quiz", req, signal),
  resolveCycle: (req: ResolveCycleRequest, signal?: AbortSignal) => run("resolveCycle", req, signal),
  readPage: (req: ReadPageRequest, signal?: AbortSignal) => run("readPage", req, signal),
  splitProblems: (req: SplitProblemsRequest, signal?: AbortSignal) => run("splitProblems", req, signal),
  tutorHint: (req: Partial<TutorHintRequest> & Pick<TutorHintRequest, "problem">, signal?: AbortSignal) => run("tutorHint", req, signal),
  mathlib: (req: Partial<MathlibRequest> & Pick<MathlibRequest, "node">, signal?: AbortSignal) => run("mathlib", req, signal),
  connect: (req: Partial<ConnectRequest> & Pick<ConnectRequest, "node">, signal?: AbortSignal) => run("connect", req, signal),
  checkStep: (req: Partial<CheckStepRequest> & Pick<CheckStepRequest, "problem" | "step">, signal?: AbortSignal) =>
    run("checkStep", req, signal),
  refereeReport: (req: Partial<RefereeRequest> & Pick<RefereeRequest, "problem">, signal?: AbortSignal) =>
    run("refereeReport", req, signal),
  latexify: (req: LatexifyRequest, signal?: AbortSignal) => run("latexify", req, signal),
  assess: (req: Partial<AssessRequest> & Pick<AssessRequest, "name" | "sources">, signal?: AbortSignal) => run("assess", req, signal),
  absurdChain: (req: Partial<AbsurdChainRequest> & Pick<AbsurdChainRequest, "from" | "to">, signal?: AbortSignal) =>
    run("absurdChain", req, signal),

  /** Providers configured on the local server (server mode only). */
  serverProviders: () => serverFetch<ProvidersResponse>("providers"),

  /** Discover models for a provider using the given (unsaved) settings. */
  async listModels(
    kind: ProviderKind,
    cfg: ProviderConfig,
    connection: "browser" | "server",
    signal?: AbortSignal,
  ): Promise<ModelInfo[]> {
    if (connection === "browser") return (await browserProvider(kind, cfg)).listModels({ signal });
    const r = await serverFetch<{ models: ModelInfo[] }>(`models?provider=${kind}`, {}, signal, 20_000);
    return r.models;
  },
};
