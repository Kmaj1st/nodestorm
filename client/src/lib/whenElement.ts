interface Watcher {
  observe(target: Node, options: MutationObserverInit): void;
  disconnect(): void;
}

/**
 * Call `onFound` once `find()` returns something: right away, or as soon as the DOM under `root` changes to include
 * it. Gives up after `timeoutMs`. Returns a function that stops waiting (call it when the caller closes or unmounts),
 * so nothing keeps watching the page afterwards.
 */
export function whenElement<T>(
  find: () => T | null | undefined,
  onFound: (el: T) => void,
  opts: { root?: Node; timeoutMs?: number; Observer?: new (cb: () => void) => Watcher } = {},
): () => void {
  const now = find();
  if (now) {
    onFound(now);
    return () => {};
  }
  const Observer = opts.Observer ?? MutationObserver;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
  };
  const observer = new Observer(() => {
    const el = find();
    if (!el) return;
    stop();
    onFound(el);
  });
  observer.observe(opts.root ?? document.body, { childList: true, subtree: true });
  const timer = setTimeout(stop, opts.timeoutMs ?? 2000);
  return stop;
}
