# NodeStorm

An AI-aided brainstorming graph. Add concepts as nodes. The AI then helps with four things:

- **Naming.** If you can only *describe* something, the AI suggests the established names and definitions for it.
- **Mixing.** Select two nodes and press **Mix ⇄**. The AI finds how they relate, **separately in each direction**. Each relation line has an arrowhead at both ends. Clicking the arrowhead at B shows what A does to B, and clicking the one at A shows what B does to A.
- **Dependencies.** Every new node is checked for direct prerequisites. Prerequisites already in the graph are linked with dashed dependency edges. Missing ones **block** the node until you **Install** them. Installing creates the missing node, links it, and checks that node's own prerequisites.
  *Example:* add *Homomorphism*, then *First Isomorphism Theorem*. The theorem uses homomorphisms and derives an isomorphism, so it shows as blocked with *Isomorphism* missing. Install it and the theorem becomes ready.
  - **Install all…** installs every missing prerequisite, then theirs, breadth-first. It stops at a depth limit (default 3) and a cap on new concepts (default 15). You can change both in Settings. The run appears in the status bar, and cancelling it there stops the whole run. Concepts with ambiguous names are skipped and listed in the summary.
  - The inspector's **Learning path** lists everything a concept builds on, in study order, and marks prerequisites that are still missing. **Highlight** shows that chain on the canvas and dims everything else.
  - **Dependency cycles** (A needs B needs A) usually mean the AI gave a wrong answer. The affected nodes and edges are flagged, and the inspector offers **Remove this link**.
- **Sandbox mode.** **Fork sandbox** (the 🧪+ button next to the graph selector) makes a copy of the current graph. You can derive (**Derive ✦**), mix and install in the copy without touching the original. When you're done, **Merge back** or **Discard** from the sandbox banner.

- **Extract from text.** Brainstorms often start from existing text. **File ▾ → Extract from text…** takes pasted lecture notes, a paragraph from a book or a messy list (or drop / load a `.txt` or `.md` file), up to 12,000 characters, with an optional *focus* hint. The AI lists candidate concepts, each with a definition and a short quote from the text, plus the relations (both directions) and prerequisites the text states. Review them before anything is added. Candidates already in the graph (by name, plural or alias) are unticked and flagged. Their relations link to the existing concept instead of adding a duplicate. You can rename candidates and untick concepts or relations. **Add selected** places the new concepts in layers near the middle of the view, adds the relations (a dotted line; the **View** menu can hide them as *Extracted relations*) and then checks each new concept's prerequisites through the AI queue. The whole insert is one undo step. The offline demo provider recognises its algebra concepts and terms you put in "quotes" or **bold**.

- **Explain more.** In the inspector, pick a level (*intuitive*, *rigorous* or *example-driven*) and press **Explain**. The AI writes a summary, the intuition, key points, examples, common pitfalls and further reading (described in words, never links), building on the concept's prerequisites and relations in the graph. The latest explanation is kept on the concept. **Use summary as definition** copies its summary into the definition. Each concept also has a free-text **My notes** field. Both appear in the Markdown export, and **Ctrl/Cmd+K** also finds concepts by words in their notes (after name and alias matches).

- **Quiz me.** Study what the graph knows. Start from **File ▾ → Quiz me…** (the whole graph, or the selected concept's learning path) or from the inspector's **Quiz me on this and its prerequisites**. Questions come one concept at a time, prerequisites first. Pick the kind of question: *recall* (what is it?), *apply* (use it on an example), *connect* (how it builds on one of its prerequisites) or *mixed*, which moves from recall to the others as you get better. Tick *Multiple choice* for four options instead of free recall with **Show answer**. Hints come one at a time on demand. After each answer, grade yourself **Knew it / Partly / Didn't know**. The grade is stored on the concept as its mastery (a score and the time of the last review), and a small dot after the concept's name shows it (green strong, amber fair, red weak). Mastery fades over time, more slowly the more often you reviewed it, so the next quiz asks what you didn't know, or haven't seen for a while, first. A prerequisite you already know well no longer has to come before the concepts that build on it. Blocked and unclear concepts are skipped and listed with the reason, and a summary ends the quiz. Grades are never undo steps. Mastery is kept in JSON exports and imports, but share links leave it out: it is your own study progress, like your notes and explanations. The read-only share viewer has no quiz.

New concepts appear in a free spot near what you're looking at (or near the concept they relate to), and the view pans to them. **Tidy** (⊞) arranges the graph in layers, with prerequisites above the concepts that depend on them. **🔍** or **Ctrl/Cmd+K** finds a concept by name or alias, then selects it and centres the view on it.

For bigger graphs:
- **Focus** (◎, or **F** on the canvas) shows only the selected concept and what is within 1–3 relations of it. Everything else is hidden. Selecting another concept moves the focus to it. **Esc** or the ✕ of the focus control shows the whole graph again.
- **View** (👁 ▾) hides relation kinds (dependency links, mixed, derived or extracted relations) or the relation labels. **To-do only** hides ready concepts, so only blocked, unclear and failed ones are left. These choices are remembered in this browser. Hidden concepts and relations can't be deleted with the Delete key.
- Relation labels are left out when you zoom far out, and with 150 or more concepts only what's on screen is rendered. `node e2e/perf.mjs` times a generated 300-concept, 600-relation graph.

The toolbar keeps to one row from 1200px up; its icon buttons explain themselves in a tooltip. **Settings** (⚙) → *Interface* chooses the theme, **Auto** (follows your system's light/dark setting), **Light** or **Dark**, and the **interface language**: English or 中文 (Simplified Chinese). By default it follows the browser's language. This only changes the app's menus, buttons and messages; the language the AI writes in is the separate **AI answers in** setting (see below). Everything works from the keyboard (press **?** for the list of shortcuts): dialogs trap focus and close with Escape, and Tab reaches each relation arrowhead (Enter opens it). On phones the less-used toolbar buttons fold into a **☰** menu and the inspector becomes a bottom sheet you can collapse.

**First visit.** A welcome card on the empty canvas says what NodeStorm does and offers three starts: a **1-minute tour**, the **Group theory example**, or an empty graph. It also points to ⚙ Settings for an AI key (the offline demo needs none). The tour is a few small popovers pointing at the real controls (Add concept, Install, a relation's arrowheads, Mix, Fork sandbox, File, Settings); it offers to load the example first, works from the keyboard (Enter/→ next, ← back, Esc skips) and leaves out what isn't on screen, e.g. the buttons folded into ☰ on phones. **Show tour again** is in the **?** shortcuts dialog. The card never appears in the share viewer or once you have concepts, and whether it and the tour were dismissed is remembered in this browser.

Everything the AI suggests can be fixed by hand: rename a concept (the old name stays as an alias) or edit a relation's text in the inspector, and press **Delete** to remove the selected concepts or the open relation. **Ctrl/Cmd+Z** undoes and **Ctrl/Cmd+Shift+Z** (or Ctrl+Y) redoes, separately for each sandbox. AI results that arrive later never become undo steps of their own.

**Projects.** Keep several independent brainstorms. Each project has its own main graph and sandboxes. The project menu at the left of the toolbar switches between projects and can create, rename, duplicate or delete them. The graph selector lists only the current project's graphs. A new, empty project offers **Load example: Group theory**, a small ready-made graph that is built offline (no AI call or key needed). One of its concepts is blocked on a missing prerequisite, so you can try **Install** straight away.

Projects autosave to your browser's localStorage. Data saved by earlier versions becomes the project *My brainstorm*. **File ▾** imports a project and saves your work in several forms:
- **JSON (this project)**: the current project, including sandboxes. **Import JSON…** adds such a file as a new project and never overwrites an existing one.
- **Markdown notes**: the current graph as study notes. Concepts come in study order (prerequisites first), with aliases, definitions and prerequisites, and every relation is written out in both directions.
- **Mermaid diagram**: flowchart text for GitHub, Notion, etc. It is copied to the clipboard and also downloaded.
- **PNG image**: a picture of the whole current graph.

**Share link…** (in **File ▾**) packs the current graph into a link, without its sandboxes. No account or server is involved: the graph is compressed into the part of the URL after `#`, which browsers never send to a server, so it works on the static GitHub Pages site too. The dialog shows the link's length. Some chat apps and mail clients cut off links longer than about 8,000 characters, so for big graphs send the JSON export instead. Opening a link shows the graph **read-only**: a banner says *Viewing a shared graph*, editing and AI controls are hidden, and export still works. **Save a copy** adds it as a new project (your existing projects are never overwritten), and **Close** goes back to your own work. Damaged or oversized links show an error and open the normal app.

**Versions.** Undo history is in memory only, so each project also keeps restore points. NodeStorm saves one automatically before big changes (**Install all**, adding an **Extract from text** result, merging or discarding a sandbox, **Tidy**, restoring a version) and every 10 minutes while you edit, but never twice for an unchanged project. **File ▾ → Save snapshot…** saves a named one with an optional label. **File ▾ → Versions…** lists them, newest first, with the reason or label and the counts. **Compare** says what restoring would bring back, remove or change in the main graph, and **Preview** opens the version read-only. **Restore** replaces the project (main graph and sandboxes) with it, after saving the current state as *Before restoring a version*, so a restore can be undone the same way. **Restore as new project** leaves the current one alone. Mastery from quizzes is kept when you restore. The last 20 automatic versions of each project are kept, and named ones until you delete them. Old automatic ones are also dropped to keep all versions under about 20 MB. Versions live in the browser's IndexedDB, not in localStorage with the projects, and are read back through the same repair as imports, so versions saved by older releases still open. Where IndexedDB is blocked (some private windows) the dialog says so and everything else works as before. The read-only viewer has no Versions.

**Import** repairs files from older or newer versions and hand-edited files instead of rejecting them. It fills in missing fields and drops relations or prerequisite links that point to concepts that aren't in the file. A notice lists what was fixed.

## Setup

```bash
npm install
npm run web        # UI only: http://localhost:5173
```

Click **⚙ Set up AI** in the toolbar (afterwards it shows the chosen model), choose a provider and paste your API key. The model list loads straight from the provider's API. Start typing to filter it, then pick a model. To try the app without a key, choose **Offline demo**. It has a tiny built-in abstract-algebra knowledge base.

`npm run build` produces a static site in `client/dist/` that runs without a server. You can open it from any static host.

### Deploy to GitHub Pages

`.github/workflows/pages.yml` builds `client/` and publishes it to GitHub Pages. It only runs when you start it by hand from the Actions tab (**Run workflow**), because publishing a public site is your decision. Browser mode needs no server, so the published site works fully: visitors bring their own API key or use the offline demo.

To turn it on once: open the repository's **Settings → Pages** and under **Build and deployment → Source** choose **GitHub Actions**. Then run the workflow; the run shows the site's URL. To deploy on every push instead, add a `push: branches: [main]` trigger to the workflow.

### Install as an app / offline

The built site (`npm run build`, or the GitHub Pages deployment) is an installable web app. In Chrome or Edge use **Install app** in the address bar or menu; on iPhone and iPad use Safari's **Share → Add to Home Screen**. It then opens in its own window with the NodeStorm icon.

After the first visit a service worker keeps a copy of the app itself, so it also opens without a network. Your projects are in the browser's localStorage anyway. While you're offline a banner says so, and AI actions stop right away with a message instead of waiting for a timeout; the **Offline demo** provider still works. Only the app's own files are stored. Calls to AI providers and to the local server's `/api/*` always go to the network and are never cached. When a new version has been deployed, a small **New version available — Reload** notice appears. Nothing changes until you press **Reload**. `npm run dev` never registers the service worker.

The icons are drawn in `client/public/icon.svg` and `client/pwa/icon-maskable.svg`; `node client/pwa/make-icons.mjs` renders the PNGs from them.

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
| DeepSeek | `GET /v1/models` | default `deepseek-chat` |
| Moonshot (Kimi) | `GET /v1/models` | default `moonshot-v1-8k` |
| Zhipu (GLM) | `GET /api/paas/v4/models` | default `glm-4-flash` |
| Alibaba Qwen (DashScope) | `GET /compatible-mode/v1/models` | default `qwen-plus` |
| Ollama (local) | `GET {baseURL}/models` | no key, works offline; for browser mode start it with `OLLAMA_ORIGINS="*" ollama serve` |
| OpenAI-compatible | `GET {baseURL}/models` (non-chat models hidden) | any other compatible endpoint: OpenAI, vLLM, LM Studio… |
| Offline demo | built-in | no key; deterministic, used by tests |

In Settings, **AI answers in** picks the language for names, definitions and relations: *Auto* matches the language of your concept names, or pick one (English, 中文, …) or type your own. Rate limits (HTTP 429) and brief provider outages (5xx, network errors) are retried up to twice with backoff, honouring `Retry-After`, within the request timeout. At most 3 AI requests run at once (configurable); the rest show as *queued* in the status bar and can be cancelled there. In browser mode Settings also shows roughly how many tokens this session used.

In server mode the same providers are configured by env vars named `<PROVIDER>_API_KEY`, `<PROVIDER>_BASE_URL` and `<PROVIDER>_MODEL` (e.g. `SILICONFLOW_API_KEY`, `DEEPSEEK_MODEL`), plus `ANTHROPIC_WEB_SEARCH=1`. See `server/.env.example`. The default models are a starting point: Settings lists the models your key can actually use.

The provider code lives in `shared/src/ai/`, so the browser and the server run the same prompts, JSON extraction, zod validation and retry. To add a provider:
1. Implement the `Provider` interface: `complete(messages, opts)` and `listModels()`.
2. Add it to `PROVIDERS` and `createProvider` in `shared/src/ai/factory.ts`.
3. Map its env vars in `server/src/providers/registry.ts`.

## Layout

```
shared/   graph model + AI task schemas (zod), and the AI core: providers, prompts, tasks
server/   optional Express API: POST /api/{name,clarify,relate,deps,derive,explain,extract,quiz}, GET /api/providers, GET /api/models
client/   Vite + React + React Flow UI; pure graph logic in client/src/lib/graphOps.ts
e2e/      Playwright smoke test (runs against the mock provider)
```

## Checks

```bash
npm run typecheck
npm test        # vitest: AI task parsing/validation, model discovery, graph logic, layout, export formats, import repair, projects, share links, quiz scheduling, version snapshots
npm run e2e     # starts server (mock) + UI and drives the full flow in Chromium, incl. settings and an axe (WCAG A/AA) audit
npm run e2e:pwa # builds, serves client/dist, checks manifest + service worker (all chunks precached), offline start, a failed chunk load and the update notice
```

All of these use the offline demo AI. To check a **real** provider and model end to end, put its key in `server/.env` and run:

```bash
npm run smoke:live                        # default provider (AI_PROVIDER, else SiliconFlow)
npm run smoke:live -- anthropic           # a specific provider
npm run smoke:live -- siliconflow 中文     # …and an answer language
```

It runs every AI task once, validates each answer against the same schemas the app uses and prints the timings. It costs a few cents at most.

`.github/workflows/ci.yml` runs all of them on every push and pull request. When the e2e run fails, its screenshots are uploaded as the `e2e-screenshots` artifact.
