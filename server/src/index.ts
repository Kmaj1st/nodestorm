import { createApp } from "./app.js";
import { createRegistry } from "./providers/registry.js";

const registry = createRegistry();
const port = Number(process.env.PORT || 8787);
createApp(registry).listen(port, () => {
  const p = registry.get();
  console.log(`NodeStorm server on http://localhost:${port} — provider: ${p.label} (${p.model})${p.configured ? "" : " [NOT CONFIGURED]"}`);
});
