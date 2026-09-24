// The KaTeX chunk: loaded by panels/MathText.tsx only when some visible text contains math, so the main bundle
// doesn't carry KaTeX or its fonts. The CSS import brings in the fonts (woff2 only, see `katexWoff2Only` in
// vite.config.ts); the service worker precaches them with the rest of the build, so math renders offline too.
import katex from "katex";
import "katex/dist/katex.min.css";

const cache = new Map<string, string | null>();
const CACHE_MAX = 500;

/**
 * KaTeX HTML (with MathML for screen readers) for `tex`, or null when KaTeX rejects it: the caller then shows the
 * source instead. Never throws. `trust: false` disables \href, \url, \includegraphics and \html…, so user or AI text
 * can't inject links or markup; `maxSize`/`maxExpand` bound what a hostile macro can do.
 */
export function renderTex(tex: string, display: boolean): string | null {
  const key = `${display ? "D" : "I"}${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string | null;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      output: "htmlAndMathml",
      maxSize: 20,
      maxExpand: 200,
    });
  } catch {
    html = null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, html);
  return html;
}
