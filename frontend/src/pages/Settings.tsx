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
  const [message, setMessage] = useState("");

  const refresh = () => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    fetch("/api/models").then((r) => r.json()).then(setModels).catch(() => {});
    fetch("/api/provider").then((r) => r.json()).then(setProvider).catch(() => {});
  };

  useEffect(() => { refresh(); }, []);

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
          {models?.models && models.models.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p className="st-note">Available in volume:</p>
              {models.models.map((m) => (
                <div key={m.name} className="st-row">
                  <span className="st-key mono">{m.name}</span>
                  <span className="st-val dim">{Math.round(m.size_mb)} MB</span>
                </div>
              ))}
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
      `}</style>
    </div>
  );
}
