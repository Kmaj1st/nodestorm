import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { BAIKE_FRAME_SCRIPT } from "../src/lib/baikeFrame";

/**
 * The production build's Content-Security-Policy, as a <meta> tag (GitHub Pages can't send headers). It is a second
 * line of defence: if some text ever got into the page as markup, it still couldn't run a script.
 * - script-src: the build's own files; Baidu Baike's JSONP, which runs only in a sandboxed srcdoc frame (baike.ts;
 *   the frame inherits this policy); and that frame's one fixed inline script, by hash. No inline code, no eval.
 * - style-src 'unsafe-inline': KaTeX's output positions every glyph with style attributes.
 * - connect-src: AI calls go to whatever endpoint the user sets up (a provider, or a local model on http://localhost),
 *   and look-ups to the encyclopedias, so any http(s) address.
 * The dev server has no policy (Vite's hot reload injects inline scripts).
 */
export function contentSecurityPolicy(): string {
  const frameScript = createHash("sha256").update(BAIKE_FRAME_SCRIPT).digest("base64");
  return [
    "default-src 'self'",
    `script-src 'self' https://baike.baidu.com 'sha256-${frameScript}'`,
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

export const cspMetaTag = () => `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy().replace(/"/g, "&quot;")}">`;

/** Puts the policy first in <head> of the built index.html (only in `vite build`). */
export function csp(): Plugin {
  return {
    name: "nodestorm-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(/<head>/i, `<head>\n    ${cspMetaTag()}`),
    },
  };
}
