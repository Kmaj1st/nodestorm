# Changelog

## 2026-09-24

Everything below landed on `claude/hopeful-pascal-bc67up` in one day. Most features were built on their own
`claude/feature-*` branch and merged by hand, with typecheck, unit tests, the Playwright e2e run, the PWA check and an
axe accessibility audit green after each merge. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits
together.

### The core idea
- A concept graph: add concepts by name, or describe one and let the AI name it.
- The AI checks each concept's **prerequisites**. Missing ones **block** it until you install them.
  Example: *First Isomorphism Theorem* needs *Isomorphism*.
- **Mix** two concepts to get their relation **in both directions**. Click either arrowhead to read what that side
  does to the other.
- **Sandbox mode**: fork a copy, derive new ideas in it, then merge back or discard.
- **"What do you mean?"**: an ambiguous name (e.g. *Expectation*) opens a dialog with N meanings plus
  "something else". N is set in Settings.

### AI
- **Keys in the browser**, with no server needed. Keys are kept for the tab only unless you tick "remember".
  **Server mode** keeps keys in `server/.env`; the server listens on 127.0.0.1 only.
- **Providers**: SiliconFlow (default), Anthropic, DeepSeek, Moonshot (Kimi), Zhipu (GLM), Qwen (DashScope),
  Ollama (local), any OpenAI-compatible endpoint, and an offline demo.
- **Model discovery** from each provider's API.
- **Answer language** setting, independent of the interface language.
- **Robustness**:
  - Timeouts and cancel on every call, so a hung request fails visibly.
  - 429/5xx retries with backoff.
  - A queue limiting how many calls run at once.
  - Handling for reasoning models (`<think>` blocks, JSON-mode fallback).
  - LaTeX escape repair that only kicks in when needed.
- `npm run smoke:live` checks a real key and model end to end.

### Study and thinking tools
- **Install all** missing prerequisites, recursively and with limits. **Learning path** in study order, with
  highlight. **Cycle** warnings.
- **Explain more** at three levels, plus **personal notes**.
- **Extract from text**: paste notes and review the proposed concepts and relations.
- **Quiz me**: questions in prerequisite order, self-grading, and a mastery dot on each concept.
- **Math**: `$…$` LaTeX is rendered with KaTeX, which loads only when needed.
- **Flashcards**: export for Anki (TSV, with math converted for MathJax) or as CSV.

### Organising
- **Projects**, plus an offline *Group theory* example with LaTeX formulas.
- **Undo/redo** per graph, the Delete key, and hand-editing of names and relations.
- **Tidy** layered layout. **Find** (Ctrl/Cmd+K), which also searches notes.
- **Focus mode** (1–3 hops). **View filters**: relation kinds, labels, a to-do view.
- **Versions**: automatic and named snapshots in IndexedDB, with compare, preview and restore.

### Sharing and export
- Export JSON, Markdown notes, Mermaid, PNG and flashcards. Import repairs damaged files instead of rejecting them.
- **Share by link**: the graph is compressed into the URL hash and opens in a read-only viewer with "Save a copy".

### App quality
- **Interface in English and 中文**. Dark mode. Accessible dialogs. A small-screen layout. An axe WCAG A/AA audit
  in e2e.
- **Installable, offline-capable PWA** with an update notice. `?` shows the keyboard shortcuts.
- First-run **welcome card** and **guided tour**.
- Performance on 300-concept graphs: status updates about 17× faster and drags about 5× faster. Initial JS is 25%
  smaller, with dialogs, SDK and KaTeX loaded on demand.
- **CI** runs typecheck, unit tests, e2e and the PWA check. A **manual** GitHub Pages deploy workflow is included.

### Reviews
Five review passes of the merged code confirmed about 20 bugs, all fixed with regression tests. Highlights:
- **Security**: the server now binds to loopback only. CSV exports no longer allow formula injection. LaTeX is
  rendered with `trust: false`.
- **Data safety**: no more concepts stuck on "checking" after fork, merge or copy. No duplicate concepts on merge.
  Undo restores the right state. Quiz progress survives merges.
- **Robustness**: a failed dialog download shows a Reload notice instead of a blank app. Opening a share link no
  longer breaks AI work on your own graphs. Names in any script (Cyrillic, kana, Hangul…) match correctly.

### Known limitations
Not yet verified against a real AI provider. The tests use the offline demo and simulated SiliconFlow responses, so
run `npm run smoke:live` with your key first. Other limitations are listed in `docs/ARCHITECTURE.md`.
