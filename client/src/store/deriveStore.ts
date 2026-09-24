import { toBrief, type SheetProblem } from "@nodestorm/shared";
import { create } from "zustand";
import { t } from "../i18n";
import { analyzeNode, cancelTask, inViewer, withBusy } from "../lib/actions";
import { api } from "../lib/api";
import {
  addHint,
  applyGraphPlan,
  newDerivation,
  nextHintNumber,
  numberReferences,
  setCheck,
  stepsForTutor,
  toStepCheck,
  type Derivation,
  type GraphPlan,
  type Problem,
} from "../lib/derivation";
import * as db from "../lib/docDb";
import type { DocMeta, DocPage } from "../lib/docDb";
import { readPdf, renderPageImage, titleFromFile } from "../lib/pdf";
import { buildIndex, chunkPages, search, type Index } from "../lib/retrieve";
import { uid } from "../lib/graphOps";
import { viewport } from "../lib/viewport";
import { useGraphStore } from "./graphStore";
import { autoSnapshot } from "./snapshotStore";

/**
 * "Derive together": the open panel, the project's imported documents and derivation sessions, and the actions
 * behind them (import, find problems, hint, check, add to graph). Documents and sessions live in IndexedDB
 * (lib/docDb.ts); everything else here is UI state.
 */

export type DeriveTab = "library" | "work";

/** A document's problems as found by "Find problems", kept on the document. */
export type DocWithProblems = DocMeta & { problems?: SheetProblem[] };

export interface ImportProgress {
  title: string;
  done: number;
  total: number;
  /** Reading the text layer, or reading scanned pages with the vision model. */
  phase: "text" | "vision";
}

interface State {
  open: boolean;
  tab: DeriveTab;
  /** False when IndexedDB can't be used: documents and sessions then last only until the page closes. */
  available: boolean;
  projectId: string | null;
  docs: DocWithProblems[];
  pages: Record<string, DocPage[]>;
  sessions: Derivation[];
  currentId: string | null;
  /** The page shown in the reader. */
  reader: { docId: string; page: number } | null;
  importing: ImportProgress | null;
  /** Reference documents the tutor may cite; null = all of them. */
  refDocs: string[] | null;
  /** The step being checked right now. */
  checkingId: string | null;
}

interface Actions {
  openPanel(opts?: { problem?: Problem }): Promise<void>;
  close(): void;
  setTab(tab: DeriveTab): void;
  load(projectId: string): Promise<void>;
  importFile(file: File, kind: DocMeta["kind"]): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  loadPages(docId: string): Promise<DocPage[]>;
  openReader(docId: string, page: number): Promise<void>;
  closeReader(): void;
  setPageText(docId: string, page: number, text: string): Promise<void>;
  findProblems(docId: string): Promise<void>;
  start(problem: Problem): Promise<void>;
  select(id: string | null): void;
  update(d: Derivation): void;
  deleteSession(id: string): Promise<void>;
  setRefDocs(ids: string[] | null): void;
  hint(): Promise<void>;
  check(stepId: string): Promise<void>;
  addToGraph(plan: GraphPlan): string[];
}

export type DeriveStore = State & Actions;

const graphs = () => useGraphStore.getState();

/** Busy keys (status bar, cancel). */
export const DERIVE_KEYS = { read: "derive-read", problems: "derive-problems", hint: "derive-hint", check: "derive-check" };
/** Finding problems runs per sheet, so importing a second sheet doesn't cancel the first one's. */
export const problemsKey = (docId: string) => `${DERIVE_KEYS.problems}:${docId}`;

// Search index over the reference documents, rebuilt when the set of documents or their text changes.
let index: { key: string; index: Index } | null = null;

export const useDerive = create<DeriveStore>()((set, get) => {
  /** Save a session, in memory now and in IndexedDB in the background. */
  const save = (d: Derivation) => {
    set({ sessions: [d, ...get().sessions.filter((s) => s.id !== d.id)] });
    if (get().available) db.putSession(d).catch(() => set({ available: false }));
  };
  const current = () => get().sessions.find((s) => s.id === get().currentId) ?? null;

  /** The passages most relevant to the session (problem, last steps, and the step being checked). */
  const references = async (d: Derivation, extra = "") => {
    const docs = get().docs.filter((doc) => doc.kind === "reference" && (!get().refDocs || get().refDocs!.includes(doc.id)));
    const withPages = await Promise.all(docs.map(async (doc) => ({ doc, pages: await get().loadPages(doc.id) })));
    const key = withPages.map(({ doc, pages }) => `${doc.id}:${pages.map((p) => p.text.length).join(",")}`).join("|");
    if (index?.key !== key) {
      index = { key, index: buildIndex(withPages.flatMap(({ doc, pages }) => chunkPages(doc.id, doc.title, pages))) };
    }
    const query = [d.problem.statement, ...d.steps.slice(-2).map((s) => s.text), extra].join("\n");
    return numberReferences(search(index.index, query, 6).map((r) => r.chunk));
  };

  const context = () => {
    const g = graphs().graphs[graphs().activeId];
    return (g?.nodes ?? []).slice(0, 80).map(toBrief);
  };

  return {
    open: false,
    tab: "library",
    available: true,
    projectId: null,
    docs: [],
    pages: {},
    sessions: [],
    currentId: null,
    reader: null,
    importing: null,
    refDocs: null,
    checkingId: null,

    async openPanel(opts = {}) {
      set({ open: true });
      const projectId = graphs().projectId;
      if (get().projectId !== projectId) await get().load(projectId);
      if (opts.problem) await get().start(opts.problem);
      else set({ tab: current() ? "work" : "library" });
    },

    close() {
      for (const key of Object.values(DERIVE_KEYS)) cancelTask(key);
      for (const d of get().docs) cancelTask(problemsKey(d.id));
      set({ open: false, reader: null });
    },

    setTab: (tab) => set({ tab }),

    async load(projectId) {
      set({ projectId, docs: [], pages: {}, sessions: [], currentId: null, reader: null, refDocs: null });
      index = null;
      if (!(await db.docsAvailable())) return set({ available: false });
      try {
        const [docs, sessions] = await Promise.all([db.listDocs(projectId), db.listSessions(projectId)]);
        if (get().projectId !== projectId) return; // switched again meanwhile
        set({
          available: true,
          docs: (docs as DocWithProblems[]).sort((a, b) => b.addedAt - a.addedAt),
          sessions: (sessions as unknown as Derivation[]).sort((a, b) => b.updatedAt - a.updatedAt),
        });
      } catch {
        set({ available: false });
      }
    },

    async importFile(file, kind) {
      const projectId = get().projectId ?? graphs().projectId;
      const title = titleFromFile(file.name);
      const meta: DocWithProblems = { id: uid("doc"), title, kind, pages: 0, addedAt: Date.now(), projectId };
      let pages: DocPage[] = [];
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      set({ importing: { title, done: 0, total: 0, phase: "text" } });
      try {
        if (!isPdf) {
          // Plain text or Markdown: form feeds separate pages when there are any.
          const text = await file.text();
          pages = text.split("\f").map((p, i) => ({ docId: meta.id, page: i + 1, text: p.trim(), via: "text" as const }));
        } else {
          const read = await withBusy(DERIVE_KEYS.read, t("dt.task.read", { title }), async (signal) => {
            const { pages: pdfPages, doc } = await readPdf(await file.arrayBuffer(), {
              signal,
              onPage: (done, total) => set({ importing: { title, done, total, phase: "text" } }),
            });
            try {
              const out: DocPage[] = pdfPages.map((p) => ({ docId: meta.id, page: p.page, text: p.text, via: p.scanned ? "none" : "text" }));
              const scanned = out.filter((p) => p.via === "none");
              // Scanned pages: a picture of each goes to the vision model, one at a time. A page that fails stays
              // without text (the reader says so) rather than failing the whole import.
              for (const [i, p] of scanned.entries()) {
                set({ importing: { title, done: i, total: scanned.length, phase: "vision" } });
                if (signal.aborted) break;
                try {
                  const img = await renderPageImage(doc, p.page);
                  const res = await api.readPage(img, signal);
                  if (res.text) Object.assign(p, { text: res.text, via: "vision" });
                } catch (e) {
                  if (signal.aborted) break;
                  if (i === 0) graphs().setToast(t("dt.visionFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
                }
              }
              return out;
            } finally {
              void doc.destroy();
            }
          });
          if (!read) return; // cancelled or failed (already reported)
          pages = read;
        }
        pages = pages.filter((p) => p.text || p.via === "none");
        if (!pages.length) return graphs().setToast(t("dt.emptyDoc", { title }), "error");
        meta.pages = pages.length;
        if (get().available) await db.putDoc(meta, pages).catch(() => set({ available: false }));
        // Another project was opened meanwhile: the document is saved with its own project, not shown in this one.
        if (get().projectId !== projectId) return;
        set({ docs: [meta, ...get().docs], pages: { ...get().pages, [meta.id]: pages } });
        const unread = pages.filter((p) => p.via === "none").length;
        graphs().setToast(
          unread ? t("dt.importedUnread", { title, n: unread }) : t("dt.imported", { title, n: pages.length }),
          unread ? "error" : "info",
        );
        if (kind === "problems") void get().findProblems(meta.id);
      } catch (e) {
        graphs().setToast(t("dt.importFailed", { title, error: e instanceof Error ? e.message : String(e) }), "error");
      } finally {
        set({ importing: null });
      }
    },

    async deleteDoc(id) {
      cancelTask(problemsKey(id));
      const { [id]: _gone, ...pages } = get().pages;
      set({
        docs: get().docs.filter((d) => d.id !== id),
        pages,
        refDocs: get().refDocs?.filter((d) => d !== id) ?? null,
        reader: get().reader?.docId === id ? null : get().reader,
      });
      if (get().available) await db.deleteDoc(id).catch(() => undefined);
    },

    async loadPages(docId) {
      const have = get().pages[docId];
      if (have) return have;
      const pages = get().available ? await db.getPages(docId).catch(() => []) : [];
      set({ pages: { ...get().pages, [docId]: pages } });
      return pages;
    },

    async openReader(docId, page) {
      await get().loadPages(docId);
      set({ reader: { docId, page } });
    },
    closeReader: () => set({ reader: null }),

    async setPageText(docId, page, text) {
      const pages = (await get().loadPages(docId)).map((p) => (p.page === page ? { ...p, text, via: "text" as const } : p));
      set({ pages: { ...get().pages, [docId]: pages } });
      const changed = pages.find((p) => p.page === page);
      if (changed && get().available) await db.updatePage(changed).catch(() => undefined);
    },

    async findProblems(docId) {
      const doc = get().docs.find((d) => d.id === docId);
      if (!doc) return;
      const pages = (await get().loadPages(docId)).filter((p) => p.text.trim());
      // Batches of whole pages that fit one request; a single huge page is cut.
      const batches: { page: number; text: string }[][] = [[]];
      let size = 0;
      for (const p of pages) {
        const text = p.text.slice(0, 11_000);
        if (size + text.length > 11_000 && batches.at(-1)!.length) batches.push([]), (size = 0);
        batches.at(-1)!.push({ page: p.page, text });
        size += text.length;
      }
      const found = await withBusy(problemsKey(docId), t("dt.task.problems", { title: doc.title }), async (signal) => {
        const out: SheetProblem[] = [];
        for (const b of batches.filter((b) => b.length)) out.push(...(await api.splitProblems({ pages: b }, signal)).problems);
        return out;
      });
      // Deleted (or another project opened) meanwhile: writing it back would bring a deleted sheet back.
      if (!found || !get().docs.some((d) => d.id === docId)) return;
      const updated = { ...doc, problems: found };
      set({ docs: get().docs.map((d) => (d.id === docId ? updated : d)) });
      if (get().available) db.updateDoc(updated).catch(() => undefined);
      if (!found.length) graphs().setToast(t("dt.noProblems", { title: doc.title }), "info");
    },

    async start(problem) {
      const projectId = get().projectId ?? graphs().projectId;
      const d = newDerivation(projectId, problem);
      save(d);
      set({ currentId: d.id, tab: "work" });
    },

    select: (id) => set({ currentId: id, tab: id ? "work" : get().tab }),

    update: (d) => save(d),

    async deleteSession(id) {
      set({ sessions: get().sessions.filter((s) => s.id !== id), currentId: get().currentId === id ? null : get().currentId });
      if (get().available) await db.deleteSession(id).catch(() => undefined);
    },

    setRefDocs: (ids) => set({ refDocs: ids }),

    async hint() {
      const d = current();
      if (!d || inViewer(graphs().activeId)) return;
      const { refs, resolve } = await references(d);
      const res = await withBusy(DERIVE_KEYS.hint, t("dt.task.hint"), (signal) =>
        api.tutorHint(
          { problem: d.problem.statement, steps: stepsForTutor(d.steps), references: refs, context: context(), nth: nextHintNumber(d) },
          signal,
        ),
      );
      const now = get().sessions.find((s) => s.id === d.id);
      if (!res || !now) return;
      save(addHint(now, { text: res.hint, cites: resolve(res.cites), concepts: res.concepts }));
    },

    async check(stepId) {
      const d = current();
      const at = d?.steps.findIndex((s) => s.id === stepId) ?? -1;
      if (!d || at < 0 || inViewer(graphs().activeId)) return;
      const step = d.steps[at];
      const { refs, resolve } = await references({ ...d, steps: d.steps.slice(0, at) }, step.text);
      set({ checkingId: stepId });
      const res = await withBusy(DERIVE_KEYS.check, t("dt.task.check"), (signal) =>
        api.checkStep(
          { problem: d.problem.statement, steps: stepsForTutor(d.steps.slice(0, at)), step: step.text.slice(0, 4000), references: refs, context: context() },
          signal,
        ),
      ).finally(() => get().checkingId === stepId && set({ checkingId: null }));
      const now = get().sessions.find((s) => s.id === d.id);
      // The step may have been edited or removed while the check ran: then the answer is about old text.
      if (!res || !now || now.steps.find((s) => s.id === stepId)?.text !== step.text) return;
      save(setCheck(now, stepId, toStepCheck(res, resolve)));
    },

    addToGraph(plan) {
      const d = current();
      const graphId = graphs().activeId;
      if (!d || inViewer(graphId)) return [];
      let added: string[] = [];
      let problemId: string | undefined;
      autoSnapshot("deriveTogether", graphId);
      graphs().mutate((g) => {
        const r = applyGraphPlan(g, plan, d, viewport.center());
        added = r.added;
        problemId = r.problemId;
        return r.graph;
      }, graphId);
      for (const id of added) void analyzeNode(id, graphId, undefined, { quiet: true });
      if (problemId) {
        graphs().setHighlight({ graphId, nodeId: problemId });
        viewport.reveal(problemId);
      } else if (added.length) viewport.reveal(added[0]);
      graphs().setToast(t("dt.added", { n: added.length }), "info");
      return added;
    },
  };
});

/** Follow project switches while the panel is open; forget a deleted project's documents and sessions. */
useGraphStore.subscribe((s, prev) => {
  if (s.projectId !== prev.projectId && useDerive.getState().open) void useDerive.getState().load(s.projectId);
  for (const id of Object.keys(prev.projects)) {
    if (!s.projects[id]) db.deleteProjectData(id).catch(() => undefined);
  }
});
