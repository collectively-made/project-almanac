import { useEffect, useState } from "react";

interface SetupStatus {
  status: string;
  has_model: boolean;
  model_loaded: boolean;
  available_models: { name: string; size_mb: number }[];
  indexed_chunks: number;
  hardware: { ram_gb: number; cpu_count: number; gpu?: string; unified_memory?: boolean };
  recommended_models: {
    name: string;
    provider: string;
    parameters: string;
    quantization: string;
    context_length: number;
    min_ram_gb: number;
    score: number;
    estimated_tps: number;
    fit_level: string;
    gguf_repo: string;
    gguf_url: string;
    use_case: string;
  }[];
}

interface SetupProps {
  onReady: () => void;
}

type Step = "loading" | "needs-model" | "has-model" | "loading-model";

export function Setup({ onReady }: SetupProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");

  const fetchStatus = async () => {
    try {
      const r = await fetch("/api/setup/status");
      const data = await r.json();
      setStatus(data);
      if (data.status === "ready") onReady();
      else if (data.status === "model_available") setStep("has-model");
      else setStep("needs-model");
    } catch {
      setError("Cannot connect to backend");
      setStep("needs-model");
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 4000);
    return () => clearInterval(id);
  }, []);

  const handleLoad = async (name: string) => {
    setStep("loading-model");
    setError("");
    try {
      const r = await fetch("/api/models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (r.ok) onReady();
      else {
        const d = await r.json();
        setError(d.detail || "Failed to load model");
        setStep("has-model");
      }
    } catch {
      setError("Failed to load model");
      setStep("has-model");
    }
  };

  return (
    <div className="su-page">
      <div className="su-card">
        {/* Header */}
        <div className="su-header">
          <div className="su-mark" />
          <div>
            <h1 className="su-title">ALMANAC</h1>
            <p className="su-sub">Offline survival knowledge, grounded in real sources</p>
          </div>
        </div>

        {/* Loading */}
        {step === "loading" && (
          <div className="su-center">
            <div className="su-spinner" />
            <p className="su-text">Connecting...</p>
          </div>
        )}

        {/* Loading model into memory */}
        {step === "loading-model" && (
          <div className="su-center">
            <div className="su-spinner" />
            <p className="su-text">Loading model into memory...</p>
            <p className="su-muted">This takes 10–30 seconds depending on your hardware.</p>
          </div>
        )}

        {/* Has model in volume — just needs to load */}
        {step === "has-model" && status && (
          <>
            <div className="su-section">
              <div className="su-label">MODEL FOUND</div>
              <p className="su-muted" style={{ marginBottom: 12 }}>
                A model is available and ready to load.
              </p>
              {status.available_models.map((m) => (
                <div key={m.name} className="su-model-row">
                  <div>
                    <span className="su-model-name">{m.name}</span>
                    <span className="su-model-badge">{Math.round(m.size_mb)} MB</span>
                  </div>
                  <button className="su-btn" onClick={() => handleLoad(m.name)}>
                    Load & Start
                  </button>
                </div>
              ))}
            </div>
            {error && <p className="su-error">{error}</p>}
          </>
        )}

        {/* Needs model — show options */}
        {step === "needs-model" && status && (
          <>
            {/* Hardware info */}
            <div className="su-hw">
              {status.hardware.ram_gb} GB RAM · {status.hardware.cpu_count} CPUs
              {status.hardware.gpu ? ` · ${status.hardware.gpu}` : ""}
              {" · "}{status.indexed_chunks} knowledge chunks
            </div>

            {/* Option 1: Recommended models from llmfit database */}
            {status.recommended_models.length > 0 && (
              <div className="su-section">
                <div className="su-label">RECOMMENDED FOR YOUR HARDWARE</div>
                <p className="su-muted" style={{ marginBottom: 12, fontSize: 12 }}>
                  Scored by quality, speed, and memory fit. Click a model to visit its download page.
                </p>
                {status.recommended_models.map((m) => (
                  <div key={m.name} className="su-model-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span className="su-model-name">{m.name.split("/").pop()}</span>
                        <span className="su-model-badge">{m.parameters}</span>
                        <span className="su-model-badge" style={{ borderColor: "var(--sage-dim)", color: "var(--sage-bright)" }}>{m.fit_level}</span>
                      </div>
                      <p className="su-model-desc">
                        {m.provider} · {m.quantization} · {m.min_ram_gb} GB RAM · ~{Math.round(m.estimated_tps)} tok/s
                      </p>
                    </div>
                    <a href={m.gguf_url} target="_blank" rel="noopener" className="su-btn-link">
                      Get model ↗
                    </a>
                  </div>
                ))}
              </div>
            )}

            {/* Option 2: Already have a model */}
            {status.available_models.length > 0 && (
              <div className="su-section">
                <div className="su-label">MODELS IN VOLUME</div>
                {status.available_models.map((m) => (
                  <div key={m.name} className="su-model-row">
                    <div>
                      <span className="su-model-name">{m.name}</span>
                      <span className="su-model-badge">{Math.round(m.size_mb)} MB</span>
                    </div>
                    <button className="su-btn" onClick={() => handleLoad(m.name)}>
                      Load
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Option 3: Manual instructions */}
            <div className="su-section">
              <div className="su-label">ADD YOUR OWN MODEL</div>
              <div className="su-instructions">
                <p>Place a GGUF model file in the models volume:</p>
                <code className="su-code">
                  {typeof window !== "undefined" && window.location.port === "5173"
                    ? "models/"
                    : "/app/models/"
                  }
                </code>
                <p>Then refresh this page. Recommended sources:</p>
                <ul>
                  <li>
                    <a href="https://huggingface.co/models?search=gguf" target="_blank" rel="noopener">
                      HuggingFace GGUF models ↗
                    </a>
                  </li>
                </ul>
                <p className="su-tip">
                  Look for Q4_K_M quantization. 3B models work on 8GB RAM, 7B models need 16GB+.
                </p>
              </div>
            </div>

            {error && <p className="su-error">{error}</p>}
          </>
        )}
      </div>

      <style>{`
        .su-page { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; animation:fadeInUp 0.4s ease; }
        .su-card { max-width:500px; width:100%; background:var(--bg-elevated); border:1px solid var(--border); border-radius:10px; padding:32px; }
        .su-header { display:flex; align-items:center; gap:14px; margin-bottom:24px; }
        .su-mark { width:5px; height:32px; background:var(--accent); border-radius:2px; flex-shrink:0; }
        .su-title { font-family:var(--font-mono); font-size:18px; font-weight:500; letter-spacing:0.14em; color:var(--text-bright); }
        .su-sub { font-size:13px; color:var(--text-muted); margin-top:3px; }

        .su-hw { font-family:var(--font-mono); font-size:11px; color:var(--text-dim); margin-bottom:20px; padding:8px 12px; background:var(--bg); border:1px solid var(--border); border-radius:6px; }

        .su-section { margin-bottom:20px; }
        .su-label { font-family:var(--font-mono); font-size:9.5px; font-weight:500; color:var(--text-dim); letter-spacing:0.12em; margin-bottom:10px; text-transform:uppercase; }
        .su-muted { font-size:13px; color:var(--text-muted); line-height:1.5; }

        .su-model-row { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:var(--bg); border:1px solid var(--border); border-radius:8px; margin-bottom:8px; gap:12px; }
        .su-model-name { font-family:var(--font-mono); font-size:13px; color:var(--text); font-weight:500; }
        .su-model-badge { font-family:var(--font-mono); font-size:10px; color:var(--accent); margin-left:8px; padding:1px 6px; border:1px solid var(--accent-dim); border-radius:3px; }
        .su-model-desc { font-size:12px; color:var(--text-muted); margin-top:2px; }
        .su-model-size { font-family:var(--font-mono); font-size:11px; color:var(--text-dim); margin-top:2px; }

        .su-btn { padding:8px 16px; background:var(--accent); color:var(--bg); border:none; border-radius:6px; font-family:var(--font-mono); font-size:12px; font-weight:500; cursor:pointer; flex-shrink:0; transition:filter 0.15s; letter-spacing:0.04em; }
        .su-btn:hover { filter:brightness(1.1); }
        .su-btn-link { padding:8px 14px; background:none; color:var(--accent); border:1px solid var(--accent); border-radius:6px; font-family:var(--font-mono); font-size:11px; font-weight:500; text-decoration:none; flex-shrink:0; transition:all 0.15s; white-space:nowrap; }
        .su-btn-link:hover { background:var(--accent); color:var(--bg); }

        .su-instructions { font-size:13px; color:var(--text-muted); line-height:1.6; }
        .su-instructions p { margin-bottom:8px; }
        .su-instructions ul { margin:0 0 8px 20px; }
        .su-instructions a { color:var(--accent); text-decoration:none; }
        .su-instructions a:hover { text-decoration:underline; }
        .su-code { display:block; font-family:var(--font-mono); font-size:12px; background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:8px 12px; margin:6px 0 12px; color:var(--text-bright); }
        .su-tip { font-size:11px; color:var(--text-dim); font-style:italic; }

        .su-center { text-align:center; padding:20px 0; }
        .su-text { font-size:14px; color:var(--text); margin-bottom:6px; }
        .su-spinner { width:24px; height:24px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 16px; }
        @keyframes spin { to { transform:rotate(360deg); } }

        .su-error { font-size:12px; color:var(--danger); margin-top:8px; text-align:center; }
      `}</style>
    </div>
  );
}
