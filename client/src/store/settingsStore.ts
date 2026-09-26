import { PROVIDERS, type ProviderConfig, type ProviderKind } from "@nodestorm/shared";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * "browser": the page calls the AI provider directly with a key the user typed in.
 * "server":  requests go through the local NodeStorm server, which holds keys in server/.env.
 */
export type Connection = "browser" | "server";

interface SettingsState {
  connection: Connection;
  provider: ProviderKind;
  configs: Record<ProviderKind, ProviderConfig>;
  /** Keep API keys across browser restarts (localStorage) instead of only for this tab (sessionStorage). */
  rememberKeys: boolean;
  /** Model override used in server mode, per provider. */
  serverModels: Partial<Record<ProviderKind, string>>;
  /** Model that reads scanned PDF pages, per provider; unset uses the provider's `visionModel`, else the chat model. */
  visionModels: Partial<Record<ProviderKind, string>>;
  /** Ask "what do you mean?" when a concept name has several meanings, offering this many options. */
  clarify: { enabled: boolean; options: number };
  /** Limits for "Install all missing": how many levels of prerequisites to follow, and how many concepts to add. */
  installAll: { maxDepth: number; maxNodes: number };
  /** Look definitions up in encyclopedias before asking the AI (see lib/lookup.ts), and which ones. */
  /**
   * Definitions from encyclopedias before the AI. `baidu`: Baidu Baike for concepts with Chinese names. `fandom` /
   * `bwiki`: the Fandom subdomain / BWIKI game offered in "Look up in…" ("" for none).
   */
  lookup: { enabled: boolean; proofwiki: boolean; wikipedia: boolean; baidu: boolean; fandom: string; bwiki: string };
  /**
   * Adding a concept by name: "ask" shows what the encyclopedias and wikis found and uses the AI only when the user
   * asks; "auto" takes the best look-up (or the AI's definition) and checks prerequisites right away.
   */
  newConcepts: "ask" | "auto";
  /** When a prerequisite check closes a dependency cycle, let the AI pick the wrong link and remove it. */
  autoResolveCycles: boolean;
  /** Language the AI writes names, definitions and relations in: "auto" (match the input) or a language name. */
  language: string;
  /** How many AI calls may run at once; the rest wait in a queue (lib/aiQueue.ts). */
  aiConcurrency: number;
  /** Web search engines that find pages defining a concept (lib/webSearch.ts). Keys follow `rememberKeys` like AI keys. */
  search: SearchSettings;
}

/**
 * Web search engines. Brave allows no cross-site calls from a page, so it only runs through the local server
 * (connection "server"), which uses the key typed here or BRAVE_API_KEY from server/.env.
 */
export interface SearchSettings {
  tavily: { enabled: boolean; apiKey?: string };
  serper: { enabled: boolean; apiKey?: string };
  brave: { enabled: boolean; apiKey?: string };
  /** `url`: the user's SearXNG instance. */
  searxng: { enabled: boolean; url?: string };
  /** Most results in all (after removing duplicates). */
  maxResults: number;
}

export const defaultSearch = (): SearchSettings => ({
  tavily: { enabled: false },
  serper: { enabled: false },
  brave: { enabled: false },
  searxng: { enabled: false },
  maxResults: 6,
});

/** `search` without its API keys (what localStorage gets when keys aren't remembered). */
export function searchWithoutKeys(s: SearchSettings): SearchSettings {
  return {
    ...s,
    tavily: { ...s.tavily, apiKey: undefined },
    serper: { ...s.serper, apiKey: undefined },
    brave: { ...s.brave, apiKey: undefined },
  };
}

/** Stored `search` settings, whatever their age or state, as a complete and valid value. */
function mergeSearch(p: Partial<SearchSettings> | undefined): SearchSettings {
  const d = defaultSearch();
  const engine = <K extends "tavily" | "serper" | "brave" | "searxng">(k: K) => ({ ...d[k], ...(p?.[k] && typeof p[k] === "object" ? p[k] : {}) });
  const max = Number(p?.maxResults);
  return {
    tavily: engine("tavily"),
    serper: engine("serper"),
    brave: engine("brave"),
    searxng: engine("searxng"),
    maxResults: Number.isFinite(max) ? Math.min(20, Math.max(1, Math.round(max))) : d.maxResults,
  };
}

/** Presets for the output-language picker; `value` is what the prompt says. Anything else is custom text. */
export const LANGUAGES: { label: string; value: string }[] = [
  { label: "Auto (match the concept names)", value: "auto" },
  { label: "English", value: "English" },
  { label: "中文", value: "Chinese (中文)" },
  { label: "Español", value: "Spanish (Español)" },
  { label: "Français", value: "French (Français)" },
  { label: "Deutsch", value: "German (Deutsch)" },
  { label: "日本語", value: "Japanese (日本語)" },
  { label: "Русский", value: "Russian (Русский)" },
];

export const DEFAULT_CONCURRENCY = 3;

interface SettingsActions {
  update(patch: Partial<SettingsState>): void;
  updateConfig(kind: ProviderKind, patch: Partial<ProviderConfig>): void;
  forgetKeys(): void;
}

export type SettingsStore = SettingsState & SettingsActions;

const emptyConfigs = () =>
  Object.fromEntries(PROVIDERS.map((p) => [p.kind, {}])) as Record<ProviderKind, ProviderConfig>;

const KEY = "nodestorm-settings";

/**
 * Settings (provider, models, base URLs) always go to localStorage. API keys go to localStorage only
 * when "remember" is on; otherwise they live in sessionStorage and vanish when the tab closes.
 */
const splitStorage: StateStorage = {
  getItem(name) {
    try {
      return sessionStorage.getItem(name) ?? localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      const parsed = JSON.parse(value) as { state: SettingsState };
      if (parsed.state.rememberKeys) {
        localStorage.setItem(name, value);
        sessionStorage.removeItem(name);
      } else {
        const configs = Object.fromEntries(
          Object.entries(parsed.state.configs).map(([k, c]) => [k, { ...c, apiKey: undefined }]),
        );
        const search = parsed.state.search && searchWithoutKeys(parsed.state.search);
        localStorage.setItem(name, JSON.stringify({ ...parsed, state: { ...parsed.state, configs, search } }));
        sessionStorage.setItem(name, value);
      }
    } catch {
      /* storage unavailable (private mode etc.) — settings just won't persist */
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
      sessionStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      connection: "browser",
      provider: "siliconflow",
      configs: emptyConfigs(),
      rememberKeys: false,
      serverModels: {},
      visionModels: {},
      clarify: { enabled: true, options: 3 },
      installAll: { maxDepth: 3, maxNodes: 15 },
      lookup: { enabled: true, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" },
      newConcepts: "ask",
      autoResolveCycles: true,
      language: "auto",
      aiConcurrency: DEFAULT_CONCURRENCY,
      search: defaultSearch(),

      update: (patch) => set(patch),
      updateConfig: (kind, patch) =>
        set({ configs: { ...get().configs, [kind]: { ...get().configs[kind], ...patch } } }),
      forgetKeys: () =>
        set({
          configs: Object.fromEntries(
            Object.entries(get().configs).map(([k, c]) => [k, { ...c, apiKey: undefined }]),
          ) as Record<ProviderKind, ProviderConfig>,
          search: searchWithoutKeys(get().search),
        }),
    }),
    {
      name: KEY,
      version: 1,
      storage: createJSONStorage(() => splitStorage),
      // New providers added in later versions get an empty config.
      // A provider (or connection) this version doesn't know goes back to the default, so AI calls open Settings
      // instead of failing.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          provider: PROVIDERS.some((m) => m.kind === p.provider) ? p.provider! : current.provider,
          connection: p.connection === "browser" || p.connection === "server" ? p.connection : current.connection,
          configs: { ...emptyConfigs(), ...(p.configs ?? {}) },
          clarify: { ...current.clarify, ...(p.clarify ?? {}) },
          installAll: { ...current.installAll, ...(p.installAll ?? {}) },
          lookup: { ...current.lookup, ...(p.lookup ?? {}) },
          search: mergeSearch(p.search),
        };
      },
    },
  ),
);

/** True when AI calls can work right now without opening Settings. */
export function isReady(s: SettingsState): boolean {
  const meta = PROVIDERS.find((p) => p.kind === s.provider);
  if (!meta) return false; // a provider this version doesn't have
  if (s.connection === "server") return true;
  return !meta.needsKey || Boolean(s.configs[s.provider]?.apiKey);
}
