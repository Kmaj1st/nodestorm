import type { SnapshotMeta } from "./snapshots";

/**
 * A tiny IndexedDB wrapper for version snapshots. They don't go to localStorage, which holds the projects themselves
 * and is only ~5 MB per origin. Two object stores: `meta` (what the Versions list shows) and `data` (the JSON, only
 * read to compare or restore). Every call rejects rather than throws, so callers can treat any failure (IndexedDB
 * missing, blocked in a private window, quota exceeded) the same way.
 */

const DB_NAME = "nodestorm-snapshots";
const VERSION = 1;

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
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
      if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
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

async function run<T>(mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await open();
  const tx = db.transaction(["meta", "data"], mode);
  const [result] = await Promise.all([fn(tx), finished(tx)]);
  return result;
}

/** Can snapshots be stored in this browser? */
export async function snapshotsAvailable(): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}

export const putSnapshot = (meta: SnapshotMeta, data: string) =>
  run("readwrite", (tx) => {
    tx.objectStore("meta").put(meta);
    tx.objectStore("data").put(data, meta.id);
  });

export const listSnapshots = () => run("readonly", (tx) => done(tx.objectStore("meta").getAll() as IDBRequest<SnapshotMeta[]>));

export const getSnapshotData = (id: string) =>
  run("readonly", (tx) => done(tx.objectStore("data").get(id) as IDBRequest<string | undefined>));

export const deleteSnapshots = (ids: string[]) =>
  run("readwrite", (tx) => {
    for (const id of ids) {
      tx.objectStore("meta").delete(id);
      tx.objectStore("data").delete(id);
    }
  });

/** Close the connection (tests, which replace the IndexedDB implementation between runs). */
export async function closeSnapshotDb() {
  const db = await opening?.catch(() => null);
  db?.close();
  opening = null;
}
