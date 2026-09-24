import { create } from "zustand";

/** "auto" follows the system's prefers-color-scheme; the others pin a theme. */
export type ThemePref = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "nodestorm-theme";
const darkQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function load(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto"; // storage blocked (private mode etc.)
  }
}

const resolve = (pref: ThemePref): Theme => (pref === "auto" ? (darkQuery()?.matches ? "dark" : "light") : pref);

interface ThemeState {
  pref: ThemePref;
  /** The theme actually shown. */
  theme: Theme;
  setPref(pref: ThemePref): void;
}

export const useTheme = create<ThemeState>()((set) => {
  const pref = load();
  return {
    pref,
    theme: resolve(pref),
    setPref(pref) {
      try {
        if (pref === "auto") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, pref);
      } catch {
        /* the choice just won't survive a reload */
      }
      set({ pref, theme: resolve(pref) });
    },
  };
});

/** Mirror the theme onto <html data-theme> (styles.css keys its colours off it) and track system changes. */
export function initTheme() {
  const apply = (t: Theme) => { document.documentElement.dataset.theme = t; };
  apply(useTheme.getState().theme);
  useTheme.subscribe((s) => apply(s.theme));
  darkQuery()?.addEventListener("change", () => {
    const { pref } = useTheme.getState();
    if (pref === "auto") useTheme.setState({ theme: resolve(pref) });
  });
}
