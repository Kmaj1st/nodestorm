import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { BAIKE_FRAME_SCRIPT } from "../src/lib/baikeFrame";

/**
 * The production build's Content-Security-Policy, as a <meta> tag (GitHub Pages can't send headers). It is a second
 * line of defence: if some text ever got into the page as markup, it still couldn't run a script.
 * - script-src: the build's own files; Baidu Baike's JSONP, which runs only in a sandboxed srcdoc frame (baike.ts;
 *   the frame inherits this policy); that frame's one fixed inline script, and index.html's own (the theme before the
 *   first paint), by hash. No other inline code, no eval.
 * - style-src 'unsafe-inline': KaTeX's output positions every glyph with style attributes.
 * - connect-src: AI calls go to whatever endpoint the user sets up (a provider, or a local model on http://localhost),
 *   and look-ups to the encyclopedias, so any http(s) address.
 * - No 'wasm-unsafe-eval': only PDF.js's worker compiles WebAssembly (its decoders for scanned pictures), and a
 *   worker started from a file of the build isn't under this page's <meta> policy.
 * The dev server has no policy (Vite's hot reload injects inline scripts).
 */
export function contentSecurityPolicy(pageScripts: string[] = []): string {
  const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
  return [
    "default-src 'self'",
    ["script-src 'self' https://baike.baidu.com", hash(BAIKE_FRAME_SCRIPT), ...pageScripts.map(hash)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https: http: data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export const cspMetaTag = (pageScripts: string[] = []) =>
  `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(pageScripts).replace(/"/g, "&quot;")}">`;

/** The page's own inline scripts (index.html's theme script: plain `<script>` tags, no attributes), as written. */
export const inlineScripts = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

/** Puts the policy first in <head> of the built index.html (only in `vite build`), allowing its inline scripts. */
export function csp(): Plugin {
  return {
    name: "nodestorm-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(/<head>/i, `<head>\n    ${cspMetaTag(inlineScripts(html))}`),
    },
  };
}
