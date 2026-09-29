# NodeStorm

**English** · [中文](README.zh.md)

NodeStorm is a brainstorming and study graph for concepts. Each concept is a card on a canvas. You add concepts by
name, and NodeStorm finds definitions for them in encyclopedias, wikis and web search results, **in the sources' own
words**. An AI rates those sources, but it doesn't write the definition you keep. Ask the AI and it finds each
concept's prerequisites (which block the concept until you install them), works out how two concepts relate in each
direction, proposes new concepts, explains them and quizzes you on them. It also tutors you through a problem while
giving hints only.

It runs entirely in your browser with your own API key, or with an offline demo that needs no key. Your graphs stay
in your browser. An optional local server can hold the keys instead.

- **Try it:** <https://kmaj1st.github.io/nodestorm/>. Pick **Offline demo** in Settings to try it without a key.
- **Maintainers:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how it's built, and
  [CHANGELOG.md](CHANGELOG.md) what changed recently. See also [Developer guide](#developer-guide) below.

**Contents:** [Getting started](#getting-started) · [Setting up an AI provider](#setting-up-an-ai-provider) ·
[How definitions work](#how-definitions-work) · [Prerequisites](#prerequisites-check-with-ai-install-install-all) ·
[Building the graph](#building-the-graph) · [Views and big graphs](#views-and-big-graphs) ·
[Study tools](#study-tools) · [Mathematics and formal sciences](#mathematics-and-formal-sciences) ·
[Parody modes](#parody-modes) · [Projects and versions](#projects-sandboxes-and-versions) ·
[Export and share](#export-and-share) · [Offline and installable](#offline-and-installable) ·
[Keyboard shortcuts](#keyboard-shortcuts) · [Languages and accessibility](#languages-phones-and-accessibility) ·
[Privacy](#privacy-what-is-sent-where) · [Local server](#the-local-server-optional) ·
[Developer guide](#developer-guide)

## Getting started

1. Open the [live site](https://kmaj1st.github.io/nodestorm/), or run it yourself (`npm install`, then `npm run web`
   and open <http://localhost:5173>).
2. A first visit shows a welcome card with three starts: the **1-minute tour**, the **Group theory example** (built
   offline, no key needed) or an empty graph.
3. Click **Set up AI**, the status chip at the right of the toolbar, and choose a provider (see below). With no key,
   choose **Offline demo**. It has a small built-in abstract-algebra knowledge base, a pretend web search built from
   it, and it answers in Chinese for Chinese concept names.
4. Click **Add concept**, type a name (*Kernel*, *Homomorphism*, *First Isomorphism Theorem*) and pick a definition
   from the sources found. Then press the concept's **check with AI** badge to find its prerequisites.

The example graph comes in the interface language: in Chinese it is 群论 (群、子群、正规子群、同态、核、商群、第一同构定理).
One of its concepts is blocked on a missing prerequisite, so you can try **Install** straight away.

## Setting up an AI provider

Open **Settings** (the AI status chip) and choose how to connect:

- **Directly from this browser** (the default): paste your API key. No server is needed.
- **Through the local NodeStorm server**: the keys stay in `server/.env` on your computer (see
  [The local server](#the-local-server-optional)).

Then choose a provider and a model. The model list loads straight from the provider's API; type to filter it.

| Provider | Default model | Notes |
|---|---|---|
| SiliconFlow (default) | `deepseek-ai/DeepSeek-V3` | vision model `Qwen/Qwen2.5-VL-72B-Instruct` for scanned PDF pages |
| Anthropic Claude | `claude-opus-5` | optional web search when naming and relating concepts |
| DeepSeek | `deepseek-chat` | |
| Moonshot (Kimi) | `moonshot-v1-8k` | |
| Zhipu (GLM) | `glm-4-flash` | |
| Alibaba Qwen (DashScope) | `qwen-plus` | |
| Ollama (local) | `qwen2.5:7b` | no key, works offline; in browser mode start it with `OLLAMA_ORIGINS="*" ollama serve` |
| OpenAI-compatible | `gpt-4o-mini` | any other compatible endpoint (OpenAI, vLLM, LM Studio…); non-chat models are hidden |
| Offline demo | built in | no key, no network, deterministic (the tests use it) |

The default models are only a starting point: Settings lists the models your key can actually use.

- **AI answers in** picks the language the AI writes in. *Auto* follows the language of your concept names; you can
  also pick one (English, 中文, …) or type your own. The interface language is a separate setting.
- **Vision model** is used to read scanned PDF pages in Derive together.
- Rate limits (HTTP 429) and brief outages are retried up to twice, within the request timeout. At most 3 AI requests
  run at once (you can change this); the others show as *queued* in the status bar, where you can cancel them.
- In browser mode Settings shows roughly how many tokens this session used.

**Your key.** In browser mode the page calls the provider itself, so your key goes only to that provider. By default
the key is kept for the current tab only and forgotten when you close it. Tick **Remember keys on this device** to keep
it in the browser's localStorage. Only do that on your own device, because browser extensions and anyone using the
same browser profile can read it. **Forget all saved keys** removes the saved keys. Use a separate key with a spending
limit.

## How definitions work

When you add a concept by name, NodeStorm asks these sources at the same time:

- **Encyclopedias and wikis** (Settings → **Definitions**): **ProofWiki** for rigorous mathematics (its macros
  become standard LaTeX), **Wikipedia and Wikidata** in your answer language (formulas kept as LaTeX), **Baidu
  Baike** (百度百科) and **Moegirl** (萌娘百科) for Chinese names (Moegirl for Japanese names too), and a **Fandom** or
  **BWIKI** wiki that you name in Settings.
- **Web search engines** (Settings → **Web search**): **Tavily**, **Serper** (Google results), **Brave Search**, and
  **SearXNG** (your own instance). Each needs its own key (SearXNG needs its address) and has a **Test** button.
  Up to 6 results are used by default. Brave's API doesn't answer web pages, so Brave only works through the local
  server. A SearXNG instance must allow JSON output and requests from the site. On the https site, the browser blocks
  an http:// address other than localhost, and Settings warns you about that.

The sources show as soon as they are found, not rated yet: an AI call can take a while, so the AI checks them only
when you click **Check reliability with AI** in the pop-up (you can keep choosing meanwhile, or stop it). Turn on
*Rate sources with AI automatically* in Settings to have it done right away; the fully automatic way of adding
concepts always does.

When asked, the AI **rates the sources against each other** as **Reliable**, **Fairly reliable**,
**Doubtful** or **Unusable**. It says why: the site's authority, whether the source agrees with the others, whether
the page is a forum or an advert, or whether it describes another meaning of the name. The AI also marks a passage in
each source's text. It is told that page texts are data, never instructions, and a page that tries to steer it is
rated unusable.

The **Sources for "X"** pop-up lists them most reliable first, grouped by meaning when they describe different things.
Each source shows its site, a link to the page, and the marked passage in the source's own text. You choose:

- a source's marked passage, or
- any other words of a source: select them and press **Use selected text**, or
- **My own definition**. **Edit a copy** starts from a source's text. If you only cut it down, it stays that source's
  words. If you change it, it is saved as written by you.

The definition is always exactly the chosen words, saved with a link to the source's page and the AI's rating (the
inspector shows "Reliable (AI check of 3 sources)" with **Why?**). A passage the AI "quotes" that isn't really in the
source is dropped. **Later** leaves the concept waiting ("needs a definition"). Its badge reopens the pop-up.

- **Without an AI** you still get the sources, unrated. **Without a search engine** only the encyclopedias are
  asked, and the pop-up links to Settings → Web search.
- **Choosing automatically.** By default the pop-up asks you. If you untick *When adding a concept, show the sources
  and let me choose* in Settings, NodeStorm takes the most reliable passage itself. **Install all** always chooses
  automatically. An automatic choice is only made when it is safe:
  - An encyclopedia page for exactly that name, rated reliable, can be taken on its own.
  - A web page needs a second opinion: an encyclopedia, or a page from another site, rated at least fairly reliable
    for the same meaning.
  - Nothing is taken when equally reliable sources describe different meanings, or when an encyclopedia page is for
    another name.

  In any of those cases the pop-up asks you (Install all leaves the concept "needs a definition").
- **Look up in…** (inspector, next to the source) defines a concept again from one site, or with **Search the web
  and compare…**. The change is one undo step. **Search again** in the pop-up asks the search engines again instead
  of using their 30-day cache, so it uses search quota.
- What was found is kept for a day, so a concept's badge reopens the rated sources after a reload without searching
  again. Web search results are cached for 30 days. A site or engine that refuses is skipped for 10 minutes.
- ProofWiki sits behind a Cloudflare bot check that often refuses apps, so definitions usually come from Wikipedia.
  `npm run smoke:lookup` checks the sites from your machine.

**Where the AI's own words do appear.** The AI never writes a definition that is looked up. Concepts that the AI
itself proposes (naming something you describe, **Derive**, **Suggest connections**, **Extract from text**) and
**Use summary as definition** in Explain arrive with the AI's text. Their source says "AI" with the provider and
model, so you can always tell them apart. **Look up in…** replaces such a definition with a source's.

## Prerequisites: Check with AI, Install, Install all

- **Check with AI.** A concept with a definition shows a **check with AI** badge (or **Check prerequisites with AI**
  in the inspector). The AI lists the concept's direct prerequisites. Those already in the graph are linked with a
  dashed prerequisite link, labelled from the concept that needs them ("using", "deriving", "assuming"). A missing one
  **blocks** the concept.
  *Example:* add *Homomorphism*, then *First Isomorphism Theorem*. The theorem shows as blocked with *Isomorphism*
  missing. Install it and the theorem becomes ready.
- **Install** (inspector) adds a missing prerequisite, links it and looks up its definition. With the pop-up setting
  on (the default), a single Install takes only an encyclopedia page with exactly that name, without a web search, to
  save your search quota. Otherwise the concept waits for you to choose.
- **Install all…** installs every missing prerequisite, then theirs, breadth-first. It stops at a depth limit
  (default 3) and a cap on new concepts (default 15), both set in Settings. The run shows in the status bar, where
  cancelling stops all of it. A version is saved first.
- **Basic concept** (inspector) marks a concept as taken as given. It needs no prerequisites: its missing ones are
  removed, it is never blocked and no AI check runs for it. A blocked concept's missing list also offers "take it as
  given".
- **Learning path** (inspector) lists everything a concept builds on, in study order, and marks the prerequisites
  that are still missing. **Highlight** shows that chain on the canvas.
- **Dependency cycles** (A needs B needs A) usually mean a wrong AI answer. The AI reads why each link was added and
  removes the wrong one, and Ctrl+Z brings it back. Turn this off in Settings → *Dependency cycles* to only get a
  warning.

## Building the graph

- **Add concept.** Type a name, or choose **Describe it** and the AI suggests established names for what you describe.
  A new concept appears in a free spot near what you're looking at.
- **Mix.** Select two concepts and press **Mix**. The AI finds how they relate, **separately in each direction**.
  Each relation line has an arrowhead at both ends: the one at B shows what A does to B. Click an arrowhead to read
  it. When there is no relation either way, the line is drawn in its own colour, marked "no relation".
- **Derive** proposes new concepts from the selected ones, with their relations. You accept each proposal. The dialog
  can **Fork a sandbox** first, so your graph stays as it was.
- **Suggest connections** (inspector → Relations) finds concepts this one can connect to. Concepts that its definition
  names come first (found without the AI), then the AI's suggestions. You tick which to add.
- **Extract from text** (**File → Extract from text…**) takes pasted notes, a book paragraph or a `.txt`/`.md` file
  (up to 12,000 characters). You review the candidate concepts, relations and prerequisites before adding them.
  Candidates already in the graph are recognised.
- **Sandboxes.** **Fork sandbox** (the branch icon next to the graph selector) copies the current graph. Derive,
  mix and install in the copy, then **Merge back** or **Discard** from the sandbox banner.
- **Edit anything by hand.** Rename a concept (the old name stays as an alias), edit a definition or a relation's
  text, set a relation side to **No relation this way**, or delete. **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z** undo and
  redo, separately for each graph. AI results that arrive later never become undo steps of their own.
- **Relation colours** for each kind of line can be set in Settings. The View menu shows the legend.

## Views and big graphs

- **Tidy** arranges the graph in layers, with prerequisites above what depends on them. **Find** (Ctrl/Cmd+K) finds a
  concept by name, alias or words in your notes, and centres on it.
- **Focus** (**F** on the canvas) shows only the selected concept and what is within 1–3 relations of it. **Esc**
  shows everything again.
- **View** (the eye icon) hides kinds of relations, relation labels or concept kinds. **To-do only** leaves just the
  blocked, unclear and failed concepts. These choices are remembered in this browser.
- **Hide concepts for now.** **H** hides the selected concepts and **Shift+H** hides all the others. You can also use
  the eye button in the inspector or **View → Hide selected / Hide others**. Hidden concepts leave the canvas,
  minimap, Tidy and 3D view. Nothing is deleted, exported or shared, and a new tab shows everything. **"N hidden ·
  Show all"** in the canvas corner lists them.
- **Select several** (the button with the zoom controls) is for touch screens, which have no Shift key. While it's
  on, taps add concepts to the selection or take them out, for Mix and Derive. Holding a card on a touch screen also
  starts it. With a mouse, Shift- or Ctrl-click does the same.
- **Layered view (2.5D)** (View → Layout) stands concepts on stacked plates, one per dependency depth. The **3D view**
  (View → 3D view…) shows the layers in 3D: drag or use one finger to rotate, scroll or pinch to zoom. A list of the
  layers beside it works without the canvas.
- **Physics** (the magnet button) makes relations act as springs and cards push each other apart, so the graph sorts
  itself by its connections. Double-click a card to pin it. It works on graphs of up to 400 concepts.
- From 150 concepts only what's on screen is drawn, and relation labels are left out when you zoom far out.

## Study tools

- **Explain more** (inspector): pick a level (*intuitive*, *rigorous* or *example-driven*) and optionally a parody
  narrator (*nature documentary*, *sports commentator*, *noir detective*, *medieval scholar*, *overexcited
  infomercial*, *Shakespearean*). The narrator changes only the telling; the mathematics stays correct. The
  explanation is kept on the concept, next to your own **My notes**.
- **Quiz me** (**File → Quiz me…**, or the inspector): questions one concept at a time, prerequisites first, as free
  recall or multiple choice. Grade yourself **Knew it / Partly / Didn't know**. The grade becomes the concept's
  mastery, shown as a coloured dot. Mastery fades over time, so the next quiz asks what you didn't know first.
- **Flashcards (Anki)…** (**File**): definition, prerequisite and relation cards for Anki (formulas converted for
  Anki's MathJax) or as CSV. A theorem you took apart also gives cards for its hypotheses.
- **Walkthrough…** (**File**, or the inspector): a full-screen, read-only presentation, one concept per slide in study
  order.
- **Derive together** (toolbar or **File**): work a problem out yourself with an AI tutor that **only gives hints**.
  It never writes a step or the answer.
  - **Documents:** import PDF, text or Markdown files. A **problem sheet** is split into its problems, and you pick
    one. **Reference** material is what the tutor cites, as `[1] Notes, p. 4`. Click a citation to open that page.
    Or select a passage and choose **Use selection as problem**, or type any problem.
  - **PDF import** reads the text layer, including Chinese, Japanese and Korean PDFs whose fonts aren't embedded.
    Scanned pages (also black-and-white fax, JBIG2 or JPEG 2000 scans) are sent as a picture to the **vision model**,
    which reads formulas as LaTeX. You can paste in the text of a page that can't be read.
  - **Steps:** **Check** marks each step *Correct*, *Gap*, *Error* or *Unclear*. **Hint** gets more specific each
    time you ask. **Reviewer 2** writes a mock-pedantic referee report whose points are meant to be real.
  - **Add to graph:** the problem becomes a concept linked to the concepts it used, with the source page and your
    steps in its notes. Documents and derivations are kept per project in this browser; **Copy as Markdown** exports
    a derivation.

## Mathematics and formal sciences

- **Formulas** as LaTeX (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`) are typeset with KaTeX on cards, in the inspector, in
  explanations, quizzes and proposals. Prices such as "$5 and $10" stay text.
- **Formulas → LaTeX** (inspector, next to the definition's **Edit**): when a definition writes its formulas with
  Unicode symbols ("φ(ab) = φ(a)φ(b)", "x² ≤ y"), the AI rewrites just those formulas as LaTeX. An answer that changed
  any other word is refused, the source is kept, and one Undo brings the old text back.
- **Concept kinds:** *definition*, *theorem*, *lemma*, *proposition*, *corollary*, *axiom*, *conjecture*, *example*,
  *notation* or *other*, shown as a small label on each card. The AI suggests a kind only while it is unset, so your
  own choice is never overridden.
- **Theorem anatomy** (inspector, **Take apart**): each hypothesis with why it is needed and a counterexample without
  it, the conclusion, a proof idea, examples and non-examples.
- **Find in Mathlib** (inspector): the AI suggests Lean 4 declarations, and each one is checked against Mathlib with
  Loogle. Only declarations that really exist are listed.
- **Find papers** (inspector): real published papers about the concept from [OpenAlex](https://openalex.org). No AI
  is involved. OpenAlex allows about 100 free searches a day per network.
- **Import LaTeX (.tex)…** (**File**): each definition, theorem, lemma… of a paper becomes a concept of that kind,
  linked by what it `\ref`s. You review it first, and no AI is involved.
- **LaTeX document (.tex)** (**File**): a compilable `amsart` article with one theorem environment per concept, in
  study order. **Notation…** lists the symbols the graph introduces.

## Parody modes

- **Absurd chain** (the theatre-masks button next to Mix, or **File → Absurd chain…**): real facts, ridiculous
  reasoning. Give it two concepts (from the graph or typed in), pick a style (*deadpan*, *conspiracy*, *epic saga*,
  *bureaucratic*, *academic overkill*) and a length (3 to 7 links). Every link is meant to be a true, checkable fact;
  only the narration, the title and the moral are silly.
  - **Stops along the way:** add up to 6 stops of your own, either concepts of your graph or your own with a short
    description. The chain passes through them in order, and you can reorder them.
  - **Roll again** takes another route, **Copy as text** copies it, and **Add to a sandbox** puts the chain into a new
    sandbox, so your graph only changes if you merge it back. **Surprise me** picks two random ends.
  - **Guess the chain** is a game: guess the concepts hidden between the two ends from each link's relation, with
    clues and a best score per pair.
- The facts come from an AI: check one before quoting it.

## Projects, sandboxes and versions

- **Projects** (the menu at the left of the toolbar): several independent brainstorms, each with its own main graph
  and sandboxes. Everything autosaves in this browser.
- **Versions** (**File → Versions…**): restore points, saved automatically before big changes (Install all, adding
  extracted concepts, merging or discarding a sandbox, Tidy, restoring) and every 10 minutes while you edit. You can
  also save one with **File → Save snapshot…**. **Compare**, **Preview** and **Restore** (or **Restore as new
  project**) work from the list.

## Export and share

**File** has:

- **JSON (this project)**, with its sandboxes. **Import JSON…** adds a file as a new project and repairs damaged or
  hand-edited files instead of rejecting them.
- **Markdown notes** (in the interface language, formulas as `$…$`), **LaTeX document**, **Mermaid diagram**, **PNG
  image** and **Flashcards (Anki)…**.
- **Share link…** packs the current graph into a link. No account or server is involved: the graph is compressed into
  the part of the URL after `#`, which browsers never send to a server. The recipient sees it read-only and can **Save
  a copy**. Your notes, explanations, quiz progress and stored look-ups are left out. Some chat apps cut links longer
  than about 8,000 characters, so for big graphs send the JSON export instead.

## Offline and installable

The site is an installable web app: in Chrome or Edge use **Install app** in the address bar or menu, and on iPhone
and iPad use Safari's **Share → Add to Home Screen**. After the first visit it also opens without a network. While
offline, a banner says so and AI actions stop at once with a message. The **Offline demo** and a local Ollama still
work. The offline copy holds only the app's own files: calls to AI providers, look-up sites, search engines and the
local server always go to the network. When a new version is deployed, a
**New version available — Reload** notice appears, and nothing changes until you press it.

## Keyboard shortcuts

Press **?** in the app for the full list and the tour.

| Keys | What it does |
|---|---|
| Ctrl/Cmd+K | Find a concept |
| ? | Keyboard shortcuts |
| Esc | Close a dialog or menu; leave focus mode or Select several |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl+Y) | Undo, redo |
| Delete / Backspace | Delete the selected concepts, or the open relation |
| F | Focus on the selected concept |
| H, Shift+H | Hide the selected concepts, hide all the others |
| Shift/Ctrl+click, Shift+drag | Select several concepts, select an area |
| Tab, Enter | Move between relation arrowheads, open one |
| ←/→, Space, Home/End | Move through the walkthrough |

## Languages, phones and accessibility

- **Settings → Interface:** theme **Auto**, **Light** or **Dark**, and the interface language, English or 中文
  (Simplified Chinese). By default it follows the browser. The AI's answer language is a separate setting.
- **Phones:** the less-used buttons fold into a **More tools** menu, the inspector becomes a bottom sheet, and **Select
  several** replaces Shift-click. The 3D view knows finger gestures.
- **Keyboard and screen readers:** everything works from the keyboard. Dialogs trap focus and give it back when they
  close, and messages are announced. The end-to-end tests run an axe (WCAG A/AA) audit in both themes and in Chinese.

## Privacy: what is sent where

NodeStorm has no account and no NodeStorm server on the internet. Your projects, versions and documents stay in your
browser (localStorage and IndexedDB).

| What | Goes to |
|---|---|
| Concept names, definitions and the related concepts (up to 500) for each AI task; the sources' texts to rate; for Derive together, the problem, your steps and passages of your documents; a scanned page's picture | The AI provider you chose (directly, or through your local server) |
| Concept names | The encyclopedias and wikis you enable (ProofWiki, Wikipedia/Wikidata, Baidu Baike and Moegirl for Chinese names, your Fandom/BWIKI wiki) |
| `"<name>" definition` as a search query | Only the web search engines you tick in Settings → Web search |
| Lean names the AI suggested | Loogle, when you press Find in Mathlib |
| A concept name (plus some prerequisite names) | OpenAlex, when you press Find papers |
| A shared graph | Nobody: it travels in the link's `#` part, which isn't sent to any server |

- Look-ups and searches send no cookies. The Baidu Baike answer is read in a sandboxed frame that can't reach the
  page, your keys or your storage.
- **API keys** for AI providers and search engines stay in this browser tab (sessionStorage) unless you tick
  **Remember keys on this device**, which keeps them in localStorage. They are never part of exports, share links or
  versions. In browser mode each key goes only to its own service.
- With the local server, the keys can stay in `server/.env` and never reach the browser.

## The local server (optional)

You need the local server when you want to:

- keep your keys out of the browser (in `server/.env`), or
- use **Brave Search**, whose API refuses calls from web pages, or
- reach a SearXNG instance that doesn't allow requests from the site.

```bash
cp server/.env.example server/.env   # add your keys
npm run dev                          # server on :8787 + UI on :5173
npm run dev:mock                     # the same with the offline demo AI (no keys)
```

Then choose **Through the local NodeStorm server** in Settings.

- AI providers are configured with `<PROVIDER>_API_KEY`, `<PROVIDER>_BASE_URL` and `<PROVIDER>_MODEL` (for example
  `SILICONFLOW_API_KEY`, `DEEPSEEK_MODEL`), plus `AI_PROVIDER` (the default) and `ANTHROPIC_WEB_SEARCH=1`. The browser
  may choose the provider and model, never the key.
- Web search uses the key typed in Settings, or else `TAVILY_API_KEY`, `SERPER_API_KEY`, `BRAVE_API_KEY` and
  `SEARXNG_URL` from `server/.env`.
- **It has no login and spends your keys**, so it listens only on this computer (127.0.0.1, port `PORT`, default
  8787). Set `HOST` (for example `HOST=0.0.0.0`) only behind your own authentication.
- **DNS-rebinding protection:** it only answers requests addressed to `localhost`, `127.0.0.1`, `[::1]` or `HOST`,
  and none sent by pages of other sites, so a malicious page can't spend your keys. If you reach it by another name,
  list that name in `NODESTORM_ALLOWED_HOSTS` (comma-separated).

## Developer guide

Requirements: Node 22 and npm. The repository is an npm-workspaces monorepo:

```
shared/   graph model + AI task schemas (zod), and the AI core: providers, prompts, tasks, the offline demo,
          encyclopedia, web search, Loogle and OpenAlex clients
server/   optional Express API: POST /api/<task> (name, relate, deps, derive, explain, anatomy, extract, quiz,
          resolveCycle, readPage, splitProblems, tutorHint, checkStep, refereeReport, absurdChain, mathlib, connect,
          assess), POST /api/search/<engine>, GET /api/providers, GET /api/models
client/   Vite + React + React Flow UI; pure graph logic in client/src/lib/ (e.g. graphOps.ts)
e2e/      Playwright smoke test (runs against the offline demo), PWA check, perf timing
scripts/  live smoke tests against real providers, the encyclopedias and OpenAlex
docs/     ARCHITECTURE.md, the maintainer's guide
```

### Scripts

```bash
npm install
npm run web        # UI only, http://localhost:5173
npm run dev        # local server (:8787) + UI
npm run dev:mock   # the same with the offline demo AI
npm run build      # static site in client/dist/
npm run typecheck
npm test           # vitest (unit tests; the network is blocked in tests)
npm run e2e        # starts server (offline demo) + UI and drives the whole app in Chromium, incl. an axe audit
npm run e2e:pwa    # builds, serves client/dist, checks manifest, service worker, offline start and update notice
```

- The e2e scripts need Chromium for Playwright (`npx playwright install chromium`). `E2E_SERVER_PORT` (default 8799)
  and `E2E_WEB_PORT` (default 5199; 4273 for `e2e:pwa`) change their ports, so several runs can share a machine.
  `E2E_BUILT=1 npm run e2e` runs the same test against the production build (`npm run build` first) and fails on any
  Content-Security-Policy violation. Screenshots go to `e2e/screenshots/`.
- `node e2e/perf.mjs` times a generated 300-concept graph (it starts Vite itself; `PERF_PROFILE=status|inspect|drag|physics`
  profiles one section).
- Coverage, as a one-off: `npm i --no-save @vitest/coverage-v8@<vitest version>`, then `npx vitest run --coverage`.
- The app icons are drawn in `client/public/icon.svg` and `client/pwa/icon-maskable.svg`; `node
  client/pwa/make-icons.mjs` renders the PNGs.

All of these use the offline demo. To check a **real** provider end to end, put its key in `server/.env` and run
`npm run smoke:live` (default provider), `npm run smoke:live -- anthropic`, or `npm run smoke:live -- siliconflow 中文`.
It runs every AI task once, validates each answer against the app's schemas and prints the timings. It costs a few
cents at most. `npm run smoke:lookup` and `npm run smoke:papers` check the encyclopedias and OpenAlex.

### CI and deployment

- `.github/workflows/ci.yml` runs typecheck, unit tests, e2e and e2e:pwa on every push and pull request. When an e2e
  run fails, its screenshots are uploaded as the `e2e-screenshots` artifact.
- `.github/workflows/pages.yml` builds `client/` and publishes it to GitHub Pages. It only runs when started by hand
  (Actions → **Run workflow**), because publishing a public site is the owner's decision. To turn it on once, choose
  **Settings → Pages → Build and deployment → Source: GitHub Actions**, then run the workflow. To deploy on every
  push, add a `push: branches: [main]` trigger. The built site needs no server: visitors bring their own key or use
  the offline demo.

### Adding a provider

See [docs/ARCHITECTURE.md → Add a provider preset](docs/ARCHITECTURE.md#add-a-provider-preset). In short: add it to
`PROVIDERS` and `createProvider` in `shared/src/ai/factory.ts` (implementing the `Provider` interface if it isn't
OpenAI-compatible); the server maps its env vars in `server/src/providers/registry.ts`.
