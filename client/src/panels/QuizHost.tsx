import { useEffect } from "react";
import { isViewing, useGraphStore } from "../store/graphStore";
import { useQuiz } from "../store/quizStore";
// Loaded lazily like the other dialogs (with their "couldn't be loaded" fallback): most sessions never open a quiz.
import { QuizDialog } from "./lazy";

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
  // Opening it again for another concept starts afresh.
  return <QuizDialog key={`${open.graphId}:${open.rootId}:${open.pathFirst}`} {...open} onClose={close} />;
}
