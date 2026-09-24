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
  /** When a prerequisite check closes a dependency cycle, let the AI pick the wrong link and remove it. */
  autoResolveCycles: boolean;
  /** Language the AI writes names, definitions and relations in: "auto" (match the input) or a language name. */
  language: string;
  /** How many AI calls may run at once; the rest wait in a queue (lib/aiQueue.ts). */
  aiConcurrency: number;
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
        localStorage.setItem(name, JSON.stringify({ ...parsed, state: { ...parsed.state, configs } }));
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
      autoResolveCycles: true,
      language: "auto",
      aiConcurrency: DEFAULT_CONCURRENCY,

      update: (patch) => set(patch),
      updateConfig: (kind, patch) =>
        set({ configs: { ...get().configs, [kind]: { ...get().configs[kind], ...patch } } }),
      forgetKeys: () =>
        set({
          configs: Object.fromEntries(
            Object.entries(get().configs).map(([k, c]) => [k, { ...c, apiKey: undefined }]),
          ) as Record<ProviderKind, ProviderConfig>,
        }),
    }),
    {
      name: KEY,
      version: 1,
      storage: createJSONStorage(() => splitStorage),
      // New providers added in later versions get an empty config.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          configs: { ...emptyConfigs(), ...(p.configs ?? {}) },
          clarify: { ...current.clarify, ...(p.clarify ?? {}) },
          installAll: { ...current.installAll, ...(p.installAll ?? {}) },
        };
      },
    },
  ),
);

/** True when AI calls can work right now without opening Settings. */
export function isReady(s: SettingsState): boolean {
  if (s.connection === "server") return true;
  const meta = PROVIDERS.find((p) => p.kind === s.provider);
  return !meta?.needsKey || Boolean(s.configs[s.provider]?.apiKey);
}
