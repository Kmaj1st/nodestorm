import { CancelledError } from "@nodestorm/shared";

export type QueueState = "queued" | "running";

export interface RunOptions {
  /** Aborting while queued drops the task (rejecting with CancelledError); while running, `fn` handles it. */
  signal?: AbortSignal;
  /** "queued" when the task has to wait for a free slot, "running" when it starts. */
  onState?: (state: QueueState) => void;
}

export interface Limiter {
  run<T>(fn: () => Promise<T>, opts?: RunOptions): Promise<T>;
  readonly running: number;
  readonly waiting: number;
}

/**
 * First-in first-out limit on how many tasks run at once. `limit` is read each time a slot may open, so a changed
 * setting applies to the next task. Installing several dependencies fires many AI calls at once; this keeps
 * them from hitting the provider's rate limit all together.
 */
export function createLimiter(limit: () => number): Limiter {
  let running = 0;
  const queue: { start: () => void }[] = [];
  const max = () => Math.max(1, Math.floor(limit()) || 1);

  const pump = () => {
    while (running < max() && queue.length) queue.shift()!.start();
  };

  return {
    get running() {
      return running;
    },
    get waiting() {
      return queue.length;
    },
    run<T>(fn: () => Promise<T>, opts: RunOptions = {}): Promise<T> {
      const { signal, onState } = opts;
      if (signal?.aborted) return Promise.reject(new CancelledError());
      return new Promise<T>((resolve, reject) => {
        const entry = {
          start: () => {
            signal?.removeEventListener("abort", onAbort);
            running++;
            onState?.("running");
            let p: Promise<T>;
            try {
              p = fn();
            } catch (e) {
              p = Promise.reject(e);
            }
            p.then(resolve, reject).finally(() => {
              running--;
              pump();
            });
          },
        };
        const onAbort = () => {
          const i = queue.indexOf(entry);
          if (i < 0) return;
          queue.splice(i, 1);
          reject(new CancelledError());
        };
        // Join the back of the line even when the limit was just raised, so earlier waiters go first.
        queue.push(entry);
        signal?.addEventListener("abort", onAbort, { once: true });
        pump();
        if (queue.includes(entry)) onState?.("queued");
      });
    },
  };
}
