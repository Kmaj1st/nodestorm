// Only in a build made for `node e2e/perf.mjs --built` (VITE_PERF_HOOKS=1): the stores the benchmark drives, which
// the dev server lets it import by path. Ordinary builds drop this module (see main.tsx).
import { updateNode } from "./lib/graphOps";
import { useGraphStore } from "./store/graphStore";
import { useView } from "./store/viewStore";

(window as unknown as { __nodestormPerf: unknown }).__nodestormPerf = { useGraphStore, useView, updateNode };
