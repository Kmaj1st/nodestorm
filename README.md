# NodeStorm

An AI-aided brainstorming graph. Add concepts as nodes. The AI then helps with four things:

- **Naming.** If you can only *describe* something, the AI suggests the established names and definitions for it.
- **Mixing.** Select two nodes and press **Mix ⇄**. The AI finds how they relate, **separately in each direction**. Each relation line has an arrowhead at both ends. Clicking the arrowhead at B shows what A does to B, and clicking the one at A shows what B does to A.
- **Dependencies.** Every new node is checked for direct prerequisites. Prerequisites already in the graph are linked with dashed dependency edges. Missing ones **block** the node until you **Install** them. Installing creates the missing node, links it, and checks that node's own prerequisites.
  *Example:* add *Homomorphism*, then *First Isomorphism Theorem*. The theorem uses homomorphisms and derives an isomorphism, so it shows as blocked with *Isomorphism* missing. Install it and the theorem becomes ready.
- **Sandbox mode.** **Fork sandbox** makes a copy of the current graph. You can derive (**Derive ✦**), mix and install in the copy without touching the original. When you're done, **Merge back** or **Discard**.

Graphs autosave to your browser's localStorage. **Export** and **Import** move them in and out as JSON.

## Setup

```bash
npm install
cp server/.env.example server/.env   # then add your API key
npm run dev                          # server on :8787, UI on http://localhost:5173
```

To try it without an API key, use the offline mock provider. It has a tiny built-in abstract-algebra knowledge base.

```bash
npm run dev:mock
```

## AI providers

Providers are pluggable (`server/src/providers/`). You set the default with `AI_PROVIDER` in `server/.env`, and you can switch per session from the dropdown in the toolbar.

| id            | Provider                           | Env vars                                                     |
|---------------|------------------------------------|--------------------------------------------------------------|
| `siliconflow` | SiliconFlow (default), OpenAI-compatible | `SILICONFLOW_API_KEY`, `SILICONFLOW_MODEL` (default `deepseek-ai/DeepSeek-V3`), `SILICONFLOW_BASE_URL` |
| `anthropic`   | Anthropic Claude                   | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-opus-5`), `ANTHROPIC_WEB_SEARCH=1` to let it search the web when naming or relating |
| `openai`      | Any OpenAI-compatible endpoint     | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`         |
| `mock`        | Offline, deterministic             | none                                                           |

To add a provider, implement the `Provider` interface (`complete(messages, opts) → string`) and register it in `server/src/providers/registry.ts`. Everything else is shared across providers: the prompts (`server/src/ai/prompts.ts`), JSON extraction, zod validation, and the retry on malformed output.

## Layout

```
shared/   zod schemas + types shared by client and server (graph model, AI task I/O)
server/   Express API: POST /api/{name,relate,deps,derive}, GET /api/providers
client/   Vite + React + React Flow UI; pure graph logic in client/src/lib/graphOps.ts
e2e/      Playwright smoke test (runs against the mock provider)
```

## Checks

```bash
npm run typecheck
npm test        # vitest: AI task parsing/validation, dependency/install/sandbox logic
npm run e2e     # starts server (mock) + UI and drives the full flow in Chromium
```
