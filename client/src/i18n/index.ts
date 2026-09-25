import { createElement, Fragment, type ReactNode } from "react";
import { create } from "zustand";
import { en, type MessageKey } from "./en";
import { format, plurals, splitPlaceholders, type Params } from "./format";
import { zh } from "./zh";

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
export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, zh };

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
    lang: resolve(pref),
    setPref(pref) {
      try {
        if (pref === "auto") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pref);
      } catch {
        /* the choice just won't survive a reload */
      }
      set({ pref, lang: resolve(pref) });
    },
  };
});

/** A message in a given language (tests, and anything that must not depend on the current choice). */
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  return format(MESSAGES[lang][key] ?? en[key], params);
}

/** A message in the current interface language. */
export function t(key: MessageKey, params?: Params): string {
  return translate(useLocale.getState().lang, key, params);
}

const LIST_SEPARATOR: Record<Lang, string> = { en: ", ", zh: "、" };
const listFormats = new Map<Lang, Intl.ListFormat | null>();

/**
 * Names listed in running text, in the interface language: "A, B, C" in English, "A、B、C" in Chinese (no "and": the
 * lists are of names, often cut short). Uses Intl.ListFormat where there is one, else the separator above.
 */
export function listJoin(items: readonly string[], lang: Lang = useLocale.getState().lang): string {
  if (!listFormats.has(lang)) {
    let f: Intl.ListFormat | null = null;
    try {
      if (typeof Intl !== "undefined" && "ListFormat" in Intl) f = new Intl.ListFormat(lang, { type: "conjunction", style: "narrow" });
    } catch {
      /* an engine without the locale's data: the plain separator below */
    }
    listFormats.set(lang, f);
  }
  const f = listFormats.get(lang);
  return f ? f.format(items) : items.join(LIST_SEPARATOR[lang]);
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
  const text = plurals(MESSAGES[useLocale.getState().lang][key] ?? en[key], params);
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
    if (pref === "auto") useLocale.setState({ lang: resolve(pref) });
  });
}
