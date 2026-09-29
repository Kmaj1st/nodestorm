// A module script of its own in index.html, before the app's: a Chinese interface starts fetching its messages
// (i18n/zh.ts, a chunk of its own) at once, alongside the app's chunk, instead of only once that chunk has been
// downloaded and run (a second round trip before the first paint on a slow network). The app's loadLang() then gets
// the same module. It reads the choice as i18n/index.ts does (load, browserLang), but imports nothing: anything
// shared with the app would become a chunk of its own, another request for everyone.
export const EARLY_KEY = "nodestorm-ui-language";

export function earlyWantsZh(stored: string | null, browserTag: string): boolean {
  return stored === "zh" || (stored !== "en" && /^zh\b/i.test(browserTag));
}

let stored: string | null = null;
try {
  stored = localStorage.getItem(EARLY_KEY);
} catch {
  /* storage blocked: the browser's language decides, as in i18n/index.ts */
}
if (typeof navigator !== "undefined" && earlyWantsZh(stored, navigator.language ?? "")) void import("./zh").catch(() => {});
