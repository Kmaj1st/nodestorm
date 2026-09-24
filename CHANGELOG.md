# Changelog

## 2026-09-24

Everything below landed on `claude/hopeful-pascal-bc67up` in one day. Most features were built on their own
`claude/feature-*` branch and merged by hand, with typecheck, unit tests, the Playwright e2e run, the PWA check and an
axe accessibility audit green after each merge. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits
together.

### UI refresh
- **No emoji or pictographic symbols** in the interface: icons are SVGs from `lucide-react` (one `Icon` component,
  decorative and `aria-hidden`), and translated strings no longer carry symbols ("Mix", "Derive", "File").
- **Design tokens** for spacing, radius, type, shadows and focus; light and dark palettes tuned separately.
- Consistent buttons (primary, secondary, ghost/icon, danger; 32px and 28px dense), a grouped toolbar with an AI
  status chip, calmer concept cards with status pills, a sticky inspector header with chips and rows, dialogs with a
  standard header (title and close button) and a sticky footer, and restyled menus, toasts, status bar, welcome card,
  tour, quiz, versions, flashcards and walkthrough.

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
- **Lean / Mathlib**: the AI suggests Mathlib declarations for a concept and each is verified with Loogle. Only real declarations are shown, with their types, docstrings and doc links.
- **Definitions from encyclopedias**:
  - ProofWiki (with its maths macros turned into standard LaTeX), then Wikipedia and Wikidata (formulas kept), are asked before the AI.
  - Each definition keeps a link to its source, and several meanings go to "what do you mean?".
  - It works without an AI key. Each source can be switched on or off in Settings.
- **Derive together**: a tutor mode for working a problem out yourself.
  - Import PDFs (scanned pages are read by a vision model), text or Markdown, as problem sheets or references.
  - Pick a problem from a sheet, select one in a document, or type your own.
  - The AI checks each step (correct / gap / error / unclear) and gives hints that get more specific when asked
    again. It never writes the derivation for you, and it cites your references by page.
  - You choose what goes into the graph: the result, linked to the concepts it used, with its source page.
- **Absurd chain** (parody mode): link any two concepts, from the graph or typed in, through a chain of 3-7 true,
  checkable facts, narrated in a silly style (deadpan, conspiracy, epic, bureaucratic, academic overkill). Roll again
  for another route, copy it as text, or add it to a new sandbox named after it. A new `absurdChain` AI task whose
  answers are checked (the chain must run from one end to the other; loops are cut out) and asked again when broken.
  The toolbar now keeps the brand and button labels hidden up to 1440px (was 1360px), so it stays on one row with
  the new button.
- **Automatic cycle resolution**: when a check closes a dependency cycle, the AI picks the wrong link from the
  reasons each link was added with, and it is removed as one undoable step (a Settings toggle; "Resolve with AI" in
  the inspector).
- **Install all** missing prerequisites, recursively and with limits. **Learning path** in study order, with
  highlight. **Cycle** warnings.
- **Explain more** at three levels, plus **personal notes**.
- **Extract from text**: paste notes and review the proposed concepts and relations.
- **Quiz me**: questions in prerequisite order, self-grading, and a mastery dot on each concept.
- **Math**: `$…$` LaTeX is rendered with KaTeX, which loads only when needed.
- **Flashcards**: export for Anki (TSV, with math converted for MathJax) or as CSV.
- **Walkthrough**: full-screen slides through a learning path or the whole graph, in study order. Also works on
  a shared graph.

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
- **Visual refresh**: consistent design tokens, and lucide icons instead of emoji and symbols.
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
