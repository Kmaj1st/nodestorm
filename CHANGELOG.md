# Changelog

## 2026-09-26: overnight improvements

- **Web search for definitions (engines and Settings):** Settings → **Web search** sets up Tavily, Serper (Google results), Brave Search and your own SearXNG instance. Each has a key (or address) field and a **Test** button that runs one small search and says it works, or why not in the interface language ("Tavily rejected the API key", "Serper: this account's searches (or credits) are used up"). There is a link to get a key and a limit on results (6 by default). Keys are kept like AI keys: only for the tab unless "Remember keys" is on. Concept names go only to the engines you tick. Brave's API doesn't answer web pages, so it needs the local server. There, every engine goes through `POST /api/search/:engine`, which can also take the keys from `server/.env`. Results are plain text (markup removed, never inserted), https pages only, one per page, cached for 30 days. An engine that refuses is skipped for 10 minutes. The offline demo searches a pretend web built from its knowledge base.
- **Definitions from sources you pick, never written by the AI:** adding a concept by name searches the encyclopedias and wikis and the web search engines together, and the AI rates the sources against each other: **Reliable**, **Fairly reliable**, **Doubtful** or **Unusable**, with why (the site's authority, agreement with the others, a forum or advert, another meaning of the name), plus a short note on where they disagree. The pop-up **Sources for “X”** lists them most reliable first, grouped by meaning when they describe different things, each with a link to the page and the AI's passage marked in the source's own text. Pick a passage, select any other words of a source and press **Use selected text**, or write **My own definition** (**Edit a copy** starts from a source's text: cut down it stays that source's words, changed it is saved as written by you). The definition is always exactly the source's words, saved with its page as the source. A passage the AI "quotes" that isn't really in the source is dropped. Without an AI the sources are listed unrated; without a search engine the pop-up says only encyclopedias were asked and links to Settings → Web search.
  - **Ask the AI** and the AI's own definitions are gone from the look-up paths. **Look up in… → Search the web and compare…** (instead of "AI") opens the same pop-up for an existing concept; choosing replaces the definition (one undo step).
  - **Use the AI right away** (Settings) and **Install all** take the most reliable source's passage automatically (never an encyclopedia's page for another name, and not when equally reliable sources mean different things: then the pop-up asks); with nothing found the concept "needs a definition". A single **Install** in ask-first mode still takes only an exact encyclopedia page (no web search, to save the search quota).
  - Reopening the pop-up from a concept's badge shows this session's rated sources again without searching.

- **Definitions pop-up polish:** with look-up results it says **Use this definition** (and the inspector "Definitions were found for …" / **Choose a definition…**; the card badge "choose a definition", the status "needs a definition"). When nothing was found, **My own definition** is open and focused (its **Ask the AI** button has since gone, with the AI's own definitions: see above). The inspector's "not checked" and other boxes wrap their button under the text on narrow panels and phones; the share viewer shows "not checked" instead of an action.
- **Look-ups don't overwrite a changed concept:** renaming a concept while its look-up runs looks the new name up; a definition typed meanwhile is kept (waiting for "Check with AI"); an undone add opens no pop-up. Baidu Baike and Moegirl are asked for Chinese (or Japanese) names whatever language the AI answers in.
- **Imports and share links keep more:** the meanings of a concept waiting for a choice keep their source (encyclopedia link or AI) and kind, and a concept that "needs a definition" still needs one after the round trip instead of turning "ok".
- **Share links** no longer mark a concept whose check was running or failed as "ok": it arrives "not checked" (or "needs a definition").
- **Symbol names** such as "∇" or "∫" are recognised as the same concept when added again, and as different prerequisites from each other.
- **Markdown and LaTeX exports** name the site of a looked-up definition ("Wikidata: Q83478"), and Markdown links its page.
- **Full browser storage** no longer breaks editing: changes still apply (a new concept no longer stays "checking"), and a notice says they can't be saved and suggests exporting the project.
- **Merging a sandbox** where both sides added the same concept keeps the sandbox's prerequisites of it (linked and missing), so its dependency links still count in study order and learning paths. Folding a concept into an existing one does the same.
- **A prerequisite that is one of the concept's own aliases** is ignored instead of staying "missing" for good (installing it only said the concept already exists).
- **AI answers** that write a prerequisite's role with capitals ("Uses") are read instead of failing the check.
- **Absurd chain: stops along the way.** Put up to 6 of your own stops between the two ends: concepts of your graph, or your own with a short description of what they mean. The chain passes through them in order (the AI is asked again if it skips one), they are marked "your stop", and a custom stop added to a sandbox keeps your description as its definition. Stops can be reordered with the up/down buttons.
- **中文 throughout:** the Markdown notes export and "Copy as Markdown" in Derive together are written in the interface language (headings, labels, verdicts, sources). The LaTeX document stays English. The offline demo provider is called 离线演示, and errors about a missing version are translated.
- **Wording:** "prerequisites" (not "dependencies") for what a concept needs, "concept" (not "node"), and counts read "1 new concept", "1 layer". Chinese wording made consistent (连线 for graph links, 循环依赖, 定理解剖/假设), with Chinese colons and quotes.
- A test checks that no Chinese message is left in English and that every plural form resolves.
- **中文, the rest:**
  - AI errors (time-outs, rate limits, a rejected key, an unknown model, server errors, unreadable answers) are shown in the interface language, also through the local server. The provider's own message and the HTTP status follow in brackets.
  - What the app writes into the graph is in the interface language of that moment: prerequisite labels ("using" / 使用) and their explanations, "builds on", Derive together's "Used in the derivation", LaTeX import's "Refers to…" / "Mentions…", the "relates to" of a repaired file, and the default project names ("Untitled project", "My brainstorm", "… (copy)"). Nothing already stored is rewritten.
  - The relation panel has **No relation this way** (这个方向没有关系) instead of asking for the word "none"; typing 无 or 没有 as the relation also means none. A "none" side reads "no relation" in the relations list and on screen readers.
  - Lists of names use 、 in Chinese; labels ("事实：", "可信度：", a relation "A → B：…", "Wikidata：…") take the Chinese colon; Baidu Baike and Moegirl are called 百度百科 and 萌娘百科; "Surprise me" offers Chinese ends; 前置知识 is used throughout.
- **Basic concepts:** Inspector → **Basic concept** marks a concept as taken as given (a small mark on its card). It needs no prerequisites: its missing ones go, it is never blocked, and no prerequisite check (no AI call) runs for it. The links it already has stay. Unmarking leaves it "not checked", ready for **Check prerequisites with AI**. A blocked concept's missing list also offers "take it as given". Undo, share links, files and sandboxes keep the mark.
- **Hide concepts for now.** The eye button in the inspector's header, **H** on the canvas (the selected concepts) or **Shift+H** (all but the selected ones), and **View → Hide selected / Hide others** take concepts and their relations off the canvas, the minimap, fit-view, Tidy and the 3D view. It is only a view choice for this browser tab: nothing is deleted, undone, exported or shared, and a new tab shows everything. **"N hidden · Show all"** in the canvas corner lists them, each with its own **Show** button; finding, opening or walking through a hidden concept shows it again.
  - Deleting a hidden concept and then **Undo** brings it back still hidden (and Redo takes it away again).
  - On a phone the open "N hidden" list sits beside the canvas zoom buttons instead of covering them.
- **Faster start:** the first-paint bundle is 15% smaller (805 kB instead of 950 kB; 258 kB instead of 313 kB gzipped). The in-page AI (provider clients, prompts, the offline demo's knowledge base), the Chinese interface text (only fetched when the interface is Chinese) and LaTeX export/import are now loaded when first needed. The service worker still caches them all, so everything works offline.
- **Smoother Physics on big graphs:** a simulation step on 400 concepts takes about a quarter of the time (1.7 ms instead of 7 ms), with exactly the same result, and concept cards no longer re-render when they only move (Physics frames and drags).
- `e2e/perf.mjs` also measures a Physics run and main-thread time of each section; `PERF_PROFILE=status|inspect|drag|physics` profiles one.
- **Phones and keyboards:** the View popover opens inside the screen on phones and tablets (it ran off the left edge); Settings' Fandom/BWIKI fields stack on a phone instead of spilling past the dialog; Add, Mix, Derive and Derive together share one toolbar row at 390px, so the canvas gets a row back. Tabbing out of the project, View or File menu closes it, and Escape returns focus to its button. On a phone, **Derive together** hides the app it covers from Tab and screen readers, and closing it returns focus to where it was. The details sheet can be scrolled from the keyboard. Relations are no longer an extra tab stop named by internal ids (their arrowheads are the keyboard targets), and the zoom buttons and canvas hints for screen readers follow the interface language.
- **Damaged saved projects load:** graphs saved in the browser are checked like imports when the page opens. A missing list or field is filled in, a broken entry dropped, and the rest of the project kept; a notice says what was repaired.
- **A saved AI provider that no longer exists** goes back to the default one, so AI actions open Settings instead of failing.
- **Aliases stay unambiguous:** a new concept's alias (or one found by a look-up, or kept on renaming) that is another concept's name or alias is dropped; the concept is added as usual.
- **Extracting without an AI set up** leaves the new concepts "not checked" (their badge checks them later) instead of one error per concept.
- **C, C++ and C#** (and f / f′, A / A*, A†) are different concepts: symbols such as + # * ′ † count in names, while case, spaces, hyphens, underscores and trailing punctuation still don't.
- **Escape doesn't lose typed text:** in the definitions pop-up (your own definition), Add concept (definition or description) and Settings (unsaved changes), Escape, a click outside or X first asks "Discard what you typed?"; focus is on **Keep editing**, and Escape again goes back to the text. Extract from text (pasted text or a focus, also while its concepts are reviewed) and Absurd chain (ends or stops typed for a chain not built yet, a custom stop's description) ask too.
- **Derive together keeps the last change across a quick reload:** a derivation started (or a document's problems found, or something deleted) just before the page reloads or the tab closes is no longer lost when its IndexedDB write hadn't finished. Each such write is noted in localStorage first and written through when the library next opens.
- **Undo keeps an AI explanation or theorem anatomy exactly as it was stored** (its time could differ by a millisecond before).
- Tests: the flaky theorem-anatomy unit test is deterministic, and the end-to-end test waits for menus, dialogs and saved state instead of fixed pauses.
- **Merging a sandbox, or folding a concept into one that has the same meaning,** keeps aliases unambiguous too: the folded concept's name and aliases become aliases of the one it joined where no other concept has them, and on a merge the aliases the main graph already had win.
- **Errors of the browser storage** behind Versions and Derive together's documents (unavailable, blocked by another tab, full) are said in the interface language.
- **The main graph** is headed "Main graph" (主图谱) in the Markdown export and in Derive together's "Add to graph", instead of its stored name "Main".
- **Faster start, again:** the encyclopedia clients (ProofWiki, Wikipedia/Wikidata, Baidu Baike, the MediaWiki wikis) load on the first look-up that isn't cached: the first-paint bundle is 818 kB instead of 832 kB (262 kB instead of 267 kB gzipped). Physics saves positions without scanning the concept list once per concept.
- **Concept names wrap between words:** a card's name no longer breaks mid-word ("Homomor|phism") on a narrow card; the status pill moves under the name when both don't fit. A single long word is hyphenated in the name's own language and set a little smaller (also when zoomed out), and Chinese names wrap as before.
- **Touch screens:** the 3D view's hint names finger gestures (one finger rotates, a pinch zooms, two fingers pan, a tap opens a concept), and lifting a finger after a pinch no longer opens a card. Loading the example says "tap a concept" instead of "press ?".
- **Quiz on a phone:** the question type select shows short names (Mixed, Recall, Apply, Connect), with the chosen one explained under it, instead of cutting off its text. Toasts use the width of the screen instead of half of it.
- **First visit polish:** the welcome card's first button has the focus; after adding a stop to an absurd chain the focus goes back to its field, and a new chain takes the focus when it is built (it was lost); Mix gives the focus back when it's done. Disabled **Derive** (nothing selected) and **Use this definition** (nothing picked or written) say why. "How to use" describes the look-ups-first flow and **Check with AI**. Derive's goal field keeps its example readable on a phone.
- **The example in Chinese:** in the Chinese interface, loading the example builds 群论 (群、子群、正规子群、同态、核、商群、第一同构定理, blocked on a missing 同构) with Chinese definitions, reasons and relation labels (核 总是构成 正规子群…). Same graph as the English one; a test keeps the two in step.
- **The offline demo speaks Chinese:** with Chinese concept names (AI answer language "Auto") or the 中文 answer language, the demo AI answers in Chinese in every task: prerequisites and their reasons, Mix's relation labels (使用、推导出、假设), Derive's proposals, extraction from a Chinese text, explanations at every level and in every voice, theorem anatomy, quiz questions, absurd chains (with their stops), suggested connections, "describe it", cycle repairs, Mathlib's descriptions (the Lean names stay as they are) and the reasons and notes of its source check. Its knowledge base knows the Chinese names and aliases (群、核、商群、同态基本定理…), and its pretend web search has Chinese pages for them (百科, lecture notes and a forum post that is wrong). English names get exactly the English answers as before.
- **Derive's sandbox tip has a button:** **Fork a sandbox** in the tip forks like the toolbar's button and keeps the dialog open: it says which sandbox the accepted concepts now go to, and the focus goes to the goal field.
- **Hiding keeps the focus:** hiding a concept from the inspector moves the focus to "N hidden" in the canvas corner; **H** on a concept's card moves it on to the next concept shown; "Show all" (or showing the last hidden one) to a concept shown again, instead of the page. Screen readers hear "Hid Kernel from the canvas…".
- **File names:** exports of the main graph are named in the interface language ("nodestorm-main-graph-…", "nodestorm-主图谱-…"), and Chinese (or accented) graph and project names are kept in the file name instead of dropped. The graph menu shows a main graph that was renamed by its name.
- Add concept: "(optional)" stays beside "Definition". A relation's explanation is a bordered field like Notes (it showed a resize handle without a border).
- **Security review:** the local server answers only requests addressed to `localhost`/`127.0.0.1`/`[::1]` (or `HOST`, or names in `NODESTORM_ALLOWED_HOSTS`) and none from other sites' pages, so a DNS-rebinding page can't spend the keys in `server/.env`. An API key that a provider (or proxy) echoes in an error body is replaced by "[key hidden]" before it reaches a message. The production build carries a Content-Security-Policy (`client/pwa/csp.ts`: the app's own scripts only, no inline code or eval; the Baidu Baike frame's one fixed script is allowed by hash). PDF import turns XFA forms off. `E2E_BUILT=1 npm run e2e` runs the end-to-end test against the build and fails on any CSP violation.
- **Security review, follow-ups:**
  - **Taking a definition unasked** (Settings "use the AI right away", Install all) needs a second opinion for a web page: another site or an encyclopedia rated reliable (or fairly reliable) for the same meaning. A page that alone was rated reliable, perhaps because its own text steered the AI, now opens the pop-up (Install all leaves it "needs a definition"). An encyclopedia page of exactly the name rated reliable is still taken alone.
  - **The saved sources** (kept a day so the badge reopens them) are checked when read like the web search cache: bounded text, https links only, known ratings, and passages that really are their source's words. A damaged or edited entry is dropped and searched again.
  - **A SearXNG instance used through the local server** can redirect at most twice, and only on its own host (or from http to its https): a redirect elsewhere, such as to a cloud metadata address, is refused.
  - The source check's concept name and hint, and the names sent to "Suggest connections", have length limits.
- **Security review of web search and sources:** an engine's answer is read up to 4 MB (a larger one, or a larger Content-Length, is refused unread) and at most 100 hits of it are kept, so a hostile SearXNG instance can't exhaust the browser or the local server. Tavily, Serper and Brave requests don't follow redirects (their key headers would go along). No piece of a key is left where an engine's error message is cut short. The stored web search cache is checked when read: junk in storage is ignored, and an entry with a non-https page or non-text fields is searched again. The sources pop-up links only https pages. KaTeX shows a formula as its source when it is over 5 000 characters or its typeset HTML would be over 300 kB (a 2 kB matrix from a web page made 600 kB). The AI's source check is told that page texts are data, never instructions, and a page that tries to steer it is "unusable".
- **Derive together keeps a page's text typed just before a quick reload** too: the write is noted in localStorage like the others while the page notes stay under 200 kB in all; a bigger page is noted when the tab is hidden or closed.
- **Look-ups send no cookies** to the encyclopedias and wikis, like web searches.
- Cleanup: the AI task that asked which meaning a name has (no longer used since definitions come from sources) is gone, with its prompt, offline answer and styles. README and ARCHITECTURE.md describe the sources flow instead of "what do you mean?".
- **The AI's rating stays with the definition:** a definition taken from a rated source keeps how reliable the AI found it, its short reason and how many sources it compared. The inspector says "Source: demo-encyclopedia.example: … · Reliable (AI check of 3 sources)" with **Why?** (and a tooltip) for the reason; the Markdown export adds the same after the source. Files, share links and import repair keep it (a damaged rating is dropped, the source kept). Editing the definition by hand makes it yours and drops the rating.
- **Sources survive a reload:** what the sources pop-up found and the AI's rating are kept in the browser for a day (50 names, about 500 KB), so a concept's badge reopens the rated sources after a reload without searching or asking the AI again. **Look up in…** and **Search the web and compare…** (and the pop-up's **Search again**) look afresh.
- **A waiting concept's badge gathers its sources:** when nothing was gathered for it yet (a single **Install** in ask-first mode takes only an exact encyclopedia page, to save the search quota), opening the pop-up searches the encyclopedias and the web and has the AI rate them, with "Searching the sources for …" shown meanwhile (closing the pop-up stops it). Sources found but not yet rated are no longer shown as "Not rated" while the AI is still checking them.
- **Sources pop-up polish:** Chinese (and Japanese, Korean) texts are shortened at half the length, and a short view no longer runs to the end of a text without spaces; a cut starts at a word. Rated sources without a meaning label are headed "Other sources" instead of "Not rated". A long title keeps its radio button on the first line. The inspector's source link, its rating and the link icon flow as one line of text.
- **SearXNG on http:** Settings warns that an http:// address other than localhost is blocked on the https site (mixed content), and **Test** (and a search) says so instead of failing with no reason.
- **Select several, for phones:** Mix and Derive need two or more concepts, which only Shift/Ctrl-click could select, so a touch screen couldn't reach them. The new **Select several** button (with the zoom buttons in the canvas corner, where it fits at every width) makes taps and clicks add concepts to the selection or take them out; a bar says "2 selected" with **Clear** and **Done** (or Escape). Holding a card on a touch screen starts it with that card. While it is on, a tap doesn't open the details sheet, and a tap on the empty canvas keeps the selection. Mix's tooltip says how many are picked, and "How to use" on a touch screen names Select several instead of Shift/Ctrl-click.
- **Notices on phones** show just under the toolbar instead of over the bottom of dialogs and the details sheet, and an open dialog (on any screen) keeps clear of a notice, so its buttons are never covered. They are still announced and dismissed with a tap.
- **The React Flow attribution** sits under the zoom buttons on a phone instead of over the cards in the bottom-right corner.
- **PDF.js 6** (from 5.7; fixes advisory GHSA-hq66-cqwq-w95j). **Scans in black and white or JPEG 2000 are read:** pages compressed as CCITT fax, JBIG2 or JPEG 2000 (as most document scanners write them) rendered blank before, so the vision model got an empty picture. PDF.js's WebAssembly decoders for them now ship with the app (360 kB, fetched for the first such page, and precached by the service worker like the rest of the app so it works offline). The Content-Security-Policy is unchanged. The PDF unit tests load PDF.js once before timing anything (a loaded full run could time out the first test), and a new fixture (`e2e/fixtures/scanned-fax.pdf`) checks that such a page renders.
- **Chinese PDFs whose fonts aren't embedded are read:** many Chinese (and Japanese, Korean) papers and textbooks only name a font such as STSong-Light with a predefined CMap (UniGB-UCS2-H), and their text came out empty, so the page went to the vision model as a "scan" it couldn't read either. PDF.js's CMaps now ship with the app, and its standard fonts too (for PDFs that only name Helvetica, Times, Courier, Symbol or ZapfDingbats, drawn with the right shapes where the system lacks them). They are in a folder named after the PDF.js version (`pdfjs-6.3.289/`, 2 MB) that the service worker doesn't precache (the precache stays 77 files, 4.80 MB) but caches file by file on first use, so a PDF read once online is read offline too. `client/pwa/pdfjsData.ts` copies them into the build and serves them in `vite dev`; the Content-Security-Policy is unchanged (same-origin fetches and fonts). A new fixture (`e2e/fixtures/cjk.pdf`, "群论：正规子群与商群") is checked by the unit tests (and without the CMaps: empty text), the end-to-end test and, offline, the PWA check.
- **Sources pop-up from the keyboard:** only the source you're on (its radio, reached with the arrow keys) has its actions (Why?, Open page, Show the whole text, Edit a copy) in the Tab order, so **Use this text** is 6 Tab presses from the first source instead of about 30 with 8 sources. Each action names its source for screen readers ("Edit a copy (demo-encyclopedia.example)"), and the list says how the keys work. Mouse, touch and a screen reader's reading mode reach every action as before.
- The pop-up says **Checking the sources for “X”…** (not "Searching…") while the AI rates them, like the status bar.
- **Touch screens:** the zoom buttons and **Select several** are 40px (28px with a mouse), the open "N hidden" list moves clear of them, and the tour's Mix step says to tap **Select several** (or hold a concept) instead of Shift+click; its relation step says "tap".
- **Focus comes back:** a dialog opened from the File or project menu (or the 3D view from View) returns the focus to that menu's button when it closes, instead of to the page. **Select several**'s Clear moves the focus to Done, and Done or Escape to its toggle by the zoom buttons. In the open "N hidden" list, Tab goes through the concepts before **Show all**, and tabbing out closes the list. A web search **Test** button keeps the focus while it tests.

## 2026-09-25: adding a concept shows the look-ups first; the AI only when you ask

- **Adding a concept by name** opens **Definitions for "…"**: what ProofWiki, Wikipedia/Wikidata, Baidu Baike and Moegirl (for Chinese names) and your Fandom/BWIKI wiki found, side by side, each with its source.
  - It says which sources had nothing, or couldn't be reached. Pick one, write your own, or **Ask the AI** (the tooltip names the provider and model).
  - **Later** leaves the concept marked "needs a definition"; its badge reopens the pop-up.
- **Prerequisites are checked only when you ask.** A concept with a chosen or typed definition is "not checked"; its **check with AI** badge (or **Check prerequisites with AI** in the inspector) runs the check.
- **Install** takes an encyclopedia page of exactly that name without asking; otherwise the concept needs a definition. **Install all** still follows the chain with the AI, as its button says.
- Settings → Definitions has a switch to go back to the automatic flow (best look-up or the AI's definition, prerequisites checked right away).

## 2026-09-25: Baidu Baike, Moegirl, Fandom, BWIKI; AI look-ups proposed

- **Baidu Baike (百度百科):** concepts with Chinese names are looked up there after ProofWiki and Wikipedia (there's a switch in Settings), and it is in "Look up in…".
  - Baidu's API only works through JSONP, so its script runs in a sandboxed frame. The frame can't reach the app's page, storage, API keys or cookies; it can only hand back the answer, which is checked.
- **Community wikis** in "Look up in…":
  - **Moegirl (萌娘百科)**.
  - A **Fandom** wiki and a **BWIKI** wiki you name in Settings (e.g. "minecraft", "ys").
  - The definition is the page's intro, with infoboxes and tables left out.
- **RedNote:** it has no public API; its search needs a logged-in account, and the open-source clients rely on that. "Look up in…" therefore has "Search on RedNote", which opens RedNote's own search in a new tab.
- **Look up in… → AI** now proposes the AI's definition, with the model it came from. You choose **Use this definition** or **Keep current**. Encyclopedia look-ups still replace it directly (Undo brings the old one back).

## 2026-09-25: suggested connections, sources for every definition

- **Suggest connections** (Inspector → Relations):
  - Finds keywords a concept can connect to. Concepts of the graph its definition names come first, found without the AI. Then come the AI's suggestions: what it relies on, what builds on it, close relatives and examples.
  - They are shown in the review list, where you tick what to add. An existing concept is linked, not added again. New ones come with a definition and are placed below the concept.
  - Already linked concepts are never suggested.
- **Every definition records its source:**
  - an encyclopedia (linked);
  - the AI, with the provider and model;
  - an imported paper;
  - "written by you" when you type or edit it.
  - Older concepts show "not recorded".
- **Look up in…:** next to the source, define a concept again from ProofWiki, Wikipedia / Wikidata or the AI, even when it already has a definition, and even with look-ups before the AI switched off. It replaces the definition as one undo step, or asks "what do you mean?" when there are several meanings.

## 2026-09-25: "no relation" links, relation colours, zoomed-out cards

- **No relation found:** when Mix finds no relation either way, the link stays but is drawn in its own colour (rose) with a long dash, marked "no relation". A notice says so. Exports write the pair once ("no relation found"); the 3D view uses the same colour.
- **Relation colours:** Settings → Relation colours sets the colour of dependency, mixed, derived, extracted and "no relation" links, in both themes, each with Reset (and Reset all). The View menu shows a legend with the current colours.
- **Zoomed out:** when descriptions would be too small to read, cards hide them and show the name larger.

## 2026-09-25: active relation labels, definition box

- **Relation labels are active and one-way:**
  - A prerequisite link now reads "using", "deriving" or "assuming", from the concept that needs it. The prerequisite's side is "none", so a dependency is one arrow with one label, never "is used by".
  - The AI is asked for active -ing labels ("using", "generalizing", "quoting"). If it still answers with a passive form ("… by") where the other side has an active one, that side becomes "none".
  - The example graph and the offline demo use active labels too.
  - Exports, flashcards and the walkthrough skip a "none" side.
  - In the inspector, a relation that only runs the other way is listed as "First Isomorphism Theorem using → this concept".
  - Graphs you've already saved keep their labels.
- **Definition box:** the inspector shows the definition formatted (formulas typeset) in a box. **Edit** opens the source, with a live preview; **Done**, Escape or Ctrl+Enter close it, and a double-click on the box also opens it.

## 2026-09-25: layers in 2.5D and 3D, and Physics

- **Physics** (the magnet button in the toolbar):
  - Relations act as springs and cards push each other apart without ever overlapping, so the graph sorts itself by its connections. Prerequisites drift above what needs them.
  - Dragging a card pulls its neighbours along.
  - Double-click a card, or use Pin in the inspector, to hold it in place.
  - Once things settle, the result is saved as one undo step.
  - With reduced motion turned on, it jumps straight to the result.
  - Graphs of more than 400 concepts are too big for it.
- **Layered view (2.5D)** (View → Layout):
  - Concepts stand on stacked plates, one per dependency depth, with the foundations on top.
  - A card slides along its own layer.
  - Switching back to Flat restores the layout you had.
  - Physics also works in this view.
- **3D view** (View → 3D view…):
  - The layers as plates stacked in 3D. Drag to rotate, scroll to zoom and right-drag to pan (arrow keys, +/- and 0 do the same), and click a concept to open it.
  - A list of the layers beside it works without the canvas.
  - It is loaded only when opened (139 KB gzipped) and works offline.

## 2026-09-25: remaining fixes and interface polish

### Fixes
- **Concept kinds:** a kind you clear by hand stays cleared. A Re-check no longer fills it back in, and merging a sandbox back no longer restores it.
- **LaTeX import:**
  - Results are numbered as the paper prints them: shared counters, numbering within sections or chapters ("Lemma 1.3"), and unnumbered and starred environments.
  - A `\label` right after `\end{…}` is picked up.
  - `verbatim`, listings, `comment` blocks, `\verb` and `\iffalse` are skipped.
- **Find in Mathlib:** the names are checked in parallel. Names Loogle didn't answer for are listed as unchecked rather than silently dropped.
- **Dialogs:** dragging a text selection out of a field onto the backdrop no longer closes the dialog.
- **LaTeX export:** CJK punctuation and fullwidth characters now switch on CJK support.

### Interface
- **Cancel buttons:** for Explain, Find in Mathlib, Reviewer 2 and hints.
- **Lean / Mathlib and Papers:** say inline when nothing was found, show when they were checked, and wrap long Lean names.
- **File menu:** grouped into Import, Versions, Study & play, Export and Share. The arrow keys, Home and End move through it, and Escape returns focus to the button.
- **Install all:** its confirmation closes on Escape or a click elsewhere.
- **Derive together:**
  - A deleted step can be undone.
  - When editing a step, Ctrl+Enter saves and Escape cancels.
  - Reviewer 2 needs at least one step.
- **Theme:** the brand gradient and the toast colours now use theme tokens, and one shared screen-reader-only style replaces three copies.

## 2026-09-25 (overnight): formal sciences and parody

### Formal sciences
- **Definitions from encyclopedias**:
  - ProofWiki, then Wikipedia and Wikidata, are asked before the AI.
  - Every definition keeps a link to its source.
  - It works without an AI key.
- **Lean / Mathlib**:
  - Mathlib declarations are verified with Loogle.
  - Each one has a "Try it in the Lean editor" link.
- **Real papers** from OpenAlex.
- **Concept kinds and theorem anatomy**, plus anatomy flashcards.
- **LaTeX**:
  - Import a paper, with `\ref`-based links.
  - Export a compilable document.
  - A notation glossary.
- **Derive together**: a hints-only tutor over imported PDFs. It checks each step and cites references by page.

### Parody (true facts, told absurdly)
- **Absurd chain** between any two concepts, in five styles. It has Surprise me, and a **Guess the chain** game.
- **Narrator voices** for Explain more.
- **Reviewer 2**: a pedantic but accurate referee report on a derivation.

### Quality
- Three code-review passes. Every confirmed finding in the first two was fixed with a regression test; so were the
  third's most important ones.
- The intermittent Find failure in CI was root-caused and fixed: a still pointer used to take over the keyboard's
  choice.

## 2026-09-24

Everything below landed on `claude/hopeful-pascal-bc67up` in one day. Most features were built on their own
`claude/feature-*` branch and merged by hand, with typecheck, unit tests, the Playwright e2e run, the PWA check and an
axe accessibility audit green after each merge. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits
together.

### Guess the chain (`claude/feature-chain-game`)
- **A game mode in the Absurd chain dialog**: *Guess the chain* builds a chain with the concepts between the two ends
  hidden. Each link shows only its relation; type guesses in any order (checked leniently: case, plural, leading
  article, aliases from the graph and small typos). 3 points for a concept found alone, 2 after a clue (the link's
  narration with every hidden name blanked out), none when revealed. A summary gives the title, the score, a tally,
  the moral and the best score for that pair of ends (localStorage); *Play again* takes another route. Copy and Add to
  a sandbox wait until the game is over. Keyboard-only playable, feedback in a live region, fits a 390px phone, axe
  clean in both themes. Pure logic in `client/src/lib/chainGame.ts` with unit tests over the offline demo's
  Homomorphism → Toast chain.

### Parody voices and Reviewer 2 (`claude/feature-parody-voices`)
- **Narrators for Explain more**: next to the level, pick the plain voice or a parody narrator (nature documentary,
  sports commentator, noir detective, medieval scholar, overexcited infomercial, Shakespearean). Only the telling
  changes: the prompt insists the mathematics stays correct and at the chosen level, formulas stay `$…$`, and the
  summary stays a plain definition. The voice is stored with the explanation (optional, so older data still loads;
  import repair resets an unknown one) and named in its heading and in the Markdown export.
- **Reviewer 2** in Derive together (new `refereeReport` AI task): a deliberately pedantic referee report on the
  derivation so far, with a verdict, a weary summary, points by step and severity, and grudging praise. Every point is
  meant to be accurate, and like the tutor it never writes the fix or the answer. Shown as a collapsible card, kept
  with the session, marked outdated when the steps change, and included in Copy as Markdown.
- **Surprise me** in the Absurd chain dialog: two random concepts of the graph (or fun ends for a nearly empty graph),
  built straight away.

### Formal sciences (`claude/feature-formal`)
- **Concept kinds**: definition, theorem, lemma, proposition, corollary, axiom, conjecture, example, notation or
  other. Set by the AI (only while unset) or by hand in the inspector; a colour-coded, text-labelled tag on each card;
  a View filter by kind; kept in JSON, share links, import repair and the Markdown notes. The example graph is typed.
- **Theorem anatomy** in the inspector (new `anatomy` AI task): hypotheses with why each is needed and a
  counterexample without it, the conclusion, a proof idea, examples and non-examples. Stored on the concept,
  cancellable, never an undo step.
- **LaTeX export**: a compilable `amsart` document with `amsthm` environments per kind, in study order, with
  `\label`/`\ref` cross-references to prerequisites; text escaped, formulas passed through.
- **Notation glossary** (File → Notation…): the symbols the definitions and notation concepts introduce, with a jump
  to each concept. Built without the AI.
- The walkthrough shows each slide's kind; Find and the glossary turn off a kind filter that hides their target; the
  tour scrolls the Install button into a phone's bottom sheet even when it starts out of view.

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
- **Anatomy flashcards**: a theorem taken apart exports as Anki/CSV cards. One card asks for the full statement with its hypotheses; the others ask why each hypothesis is needed and what fails without it.
- **Import LaTeX**: a paper's definitions, theorems and lemmas become concepts of their kind, linked by what each `\ref`s in its statement or proof. You review it before adding, and no AI is involved.
- **Papers** (`claude/feature-papers`): **Find papers** in the inspector lists real published works about a concept
  from OpenAlex (title and abstract match, most relevant first; a one-word name is narrowed by its prerequisites), with
  authors, year, venue, citations, a DOI link and a free copy when there is one. No AI involved, so nothing is
  invented. Stored on the node (not an undo step), validated by import repair, in the Markdown and LaTeX exports,
  not in share links. `npm run smoke:papers` checks OpenAlex live.
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
