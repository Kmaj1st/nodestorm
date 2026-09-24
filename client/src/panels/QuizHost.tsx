import { lazy, Suspense, useEffect } from "react";
import { isViewing, useGraphStore } from "../store/graphStore";
import { useQuiz } from "../store/quizStore";

// Loaded on first use: most sessions never open a quiz.
const QuizDialog = lazy(() => import("./QuizDialog").then((m) => ({ default: m.QuizDialog })));

/** Mounts the "Quiz me" dialog while it is open. It closes when the graph changes or a shared graph is shown. */
export function QuizHost() {
  const open = useQuiz((s) => s.open);
  const close = useQuiz((s) => s.closeQuiz);
  const activeId = useGraphStore((s) => s.activeId);
  const viewing = useGraphStore(isViewing);
  const stale = !!open && (viewing || open.graphId !== activeId);
  useEffect(() => {
    if (stale) close();
  }, [stale, close]);
  if (!open || stale) return null;
  return (
    <Suspense fallback={null}>
      {/* Opening it again for another concept starts afresh. */}
      <QuizDialog key={`${open.graphId}:${open.rootId}:${open.pathFirst}`} {...open} onClose={close} />
    </Suspense>
  );
}
