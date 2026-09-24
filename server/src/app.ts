import express from "express";
import { ZodError } from "zod";
import { tasks, type TaskName } from "./ai/tasks.js";
import { ProviderError } from "./providers/Provider.js";
import type { Registry } from "./providers/registry.js";

export function createApp(registry: Registry) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/providers", (_req, res) => {
    res.json(registry.info());
  });

  for (const name of Object.keys(tasks) as TaskName[]) {
    app.post(`/api/${name}`, async (req, res) => {
      try {
        const provider = registry.get(req.header("x-ai-provider"));
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
