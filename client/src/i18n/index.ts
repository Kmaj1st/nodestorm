import { createElement, Fragment, type ReactNode } from "react";
import { create } from "zustand";
import { en, type MessageKey } from "./en";
import { format, plurals, splitPlaceholders, type Params } from "./format";

/**
 * A tiny i18n layer for the interface (not for user content or AI output; the AI's answer language is the separate
 * `language` setting in settingsStore). `t(key, params)` works anywhere; components call `useT()` so they re-render
 * when the language changes. See en.ts for the message syntax.
 */

export type { MessageKey } from "./en";
export type Lang = "en" | "zh";
/** "auto" follows the browser's language. */
export type LangPref = "auto" | Lang;

export const LANG_NAMES: Record<Lang, string> = { en: "English", zh: "中文" };
/**
 * Messages per language. English is built in (it is also the fallback for a missing key); Chinese is a chunk of its
 * own, fetched by loadLang() when first needed, so an English interface never downloads it.
 */
export const MESSAGES: Partial<Record<Lang, Record<MessageKey, string>>> = { en };

let zhLoading: Promise<void> | null = null;
/** Fetch a language's messages (once). Resolves when t() can show that language. */
export function loadLang(lang: Lang): Promise<void> {
  if (MESSAGES[lang]) return Promise.resolve();
  zhLoading ??= import("./zh").then(
    (m) => void (MESSAGES.zh = m.zh),
    (e) => {
      zhLoading = null; // let a later switch try again
      throw e;
    },
  );
  return zhLoading;
}

const KEY = "nodestorm-ui-language";

/** The interface language for a browser language tag: any Chinese variant (zh, zh-CN, zh-TW, …) → 中文, else English. */
export function browserLang(tag = typeof navigator === "undefined" ? "" : navigator.language): Lang {
  return /^zh\b/i.test(tag ?? "") ? "zh" : "en";
}

function load(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "en" || v === "zh" ? v : "auto";
  } catch {
    return "auto"; // storage blocked (private mode etc.) or not in a browser
  }
}

const resolve = (pref: LangPref): Lang => (pref === "auto" ? browserLang() : pref);

interface LocaleState {
  pref: LangPref;
  /** The language actually shown. */
  lang: Lang;
  setPref(pref: LangPref): void;
}

export const useLocale = create<LocaleState>()((set) => {
  const pref = load();
  return {
    pref,
    lang: resolve(pref), // main.tsx waits for localeReady before the first render
    setPref(pref) {
      try {
        if (pref === "auto") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pref);
      } catch {
        /* the choice just won't survive a reload */
      }
      set({ pref });
      show(resolve(pref));
    },
  };
});

/**
 * Show a language: at once if its messages are loaded, else once they are. Until then the current language stays (for
 * good if the fetch fails, e.g. offline on a first visit before the service worker cached it).
 */
function show(lang: Lang) {
  if (MESSAGES[lang]) return useLocale.setState({ lang });
  void loadLang(lang).then(
    () => useLocale.setState({ lang: resolve(useLocale.getState().pref) }), // the choice may have changed meanwhile
    () => {},
  );
}

/** Resolves once the starting language's messages are loaded (at once for English); never rejects, English being the
 * fallback. */
export const localeReady: Promise<void> = loadLang(useLocale.getState().lang).catch(() => useLocale.setState({ lang: "en" }));

/** A message in a given language (tests, and anything that must not depend on the current choice). */
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  return format(MESSAGES[lang]?.[key] ?? en[key], params);
}

/** A message in the current interface language. */
export function t(key: MessageKey, params?: Params): string {
  return translate(useLocale.getState().lang, key, params);
}

/** `t` for components: subscribes to the language so the component re-renders when it changes. */
export function useT(): typeof t {
  useLocale((s) => s.lang);
  return t;
}

/** The current language (for locale-aware formatting such as dates). */
export const useLang = () => useLocale((s) => s.lang);

/**
 * A message as React nodes: `**bold**` becomes <b>, `` `code` `` becomes <code>, and `{name}` placeholders may be
 * elements. Plural forms read numeric parameters, as in `t`.
 */
export function rich(key: MessageKey, params: Record<string, ReactNode> = {}): ReactNode {
  const text = plurals(MESSAGES[useLocale.getState().lang]?.[key] ?? en[key], params);
  const fill = (s: string) =>
    splitPlaceholders(s).map((part, i) =>
      createElement(Fragment, { key: i }, i % 2 ? (part in params ? params[part] : `{${part}}`) : part),
    );
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return createElement("b", { key: i }, fill(part.slice(2, -2)));
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return createElement("code", { key: i }, part.slice(1, -1));
    return createElement(Fragment, { key: i }, fill(part));
  });
}

/** Keep <html lang> in step with the interface language (screen readers, fonts, hyphenation). */
function applyHtmlLang(lang: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}
applyHtmlLang(useLocale.getState().lang);
useLocale.subscribe((s) => applyHtmlLang(s.lang));
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    const { pref } = useLocale.getState();
    if (pref === "auto") show(resolve(pref));
  });
}
