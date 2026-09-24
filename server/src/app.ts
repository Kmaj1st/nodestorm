import express from "express";
import { ProviderError, tasks, type TaskName } from "@nodestorm/shared";
import { ZodError } from "zod";
import type { Registry } from "./providers/registry.js";

export function createApp(registry: Registry) {
  const app = express();
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
      res.status(status).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  for (const name of Object.keys(tasks) as TaskName[]) {
    app.post(`/api/${name}`, async (req, res) => {
      try {
        const provider = registry.get(req.header("x-ai-provider"), req.header("x-ai-model"));
        res.json(await tasks[name](provider, req.body));
      } catch (err) {
        if (err instanceof ZodError) {
          res.status(400).json({ error: "Invalid request", details: err.issues });
        } else if (err instanceof ProviderError) {
          res.status(err.status).json({ error: err.message });
        } else {
          console.error(err);
          res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
        }
      }
    });
  }
  return app;
}
