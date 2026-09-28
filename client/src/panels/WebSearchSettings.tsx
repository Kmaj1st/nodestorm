import type { ProviderKind, SearchEngineId } from "@nodestorm/shared";
import { Check, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listJoin, useT, type MessageKey } from "../i18n";
import { errorMessage } from "../lib/errors";
import { ENGINE_KEY_URL, ENGINE_NAME, engineUsable, mixedContent, pausedEngines, testSearchEngine } from "../lib/webSearch";
import type { Connection, SearchSettings } from "../store/settingsStore";
import { Icon } from "../ui/Icon";

type TestState = { status: "loading" } | { status: "ok" } | { status: "error"; message: string };

const LABEL: Record<SearchEngineId, MessageKey> = {
  tavily: "settings.searchTavily",
  serper: "settings.searchSerper",
  brave: "settings.searchBrave",
  searxng: "settings.searchSearxng",
};
const ENV: Record<SearchEngineId, string> = { tavily: "TAVILY_API_KEY", serper: "SERPER_API_KEY", brave: "BRAVE_API_KEY", searxng: "SEARXNG_URL" };
const ORDER: SearchEngineId[] = ["tavily", "serper", "brave", "searxng"];

/**
 * Settings → Web search: per engine a tick box, its key (or SearXNG's address), a "Test" that runs one tiny search
 * with what is typed (before Save), and where to get a key. Edits the dialog's draft; nothing is stored until Save.
 */
export function WebSearchSettings({
  value,
  onChange,
  connection,
  provider,
}: {
  value: SearchSettings;
  onChange: (s: SearchSettings) => void;
  connection: Connection;
  provider: ProviderKind;
}) {
  const t = useT();
  const [tests, setTests] = useState<Partial<Record<SearchEngineId, TestState>>>({});
  const [shown, setShown] = useState<Partial<Record<SearchEngineId, boolean>>>({});
  const running = useRef<Partial<Record<SearchEngineId, AbortController>>>({});
  useEffect(() => () => Object.values(running.current).forEach((c) => c?.abort()), []);

  const setEngine = (engine: SearchEngineId, patch: Record<string, unknown>) => {
    running.current[engine]?.abort();
    setTests((s) => ({ ...s, [engine]: undefined }));
    onChange({ ...value, [engine]: { ...value[engine], ...patch } });
  };

  const test = async (engine: SearchEngineId) => {
    running.current[engine]?.abort();
    const ctrl = new AbortController();
    running.current[engine] = ctrl;
    setTests((s) => ({ ...s, [engine]: { status: "loading" } }));
    try {
      await testSearchEngine(engine, value, connection, ctrl.signal);
      if (!ctrl.signal.aborted) setTests((s) => ({ ...s, [engine]: { status: "ok" } }));
    } catch (e) {
      if (!ctrl.signal.aborted) setTests((s) => ({ ...s, [engine]: { status: "error", message: errorMessage(e) } }));
    }
  };

  const paused = pausedEngines();
  return (
    <fieldset className="choice web-search" data-testid="web-search-settings">
      <legend>{t("settings.search")}</legend>
      <span className="muted small">{t("settings.searchIntro")}</span>
      {provider === "mock" && <span className="muted small">{t("settings.searchDemo")}</span>}
      {ORDER.map((engine) => {
        const cfg = value[engine];
        const browserOnly = engine === "brave" && connection === "browser";
        const state = tests[engine];
        const isUrl = engine === "searxng";
        const field = isUrl ? value.searxng.url ?? "" : value[engine as Exclude<SearchEngineId, "searxng">].apiKey ?? "";
        const label = isUrl ? t("settings.searchUrl") : t("settings.searchKey", { engine: ENGINE_NAME[engine] });
        return (
          <div key={engine} className="web-search__engine" data-testid={`search-${engine}`}>
            <label className="check">
              <input
                type="checkbox"
                checked={cfg.enabled && !browserOnly}
                disabled={browserOnly}
                onChange={(e) => setEngine(engine, { enabled: e.target.checked })}
                data-testid={`search-${engine}-enabled`}
              />
              <span className="web-search__name">{t(LABEL[engine])}</span>
            </label>
            {browserOnly && <span className="muted small indent-text">{t("settings.searchBraveServer")}</span>}
            {cfg.enabled && !browserOnly && (
              <div className="web-search__body">
                <label className="field">
                  <span className="web-search__label">
                    {label} · <a href={ENGINE_KEY_URL[engine]} target="_blank" rel="noreferrer">{t(isUrl ? "settings.searchHowTo" : "settings.getKey")}</a>
                  </span>
                  <div className="row">
                    <input
                      type={isUrl || shown[engine] ? "text" : "password"}
                      value={field}
                      onChange={(e) => setEngine(engine, isUrl ? { url: e.target.value.trim() || undefined } : { apiKey: e.target.value.trim() || undefined })}
                      placeholder={isUrl ? "https://searx.example.org" : ""}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={label}
                      data-testid={`search-${engine}-${isUrl ? "url" : "key"}`}
                    />
                    {!isUrl && (
                      <button type="button" onClick={() => setShown({ ...shown, [engine]: !shown[engine] })} aria-pressed={Boolean(shown[engine])}>
                        <Icon icon={shown[engine] ? EyeOff : Eye} size={14} />
                        {t(shown[engine] ? "settings.hide" : "settings.show")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => test(engine)}
                      disabled={!engineUsable(engine, value, connection) || state?.status === "loading"}
                      aria-label={t("settings.searchTestAria", { engine: ENGINE_NAME[engine] })}
                      data-testid={`search-${engine}-test`}
                    >
                      {state?.status === "loading" && <span className="spinner spinner--xs" aria-hidden="true" />}
                      {t(state?.status === "loading" ? "settings.searchTesting" : "settings.searchTest")}
                    </button>
                  </div>
                  {connection === "server" && <span className="muted small">{t("settings.searchServerKey", { env: ENV[engine] })}</span>}
                  {isUrl && connection === "browser" && mixedContent(field) && (
                    <span className="warn small" data-testid="search-searxng-mixed">{t("settings.searchMixed")}</span>
                  )}
                  {isUrl && <span className="muted small">{t("settings.searchUrlHint")}</span>}
                </label>
                <div aria-live="polite">
                  {state?.status === "ok" && (
                    <span className="ok small status-line" data-testid={`search-${engine}-ok`}><Icon icon={Check} size={14} />{t("settings.searchOk")}</span>
                  )}
                  {state?.status === "error" && <span className="error small" data-testid={`search-${engine}-error`}>{state.message}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <label className="check">
        {t("settings.searchMax")}
        <input
          type="number"
          min={1}
          max={20}
          value={value.maxResults}
          onChange={(e) => onChange({ ...value, maxResults: Math.min(20, Math.max(1, Number(e.target.value) || 6)) })}
          aria-label={t("settings.searchMaxAria")}
          className="num"
        />
        {t("settings.searchMaxSuffix")}
      </label>
      <span className="muted small">{t("settings.searchPrivacy")}</span>
      {connection === "browser" && <span className="muted small">{t("settings.searchKeys")}</span>}
      {paused.length > 0 && (
        <span className="warn small">{t("settings.searchPaused", { engines: listJoin(paused.map((e) => ENGINE_NAME[e])) })}</span>
      )}
    </fieldset>
  );
}
