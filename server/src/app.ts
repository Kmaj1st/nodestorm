import express from "express";
import { CancelledError, normalizeLanguage, ProviderError, tasks, type TaskName } from "@nodestorm/shared";
import { ZodError } from "zod";
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

export function createApp(registry: Registry) {
  const app = express();
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
