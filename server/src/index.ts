import { createApp } from "./app.js";
import { createRegistry } from "./providers/registry.js";

const registry = createRegistry();
const port = Number(process.env.PORT || 8787);
// Loopback only by default: the server has no authentication and spends the API keys in server/.env, so it must not
// be reachable from the network unless HOST is set on purpose (e.g. HOST=0.0.0.0 behind your own auth proxy).
const host = process.env.HOST || "127.0.0.1";
createApp(registry).listen(port, host, () => {
  const p = registry.get();
  console.log(
    `NodeStorm server on http://${host === "127.0.0.1" ? "localhost" : host}:${port} — provider: ${p.label} (${p.model})` +
      (p.configured ? "" : " [NOT CONFIGURED]"),
  );
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    console.warn(`Warning: listening on ${host}. Anyone who can reach it can use your API keys; there is no login.`);
  }
});
