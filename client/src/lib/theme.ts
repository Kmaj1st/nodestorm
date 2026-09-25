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

/** Relation colours the user can change (Settings → Relation colours); each is the CSS token `--edge-<key>`. */
export const EDGE_COLOR_KEYS = ["dependency", "mix", "derive", "extract", "unrelated"] as const;
export type EdgeColorKey = (typeof EDGE_COLOR_KEYS)[number];
export type EdgeColors = Partial<Record<EdgeColorKey, string>>;

const COLORS_KEY = "nodestorm-edge-colors";
const HEX = /^#[0-9a-f]{6}$/i;

/** Only known keys with `#rrggbb` values survive (a hand-edited or older value is dropped). */
export function sanitizeEdgeColors(raw: unknown): EdgeColors {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: EdgeColors = {};
  for (const k of EDGE_COLOR_KEYS) if (typeof v[k] === "string" && HEX.test(v[k] as string)) out[k] = (v[k] as string).toLowerCase();
  return out;
}

function loadColors(): EdgeColors {
  try {
    return sanitizeEdgeColors(JSON.parse(localStorage.getItem(COLORS_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

interface ThemeState {
  pref: ThemePref;
  /** The theme actually shown. */
  theme: Theme;
  /** Custom relation colours; a missing key uses the theme's own colour. */
  edgeColors: EdgeColors;
  setPref(pref: ThemePref): void;
  setEdgeColors(colors: EdgeColors): void;
}

export const useTheme = create<ThemeState>()((set) => {
  const pref = load();
  return {
    pref,
    theme: resolve(pref),
    edgeColors: loadColors(),
    setEdgeColors(colors) {
      const edgeColors = sanitizeEdgeColors(colors);
      try {
        if (Object.keys(edgeColors).length) localStorage.setItem(COLORS_KEY, JSON.stringify(edgeColors));
        else localStorage.removeItem(COLORS_KEY);
      } catch {
        /* the choice just won't survive a reload */
      }
      set({ edgeColors });
    },
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
  // Custom relation colours override the theme's tokens, in both themes.
  const applyColors = (c: EdgeColors) => {
    for (const k of EDGE_COLOR_KEYS) {
      if (c[k]) document.documentElement.style.setProperty(`--edge-${k}`, c[k]);
      else document.documentElement.style.removeProperty(`--edge-${k}`);
    }
  };
  apply(useTheme.getState().theme);
  applyColors(useTheme.getState().edgeColors);
  useTheme.subscribe((s, prev) => {
    apply(s.theme);
    if (s.edgeColors !== prev.edgeColors) applyColors(s.edgeColors);
  });
  darkQuery()?.addEventListener("change", () => {
    const { pref } = useTheme.getState();
    if (pref === "auto") useTheme.setState({ theme: resolve(pref) });
  });
}
