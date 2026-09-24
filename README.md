# NodeStorm

An AI-aided brainstorming graph. Add concepts as nodes. The AI then helps with four things:

- **Naming.** If you can only *describe* something, the AI suggests the established names and definitions for it.
- **Mixing.** Select two nodes and press **Mix ⇄**. The AI finds how they relate, **separately in each direction**. Each relation line has an arrowhead at both ends. Clicking the arrowhead at B shows what A does to B, and clicking the one at A shows what B does to A.
- **Dependencies.** Every new node is checked for direct prerequisites. Prerequisites already in the graph are linked with dashed dependency edges. Missing ones **block** the node until you **Install** them. Installing creates the missing node, links it, and checks that node's own prerequisites.
  *Example:* add *Homomorphism*, then *First Isomorphism Theorem*. The theorem uses homomorphisms and derives an isomorphism, so it shows as blocked with *Isomorphism* missing. Install it and the theorem becomes ready.
- **Sandbox mode.** **Fork sandbox** makes a copy of the current graph. You can derive (**Derive ✦**), mix and install in the copy without touching the original. When you're done, **Merge back** or **Discard**.

New concepts appear in a free spot near what you're looking at (or near the concept they relate to), and the view pans to them. **Tidy** arranges the graph in layers, with prerequisites above the concepts that depend on them. **🔍** or **Ctrl/Cmd+K** finds a concept by name or alias, then selects it and centres the view on it.

Graphs autosave to your browser's localStorage. **Export** and **Import** move them in and out as JSON.

## Setup

```bash
npm install
npm run web        # UI only: http://localhost:5173
```

Click **⚙ Set up AI** in the toolbar, choose a provider and paste your API key. The model list loads straight from the provider's API. Start typing to filter it, then pick a model. To try the app without a key, choose **Offline demo**. It has a tiny built-in abstract-algebra knowledge base.

`npm run build` produces a static site in `client/dist/` that runs without a server. You can open it from any static host.

### Where your key goes

In **Directly from this browser** mode, the page calls the provider itself. Your key goes only to that provider and never to a NodeStorm server.
- By default the key is kept only for the current tab and forgotten when you close it.
- If you tick **Remember keys on this device**, it is saved in the browser's localStorage instead. Only do that on your own device. Browser extensions and anyone using the same browser profile can read it.
- Use a separate key with a spending limit.
- **Forget all saved keys** removes them.

### Server mode (optional)

If you'd rather keep keys out of the browser, put them in `server/.env` and switch Settings to **Through the local NodeStorm server**:

```bash
cp server/.env.example server/.env   # add your keys
npm run dev                          # server on :8787 + UI on :5173
```

## AI providers

| Provider | Model discovery | Notes |
|---|---|---|
| SiliconFlow (default) | `GET /v1/models?type=text&sub_type=chat` | default model `deepseek-ai/DeepSeek-V3` |
| Anthropic Claude | `GET /v1/models` | default `claude-opus-5`; optional web search when naming/relating |
| OpenAI-compatible | `GET {baseURL}/models` (non-chat models hidden) | any compatible endpoint: OpenAI, Ollama, vLLM, DeepSeek… |
| Offline demo | built-in | no key; deterministic, used by tests |

In server mode the same providers are configured by env vars (`SILICONFLOW_API_KEY`, `SILICONFLOW_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WEB_SEARCH=1`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, …). See `server/.env.example`.

The provider code lives in `shared/src/ai/`, so the browser and the server run the same prompts, JSON extraction, zod validation and retry. To add a provider:
1. Implement the `Provider` interface: `complete(messages, opts)` and `listModels()`.
2. Add it to `PROVIDERS` and `createProvider` in `shared/src/ai/factory.ts`.
3. Map its env vars in `server/src/providers/registry.ts`.

## Layout

```
shared/   graph model + AI task schemas (zod), and the AI core: providers, prompts, tasks
server/   optional Express API: POST /api/{name,relate,deps,derive}, GET /api/providers, GET /api/models
client/   Vite + React + React Flow UI; pure graph logic in client/src/lib/graphOps.ts
e2e/      Playwright smoke test (runs against the mock provider)
```

## Checks

```bash
npm run typecheck
npm test        # vitest: AI task parsing/validation, model discovery, dependency/install/sandbox logic, layout
npm run e2e     # starts server (mock) + UI and drives the full flow in Chromium, incl. settings
```
