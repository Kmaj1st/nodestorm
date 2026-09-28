import "fake-indexeddb/auto";
import type { CheckStepResponse, SplitProblemsRequest } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { addStep, editStep, type Derivation } from "../src/lib/derivation";
import * as db from "../src/lib/docDb";
import * as ops from "../src/lib/graphOps";
import { useDerive } from "../src/store/deriveStore";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// "Derive together" through the real store: imports, problem finding, and the tutor calls, with IndexedDB faked
// and the AI calls stubbed so each test controls when (and whether) they answer.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const graphs = () => useGraphStore.getState();
const derive = () => useDerive.getState();
const current = (): Derivation => derive().sessions.find((s) => s.id === derive().currentId)!;

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const okCheck: CheckStepResponse = { verdict: "ok", comment: "Fine.", missing: [], cites: [], concepts: [], solved: false };

beforeEach(async () => {
  graphs().reset();
  useSettings.setState({ connection: "browser", provider: "mock" });
  useDerive.setState({ open: false, projectId: null, available: true, sessions: [], docs: [], pages: {}, currentId: null });
  await derive().load(graphs().projectId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("derive store: importing documents", () => {
  it("splits a text file into pages at form feeds, drops empty pages and keeps the document in IndexedDB", async () => {
    const file = new File(["First page.\f  \fThird page."], "notes.txt", { type: "text/plain" });
    await derive().importFile(file, "reference");
    expect(derive().importing).toBeNull();
    const [doc] = derive().docs;
    expect(doc).toMatchObject({ title: "notes", kind: "reference", pages: 2, projectId: graphs().projectId });
    expect(derive().pages[doc.id].map((p) => [p.page, p.text])).toEqual([
      [1, "First page."],
      [3, "Third page."],
    ]);
    expect(graphs().toastKind).toBe("info");

    // Reloading the project (a new page load) finds the document and its pages again.
    await derive().load(graphs().projectId);
    expect(derive().docs.map((d) => d.id)).toEqual([doc.id]);
    expect(derive().pages).toEqual({});
    expect((await derive().loadPages(doc.id)).map((p) => p.text)).toEqual(["First page.", "Third page."]);
  });

  it("an empty file is refused with an error and adds nothing", async () => {
    await derive().importFile(new File(["  \f \n"], "blank.md"), "reference");
    expect(derive().docs).toEqual([]);
    expect(graphs().toastKind).toBe("error");
    expect(graphs().toast).toMatch(/blank/);
  });

  it("a problem sheet is split into problems in batches that fit one request", async () => {
    const calls: SplitProblemsRequest[] = [];
    vi.spyOn(api, "splitProblems").mockImplementation(async (req) => {
      calls.push(req);
      return { problems: req.pages.map((p) => ({ label: String(p.page), statement: `Problem on page ${p.page}`, page: p.page })) };
    });
    // Two pages of 6000 characters don't fit one 11000-character batch; a 20000-character page is cut.
    const text = ["a".repeat(6000), "b".repeat(6000), "c".repeat(20_000)].join("\f");
    await derive().importFile(new File([text], "sheet.txt"), "problems");
    await vi.waitFor(() => expect(derive().docs[0].problems).toHaveLength(3));
    expect(calls.map((c) => c.pages.map((p) => [p.page, p.text.length]))).toEqual([[[1, 6000]], [[2, 6000]], [[3, 11_000]]]);
  });

  it("a sheet deleted while its problems are being found does not come back", async () => {
    const answer = deferred<{ problems: { label: string; statement: string; page: number }[] }>();
    const split = vi.spyOn(api, "splitProblems").mockReturnValue(answer.promise);
    await derive().importFile(new File(["1. Prove it."], "sheet.txt"), "problems");
    await vi.waitFor(() => expect(split).toHaveBeenCalled());
    const id = derive().docs[0].id;
    await derive().deleteDoc(id);
    answer.resolve({ problems: [{ label: "1", statement: "Prove it.", page: 1 }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(derive().docs).toEqual([]);
    await derive().load(graphs().projectId);
    expect(derive().docs).toEqual([]);
  });

  it("problems found after the sheet's project was deleted are not written back", async () => {
    const answer = deferred<{ problems: { label: string; statement: string; page: number }[] }>();
    const split = vi.spyOn(api, "splitProblems").mockReturnValue(answer.promise);
    const first = graphs().projectId;
    useDerive.setState({ open: true });
    await derive().importFile(new File(["1. Prove it."], "sheet.txt"), "problems");
    await vi.waitFor(() => expect(split).toHaveBeenCalled());
    // Another project is opened (the panel follows it) and the sheet's project deleted, while the AI still runs.
    graphs().newProject("Second");
    await vi.waitFor(() => expect(derive().projectId).toBe(graphs().projectId));
    graphs().deleteProject(first);
    await vi.waitFor(async () => expect(await db.listDocs(first)).toEqual([]));
    answer.resolve({ problems: [{ label: "1", statement: "Prove it.", page: 1 }] });
    await new Promise((r) => setTimeout(r, 10));
    expect(await db.listDocs(first)).toEqual([]);
    expect(derive().docs).toEqual([]);
  });

  it("deleting a document removes it from the chosen references and closes it in the reader", async () => {
    await derive().importFile(new File(["Text."], "ref.txt"), "reference");
    await derive().importFile(new File(["Other."], "other.txt"), "reference");
    const [other, ref] = derive().docs;
    derive().setRefDocs([ref.id, other.id]);
    await derive().openReader(ref.id, 1);
    await derive().deleteDoc(ref.id);
    expect(derive().refDocs).toEqual([other.id]);
    expect(derive().reader).toBeNull();
    expect(derive().pages[ref.id]).toBeUndefined();
    expect(await db.getPages(ref.id)).toEqual([]);
  });
});

describe("derive store: tutor calls", () => {
  const startWithStep = async (text: string) => {
    await derive().start({ statement: "Show that 1 + 1 = 2." });
    const { derivation, id } = addStep(current(), text);
    derive().update(derivation);
    return id;
  };

  it("keeps a check only while the step still says what was checked", async () => {
    const answer = deferred<CheckStepResponse>();
    vi.spyOn(api, "checkStep").mockReturnValue(answer.promise);
    const id = await startWithStep("By definition of 2.");
    const running = derive().check(id);
    await vi.waitFor(() => expect(derive().checkingId).toBe(id));
    // The learner edits the step while the tutor reads it: the answer is about the old text and is dropped.
    derive().update(editStep(current(), id, "By Peano's axioms."));
    answer.resolve(okCheck);
    await running;
    expect(derive().checkingId).toBeNull();
    expect(current().steps[0].check).toBeUndefined();

    vi.spyOn(api, "checkStep").mockResolvedValue(okCheck);
    await derive().check(id);
    expect(current().steps[0].check).toMatchObject({ verdict: "ok", comment: "Fine." });
  });

  it("asks for stronger hints for the same step and stores each one on the session", async () => {
    const hint = vi.spyOn(api, "tutorHint").mockResolvedValue({ hint: "Count.", cites: [], concepts: [] });
    await startWithStep("Start.");
    await derive().hint();
    await derive().hint();
    expect(hint.mock.calls.map(([req]) => req.nth)).toEqual([1, 2]);
    expect(current().hints.map((h) => [h.text, h.atStep])).toEqual([
      ["Count.", 1],
      ["Count.", 1],
    ]);
    // Saved to IndexedDB as well: a reload finds the session with its hints.
    const id = current().id;
    await vi.waitFor(async () => expect((await db.listSessions(graphs().projectId) as Derivation[]).find((s) => s.id === id)).toBeTruthy());
    await derive().load(graphs().projectId);
    expect(derive().sessions.find((s) => s.id === id)?.hints).toHaveLength(2);
  });

  it("does not call the tutor or change the graph for a shared graph open in the viewer", async () => {
    const hint = vi.spyOn(api, "tutorHint");
    await startWithStep("Start.");
    graphs().openView(graphs().graphs[graphs().activeId], "Shared");
    await derive().hint();
    expect(hint).not.toHaveBeenCalled();
    expect(derive().addToGraph({ items: [], edges: [] } as never)).toEqual([]);
    expect(graphs().toast).toBeTruthy();
  });

  it("deleting a session clears the open one and removes it from IndexedDB", async () => {
    await startWithStep("Start.");
    const id = current().id;
    await vi.waitFor(async () => expect((await db.listSessions(graphs().projectId) as Derivation[]).map((s) => s.id)).toContain(id));
    await derive().deleteSession(id);
    expect(derive().currentId).toBeNull();
    expect((await db.listSessions(graphs().projectId) as Derivation[]).map((s) => s.id)).not.toContain(id);
  });
});

describe("derive store: projects", () => {
  it("deleting a project deletes its documents from IndexedDB", async () => {
    const first = graphs().projectId;
    await derive().importFile(new File(["Text."], "ref.txt"), "reference");
    graphs().newProject("Second");
    graphs().mutate((g) => ops.addNode(g, { name: "X" }).graph);
    graphs().deleteProject(first);
    await vi.waitFor(async () => expect(await db.listDocs(first)).toEqual([]));
  });

  it("follows a project switch while the panel is open", async () => {
    await derive().importFile(new File(["Text."], "ref.txt"), "reference");
    const first = graphs().projectId;
    useDerive.setState({ open: true });
    graphs().newProject("Second");
    await vi.waitFor(() => expect(derive().projectId).toBe(graphs().projectId));
    await vi.waitFor(() => expect(derive().available).toBe(true));
    expect(derive().docs).toEqual([]);
    graphs().switchProject(first);
    await vi.waitFor(() => expect(derive().docs).toHaveLength(1));
  });
});
