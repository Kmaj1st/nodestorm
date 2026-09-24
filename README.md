# NodeStorm

An AI-aided brainstorming graph. You add concepts as nodes; the AI names what you can only describe, finds how two
concepts relate (separately in each direction), checks every concept's prerequisites and installs the missing ones,
proposes new concepts, pulls concepts out of pasted notes, explains them and quizzes you on them. It runs entirely in
the browser with your own API key (or an offline demo that needs none); an optional local server can hold the keys
instead. Your work stays in your browser.

Maintainers: see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for how it's built and how to change it.

## Quick start

```bash
npm install
npm run web        # UI only: http://localhost:5173
```

Click **Set up AI** in the toolbar (the status chip at the right) (afterwards it shows the chosen model), choose a provider and paste your API key.
The model list loads straight from the provider's API; start typing to filter it, then pick a model. To try the app
without a key, choose **Offline demo**: it has a tiny built-in abstract-algebra knowledge base.

A first visit shows a welcome card with three starts: a **1-minute tour**, the **Group theory example** (built offline,
no key needed) or an empty graph.

## Feature tour

### Graph and AI

- **Naming.** If you can only *describe* something, the AI suggests the established names and definitions for it.
  Ambiguous names ("Expectation") get a **what do you mean?** choice of meanings.
- **Mix.** Select two concepts and the AI finds how they relate, **separately in each direction**. Each relation line
  has an arrowhead at both ends: the one at B shows what A does to B, the one at A what B does to A.
- **Dependencies.** Every new concept is checked for direct prerequisites. Those already in the graph are linked with
  dashed dependency edges; missing ones **block** the concept until you **Install** them, which creates the missing
  concept, links it and checks its own prerequisites.
  *Example:* add *Homomorphism*, then *First Isomorphism Theorem*. The theorem uses homomorphisms and derives an
  isomorphism, so it shows as blocked with *Isomorphism* missing. Install it and the theorem becomes ready.
  - **Install all…** installs every missing prerequisite, then theirs, breadth-first, up to a depth limit (default 3)
    and a cap on new concepts (default 15), both in Settings. The run shows in the status bar, where cancelling stops
    the whole run. Concepts with ambiguous names are skipped and listed in the summary.
  - **Learning path** (inspector) lists everything a concept builds on, in study order, marking prerequisites still
    missing. **Highlight** shows that chain on the canvas and dims everything else.
  - **Dependency cycles** (A needs B needs A) usually mean a wrong AI answer, so they are resolved automatically: the
    AI reads the reason each link was added with and removes the wrong one (without an AI answer, the link the latest
    check added goes). A notice says which link went and why, and Ctrl+Z brings it back. Turn this off in Settings →
    *Dependency cycles* to only get a warning; the inspector's warning also has **Resolve with AI** and per-link
    **Remove this link**.
- **Derive** proposes new concepts from the selected ones, with their relations.
- **Extract from text** (**File → Extract from text…**) takes pasted notes, a book paragraph or a messy list (or a
  dropped / loaded `.txt` or `.md` file), up to 12,000 characters, with an optional *focus* hint. The AI lists
  candidate concepts (definition plus a short supporting quote), the relations (both directions) and prerequisites the
  text states. You review them first: candidates already in the graph (by name, plural or alias) are unticked and
  flagged, and their relations link to the existing concept instead. You can rename candidates and untick concepts or
  relations. **Add selected** places the new concepts in layers near the middle of the view, adds the relations (a
  dotted line; **View** can hide them as *Extracted relations*) and checks each new concept's prerequisites through
  the AI queue. The whole insert is one undo step. The offline demo recognises its algebra concepts and terms in
  "quotes" or **bold**.
- **Fix anything by hand.** Rename a concept (the old name stays as an alias), edit a relation's text in the inspector,
  **Delete** removes the selected concepts or the open relation. **Ctrl/Cmd+Z** undoes and **Ctrl/Cmd+Shift+Z** (or
  Ctrl+Y) redoes, separately for each sandbox. AI results that arrive later never become undo steps of their own.
- **Math.** Write formulas as LaTeX: `$\varphi(ab) = \varphi(a)\varphi(b)$` or `\(…\)` inline, `$$G/\ker\varphi \cong
  \operatorname{im}\varphi$$` or `\[…\]` on a line of their own. They're typeset (with KaTeX) on the cards, in the
  inspector (a *Formatted* preview under the definition and relation fields, which stay plain text to edit), in
  explanations, quizzes and the AI's proposals; the AI is asked to write its notation this way too. `\$` is a literal
  dollar, and prices like "$5 and $10" stay text (a `$` followed by a space can't open a formula, and one after a
  space or before a digit can't close it). A formula KaTeX can't read is shown as written.

### Mathematics, logic and other formal sciences

- **Concept kinds.** A concept can be a *definition*, *theorem*, *lemma*, *proposition*, *corollary*, *axiom*,
  *conjecture*, *example*, *notation* or *other*. The AI's check sets the kind while it is unset (as do naming, the
  "what do you mean?" choice, Derive and Extract from text, which follows the text's own "Lemma 2.1"); you can change
  it in the inspector's **Kind** field, and the AI never overrides your choice. Each card shows its kind as a small
  colour-coded label (the proved results share a colour, and so do definitions and notation). **View** can hide
  concepts by kind (only the kinds in the graph are listed, plus *No kind set*). The kind is kept in JSON exports,
  share links and the Markdown notes, and the Group theory example is typed.
- **Theorem anatomy** (inspector, for theorems, lemmas, propositions, corollaries and conjectures): **Take apart** asks
  the AI for each hypothesis with *why it is needed* and a *counterexample without it*, the conclusion, a proof idea
  (a sketch in a few sentences, never a full proof; for a conjecture, why it is believed), examples and non-examples,
  all typeset. It is kept on the concept like an explanation (not an undo step), can be cancelled while it runs, and
  appears in the Markdown notes; share links leave it out.
- **LaTeX document** (**File → LaTeX document (.tex)**): an `amsart` article with one `amsthm` environment per concept
  (Definition, Theorem, Lemma…; concepts without a kind are *Concept*), in study order, each labelled and saying what
  it uses (*Uses: Definition 3 (Kernel)*, as `\ref`s), with missing prerequisites, aliases, sources, your notes as
  remarks and a stored anatomy's proof idea as a proof sketch. Text is escaped for LaTeX (`# % & _ { } ~ ^ \` and
  common symbols like → or φ) while `$…$` formulas are kept as written. It compiles with `pdflatex`; a graph with
  Chinese, Japanese or Korean text asks for `xelatex` (and loads `xeCJK` there).
- **Notation…** (**File**): a glossary of the symbols the graph introduces, built without the AI: for every
  *definition* and *notation* concept, the left-hand side of its defining equation (`$\ker\varphi = …$` gives
  $\ker\varphi$) or else its first short formula that isn't a lone variable, in study order. Each entry links to its
  concept (turning off a View filter that hid it).

### Study tools

- **Explain more.** In the inspector pick a level (*intuitive*, *rigorous* or *example-driven*). The AI writes a
  summary, the intuition, key points, examples, common pitfalls and further reading (described in words, never
  links), building on the concept's prerequisites and relations. The latest explanation is kept on the concept;
  **Use summary as definition** copies its summary. Each concept also has a free-text **My notes** field. Both appear
  in the Markdown export, and **Ctrl/Cmd+K** also finds concepts by words in their notes (after name and alias
  matches).
- **Quiz me** (**File → Quiz me…** for the whole graph or the selected concept's learning path, or the inspector's
  **Quiz me on this and its prerequisites**). Questions come one concept at a time, prerequisites first. Kinds:
  *recall*, *apply* (use it on an example), *connect* (how it builds on a prerequisite) or *mixed*, which moves from
  recall to the others as you improve. Tick *Multiple choice* for four options instead of free recall with **Show
  answer**; hints come one at a time. Grade yourself **Knew it / Partly / Didn't know**: the grade is stored on the
  concept as its mastery (score and time of last review), shown as a dot after the name (green strong, amber fair,
  red weak). Mastery fades over time, more slowly the more often you reviewed, so the next quiz asks what you didn't
  know, or haven't seen for a while, first; a prerequisite you know well no longer has to come first. Blocked and
  unclear concepts are skipped and listed with the reason, and a summary ends the quiz. Grades are never undo steps.
  Mastery is kept in JSON exports and imports but left out of share links (it is your own progress, like notes and
  explanations); the share viewer has no quiz.
- **Walkthrough** (**File → Walkthrough…**, or the inspector's **Walk through the learning path**): a full-screen,
  read-only presentation, one concept per slide in study order (←/→, Space, Home/End); it works in the share viewer too.
- **Derive together** (toolbar, **File → Derive together…**, or the inspector's **Derive together**): work a problem
  out yourself with an AI tutor that **only gives hints**. It never writes a step or the answer for you.
  - **Import documents** (PDF, text or Markdown). A **problem sheet** is split into its problems, and you pick one to
    start. **Reference** material (notes, a textbook chapter) is what the tutor cites, as `[1] Notes, p. 4`. Click a
    citation to open that page.
  - **Scanned PDF pages** (no text layer) are sent as a picture to a **vision model**, which reads formulas as LaTeX.
    Set it in Settings → **Vision model**; SiliconFlow defaults to Qwen2.5-VL. A page that can't be read can have its
    text pasted in.
  - **Choosing a problem**: select a passage in a document and choose **Use selection as problem**, or type any problem.
  - **Steps**: write each step. **Check** marks it *Correct*, *Gap* (true, but relies on something unstated, which it
    names), *Error* or *Unclear*. **Hint** gets more specific each time you ask for the same step.
  - **Add to graph**: tick what goes in. The problem becomes a concept that depends on the concepts it used, with the
    source page recorded and your steps saved in its notes. It is one undo step.
  - Documents and derivations are kept per project in this browser (IndexedDB). They are not part of JSON exports or
    share links; **Copy as Markdown** exports a derivation.

### Organising

- **Projects.** Several independent brainstorms, each with its own main graph and sandboxes. The project menu at the
  left of the toolbar switches, creates, renames, duplicates and deletes them; the graph selector lists only the
  current project's graphs. A new, empty project offers **Load example: Group theory**, built offline; one of its
  concepts is blocked on a missing prerequisite, so you can try **Install** straight away.
- **Sandboxes.** **Fork sandbox** (the branch icon next to the graph selector) copies the current graph. Derive, mix and install in
  the copy without touching the original, then **Merge back** or **Discard** from the sandbox banner.
- **Layout and navigation.** New concepts appear in a free spot near what you're looking at (or near the concept they
  relate to) and the view pans to them. **Tidy** (⊞) arranges the graph in layers, prerequisites above their
  dependents. **🔍** or **Ctrl/Cmd+K** finds a concept by name or alias, selects it and centres on it.
- **Bigger graphs.**
  - **Focus** (◎, or **F** on the canvas) shows only the selected concept and what is within 1–3 relations of it.
    Selecting another concept moves the focus; **Esc** or the focus control's close (X) button shows everything again.
  - **View** (the eye icon) hides relation kinds (dependency links, mixed, derived or extracted relations) or relation labels;
    **To-do only** leaves just blocked, unclear and failed concepts. These choices are remembered in this browser.
    Hidden concepts and relations can't be deleted with the Delete key.
  - Relation labels are left out when zoomed far out, and from 150 concepts only what's on screen is rendered.
    `node e2e/perf.mjs` times a generated 300-concept, 600-relation graph.
- **Versions.** Undo history is in memory only, so each project also keeps restore points. One is saved automatically
  before big changes (**Install all**, adding an **Extract from text** result, merging or discarding a sandbox,
  **Tidy**, restoring a version) and every 10 minutes while you edit, never twice for an unchanged project.
  **File → Save snapshot…** saves a named one with an optional label. **File → Versions…** lists them, newest
  first. **Compare** says what restoring would bring back, remove or change in the main graph; **Preview** opens the
  version read-only; **Restore** replaces the project (main graph and sandboxes) after saving the current state as
  *Before restoring a version*, so a restore can be undone the same way; **Restore as new project** leaves the current
  one alone. Mastery is kept when you restore. The last 20 automatic versions per project are kept, named ones until
  you delete them, and old automatic ones are dropped to stay under about 20 MB. Versions live in IndexedDB (not
  localStorage) and are read back through the same repair as imports, so older versions still open. Where IndexedDB
  is blocked (some private windows) the dialog says so and everything else works. The read-only viewer has no
  Versions.

### Sharing and export

Projects autosave to your browser's localStorage (data from earlier versions becomes the project *My brainstorm*).
**File** imports and exports:

- **JSON (this project)**: the current project, including sandboxes. **Import JSON…** adds a file as a new project and
  never overwrites an existing one. Import repairs files from older or newer versions and hand-edited files instead
  of rejecting them: it fills in missing fields and drops relations or prerequisite links that point to missing
  concepts, and a notice lists what was fixed.
- **Markdown notes**: the current graph as study notes, in study order (prerequisites first), with aliases,
  kinds, definitions and prerequisites, stored explanations and theorem anatomies, and every relation written out in
  both directions. Formulas are kept as `$…$`, which GitHub and most Markdown editors typeset.
- **LaTeX document (.tex)**: the current graph as a compilable `amsart` article, one theorem-style environment per
  concept (see *Mathematics, logic and other formal sciences* above).
- **Mermaid diagram**: flowchart text for GitHub, Notion, etc., copied to the clipboard and downloaded.
- **PNG image**: a picture of the whole current graph.
- **Flashcards (Anki)…**: the current graph, or the selected concept's learning path, as question-and-answer cards
  in study order (prerequisites first). Tick the card types: *definitions* (name → definition and other names),
  *prerequisites* ("What does X build on?") and *relations* ("How does A relate to B?", one card per direction). The
  dialog previews the first cards and counts them.
  - **Anki** (`<project>-anki.txt`): in Anki ≥ 2.1.55 use **File → Import**. The file's header lines set the tab
    separator, HTML fields, the *Basic* note type, the deck (editable, default the project name; `::` makes a subdeck)
    and the tags column, so no import settings are needed. Cards are tagged with the project name, the concept's
    status (`status::ready`, `status::blocked`, …) and the card type (`card::definition`, …). Formulas written as
    `$…$` / `$$…$$` are converted to `\(…\)` / `\[…\]`, which Anki's built-in MathJax renders. In an Anki whose
    note types have translated names, pick the Basic type in the import dialog.
  - **CSV** (`<project>-flashcards.csv`): `front,back,tags` in plain UTF-8 text (RFC 4180 quoting, with a byte-order
    mark for Excel) for Quizlet, RemNote, a spreadsheet and the like; formulas stay as typed.
  - Quiz questions aren't stored (only your grades are), so there are no quiz cards. Works in the share viewer too.
- **Share link…** packs the current graph (without its sandboxes) into a link. No account or server is involved: the
  graph is compressed into the part of the URL after `#`, which browsers never send to a server, so it works on the
  static GitHub Pages site too. The dialog shows the link's length; some chat apps and mail clients cut off links
  longer than about 8,000 characters, so for big graphs send the JSON export instead. Opening a link shows the graph
  **read-only** (*Viewing a shared graph*): editing and AI controls are hidden, export still works, **Save a copy**
  adds it as a new project and **Close** goes back to your work. Damaged or oversized links show an error and open the
  normal app.

### Offline and installable app

The built site (`npm run build`, or the GitHub Pages deployment) is an installable web app: in Chrome or Edge use
**Install app** in the address bar or menu; on iPhone and iPad use Safari's **Share → Add to Home Screen**.

After the first visit a service worker keeps a copy of the app itself, so it also opens without a network (your
projects are in localStorage anyway). While offline a banner says so, and AI actions stop right away with a message
instead of waiting for a timeout; the **Offline demo** provider (and a local Ollama) still work. Only the app's own
files are stored: calls to AI providers and to the local server's `/api/*` always go to the network and are never
cached. When a new version has been deployed, a **New version available — Reload** notice appears; nothing changes
until you press **Reload**. `npm run web` / `npm run dev` never register the service worker.

The icons are drawn in `client/public/icon.svg` and `client/pwa/icon-maskable.svg`; `node client/pwa/make-icons.mjs`
renders the PNGs from them.

### Interface, languages and accessibility

- **Settings** (the AI status chip) → *Interface*: theme **Auto** (follows the system), **Light** or **Dark**, and the **interface
  language**, English or 中文 (Simplified Chinese), by default following the browser. This only changes menus,
  buttons and messages; the language the AI writes in is the separate **AI answers in** setting (see below).
- The toolbar keeps to one row from 1200px up; icon buttons explain themselves in a tooltip. On phones the less-used
  buttons fold into a **More tools** menu and the inspector becomes a collapsible bottom sheet.
- Everything works from the keyboard (press **?** for the shortcuts): dialogs trap focus and close with Escape, and
  Tab reaches each relation arrowhead (Enter opens it).
- The tour (welcome card, or **Show tour again** in the **?** dialog) is a few popovers on the real controls (Add
  concept, Install, a relation's arrowheads, Mix, Fork sandbox, File, Settings). It offers to load the example first,
  works from the keyboard (Enter/→ next, ← back, Esc skips) and skips what isn't on screen. The welcome card never
  appears in the share viewer or once you have concepts; dismissing it is remembered in this browser.

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

The default models are a starting point: Settings lists the models your key can actually use.

- **AI answers in** (Settings) picks the language for names, definitions and relations: *Auto* matches the language of
  your concept names, or pick one (English, 中文, …) or type your own.
- Rate limits (HTTP 429) and brief provider outages (5xx, network errors) are retried up to twice with backoff,
  honouring `Retry-After`, within the request timeout.
- At most 3 AI requests run at once (configurable); the rest show as *queued* in the status bar and can be cancelled
  there.
- In browser mode Settings also shows roughly how many tokens this session used.

To add a provider, see [docs/ARCHITECTURE.md → Add a provider preset](docs/ARCHITECTURE.md#add-a-provider-preset). In
short: add it to `PROVIDERS` and `createProvider` in `shared/src/ai/factory.ts` (implementing the `Provider` interface,
`complete(messages, opts)` and `listModels()`, if it isn't OpenAI-compatible); the server maps its env vars in
`server/src/providers/registry.ts`.

### Where your key goes

In **Directly from this browser** mode the page calls the provider itself. Your key goes only to that provider and
never to a NodeStorm server.

- By default the key is kept only for the current tab and forgotten when you close it.
- If you tick **Remember keys on this device**, it is saved in the browser's localStorage instead. Only do that on
  your own device: browser extensions and anyone using the same browser profile can read it.
- Use a separate key with a spending limit.
- **Forget all saved keys** removes them.

## Server mode (optional)

If you'd rather keep keys out of the browser, put them in `server/.env` and switch Settings to **Through the local
NodeStorm server**:

```bash
cp server/.env.example server/.env   # add your keys
npm run dev                          # server on :8787 + UI on :5173
npm run dev:mock                     # the same with the offline demo AI (no keys)
```

The server has no login and spends the keys in `server/.env`, so it only listens on this computer (127.0.0.1). Set
`HOST` (e.g. `HOST=0.0.0.0`) only if you put your own authentication in front of it.

Providers are configured by env vars named `<PROVIDER>_API_KEY`, `<PROVIDER>_BASE_URL` and `<PROVIDER>_MODEL` (e.g.
`SILICONFLOW_API_KEY`, `DEEPSEEK_MODEL`), plus `AI_PROVIDER` (the default) and `ANTHROPIC_WEB_SEARCH=1`; see
`server/.env.example`. The browser may choose the provider and model, never the key. The server has no
authentication: run it on your own machine only.

## Build and deploy

`npm run build` produces a static site in `client/dist/` that runs without a server; you can open it from any static
host.

**GitHub Pages.** `.github/workflows/pages.yml` builds `client/` and publishes it. It only runs when you start it by
hand from the Actions tab (**Run workflow**), because publishing a public site is your decision. Browser mode needs no
server, so the published site works fully: visitors bring their own API key or use the offline demo. To turn it on
once, open the repository's **Settings → Pages** and under **Build and deployment → Source** choose **GitHub
Actions**, then run the workflow; the run shows the site's URL. To deploy on every push instead, add a
`push: branches: [main]` trigger to the workflow.

## Layout

```
shared/   graph model + AI task schemas (zod), and the AI core: providers, prompts, tasks
server/   optional Express API: POST /api/<task> (name, clarify, relate, deps, derive, explain, anatomy, extract, quiz,
          resolveCycle, readPage, splitProblems, tutorHint, checkStep), GET /api/providers, GET /api/models
client/   Vite + React + React Flow UI; pure graph logic in client/src/lib/ (e.g. graphOps.ts)
e2e/      Playwright smoke test (runs against the mock provider), PWA check, perf timing
scripts/  live smoke test against real providers
docs/     ARCHITECTURE.md, the maintainer's guide
```

## Checks

```bash
npm run typecheck
npm test        # vitest: AI task parsing/validation, model discovery, graph logic, layout, export formats, import repair, projects, share links, quiz scheduling, version snapshots, flashcards
npm run e2e     # starts server (mock) + UI and drives the full flow in Chromium, incl. settings and an axe (WCAG A/AA) audit
npm run e2e:pwa # builds, serves client/dist, checks manifest + service worker (all chunks precached), offline start, a failed chunk load and the update notice
```

The e2e scripts need Chromium for Playwright (`npx playwright install chromium`); `E2E_SERVER_PORT` and
`E2E_WEB_PORT` override their ports.

All of these use the offline demo AI. To check a **real** provider and model end to end, put its key in `server/.env`
and run:

```bash
npm run smoke:live                        # default provider (AI_PROVIDER, else SiliconFlow)
npm run smoke:live -- anthropic           # a specific provider
npm run smoke:live -- siliconflow 中文     # …and an answer language
```

It runs every AI task once, validates each answer against the same schemas the app uses and prints the timings. It
costs a few cents at most.

`.github/workflows/ci.yml` runs typecheck, tests, e2e and e2e:pwa on every push and pull request. When an e2e run
fails, its screenshots are uploaded as the `e2e-screenshots` artifact.
