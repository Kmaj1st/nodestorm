/**
 * Pure undo/redo stacks. The store keeps one History per graph, holding whole-graph snapshots
 * (graphs are small and immutable, so snapshots share structure with each other).
 */

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: T[]; // oldest first; the last entry is what undo returns to
  future: T[]; // next redo first
  /** Coalescing key of the most recent step; a new step with the same key folds into it. */
  lastKey: string | null;
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], lastKey: null });

/**
 * Record a new step: `before` is the state the step started from. Clears the redo stack.
 * Consecutive steps with the same `key` (e.g. typing into one field) become a single undo step.
 */
export function record<T>(h: History<T>, before: T, key?: string, limit = HISTORY_LIMIT): History<T> {
  if (key && key === h.lastKey) return h; // undo/redo reset lastKey, so the redo stack is empty here
  const past = [...h.past, before];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [], lastKey: key ?? null };
}

export function undo<T>(h: History<T>, present: T): { history: History<T>; present: T } | null {
  if (!h.past.length) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [present, ...h.future], lastKey: null },
    present: h.past[h.past.length - 1],
  };
}

export function redo<T>(h: History<T>, present: T): { history: History<T>; present: T } | null {
  if (!h.future.length) return null;
  return {
    history: { past: [...h.past, present], future: h.future.slice(1), lastKey: null },
    present: h.future[0],
  };
}

/**
 * Apply a background change (e.g. a late AI result) to every snapshot too, so undo/redo never brings back
 * a stale "checking…" state or drops what the AI found. `fn` must be a no-op where it doesn't apply.
 */
export function rebase<T>(h: History<T>, fn: (s: T) => T): History<T> {
  if (!h.past.length && !h.future.length) return h;
  return { ...h, past: h.past.map(fn), future: h.future.map(fn) };
}
