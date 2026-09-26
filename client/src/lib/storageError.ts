/**
 * Failures of the app's IndexedDB stores (lib/snapshotDb.ts, lib/docDb.ts), with a code that lib/errors.ts turns
 * into a message in the interface language. The English message is only for logs. `detail` is the browser's own
 * message, when it gave one.
 */
export type StorageErrorCode = "unavailable" | "cantOpen" | "blocked" | "request" | "transaction" | "aborted" | "quota";

const ENGLISH: Record<StorageErrorCode, string> = {
  unavailable: "IndexedDB is not available",
  cantOpen: "IndexedDB can't be opened",
  blocked: "IndexedDB is blocked by another tab",
  request: "IndexedDB request failed",
  transaction: "IndexedDB transaction failed",
  aborted: "IndexedDB transaction aborted",
  quota: "Browser storage is full",
};

export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, readonly detail?: string) {
    super(detail ? `${ENGLISH[code]} (${detail})` : ENGLISH[code]);
    this.name = "StorageError";
  }
}

/** A coded error for a failed step; a full disk says so whatever the step was. */
export function storageError(code: StorageErrorCode, cause?: DOMException | Error | null): StorageError {
  if (cause?.name === "QuotaExceededError") return new StorageError("quota");
  return new StorageError(code, cause?.message || undefined);
}
