import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDocDb,
  deleteDoc,
  deleteProjectData,
  deleteSession,
  docsAvailable,
  getPages,
  listDocs,
  listSessions,
  putDoc,
  putSession,
  updateDoc,
  updatePage,
  type DocMeta,
  type DocPage,
} from "../src/lib/docDb";

const meta = (id: string, over: Partial<DocMeta> = {}): DocMeta => ({
  id,
  title: `Doc ${id}`,
  kind: "reference",
  pages: 3,
  addedAt: 1,
  projectId: "p1",
  ...over,
});
const page = (docId: string, n: number, text = `page ${n} of ${docId}`): DocPage => ({ docId, page: n, text, via: "text" });

beforeEach(async () => {
  await closeDocDb();
  (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory(); // a fresh, empty database for each test
});
afterEach(closeDocDb);

describe("docDb", () => {
  it("is available with IndexedDB and reports false without it", async () => {
    expect(await docsAvailable()).toBe(true);
    await closeDocDb();
    const saved = globalThis.indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      expect(await docsAvailable()).toBe(false);
      await expect(listDocs("p1")).rejects.toThrow(/not available/);
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = saved;
    }
    expect(await docsAvailable()).toBe(true); // a failed open is retried
  });

  it("stores documents per project and returns pages in page order", async () => {
    // Page 10 before page 2 on purpose: numbers, not strings, order the keys.
    await putDoc(meta("a", { addedAt: 5 }), [page("a", 10), page("a", 2), page("a", 1)]);
    await putDoc(meta("b", { addedAt: 3, kind: "problems" }), [page("b", 1)]);
    await putDoc(meta("c", { projectId: "p2" }), [page("c", 1)]);
    expect((await listDocs("p1")).map((d) => d.id)).toEqual(["b", "a"]);
    expect((await listDocs("p2")).map((d) => d.id)).toEqual(["c"]);
    expect(await listDocs("none")).toEqual([]);
    expect((await getPages("a")).map((p) => p.page)).toEqual([1, 2, 10]);
    expect(await getPages("b")).toEqual([page("b", 1)]);
    expect(await getPages("missing")).toEqual([]);
  });

  it("replaces a re-imported document's pages entirely", async () => {
    await putDoc(meta("a"), [page("a", 1), page("a", 2), page("a", 3)]);
    await putDoc(meta("a", { pages: 1, title: "New" }), [page("a", 1, "fresh")]);
    expect(await listDocs("p1")).toEqual([meta("a", { pages: 1, title: "New" })]);
    expect(await getPages("a")).toEqual([page("a", 1, "fresh")]);
  });

  it("updates one page", async () => {
    await putDoc(meta("a"), [page("a", 1), { ...page("a", 2, ""), via: "none" }]);
    await updatePage({ docId: "a", page: 2, text: "read by vision", via: "vision" });
    expect(await getPages("a")).toEqual([page("a", 1), { docId: "a", page: 2, text: "read by vision", via: "vision" }]);
  });

  it("deletes a document with its pages and leaves the others alone", async () => {
    // Ids that are prefixes of each other must not catch each other's pages.
    await putDoc(meta("a"), [page("a", 1), page("a", 2)]);
    await putDoc(meta("ab"), [page("ab", 1)]);
    await deleteDoc("a");
    expect((await listDocs("p1")).map((d) => d.id)).toEqual(["ab"]);
    expect(await getPages("a")).toEqual([]);
    expect(await getPages("ab")).toEqual([page("ab", 1)]);
    await deleteDoc("nothing"); // no-op
  });

  it("stores sessions per project, newest first, keeping their extra fields", async () => {
    await putSession({ id: "s1", projectId: "p1", updatedAt: 1, messages: ["hi"] });
    await putSession({ id: "s2", projectId: "p1", updatedAt: 5 });
    await putSession({ id: "s3", projectId: "p2", updatedAt: 9 });
    await putSession({ id: "s1", projectId: "p1", updatedAt: 7, messages: ["hi", "again"] });
    expect(await listSessions("p1")).toEqual([
      { id: "s1", projectId: "p1", updatedAt: 7, messages: ["hi", "again"] },
      { id: "s2", projectId: "p1", updatedAt: 5 },
    ]);
    await deleteSession("s1");
    expect(await listSessions("p1")).toEqual([{ id: "s2", projectId: "p1", updatedAt: 5 }]);
    expect(await listSessions("p2")).toHaveLength(1);
  });

  it("survives closing and reopening", async () => {
    await putDoc(meta("a"), [page("a", 1)]);
    await closeDocDb();
    expect(await getPages("a")).toEqual([page("a", 1)]);
  });

  it("updates a document's metadata without touching its pages", async () => {
    await putDoc(meta("a"), [page("a", 1)]);
    await updateDoc({ ...meta("a"), title: "Renamed", problems: [{ label: "1", statement: "Prove it." }] } as DocMeta);
    expect((await listDocs("p1"))[0]).toMatchObject({ title: "Renamed", problems: [{ statement: "Prove it." }] });
    expect(await getPages("a")).toHaveLength(1);
  });

  it("deletes everything of one project and nothing else", async () => {
    await putDoc(meta("a"), [page("a", 1), page("a", 2)]);
    await putDoc(meta("b", { projectId: "p2" }), [page("b", 1)]);
    await putSession({ id: "s1", projectId: "p1", updatedAt: 1 });
    await putSession({ id: "s2", projectId: "p2", updatedAt: 1 });
    await deleteProjectData("p1");
    expect(await listDocs("p1")).toEqual([]);
    expect(await getPages("a")).toEqual([]);
    expect(await listSessions("p1")).toEqual([]);
    expect(await listDocs("p2")).toHaveLength(1);
    expect(await getPages("b")).toHaveLength(1);
    expect(await listSessions("p2")).toHaveLength(1);
  });
});

describe("docDb and a reload right after a change", () => {
  // localStorage keeps a note of each background write until its transaction completes.
  const data = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  beforeEach(() => {
    data.clear();
    g.localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  });
  afterEach(() => delete g.localStorage);

  const useDb = async (db: IDBFactory) => {
    await closeDocDb();
    (globalThis as { indexedDB?: unknown }).indexedDB = db;
  };

  /**
   * What the next page finds when this one went before `writes` committed: localStorage as it was the moment they
   * started, and the database as `before` left it, without them.
   */
  async function reloadLosing(writes: () => Promise<unknown>, before: () => Promise<unknown> = async () => {}) {
    const lost = new IDBFactory();
    await useDb(lost);
    await before();
    await useDb(new IDBFactory()); // where the writes go: a database the next page never sees
    const running = writes();
    const noted = new Map(data); // taken synchronously, as the page unloads
    await running;
    await useDb(lost);
    data.clear();
    for (const [k, v] of noted) data.set(k, v);
  }

  it("a session saved just before the reload is still there, and the note is gone once written", async () => {
    await reloadLosing(() => putSession({ id: "s1", projectId: "p1", updatedAt: 3, steps: ["a"] }));
    expect(data.size).toBe(1);
    expect(await listSessions("p1")).toEqual([{ id: "s1", projectId: "p1", updatedAt: 3, steps: ["a"] }]);
    expect(data.size).toBe(0);
  });

  it("a session or document deleted just before the reload stays deleted", async () => {
    await reloadLosing(
      () => Promise.all([deleteSession("s1"), deleteDoc("a")]),
      async () => {
        await putSession({ id: "s1", projectId: "p1", updatedAt: 1 });
        await putDoc(meta("a"), [page("a", 1)]);
      },
    );
    expect(await listSessions("p1")).toEqual([]);
    expect(await listDocs("p1")).toEqual([]);
    expect(await getPages("a")).toEqual([]);
  });

  it("a document's new metadata survives it too; a note left by a deleted project is dropped", async () => {
    await reloadLosing(
      () => updateDoc({ ...meta("a"), title: "With problems" }),
      () => putDoc(meta("a"), [page("a", 1)]),
    );
    expect((await listDocs("p1"))[0].title).toBe("With problems");
    // A session of project p2 noted, then p2 deleted: the note must not bring it back.
    const running = putSession({ id: "s9", projectId: "p2", updatedAt: 1 });
    await deleteProjectData("p2");
    await running;
    expect(await listSessions("p2")).toEqual([]);
    expect(data.size).toBe(0);
  });

  it("drops a garbled note instead of failing", async () => {
    data.set("nodestorm-docs-pending", JSON.stringify({ sessions: { x: { id: "other" } }, docs: "no" }));
    expect(await docsAvailable()).toBe(true);
    expect(await listSessions("p1")).toEqual([]);
  });
});
