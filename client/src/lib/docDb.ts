/**
 * IndexedDB storage for "Derive together": imported PDFs (reference documents and problem sheets) and tutoring
 * sessions. Page text can run to megabytes, far past localStorage's ~5 MB, and is only read when a session needs
 * it. Three object stores:
 * - `docs`: `DocMeta`, what the document list shows.
 * - `pages`: one `DocPage` per page, keyed `[docId, page]` and indexed by `docId`.
 * - `sessions`: tutoring sessions as plain JSON (their shape belongs to the caller), indexed by `projectId`.
 * Modelled on `snapshotDb.ts`: every call rejects rather than throws, so callers can treat any failure (IndexedDB
 * missing, blocked in a private window, quota exceeded) the same way. Failures are coded (lib/storageError.ts).
 */
import { storageError } from "./storageError";

export interface DocMeta {
  id: string;
  title: string;
  kind: "reference" | "problems";
  /** Number of pages. */
  pages: number;
  addedAt: number;
  projectId: string;
}

export interface DocPage {
  docId: string;
  /** 1-based page number. */
  page: number;
  text: string;
  /** Where the text came from: the PDF's text layer, a vision model reading the page picture, or nowhere yet. */
  via: "text" | "vision" | "none";
}

/** The fields every stored session has; the rest is the caller's. */
export interface StoredSession {
  id: string;
  projectId: string;
  updatedAt: number;
}

const DB_NAME = "nodestorm-docs";
const VERSION = 1;
const STORES = ["docs", "pages", "sessions"] as const;
type StoreName = (typeof STORES)[number];

let opening: Promise<IDBDatabase> | null = null;

/**
 * Sessions and document metadata are saved in the background while the user works, and a transaction that hasn't
 * committed when the page goes (a reload, a closed tab) is aborted: the last change would be lost. So each such write
 * is first noted in localStorage, synchronously, and the note is dropped once the transaction completes. The first
 * open of the database in a page writes through whatever notes are left (`null` notes a deletion). Imported pages are
 * written before the document shows; a page's text changed later (`updatePage`) is noted too, while the page notes
 * stay under PAGE_NOTES_MAX in all. A bigger one is kept in memory instead and noted, as far as localStorage takes it,
 * only when the page is hidden or goes (`pagehide`, `visibilitychange`), which is when a reload could lose it.
 */
const PENDING_KEY = "nodestorm-docs-pending";
type Journaled = "sessions" | "docs" | "pages";
type Pending = Partial<Record<Journaled, Record<string, unknown>>>;

/** Characters of page text (as JSON) the page notes may hold at once: localStorage has ~5 MB for the whole app. */
export const PAGE_NOTES_MAX = 200_000;

/** A page's key in the notes. */
const pageKey = (p: { docId: string; page: number }) => JSON.stringify([p.docId, p.page]);

function readPending(): Pending {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {}; // no localStorage, or a garbled note
  }
}

function writePending(p: Pending) {
  try {
    if (Object.values(p).some((m) => m && Object.keys(m).length)) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage full or blocked: the write just isn't protected against a quick reload */
  }
}

/** Note a write (a record, or `null` for a deletion) before it starts. Returns the note, to settle it with. */
function note(store: Journaled, id: string, value: unknown) {
  const p = readPending();
  p[store] = { ...p[store], [id]: value };
  writePending(p);
  return JSON.stringify(value);
}

/** Page writes too big to note right away, by page key: noted when the page is hidden or goes (see PENDING_KEY). */
const unnoted = new Map<string, DocPage>();
let flushing = false;

function flushUnnoted() {
  if (!unnoted.size) return;
  const p = readPending();
  p.pages = { ...p.pages };
  for (const [id, page] of unnoted) p.pages[id] = page;
  writePending(p); // storage full: those writes just aren't protected
}

/** Note a page write if the page notes stay small enough, else keep it for `flushUnnoted`. Returns the note. */
function notePage(page: DocPage): string {
  const id = pageKey(page);
  const others = Object.entries(readPending().pages ?? {}).filter(([k]) => k !== id);
  if (JSON.stringify(Object.fromEntries(others)).length + JSON.stringify(page).length <= PAGE_NOTES_MAX) {
    unnoted.delete(id);
    return note("pages", id, page);
  }
  unnoted.set(id, page);
  if (!flushing && typeof addEventListener === "function" && typeof document !== "undefined") {
    flushing = true;
    addEventListener("pagehide", flushUnnoted);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushUnnoted());
  }
  return JSON.stringify(page);
}

/** Drop the notes (made or waiting) of these documents' pages: the documents were replaced or deleted. */
function forgetPages(docIds: ReadonlySet<string>) {
  const ofDocs = (id: string) => {
    try {
      return docIds.has(JSON.parse(id)[0]);
    } catch {
      return false;
    }
  };
  for (const id of unnoted.keys()) if (ofDocs(id)) unnoted.delete(id);
  const p = readPending();
  if (!p.pages) return;
  for (const id of Object.keys(p.pages)) if (ofDocs(id)) delete p.pages[id];
  writePending(p);
}

/** The write is in IndexedDB: drop its note, unless a newer write of the same record noted something else since. */
function settle(store: Journaled, id: string, noted: string) {
  const p = readPending();
  const m = p[store];
  if (!m || !(id in m) || JSON.stringify(m[id]) !== noted) return;
  delete m[id];
  writePending(p);
}

/** Write through the notes an earlier page left (its writes may not have committed). */
async function replayPending(db: IDBDatabase) {
  const p = readPending();
  // Pages first, so that a document deleted afterwards takes them along.
  const entries = (["pages", "sessions", "docs"] as const).flatMap((store) => Object.entries(p[store] ?? {}).map(([id, v]) => ({ store, id, v })));
  if (!entries.length) return;
  const tx = db.transaction(["sessions", "docs", "pages"], "readwrite");
  for (const { store, id, v } of entries) {
    if (store === "pages") {
      const page = v as Partial<DocPage> | null;
      const valid = typeof page?.docId === "string" && typeof page.page === "number" && typeof page.text === "string";
      if (valid && pageKey(page as DocPage) === id) tx.objectStore("pages").put(page);
    } else if (v && typeof v === "object" && (v as { id?: unknown }).id === id) tx.objectStore(store).put(v);
    else if (v === null) {
      tx.objectStore(store).delete(id);
      if (store === "docs") tx.objectStore("pages").delete(pageRange(id));
    }
  }
  await finished(tx);
  for (const { store, id, v } of entries) settle(store, id, JSON.stringify(v));
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError("request", req.error));
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(storageError("transaction", tx.error));
    tx.onabort = () => reject(storageError("aborted", tx.error));
  });

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") throw storageError("unavailable");
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("pages")) {
        db.createObjectStore("pages", { keyPath: ["docId", "page"] }).createIndex("docId", "docId");
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" }).createIndex("projectId", "projectId");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the database: let it, and reopen on the next call.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => reject(storageError("cantOpen", req.error));
    req.onblocked = () => reject(storageError("blocked"));
  }).then(async (db) => {
    // Before anything else reads or writes: what an earlier page noted but may not have committed.
    await replayPending(db).catch(() => writePending({})); // notes that can't be written are dropped, not retried forever
    return db;
  });
  // A failed open is retried next time (e.g. after the user allowed storage).
  opening.catch(() => { opening = null; });
  return opening;
}

async function run<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode);
  const [result] = await Promise.all([fn(tx), finished(tx)]);
  return result;
}

/** Can documents be stored in this browser? */
export async function docsAvailable(): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}

/** Store a document with its pages, replacing any earlier copy with the same id (and all of that copy's pages). */
export const putDoc = (meta: DocMeta, pages: DocPage[]) => {
  forgetPages(new Set([meta.id])); // an earlier copy's page edits must not come back over this one
  return run(["docs", "pages"], "readwrite", (tx) => {
    const store = tx.objectStore("pages");
    store.delete(pageRange(meta.id));
    tx.objectStore("docs").put(meta);
    for (const p of pages) store.put({ ...p, docId: meta.id });
  });
};

/** A project's documents, oldest first. */
export const listDocs = (projectId: string) =>
  run(["docs"], "readonly", async (tx) => {
    const all = await done(tx.objectStore("docs").getAll() as IDBRequest<DocMeta[]>);
    return all.filter((d) => d.projectId === projectId).sort((a, b) => a.addedAt - b.addedAt);
  });

/** Every page of a document, by page number. */
export const getPages = (docId: string) =>
  run(["pages"], "readonly", async (tx) => {
    const pages = await done(tx.objectStore("pages").index("docId").getAll(docId) as IDBRequest<DocPage[]>);
    return pages.sort((a, b) => a.page - b.page);
  });

/** Replace one page (e.g. with text a vision model read off a scan, or pasted), noted first (see PENDING_KEY). */
export async function updatePage(page: DocPage) {
  const id = pageKey(page);
  const noted = notePage(page);
  await run(["pages"], "readwrite", (tx) => {
    tx.objectStore("pages").put(page);
  });
  if (unnoted.get(id) === page) unnoted.delete(id);
  settle("pages", id, noted);
}

/** A write of one record in the background, noted first so a reload right after it can't lose it (see PENDING_KEY). */
async function noted(store: Journaled, id: string, value: object | null, write: () => Promise<void>) {
  const n = note(store, id, value);
  await write();
  settle(store, id, n);
}

/** Replace a document's metadata (e.g. the problems found on a sheet), keeping its pages. */
export const updateDoc = (meta: DocMeta) =>
  noted("docs", meta.id, meta, () =>
    run(["docs"], "readwrite", (tx) => {
      tx.objectStore("docs").put(meta);
    }),
  );

/** Delete everything a project has here: its documents, their pages and its sessions (the project was deleted). */
export const deleteProjectData = (projectId: string) => {
  // Its noted writes must not bring any of it back.
  const p = readPending();
  for (const m of Object.values(p)) {
    for (const [id, v] of Object.entries(m ?? {})) if ((v as { projectId?: unknown } | null)?.projectId === projectId) delete m![id];
  }
  writePending(p);
  return run(["docs", "pages", "sessions"], "readwrite", async (tx) => {
    const docs = await done(tx.objectStore("docs").getAll() as IDBRequest<DocMeta[]>);
    const gone = docs.filter((d) => d.projectId === projectId);
    forgetPages(new Set(gone.map((d) => d.id)));
    for (const d of gone) {
      tx.objectStore("docs").delete(d.id);
      tx.objectStore("pages").delete(pageRange(d.id));
    }
    const sessions = await done(tx.objectStore("sessions").index("projectId").getAllKeys(projectId));
    for (const k of sessions) tx.objectStore("sessions").delete(k);
  });
};

/** Delete a document and all its pages. */
export const deleteDoc = (id: string) => {
  forgetPages(new Set([id]));
  return noted("docs", id, null, () =>
    run(["docs", "pages"], "readwrite", (tx) => {
      tx.objectStore("docs").delete(id);
      tx.objectStore("pages").delete(pageRange(id));
    }),
  );
};

/** Every `[docId, page]` key of one document: page numbers are numbers, and every number sorts before any array. */
const pageRange = (docId: string) => IDBKeyRange.bound([docId, -Infinity], [docId, []]);

/** Save (create or replace) a session. */
export const putSession = <S extends StoredSession>(session: S) =>
  noted("sessions", session.id, session, () =>
    run(["sessions"], "readwrite", (tx) => {
      tx.objectStore("sessions").put(session);
    }),
  );

/** A project's sessions, most recently updated first. The caller validates the shape. */
export const listSessions = (projectId: string) =>
  run(["sessions"], "readonly", async (tx) => {
    const all = await done(tx.objectStore("sessions").index("projectId").getAll(projectId) as IDBRequest<StoredSession[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt) as unknown[];
  });

export const deleteSession = (id: string) =>
  noted("sessions", id, null, () =>
    run(["sessions"], "readwrite", (tx) => {
      tx.objectStore("sessions").delete(id);
    }),
  );

/** Close the connection (tests, which replace the IndexedDB implementation between runs). */
export async function closeDocDb() {
  const db = await opening?.catch(() => null);
  db?.close();
  opening = null;
  unnoted.clear();
}
