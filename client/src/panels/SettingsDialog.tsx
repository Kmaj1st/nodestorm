import {
  PROVIDERS,
  providerMeta,
  type ModelInfo,
  type ProviderConfig,
  type ProviderKind,
  type ProvidersResponse,
} from "@nodestorm/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useGraphStore } from "../store/graphStore";
import { useSettings, type Connection } from "../store/settingsStore";

type ModelsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; models: ModelInfo[] }
  | { status: "error"; message: string };

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const saved = useSettings();
  // Edit a draft; nothing is stored until Save.
  const [connection, setConnection] = useState<Connection>(saved.connection);
  const [provider, setProvider] = useState<ProviderKind>(saved.provider);
  const [configs, setConfigs] = useState(saved.configs);
  const [serverModels, setServerModels] = useState(saved.serverModels);
  const [rememberKeys, setRememberKeys] = useState(saved.rememberKeys);
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

  const discover = useCallback(async () => {
    setModels({ status: "loading" });
    try {
      setModels({ status: "ok", models: await api.listModels(provider, cfg, connection) });
    } catch (e) {
      setModels({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [provider, cfg, connection]);

  // Discover automatically when the provider/connection changes or a key is entered (debounced).
  useEffect(() => {
    setModels({ status: "idle" });
    if (!canDiscover) return;
    const t = setTimeout(discover, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, connection, cfg.apiKey, cfg.baseURL, canDiscover]);

  const save = () => {
    saved.update({ connection, provider, configs, serverModels, rememberKeys });
    useGraphStore.getState().setToast(null); // any "set up AI" error is now stale
    onClose();
  };

  const modelKnown = models.status !== "ok" || !model || models.models.some((m) => m.id === model);
  // While typing a partial name, narrow the list to matches.
  const q = model.toLowerCase();
  const shown =
    models.status !== "ok" ? [] : modelKnown ? models.models : models.models.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__body settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <h3>AI settings</h3>

        <fieldset className="choice">
          <legend>Connection</legend>
          <label>
            <input type="radio" checked={connection === "browser"} onChange={() => setConnection("browser")} />
            <span>
              <b>Directly from this browser</b>
              <span className="muted small">Paste your own API key. No server needed.</span>
            </span>
          </label>
          <label>
            <input type="radio" checked={connection === "server"} onChange={() => setConnection("server")} />
            <span>
              <b>Through the local NodeStorm server</b>
              <span className="muted small">Keys stay in <code>server/.env</code>; run <code>npm run dev</code>.</span>
            </span>
          </label>
        </fieldset>

        <label className="field">
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderKind)} aria-label="Provider">
            {PROVIDERS.map((p) => {
              const s = server && "providers" in server ? server.providers.find((x) => x.id === p.kind) : undefined;
              const off = connection === "server" && s !== undefined && !s.configured;
              return (
                <option key={p.kind} value={p.kind}>
                  {p.label}{off ? " (no key on server)" : ""}
                </option>
              );
            })}
          </select>
        </label>

        {connection === "server" && server && "error" in server && <p className="error small">{server.error}</p>}
        {connection === "server" && serverInfo && !serverInfo.configured && (
          <p className="error small">The server has no key for {meta.label}. Add it to server/.env and restart, or use browser mode.</p>
        )}

        {connection === "browser" && meta.needsKey && (
          <>
            <label className="field">
              <span>
                API key
                {meta.keyUrl && (
                  <> · <a href={meta.keyUrl} target="_blank" rel="noreferrer">get one</a></>
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
                  aria-label="API key"
                />
                <button type="button" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button>
              </div>
            </label>
            {meta.defaultBaseURL && (
              <label className="field">
                Base URL
                <input
                  value={cfg.baseURL ?? ""}
                  onChange={(e) => setCfg({ baseURL: e.target.value.trim() || undefined })}
                  placeholder={meta.defaultBaseURL}
                  aria-label="Base URL"
                />
              </label>
            )}
            {provider === "anthropic" && (
              <label className="check">
                <input type="checkbox" checked={Boolean(cfg.webSearch)} onChange={(e) => setCfg({ webSearch: e.target.checked })} />
                Let Claude search the web when naming and relating concepts
              </label>
            )}
          </>
        )}

        <label className="field">
          <span>
            Model
            {models.status === "ok" && <span className="muted"> · {models.models.length} available</span>}
          </span>
          <div className="row">
            <input
              list="model-options"
              value={model}
              onChange={(e) => setModel(e.target.value.trim())}
              placeholder={`${defaultModel} (default)`}
              aria-label="Model"
              spellCheck={false}
            />
            <button type="button" onClick={discover} disabled={!canDiscover || models.status === "loading"}>
              {models.status === "loading" ? "Loading…" : "Refresh"}
            </button>
          </div>
          <datalist id="model-options">
            {models.status === "ok" && models.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </datalist>
          {models.status === "error" && <span className="error small" data-testid="models-error">{models.message}</span>}
          {models.status === "ok" && <span className="ok small" data-testid="models-ok">✓ Connected — type to filter, or pick from the list.</span>}
          {!modelKnown && shown.length === 0 && <span className="warn small">This model isn't in the provider's list; check the spelling.</span>}
          {!canDiscover && connection === "browser" && <span className="muted small">Enter a key to load the model list.</span>}
        </label>

        {shown.length > 0 && (
          <ul className="model-list" aria-label="Available models">
            {shown.map((m) => (
              <li key={m.id}>
                <button type="button" className={m.id === (model || defaultModel) ? "model model--on" : "model"} onClick={() => setModel(m.id)}>
                  {m.label && m.label !== m.id ? <><b>{m.label}</b> <span className="muted">{m.id}</span></> : m.id}
                </button>
              </li>
            ))}
          </ul>
        )}

        {connection === "browser" && meta.needsKey && (
          <div className="keynote">
            <label className="check">
              <input type="checkbox" checked={rememberKeys} onChange={(e) => setRememberKeys(e.target.checked)} />
              Remember keys on this device
            </label>
            <p className="muted small">
              Your key is only sent to {meta.label}. {rememberKeys
                ? "It's kept in this browser's local storage until you remove it — only do this on your own device."
                : "It's kept for this tab only and forgotten when you close it."}{" "}
              Use a separate key with a spending limit, which you can revoke any time.
            </p>
            <button type="button" className="link small" onClick={() => { saved.forgetKeys(); setConfigs(useSettings.getState().configs); }}>
              Forget all saved keys
            </button>
          </div>
        )}

        <div className="form__actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
