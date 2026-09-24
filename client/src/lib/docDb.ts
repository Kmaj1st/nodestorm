/**
 * IndexedDB storage for "Derive together": imported PDFs (reference documents and problem sheets) and tutoring
 * sessions. Page text can run to megabytes, far past localStorage's ~5 MB, and is only read when a session needs
 * it. Three object stores:
 * - `docs`: `DocMeta`, what the document list shows.
 * - `pages`: one `DocPage` per page, keyed `[docId, page]` and indexed by `docId`.
 * - `sessions`: tutoring sessions as plain JSON (their shape belongs to the caller), indexed by `projectId`.
 * Modelled on `snapshotDb.ts`: every call rejects rather than throws, so callers can treat any failure (IndexedDB
 * missing, blocked in a private window, quota exceeded) the same way.
 */

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

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
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
    req.onerror = () => reject(req.error ?? new Error("IndexedDB can't be opened"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
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
export const putDoc = (meta: DocMeta, pages: DocPage[]) =>
  run(["docs", "pages"], "readwrite", (tx) => {
    const store = tx.objectStore("pages");
    store.delete(pageRange(meta.id));
    tx.objectStore("docs").put(meta);
    for (const p of pages) store.put({ ...p, docId: meta.id });
  });

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

/** Replace one page (e.g. with text a vision model read off a scan). */
export const updatePage = (page: DocPage) =>
  run(["pages"], "readwrite", (tx) => {
    tx.objectStore("pages").put(page);
  });

/** Replace a document's metadata (e.g. the problems found on a sheet), keeping its pages. */
export const updateDoc = (meta: DocMeta) =>
  run(["docs"], "readwrite", (tx) => {
    tx.objectStore("docs").put(meta);
  });

/** Delete everything a project has here: its documents, their pages and its sessions (the project was deleted). */
export const deleteProjectData = (projectId: string) =>
  run(["docs", "pages", "sessions"], "readwrite", async (tx) => {
    const docs = await done(tx.objectStore("docs").getAll() as IDBRequest<DocMeta[]>);
    for (const d of docs.filter((d) => d.projectId === projectId)) {
      tx.objectStore("docs").delete(d.id);
      tx.objectStore("pages").delete(pageRange(d.id));
    }
    const sessions = await done(tx.objectStore("sessions").index("projectId").getAllKeys(projectId));
    for (const k of sessions) tx.objectStore("sessions").delete(k);
  });

/** Delete a document and all its pages. */
export const deleteDoc = (id: string) =>
  run(["docs", "pages"], "readwrite", (tx) => {
    tx.objectStore("docs").delete(id);
    tx.objectStore("pages").delete(pageRange(id));
  });

/** Every `[docId, page]` key of one document: page numbers are numbers, and every number sorts before any array. */
const pageRange = (docId: string) => IDBKeyRange.bound([docId, -Infinity], [docId, []]);

/** Save (create or replace) a session. */
export const putSession = <S extends StoredSession>(session: S) =>
  run(["sessions"], "readwrite", (tx) => {
    tx.objectStore("sessions").put(session);
  });

/** A project's sessions, most recently updated first. The caller validates the shape. */
export const listSessions = (projectId: string) =>
  run(["sessions"], "readonly", async (tx) => {
    const all = await done(tx.objectStore("sessions").index("projectId").getAll(projectId) as IDBRequest<StoredSession[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt) as unknown[];
  });

export const deleteSession = (id: string) =>
  run(["sessions"], "readwrite", (tx) => {
    tx.objectStore("sessions").delete(id);
  });

/** Close the connection (tests, which replace the IndexedDB implementation between runs). */
export async function closeDocDb() {
  const db = await opening?.catch(() => null);
  db?.close();
  opening = null;
}
