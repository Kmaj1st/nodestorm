import express from "express";
import {
  CancelledError,
  fetchWebSearch,
  normalizeLanguage,
  ProviderError,
  SEARCH_ENGINES,
  tasks,
  type SearchEngineId,
  type TaskName,
} from "@nodestorm/shared";
import { z, ZodError } from "zod";
import type { Registry } from "./providers/registry.js";

/**
 * Output language from the `x-ai-language` header. Header values must be ASCII, so the client URI-encodes it;
 * normalizeLanguage keeps it short and on one line before it reaches a prompt.
 */
function headerLanguage(req: express.Request): string | undefined {
  const raw = req.header("x-ai-language");
  if (!raw || raw.length > 400) return undefined;
  try {
    return normalizeLanguage(decodeURIComponent(raw));
  } catch {
    return undefined; // malformed escape: ignore rather than fail the whole task
  }
}

/** The browser's timeout setting (ms), clamped to the range Settings allows; ignored when missing or invalid. */
export function parseTimeout(raw: string | undefined): number | undefined {
  const ms = Number(raw);
  return raw && Number.isFinite(ms) ? Math.min(600_000, Math.max(10_000, Math.round(ms))) : undefined;
}

/** A `Host` or `Origin` hostname, lower-cased ("[::1]" keeps its brackets); "" when it can't be parsed. */
function hostnameOf(hostOrUrl: string): string {
  try {
    return new URL(hostOrUrl.includes("://") ? hostOrUrl : `http://${hostOrUrl}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Loopback names, which no web page can point at its own server (`*.localhost` never leaves the machine). */
const isLoopbackName = (h: string) => h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]";

export interface AppOptions {
  /** Host names besides the loopback ones that requests may be addressed to (e.g. from HOST=my-box.lan). */
  allowedHosts?: string[];
  /** Where web search keys (TAVILY_API_KEY, SERPER_API_KEY, BRAVE_API_KEY) and SEARXNG_URL come from (default process.env). */
  env?: Record<string, string | undefined>;
  /** How web searches reach the engines (tests pass a fake). */
  searchFetch?: typeof fetch;
}

/** A web search the browser asks the server to forward. The key or instance address is the user's, if typed in. */
const SearchBody = z.object({
  q: z.string().trim().min(1).max(500),
  count: z.number().int().min(1).max(20),
  lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/),
  key: z.string().trim().max(500).optional(),
  url: z.string().trim().max(2000).optional(),
});

const SEARCH_ENV: Record<SearchEngineId, string> = { tavily: "TAVILY_API_KEY", serper: "SERPER_API_KEY", brave: "BRAVE_API_KEY", searxng: "SEARXNG_URL" };

export function createApp(registry: Registry, opts: AppOptions = {}) {
  const app = express();
  const extra = new Set((opts.allowedHosts ?? []).map((h) => hostnameOf(h)).filter(Boolean));
  const allowed = (h: string) => Boolean(h) && (isLoopbackName(h) || extra.has(h));
  // The server has no login and spends the keys in server/.env, so only the app on this machine may call it:
  // - Host: a site whose name the attacker re-points at 127.0.0.1 (DNS rebinding) is then "same-origin" with the
  //   server, but its requests still carry the attacker's name in Host.
  // - Origin: other sites' pages can still send simple (no-preflight) requests to localhost; browsers mark them.
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (!allowed(hostnameOf(req.header("host") ?? "")) || (origin !== undefined && !allowed(hostnameOf(origin)))) {
      res.status(403).json({ error: "Forbidden: this server only answers the NodeStorm app on this computer." });
      return;
    }
    next();
  });
  // Scanned pages sent for reading are images; every other request is small.
  app.use("/api/readPage", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/providers", (_req, res) => {
    res.json(registry.info());
  });

  app.get("/api/models", async (req, res) => {
    try {
      const provider = registry.get(req.query.provider as string | undefined);
      res.json({ models: await provider.listModels() });
    } catch (err) {
      const status = err instanceof ProviderError ? err.status : 500;
      // `code` (with its params and detail) lets the browser say it in the interface language.
      const info = err instanceof ProviderError ? err.info : undefined;
      res.status(status).json({ error: err instanceof Error ? err.message : "Internal error", ...info });
    }
  });

  // Web search, forwarded for the browser: Brave allows no cross-site calls, and keys may live in server/.env. The
  // answer is the engine's hits as parsed by shared/src/lookup/webSearch.ts; the browser cleans them up.
  app.post("/api/search/:engine", async (req, res) => {
    const engine = req.params.engine as SearchEngineId;
    if (!SEARCH_ENGINES.includes(engine)) {
      res.status(404).json({ error: "Unknown search engine" });
      return;
    }
    const body = SearchBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request", details: body.error.issues });
      return;
    }
    const { q, count, lang, key, url } = body.data;
    const env = opts.env ?? process.env;
    const fromEnv = env[SEARCH_ENV[engine]]?.trim() || undefined;
    const auth = engine === "searxng" ? { url: url || fromEnv } : { key: key || fromEnv };
    const ctrl = new AbortController();
    res.on("close", () => !res.writableFinished && ctrl.abort());
    try {
      res.json({ hits: await fetchWebSearch(engine, { q, count, lang }, auth, { signal: ctrl.signal, fetch: opts.searchFetch }) });
    } catch (err) {
      if (err instanceof CancelledError) {
        if (!res.headersSent) res.status(499).end();
      } else if (err instanceof ProviderError) {
        res.status(err.status).json({ error: err.message, ...err.info });
      } else {
        console.error(err);
        res.status(500).json({ error: "Internal error" });
      }
    }
  });

  for (const name of Object.keys(tasks) as TaskName[]) {
    app.post(`/api/${name}`, async (req, res) => {
      try {
        const provider = registry.get(req.header("x-ai-provider"), req.header("x-ai-model"), parseTimeout(req.header("x-ai-timeout")));
        // Stop the upstream AI call if the browser gives up (cancel, timeout, closed tab).
        const ctrl = new AbortController();
        res.on("close", () => !res.writableFinished && ctrl.abort());
        res.json(await tasks[name](provider, req.body, { signal: ctrl.signal, language: headerLanguage(req) }));
      } catch (err) {
        if (err instanceof CancelledError) {
          if (!res.headersSent) res.status(499).end();
        } else if (err instanceof ZodError) {
          res.status(400).json({ error: "Invalid request", details: err.issues });
        } else if (err instanceof ProviderError) {
          res.status(err.status).json({ error: err.message, ...err.info });
        } else {
          console.error(err);
          res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
        }
      }
    });
  }
  return app;
}
