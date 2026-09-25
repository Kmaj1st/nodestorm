import { CancelledError, normalizeName, SiteBlockedError, type LookupSense } from "@nodestorm/shared";
import { z } from "zod";

/**
 * Baidu Baike (百度百科) definitions, for concepts with Chinese names. Its open API sends no CORS header, so the
 * browser can't read it with fetch; it does answer JSONP. A JSONP script is never run in the app's own page: it runs
 * in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`), an opaque origin that can't reach the
 * app's page, storage, keys or cookies. All it can do is post the answer back, which is checked before use.
 */

const API = "https://baike.baidu.com/api/openapi/BaikeLemmaCardApi";
const TIMEOUT_MS = 8000;

/** The part of Baidu Baike's answer we use (it has many more fields); `{}` when there is no entry. */
export const BaikeAnswer = z.object({
  title: z.string().max(300).optional(),
  abstract: z.string().max(20_000).optional(),
  desc: z.string().max(300).optional(),
  url: z.string().max(2000).optional(),
});
export type BaikeAnswer = z.infer<typeof BaikeAnswer>;

/** An entry's summary as a definition: footnote marks and extra spaces gone, cut at a sentence end near 600 chars. */
export function baikeSense(name: string, data: BaikeAnswer): LookupSense | null {
  const title = data.title?.trim();
  let text = (data.abstract ?? "")
    .replace(/\[\d+(?:[-–,，]\d+)*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：、！？,.;:])/g, "$1")
    .replace(/([，。；：、！？）])\s+/g, "$1") // no space after full-width punctuation
    .trim();
  if (!title || !text) return null;
  if (text.length > 600) {
    const cut = text.slice(0, 600);
    const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("；"), cut.lastIndexOf(". "));
    text = end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  const url = data.url?.trim().replace(/^http:\/\//, "https://");
  return {
    name: title,
    domain: data.desc?.trim() || "百度百科",
    definition: text,
    aliases: [],
    source: { site: "Baidu Baike", title, url: url?.startsWith("https://") ? url : `https://baike.baidu.com/item/${encodeURIComponent(title)}` },
    exact: normalizeName(title) === normalizeName(name),
  };
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Ask Baidu Baike for `name` (through the sandboxed iframe). Resolves to the raw answer, `{}` when there is none. */
export function baikeFetch(name: string, signal?: AbortSignal): Promise<BaikeAnswer> {
  if (typeof document === "undefined") return Promise.reject(new SiteBlockedError("baidu", "no browser"));
  if (signal?.aborted) return Promise.reject(new CancelledError());
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const src = `${API}?scope=103&format=json&appid=379020&bk_length=600&bk_key=${encodeURIComponent(name)}&callback=cb`;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts"); // scripts only: an opaque origin, cut off from the app
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.dataset.lookup = "baidu";
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc =
    `<!doctype html><meta charset="utf-8"><script>` +
    `function cb(d){parent.postMessage({nonce:${JSON.stringify(nonce)},data:d},"*")}` +
    `</script><script src="${attr(src)}" onerror='parent.postMessage({nonce:${JSON.stringify(nonce)},error:1},"*")'></script>`;
  return new Promise<BaikeAnswer>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      frame.remove();
    };
    const onMessage = (e: MessageEvent) => {
      // Only this frame's own answer counts.
      if (e.source !== frame.contentWindow || !e.data || typeof e.data !== "object" || e.data.nonce !== nonce) return;
      done();
      if (e.data.error) return reject(new SiteBlockedError("baidu", "the Baidu Baike script didn't load"));
      const parsed = BaikeAnswer.safeParse(e.data.data ?? {});
      if (parsed.success) resolve(parsed.data);
      else reject(new SiteBlockedError("baidu", "unexpected answer"));
    };
    const onAbort = () => {
      done();
      reject(new CancelledError());
    };
    const timer = setTimeout(() => {
      done();
      reject(new SiteBlockedError("baidu", "no answer"));
    }, TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    document.body.appendChild(frame);
  });
}

/** Baidu Baike's definition of `name`, if it has an entry. */
export async function baikeLookup(name: string, signal?: AbortSignal): Promise<LookupSense[]> {
  const sense = baikeSense(name, await baikeFetch(name.trim(), signal));
  return sense ? [sense] : [];
}
