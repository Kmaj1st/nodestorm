import { Fragment, memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { hasMath, splitMath } from "../lib/math";

type Render = (tex: string, display: boolean) => string | null;

// KaTeX is a separate chunk, imported the first time a MathText with a formula mounts. Until it's there (or if it
// can't be loaded, e.g. offline before the service worker cached it) formulas show as their source.
let render: Render | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadMath(): Promise<void> {
  loading ??= import("../lib/katexRender")
    .then((m) => {
      render = m.renderTex;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      loading = null; // try again on the next formula
    });
  return loading;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getRender = () => render;

/**
 * Text with LaTeX formulas (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`, see lib/math.ts) typeset by KaTeX. Text without a
 * formula renders as is and never loads KaTeX. The only HTML injected is KaTeX's own output (`trust: false`);
 * everything else, including a formula KaTeX rejects, is a React text node. `inline` renders display formulas
 * inline, for places too small for a block (canvas cards, list items).
 */
export const MathText = memo(function MathText({ text, inline }: { text: string; inline?: boolean }) {
  const math = hasMath(text);
  const r = useSyncExternalStore(subscribe, getRender);
  useEffect(() => {
    if (math && !render) void loadMath();
  }, [math]);
  const segments = useMemo(() => (math ? splitMath(text) : null), [math, text]);
  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === "text") return <Fragment key={i}>{s.text}</Fragment>;
        const display = s.display && !inline;
        const html = r?.(s.tex, display);
        if (!html) return <span key={i} className="math-src">{s.raw}</span>;
        const cls = display ? "math math--display" : "math";
        return <span key={i} className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </>
  );
});
