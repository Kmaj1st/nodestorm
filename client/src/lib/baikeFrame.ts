/**
 * The document of the sandboxed frame that runs Baidu Baike's JSONP (see baike.ts). Its one inline script never
 * changes (the address and nonce come in as attributes), so the production build's Content-Security-Policy can
 * allow it by hash (pwa/csp.ts): a srcdoc frame inherits the page's policy.
 */
export const BAIKE_FRAME_SCRIPT =
  "var h=document.documentElement,n=h.dataset.nonce;" +
  'window.cb=function(d){parent.postMessage({nonce:n,data:d},"*")};' +
  'var s=document.createElement("script");s.src=h.dataset.src;' +
  's.onerror=function(){parent.postMessage({nonce:n,error:1},"*")};' +
  "document.head.appendChild(s)";

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The frame's HTML: loads `src` (whose callback must be `cb`) and posts the answer back tagged with `nonce`. */
export function baikeFrameDoc(src: string, nonce: string): string {
  return (
    `<!doctype html><html data-nonce="${attr(nonce)}" data-src="${attr(src)}"><head><meta charset="utf-8">` +
    `<script>${BAIKE_FRAME_SCRIPT}</script></head></html>`
  );
}
