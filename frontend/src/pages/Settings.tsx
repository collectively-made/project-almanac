import { useEffect, useState } from "react";

interface HealthData {
  status: string;
  model_loaded: boolean;
  model_name: string | null;
  model_size_gb: number | null;
  indexed_chunks: number;
}

interface ModelsData {
  models: { name: string; size_mb: number }[];
  active: string | null;
}

interface ProviderData {
  provider: string;
  model: string | null;
  has_api_key: boolean;
}

interface SettingsProps {
  onBack: () => void;
  onProfile?: () => void;
}

export function Settings({ onBack, onProfile }: SettingsProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [provider, setProvider] = useState<ProviderData | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState<"anthropic" | "openai">("anthropic");
  const [saving, setSaving] = useState(false);
  const [unloading, setUnloading] = useState(false);
  const [loadingModel, setLoadingModel] = useState("");
  const [showRecommended, setShowRecommended] = useState(false);
  const [recommended, setRecommended] = useState<{ name: string; parameters: string; min_ram_gb: number; estimated_tps: number; fit_level: string; gguf_url: string; download_url: string; download_filename: string; provider: string; quantization: string }[]>([]);
  const [message, setMessage] = useState("");

  const refresh = () => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    fetch("/api/models").then((r) => r.json()).then(setModels).catch(() => {});
    fetch("/api/provider").then((r) => r.json()).then(setProvider).catch(() => {});
  };

  useEffect(() => { refresh(); }, []);

  const handleLoadModel = async (name: string) => {
    setLoadingModel(name);
    setMessage("");
    try {
      const r = await fetch("/api/models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        setMessage(`Loaded ${name}`);
        setLoadingModel("");
        refresh();
      } else {
        const d = await r.json();
        setMessage(d.detail || "Failed to load");
        setLoadingModel("");
      }
    } catch {
      setMessage("Failed to load model");
      setLoadingModel("");
    }
  };

  const handleShowRecommended = async () => {
    setShowRecommended(true);
    try {
      const r = await fetch("/api/setup/status");
      const data = await r.json();
      setRecommended(data.recommended_models || []);
    } catch { /* silent */ }
  };

  const handleInstallModel = async (model: typeof recommended[0]) => {
    if (!model.download_url || !model.download_filename) {
      window.open(model.gguf_url, "_blank");
      return;
    }
    setLoadingModel(model.download_filename);
    setMessage("Downloading...");
    try {
      const r = await fetch("/api/setup/download-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: model.download_url, filename: model.download_filename }),
      });
      if (!r.ok || !r.body) throw new Error("Download failed");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.event === "done") {
              setMessage("Downloaded! Loading...");
              await handleLoadModel(model.download_filename);
              setShowRecommended(false);
              return;
            } else if (data.event === "error") {
              setMessage(data.message || "Download failed");
              setLoadingModel("");
              return;
            }
          } catch {}
        }
      }
    } catch {
      setMessage("Download failed. Try the manual link.");
      setLoadingModel("");
    }
  };

  const handleUnload = async () => {
    setUnloading(true);
    await fetch("/api/models/unload", { method: "POST" });
    setUnloading(false);
    setMessage("Model unloaded — RAM freed");
    refresh();
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const r = await fetch("/api/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: apiProvider, api_key: apiKey.trim() }),
      });
      if (r.ok) {
        setMessage("Cloud API connected");
        setApiKey("");
        refresh();
      }
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  const handleResetProvider = async () => {
    await fetch("/api/provider", { method: "DELETE" });
    setMessage("Switched to local mode");
    refresh();
  };

  const isCloud = provider?.provider !== "local" && provider?.has_api_key;

  return (
    <div className="st-page">
      <div className="st-inner">
        <div className="st-header">
          <button onClick={onBack} className="st-back" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <h1 className="st-title">SETTINGS</h1>
        </div>

        {message && <div className="st-message">{message}</div>}

        {/* AI Provider */}
        <section className="st-section">
          <div className="st-label">AI PROVIDER</div>
          {isCloud ? (
            <>
              <div className="st-row">
                <span className="st-key">Mode</span>
                <span className="st-val" style={{ color: "var(--accent)" }}>
                  Cloud — {provider?.provider === "anthropic" ? "Anthropic (Claude)" : "OpenAI (GPT)"}
                </span>
              </div>
              <p className="st-note">Queries are sent to {provider?.provider === "anthropic" ? "Anthropic" : "OpenAI"} servers. Knowledge base stays local.</p>
              <button className="st-btn-outline" onClick={handleResetProvider}>
                Switch to local model
              </button>
            </>
          ) : (
            <>
              <div className="st-row">
                <span className="st-key">Mode</span>
                <span className="st-val">Local</span>
              </div>
              <div className="st-cloud-form">
                <p className="st-note" style={{ marginBottom: 8 }}>
                  Or use a cloud API for faster, smarter responses:
                </p>
                <div className="st-toggle">
                  <button className={`st-toggle-btn ${apiProvider === "anthropic" ? "active" : ""}`} onClick={() => setApiProvider("anthropic")}>Anthropic</button>
                  <button className={`st-toggle-btn ${apiProvider === "openai" ? "active" : ""}`} onClick={() => setApiProvider("openai")}>OpenAI</button>
                </div>
                <input
                  type="password"
                  className="st-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiProvider === "anthropic" ? "sk-ant-..." : "sk-..."}
                />
                <button className="st-btn" onClick={handleSaveApiKey} disabled={!apiKey.trim() || saving}>
                  {saving ? "Connecting..." : "Connect"}
                </button>
                <p className="st-privacy">
                  Your questions will be sent to {apiProvider === "anthropic" ? "Anthropic" : "OpenAI"} servers. Knowledge base stays local.
                </p>
              </div>
            </>
          )}
        </section>

        {/* Local Model */}
        <section className="st-section">
          <div className="st-label">LOCAL MODEL</div>
          {health?.model_loaded ? (
            <>
              <div className="st-row">
                <span className="st-key">Active</span>
                <span className="st-val active">{health.model_name}</span>
              </div>
              {health.model_size_gb && (
                <div className="st-row">
                  <span className="st-key">Size</span>
                  <span className="st-val dim">{health.model_size_gb} GB</span>
                </div>
              )}
              <button className="st-btn-outline danger" onClick={handleUnload} disabled={unloading}>
                {unloading ? "Unloading..." : "Unload model (free RAM)"}
              </button>
            </>
          ) : (
            <p className="st-note">No local model loaded</p>
          )}

          {/* Models in volume — with load buttons */}
          {models?.models && models.models.length > 0 && !health?.model_loaded && (
            <div style={{ marginTop: 10 }}>
              <p className="st-note" style={{ marginBottom: 8 }}>Available in volume:</p>
              {models.models.map((m) => (
                <div key={m.name} className="st-model-row">
                  <div>
                    <span className="st-model-name">{m.name}</span>
                    <span className="st-model-badge">{Math.round(m.size_mb)} MB</span>
                  </div>
                  <button
                    className="st-btn-sm"
                    onClick={() => handleLoadModel(m.name)}
                    disabled={!!loadingModel}
                  >
                    {loadingModel === m.name ? "Loading..." : "Load"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* No model at all — show browse recommended */}
          {(!models?.models || models.models.length === 0) && !health?.model_loaded && (
            <div style={{ marginTop: 10 }}>
              {!showRecommended ? (
                <button className="st-btn-outline" onClick={handleShowRecommended}>
                  Browse recommended models
                </button>
              ) : (
                <div>
                  <p className="st-note" style={{ marginBottom: 8 }}>Recommended for your hardware:</p>
                  {recommended.length === 0 && <p className="st-note">Loading recommendations...</p>}
                  {recommended.map((m) => (
                    <div key={m.name} className="st-model-row">
                      <div style={{ minWidth: 0 }}>
                        <span className="st-model-name">{m.name.split("/").pop()}</span>
                        <span className="st-model-badge">{m.parameters}</span>
                        <p className="st-model-meta">{m.provider} · {m.min_ram_gb} GB · ~{Math.round(m.estimated_tps)} tok/s</p>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          className="st-btn-sm"
                          onClick={() => handleInstallModel(m)}
                          disabled={!!loadingModel}
                        >
                          {loadingModel === m.download_filename ? "..." : "Install"}
                        </button>
                        {m.gguf_url && (
                          <a href={m.gguf_url} target="_blank" rel="noopener" className="st-btn-sm-link">↗</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Profile */}
        <section className="st-section">
          <div className="st-label">YOUR PROFILE</div>
          <p className="st-note">Tell Almanac about your situation for personalized answers.</p>
          {onProfile && (
            <button className="st-btn-outline" onClick={onProfile}>Edit Profile</button>
          )}
        </section>

        {/* Knowledge Base */}
        <section className="st-section">
          <div className="st-label">KNOWLEDGE BASE</div>
          <div className="st-row">
            <span className="st-key">Indexed chunks</span>
            <span className="st-val">{health?.indexed_chunks ?? "—"}</span>
          </div>
        </section>

        {/* About */}
        <section className="st-section">
          <div className="st-label">ABOUT</div>
          <div className="st-row">
            <span className="st-key">Version</span>
            <span className="st-val mono">0.1.0</span>
          </div>
          <div className="st-row">
            <span className="st-key">License</span>
            <span className="st-val mono">AGPL-3.0</span>
          </div>
          <a href="https://github.com/collectively-made/project-almanac" target="_blank" rel="noopener" className="st-link">
            GitHub ↗
          </a>
        </section>
      </div>

      <style>{`
        .st-page { min-height:100vh; padding:24px; animation:fadeInUp 0.3s ease; }
        .st-inner { max-width:520px; margin:0 auto; }
        .st-header { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
        .st-back { width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:var(--bg-elevated); color:var(--text-muted); border:1px solid var(--border); border-radius:6px; cursor:pointer; transition:all 0.15s; }
        .st-back:hover { color:var(--text); border-color:var(--border-light); }
        .st-title { font-family:var(--font-mono); font-size:13px; font-weight:500; letter-spacing:0.14em; color:var(--text); }

        .st-message { padding:8px 12px; background:var(--sage-dim); border:1px solid var(--sage); border-radius:6px; font-size:13px; color:var(--sage-bright); margin-bottom:16px; text-align:center; }

        .st-section { margin-bottom:20px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:8px; padding:16px 18px; }
        .st-label { font-family:var(--font-mono); font-size:9.5px; font-weight:500; color:var(--text-dim); letter-spacing:0.14em; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border); }
        .st-row { display:flex; justify-content:space-between; align-items:center; padding:5px 0; font-size:13px; }
        .st-key { color:var(--text-muted); }
        .st-key.mono { font-family:var(--font-mono); font-size:11.5px; }
        .st-val { color:var(--text); }
        .st-val.active { color:var(--sage-bright); font-family:var(--font-mono); font-size:12px; }
        .st-val.dim { color:var(--text-dim); font-size:12px; }
        .st-val.mono { font-family:var(--font-mono); font-size:12px; }
        .st-note { font-size:12.5px; color:var(--text-muted); line-height:1.5; }
        .st-privacy { font-size:11px; color:var(--text-dim); line-height:1.4; margin-top:6px; }
        .st-link { font-family:var(--font-mono); font-size:12px; color:var(--accent); text-decoration:none; display:inline-block; margin-top:4px; }
        .st-link:hover { text-decoration:underline; }

        .st-btn { padding:8px 16px; background:var(--accent); color:var(--bg); border:none; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; transition:filter 0.15s; font-family:var(--font-body); }
        .st-btn:hover { filter:brightness(1.1); }
        .st-btn:disabled { opacity:0.5; cursor:wait; }
        .st-btn-outline { padding:7px 14px; background:none; border:1px solid var(--border-light); border-radius:6px; color:var(--text-muted); font-family:var(--font-mono); font-size:12px; cursor:pointer; transition:all 0.15s; margin-top:8px; }
        .st-btn-outline:hover { border-color:var(--accent); color:var(--text); }
        .st-btn-outline.danger:hover { border-color:var(--danger); color:var(--danger); }

        .st-cloud-form { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
        .st-toggle { display:flex; gap:4px; }
        .st-toggle-btn { flex:1; padding:7px; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text-muted); font-size:12px; cursor:pointer; transition:all 0.15s; font-family:var(--font-body); text-align:center; }
        .st-toggle-btn.active { background:var(--accent-dim); border-color:var(--accent); color:var(--accent); }
        .st-input { width:100%; padding:8px 12px; background:var(--bg-input); border:1px solid var(--border); border-radius:6px; color:var(--text-bright); font-family:var(--font-mono); font-size:13px; outline:none; }
        .st-input:focus { border-color:var(--accent); }
        .st-input::placeholder { color:var(--text-dim); }

        .st-model-row { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--bg); border:1px solid var(--border); border-radius:6px; margin-bottom:6px; gap:10px; }
        .st-model-name { font-family:var(--font-mono); font-size:12px; color:var(--text); font-weight:500; }
        .st-model-badge { font-family:var(--font-mono); font-size:10px; color:var(--accent); margin-left:6px; padding:1px 5px; border:1px solid var(--accent-dim); border-radius:3px; }
        .st-model-meta { font-size:11px; color:var(--text-dim); margin-top:2px; }
        .st-btn-sm { padding:5px 12px; background:var(--accent); color:var(--bg); border:none; border-radius:4px; font-family:var(--font-mono); font-size:11px; font-weight:500; cursor:pointer; transition:filter 0.15s; }
        .st-btn-sm:hover { filter:brightness(1.1); }
        .st-btn-sm:disabled { opacity:0.5; cursor:wait; }
        .st-btn-sm-link { padding:5px 8px; background:none; color:var(--accent); border:1px solid var(--accent); border-radius:4px; font-size:11px; text-decoration:none; transition:all 0.15s; }
        .st-btn-sm-link:hover { background:var(--accent); color:var(--bg); }
      `}</style>
    </div>
  );
}
