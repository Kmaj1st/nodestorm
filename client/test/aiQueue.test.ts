import { CancelledError } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { createLimiter, type QueueState } from "../src/lib/aiQueue";

/** A task that finishes when `done` is called. */
function deferred<T = string>() {
  let done!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((done = res), (fail = rej)));
  return { promise, done, fail };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AI call queue", () => {
  it("runs at most `limit` tasks at once, in order", async () => {
    const q = createLimiter(() => 2);
    const tasks = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = tasks.map((t, i) => q.run(() => (started.push(i), t.promise)).catch(() => "rejected"));
    expect(started).toEqual([0, 1]);
    expect([q.running, q.waiting]).toEqual([2, 2]);
    tasks[1].done("b");
    await tick();
    expect(started).toEqual([0, 1, 2]);
    tasks[0].fail(new Error("boom"));
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    tasks[2].done("c");
    tasks[3].done("d");
    expect(await Promise.all(results)).toEqual(["rejected", "b", "c", "d"]);
    expect([q.running, q.waiting]).toEqual([0, 0]);
  });

  it("reports queued → running", async () => {
    const q = createLimiter(() => 1);
    const first = deferred();
    const states: QueueState[] = [];
    void q.run(() => first.promise);
    const second = q.run(async () => "ok", { onState: (s) => states.push(s) });
    expect(states).toEqual(["queued"]);
    first.done("x");
    await expect(second).resolves.toBe("ok");
    expect(states).toEqual(["queued", "running"]);
  });

  it("a queued task can be cancelled without ever starting", async () => {
    const q = createLimiter(() => 1);
    const first = deferred();
    void q.run(() => first.promise);
    const ctrl = new AbortController();
    let ran = false;
    const queued = q.run(async () => (ran = true), { signal: ctrl.signal });
    ctrl.abort();
    await expect(queued).rejects.toBeInstanceOf(CancelledError);
    expect(q.waiting).toBe(0);
    first.done("x");
    await tick();
    expect(ran).toBe(false);
  });

  it("an already-cancelled signal doesn't run the task", async () => {
    const q = createLimiter(() => 3);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(q.run(async () => 1, { signal: ctrl.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(q.running).toBe(0);
  });

  it("reads the limit live and treats nonsense as 1", async () => {
    let limit = 0;
    const q = createLimiter(() => limit);
    const a = deferred();
    const b = deferred();
    const started: string[] = [];
    void q.run(() => (started.push("a"), a.promise));
    void q.run(() => (started.push("b"), b.promise));
    expect(started).toEqual(["a"]);
    limit = 5;
    // A raised limit applies to the next task, and the one already waiting still goes first.
    const c = q.run(async () => (started.push("c"), "c"));
    expect(started).toEqual(["a", "b", "c"]);
    a.done("a");
    await c;
  });

  it("a task that throws synchronously frees its slot", async () => {
    const q = createLimiter(() => 1);
    await expect(q.run(() => { throw new Error("sync"); })).rejects.toThrow("sync");
    await expect(q.run(async () => "next")).resolves.toBe("next");
  });
});
