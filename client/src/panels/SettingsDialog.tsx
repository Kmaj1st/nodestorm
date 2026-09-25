import {
  DEFAULT_TIMEOUT_MS,
  normalizeLanguage,
  PROVIDERS,
  providerMeta,
  type ModelInfo,
  type ProviderConfig,
  type ProviderKind,
  type ProvidersResponse,
} from "@nodestorm/shared";
import { Check, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { browserLang, LANG_NAMES, rich, useLocale, useT, type LangPref, type MessageKey } from "../i18n";
import { api } from "../lib/api";
import { pausedSites, SITE_NAME } from "../lib/lookup";
import { EDGE_COLOR_KEYS, useTheme, type EdgeColorKey, type EdgeColors, type ThemePref } from "../lib/theme";
import { useGraphStore } from "../store/graphStore";
import { DEFAULT_CONCURRENCY, LANGUAGES, useSettings, type Connection } from "../store/settingsStore";
import { formatTokens, useUsage } from "../store/usageStore";
import { Modal } from "./Modal";

type ModelsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; models: ModelInfo[] }
  | { status: "error"; message: string };

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const saved = useSettings();
  // Edit a draft; nothing is stored until Save.
  const [uiLang, setUiLang] = useState<LangPref>(useLocale.getState().pref);
  const [theme, setTheme] = useState<ThemePref>(useTheme.getState().pref);
  const [edgeColors, setEdgeColors] = useState<EdgeColors>(useTheme.getState().edgeColors);
  const [connection, setConnection] = useState<Connection>(saved.connection);
  const [provider, setProvider] = useState<ProviderKind>(saved.provider);
  const [configs, setConfigs] = useState(saved.configs);
  const [serverModels, setServerModels] = useState(saved.serverModels);
  const [visionModels, setVisionModels] = useState(saved.visionModels);
  const [rememberKeys, setRememberKeys] = useState(saved.rememberKeys);
  const [clarify, setClarify] = useState(saved.clarify);
  const [installAll, setInstallAll] = useState(saved.installAll);
  const [autoResolveCycles, setAutoResolveCycles] = useState(saved.autoResolveCycles);
  const [lookup, setLookup] = useState(saved.lookup);
  const [language, setLanguage] = useState(saved.language);
  // The custom-text box shows when the saved language isn't a preset, or once "Other…" is picked.
  const [customLanguage, setCustomLanguage] = useState(!LANGUAGES.some((l) => l.value === saved.language));
  const [aiConcurrency, setAiConcurrency] = useState(saved.aiConcurrency);
  const tokens = useUsage((s) => s.tokens);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelsState>({ status: "idle" });
  const [server, setServer] = useState<ProvidersResponse | { error: string } | null>(null);

  const meta = providerMeta(provider);
  const cfg = configs[provider] ?? {};
  const setCfg = (patch: Partial<ProviderConfig>) => setConfigs({ ...configs, [provider]: { ...cfg, ...patch } });
  const model = connection === "browser" ? cfg.model ?? "" : serverModels[provider] ?? "";
  const setModel = (m: string) =>
    connection === "browser" ? setCfg({ model: m }) : setServerModels({ ...serverModels, [provider]: m });
  const serverInfo = server && "providers" in server ? server.providers.find((p) => p.id === provider) : undefined;
  const defaultModel = connection === "server" && serverInfo ? serverInfo.model : meta.defaultModel;

  useEffect(() => {
    if (connection !== "server") return;
    api.serverProviders().then(setServer, (e) => setServer({ error: e instanceof Error ? e.message : String(e) }));
  }, [connection]);

  const canDiscover = connection === "server" ? Boolean(serverInfo?.configured) : !meta.needsKey || Boolean(cfg.apiKey);

  // Only the latest discovery request may update the list; older ones are aborted.
  const discovery = useRef<AbortController | null>(null);
  const discover = useCallback(async () => {
    discovery.current?.abort();
    const ctrl = new AbortController();
    discovery.current = ctrl;
    setModels({ status: "loading" });
    try {
      const models = await api.listModels(provider, cfg, connection, ctrl.signal);
      if (!ctrl.signal.aborted) setModels({ status: "ok", models });
    } catch (e) {
      if (!ctrl.signal.aborted) setModels({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [provider, cfg, connection]);
  useEffect(() => () => discovery.current?.abort(), []);

  // Discover automatically when the provider/connection changes or a key is entered (debounced).
  useEffect(() => {
    setModels({ status: "idle" });
    if (!canDiscover) return;
    const t = setTimeout(discover, 500);
    return () => {
      clearTimeout(t);
      discovery.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, connection, cfg.apiKey, cfg.baseURL, canDiscover]);

  const save = () => {
    useLocale.getState().setPref(uiLang);
    useTheme.getState().setPref(theme);
    useTheme.getState().setEdgeColors(edgeColors);
    const lang = normalizeLanguage(language) ?? "auto";
    saved.update({
      connection, provider, configs, serverModels, visionModels, rememberKeys, clarify, installAll, lookup, autoResolveCycles, language: lang, aiConcurrency,
    });
    useGraphStore.getState().setToast(null); // any "set up AI" error is now stale
    onClose();
  };

  const modelKnown = models.status !== "ok" || !model || models.models.some((m) => m.id === model);
  // While typing a partial name, narrow the list to matches.
  const q = model.toLowerCase();
  const shown =
    models.status !== "ok" ? [] : modelKnown ? models.models : models.models.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(q));

  return (
    <Modal label={t("settings.title")} title={t("settings.title")} onClose={onClose} className="settings">

      {/* Interface first: it is about this app, not the AI (whose answer language is under "AI answers"). */}
      <fieldset className="choice">
        <legend>{t("settings.interface")}</legend>
        <div className="settings__row">
          <label className="field">
            {t("settings.uiLanguage")}
            <select
              value={uiLang}
              onChange={(e) => setUiLang(e.target.value as LangPref)}
              aria-label={t("settings.uiLanguage")}
              data-testid="ui-language"
            >
              <option value="auto">{t("settings.uiAuto", { lang: LANG_NAMES[browserLang()] })}</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
          <label className="field">
            {t("settings.theme")}
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)} aria-label={t("settings.theme")}>
              <option value="auto">{t("settings.themeAuto")}</option>
              <option value="light">{t("settings.themeLight")}</option>
              <option value="dark">{t("settings.themeDark")}</option>
            </select>
          </label>
        </div>
        <span className="muted small">{t("settings.uiHint")}</span>
        <EdgeColorsField value={edgeColors} onChange={setEdgeColors} />
      </fieldset>

      <h4 className="settings__head">{t("settings.ai")}</h4>
      <fieldset className="choice">
        <legend>{t("settings.connection")}</legend>
        <label>
          <input type="radio" checked={connection === "browser"} onChange={() => setConnection("browser")} />
          <span>
            <b>{t("settings.browser")}</b>
            <span className="muted small">{t("settings.browserHint")}</span>
          </span>
        </label>
        <label>
          <input type="radio" checked={connection === "server"} onChange={() => setConnection("server")} />
          <span>
            <b>{t("settings.server")}</b>
            <span className="muted small">{rich("settings.serverHint")}</span>
          </span>
        </label>
      </fieldset>

      <label className="field">
        {t("settings.provider")}
        <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderKind)} aria-label={t("settings.provider")}>
          {PROVIDERS.map((p) => {
            const s = server && "providers" in server ? server.providers.find((x) => x.id === p.kind) : undefined;
            const off = connection === "server" && s !== undefined && !s.configured;
            return (
              <option key={p.kind} value={p.kind}>
                {p.label}{off ? ` ${t("settings.noServerKey")}` : ""}
              </option>
            );
          })}
        </select>
      </label>

      {connection === "server" && server && "error" in server && <p className="error small">{server.error}</p>}
      {connection === "server" && serverInfo && !serverInfo.configured && (
        <p className="error small">{t("settings.serverMissingKey", { provider: meta.label })}</p>
      )}

      {connection === "browser" && (meta.needsKey || meta.defaultBaseURL) && (
        <>
          {meta.needsKey && (
            <label className="field">
              <span>
                {t("settings.apiKey")}
                {meta.keyUrl && (
                  <> · <a href={meta.keyUrl} target="_blank" rel="noreferrer">{t("settings.getKey")}</a></>
                )}
              </span>
              <div className="row">
                <input
                  type={showKey ? "text" : "password"}
                  value={cfg.apiKey ?? ""}
                  onChange={(e) => setCfg({ apiKey: e.target.value.trim() || undefined })}
                  placeholder="sk-…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t("settings.apiKey")}
                />
                <button type="button" onClick={() => setShowKey(!showKey)}>
                  <Icon icon={showKey ? EyeOff : Eye} size={14} />
                  {t(showKey ? "settings.hide" : "settings.show")}
                </button>
              </div>
            </label>
          )}
          {meta.defaultBaseURL && (
            <label className="field">
              {t("settings.baseUrl")}
              <input
                value={cfg.baseURL ?? ""}
                onChange={(e) => setCfg({ baseURL: e.target.value.trim() || undefined })}
                placeholder={meta.defaultBaseURL}
                aria-label={t("settings.baseUrl")}
              />
            </label>
          )}
          {provider === "ollama" && <p className="muted small">{t("settings.ollamaHint")}</p>}
          {provider === "anthropic" && (
            <label className="check">
              <input type="checkbox" checked={Boolean(cfg.webSearch)} onChange={(e) => setCfg({ webSearch: e.target.checked })} />
              {t("settings.webSearch")}
            </label>
          )}
        </>
      )}

      <label className="field">
        <span>
          {t("settings.model")}
          {models.status === "ok" && <span className="muted"> · {t("settings.available", { n: models.models.length })}</span>}
        </span>
        <div className="row">
          <input
            list="model-options"
            value={model}
            onChange={(e) => setModel(e.target.value.trim())}
            placeholder={t("settings.modelDefault", { model: defaultModel })}
            aria-label={t("settings.model")}
            spellCheck={false}
          />
          <button type="button" onClick={discover} disabled={!canDiscover || models.status === "loading"}>
            {models.status === "loading" ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={RefreshCw} size={14} />}
            {t(models.status === "loading" ? "settings.loading" : "settings.refresh")}
          </button>
        </div>
        <datalist id="model-options">
          {models.status === "ok" && models.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </datalist>
        {models.status === "error" && <span className="error small" data-testid="models-error">{models.message}</span>}
        {models.status === "ok" && (
          <span className="ok small status-line" data-testid="models-ok"><Icon icon={Check} size={14} />{t("settings.connected")}</span>
        )}
        {!modelKnown && shown.length === 0 && <span className="warn small">{t("settings.unknownModel")}</span>}
        {!canDiscover && connection === "browser" && <span className="muted small">{t("settings.enterKey")}</span>}
      </label>

      {shown.length > 0 && (
        <ul className="model-list" aria-label={t("settings.models")}>
          {shown.map((m) => (
            <li key={m.id}>
              <button type="button" className={m.id === (model || defaultModel) ? "model model--on" : "model"} onClick={() => setModel(m.id)}>
                {m.label && m.label !== m.id ? <><b>{m.label}</b> <span className="muted">{m.id}</span></> : m.id}
              </button>
            </li>
          ))}
        </ul>
      )}

      {provider !== "mock" && (
        <label className="field">
          {t("settings.visionModel")}
          <input
            list="model-options"
            value={visionModels[provider] ?? ""}
            onChange={(e) => setVisionModels({ ...visionModels, [provider]: e.target.value.trim() })}
            placeholder={t("settings.modelDefault", { model: meta.visionModel ?? (model || defaultModel) })}
            spellCheck={false}
          />
          <span className="muted small">{t("settings.visionModelHint")}</span>
        </label>
      )}

      {provider !== "mock" && (
        <label className="field">
          {t("settings.timeout")}
          <input
            type="number"
            min={10}
            max={600}
            value={Math.round((cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}
            onChange={(e) => {
              const secs = Math.min(600, Math.max(10, Number(e.target.value) || DEFAULT_TIMEOUT_MS / 1000));
              setCfg({ timeoutMs: secs * 1000 });
            }}
            aria-label={t("settings.timeout")}
          />
          <span className="muted small">{t("settings.timeoutHint")}</span>
        </label>
      )}

      <fieldset className="choice">
        <legend>{t("settings.ambiguous")}</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={clarify.enabled}
            onChange={(e) => setClarify({ ...clarify, enabled: e.target.checked })}
          />
          {t("settings.askMeaning")}
        </label>
        <label className="check">
          {t("settings.offer")}
          <input
            type="number"
            min={2}
            max={10}
            value={clarify.options}
            disabled={!clarify.enabled}
            onChange={(e) => setClarify({ ...clarify, options: Math.min(10, Math.max(2, Number(e.target.value) || 3)) })}
            aria-label={t("settings.offerAria")}
            className="num"
          />
          {t("settings.offerSuffix")}
        </label>
      </fieldset>

      <fieldset className="choice">
        <legend>{t("settings.installAll")}</legend>
        <label className="check">
          {t("settings.followUpTo")}
          <input
            type="number"
            min={1}
            max={10}
            value={installAll.maxDepth}
            onChange={(e) => setInstallAll({ ...installAll, maxDepth: Math.min(10, Math.max(1, Number(e.target.value) || 3)) })}
            aria-label={t("settings.depthAria")}
            className="num"
          />
          {t("settings.levelsDeep")}
          <input
            type="number"
            min={1}
            max={100}
            value={installAll.maxNodes}
            onChange={(e) => setInstallAll({ ...installAll, maxNodes: Math.min(100, Math.max(1, Number(e.target.value) || 15)) })}
            aria-label={t("settings.nodesAria")}
            className="num"
          />
          {t("settings.concepts")}
        </label>
      </fieldset>

      <fieldset className="choice">
        <legend>{t("settings.lookup")}</legend>
        <label className="check">
          <input type="checkbox" checked={lookup.enabled} onChange={(e) => setLookup({ ...lookup, enabled: e.target.checked })} />
          {t("settings.lookupEnabled")}
        </label>
        <label className="check indent">
          <input type="checkbox" checked={lookup.proofwiki} disabled={!lookup.enabled} onChange={(e) => setLookup({ ...lookup, proofwiki: e.target.checked })} />
          {t("settings.lookupProofWiki")}
        </label>
        <label className="check indent">
          <input type="checkbox" checked={lookup.wikipedia} disabled={!lookup.enabled} onChange={(e) => setLookup({ ...lookup, wikipedia: e.target.checked })} />
          {t("settings.lookupWikipedia")}
        </label>
        <label className="check">
          <input type="checkbox" checked={lookup.baidu} disabled={!lookup.enabled} onChange={(e) => setLookup({ ...lookup, baidu: e.target.checked })} />
          {t("settings.lookupBaidu")}
        </label>
        <div className="field-row">
          <label className="field">
            {t("settings.lookupFandom")}
            <input
              value={lookup.fandom}
              onChange={(e) => setLookup({ ...lookup, fandom: e.target.value })}
              placeholder={t("settings.lookupWikiPlaceholder", { example: "minecraft" })}
              spellCheck={false}
              data-testid="lookup-fandom"
            />
          </label>
          <label className="field">
            {t("settings.lookupBwiki")}
            <input
              value={lookup.bwiki}
              onChange={(e) => setLookup({ ...lookup, bwiki: e.target.value })}
              placeholder={t("settings.lookupWikiPlaceholder", { example: "ys" })}
              spellCheck={false}
              data-testid="lookup-bwiki"
            />
          </label>
        </div>
        <span className="muted small">{t("settings.lookupWikisHint")}</span>
        <span className="muted small">{t("settings.lookupHint")}</span>
        {lookup.enabled && pausedSites().length > 0 && (
          <span className="warn small">{t("settings.lookupPaused", { sites: pausedSites().map((s) => SITE_NAME[s]).join(", ") })}</span>
        )}
      </fieldset>

      <fieldset className="choice">
        <legend>{t("settings.cycles")}</legend>
        <label className="check">
          <input type="checkbox" checked={autoResolveCycles} onChange={(e) => setAutoResolveCycles(e.target.checked)} />
          {t("settings.autoResolveCycles")}
        </label>
      </fieldset>

      <fieldset className="choice">
        <legend>{t("settings.aiAnswers")}</legend>
        <label className="check">
          {t("settings.writeIn")}
          <select
            value={customLanguage ? "custom" : language}
            onChange={(e) => {
              const custom = e.target.value === "custom";
              setCustomLanguage(custom);
              setLanguage(custom ? "" : e.target.value);
            }}
            aria-label={t("settings.aiAnswersAria")}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.value === "auto" ? t("settings.aiAuto") : l.label}</option>
            ))}
            <option value="custom">{t("settings.aiOther")}</option>
          </select>
          {customLanguage && (
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              maxLength={40}
              placeholder={t("settings.aiCustomPlaceholder")}
              aria-label={t("settings.aiCustomAria")}
            />
          )}
        </label>
        <span className="muted small">{t("settings.aiLangHint")}</span>
        <label className="check">
          {t("settings.runAtMost")}
          <input
            type="number"
            min={1}
            max={10}
            value={aiConcurrency}
            onChange={(e) => setAiConcurrency(Math.min(10, Math.max(1, Number(e.target.value) || DEFAULT_CONCURRENCY)))}
            aria-label={t("settings.concurrentAria")}
            className="num"
          />
          {t("settings.concurrentSuffix")}
        </label>
        {connection === "browser" && tokens > 0 && (
          <span className="muted small" data-testid="token-usage">{t("settings.tokens", { tokens: formatTokens(tokens) })}</span>
        )}
      </fieldset>

      {connection === "browser" && meta.needsKey && (
        <div className="keynote">
          <label className="check">
            <input type="checkbox" checked={rememberKeys} onChange={(e) => setRememberKeys(e.target.checked)} />
            {t("settings.remember")}
          </label>
          <p className="muted small">
            {t("settings.keyOnlyTo", { provider: meta.label })} {t(rememberKeys ? "settings.keyLocal" : "settings.keyTab")}{" "}
            {t("settings.keyAdvice")}
          </p>
          <button type="button" className="link small" onClick={() => { saved.forgetKeys(); setConfigs(useSettings.getState().configs); }}>
            {t("settings.forget")}
          </button>
        </div>
      )}

      <div className="form__actions">
        <button type="button" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="primary" onClick={save}>{t("common.save")}</button>
      </div>
    </Modal>
  );
}

const EDGE_COLOR_LABEL: Record<EdgeColorKey, MessageKey> = {
  dependency: "view.dependency",
  mix: "view.mix",
  derive: "view.derive",
  extract: "view.extract",
  unrelated: "view.unrelated",
};

/** A colour as `#rrggbb` (computed custom properties may come back as `rgb(…)`). */
function toHex(c: string): string {
  const v = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((x) => x + x).join("")}`.toLowerCase();
  const m = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v);
  return m ? `#${m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, "0")).join("")}` : "#888888";
}

/** The theme's own colour for a relation type (ignoring any custom colour set on <html>). */
function themeColor(key: EdgeColorKey): string {
  const root = document.documentElement;
  const custom = root.style.getPropertyValue(`--edge-${key}`);
  if (custom) root.style.removeProperty(`--edge-${key}`);
  const value = getComputedStyle(root).getPropertyValue(`--edge-${key}`);
  if (custom) root.style.setProperty(`--edge-${key}`, custom);
  return toHex(value);
}

/** Settings → Relation colours: one picker per relation type, each resettable to the theme's colour. */
function EdgeColorsField({ value, onChange }: { value: EdgeColors; onChange: (c: EdgeColors) => void }) {
  const t = useT();
  const custom = Object.keys(value).length > 0;
  return (
    <div className="edge-colors" role="group" aria-labelledby="edge-colors-head">
      <div className="edge-colors__head">
        <span id="edge-colors-head" className="edge-colors__title">{t("settings.edgeColors")}</span>
        <button type="button" className="link small" onClick={() => onChange({})} disabled={!custom} data-testid="edge-colors-reset-all">
          {t("settings.edgeColorsResetAll")}
        </button>
      </div>
      {EDGE_COLOR_KEYS.map((k) => (
        <div key={k} className="edge-colors__row">
          <label className="edge-colors__label">
            <input
              type="color"
              value={value[k] ?? themeColor(k)}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}
              data-testid={`edge-color-${k}`}
            />
            {t(EDGE_COLOR_LABEL[k])}
          </label>
          <button
            type="button"
            className="small-btn"
            disabled={!value[k]}
            onClick={() => {
              const { [k]: _gone, ...rest } = value;
              onChange(rest);
            }}
            aria-label={t("settings.edgeColorReset", { name: t(EDGE_COLOR_LABEL[k]) })}
          >
            {t("settings.edgeColorResetShort")}
          </button>
        </div>
      ))}
      <span className="muted small">{t("settings.edgeColorsHint")}</span>
    </div>
  );
}
