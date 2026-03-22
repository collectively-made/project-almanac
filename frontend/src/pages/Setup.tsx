import { useEffect, useState } from "react";

interface SetupStatus {
  status: string;
  has_model: boolean;
  model_loaded: boolean;
  available_models: { name: string; size_mb: number }[];
  indexed_chunks: number;
  hardware: { ram_gb: number; cpu_count: number };
  recommended_models: {
    name: string;
    description: string;
    size_gb: number;
    url: string;
    parameters: string;
  }[];
}

interface SetupProps {
  onReady: () => void;
}

export function Setup({ onReady }: SetupProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<"loading" | "welcome" | "downloading" | "load" | "loading-model">("loading");
  const [downloadProgress, setDownloadProgress] = useState("");
  const [error, setError] = useState("");

  const fetchStatus = async () => {
    try {
      const r = await fetch("/api/setup/status");
      const data = await r.json();
      setStatus(data);
      if (data.status === "ready") {
        onReady();
      } else if (data.status === "model_available") {
        setStep("load");
      } else {
        setStep("welcome");
      }
    } catch {
      setError("Cannot connect to backend. Is it running?");
      setStep("welcome");
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll while on loading/welcome — auto-download may complete on backend
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleQuickStart = async () => {
    if (!status || status.recommended_models.length === 0) return;
    const model = status.recommended_models[0]; // Best match for hardware
    setStep("downloading");
    setDownloadProgress("Connecting...");
    setError("");

    try {
      const r = await fetch("/api/setup/download-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: model.url, filename: model.name }),
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
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
            if (data.event === "progress") {
              setDownloadProgress(
                data.stage === "complete"
                  ? "Download complete. Loading model..."
                  : `Downloading AI model (${data.size_mb ? data.size_mb + " MB" : "this may take a few minutes"})...`
              );
            } else if (data.event === "done") {
              setDownloadProgress("Download complete. Loading model...");
              await handleAutoLoad(model.name);
            } else if (data.event === "error") {
              setError(data.message);
              setStep("welcome");
            }
          } catch {}
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
      setStep("welcome");
    }
  };

  const handleAutoLoad = async (name: string) => {
    setStep("loading-model");
    try {
      const r = await fetch("/api/models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        onReady();
      } else {
        const d = await r.json();
        setError(d.detail || "Failed to load model");
        setStep("welcome");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setStep("welcome");
    }
  };

  const handleLoadExisting = async () => {
    if (!status || status.available_models.length === 0) return;
    await handleAutoLoad(status.available_models[0].name);
  };

  const bestModel = status?.recommended_models?.[0];

  return (
    <div className="setup-page">
      <div className="setup-card">
        {/* Header — always visible */}
        <div className="setup-header">
          <div className="setup-mark" />
          <div>
            <h1 className="setup-title">ALMANAC</h1>
            <p className="setup-sub">Offline survival knowledge, grounded in real sources</p>
          </div>
        </div>

        {/* Step: Loading / auto-setup in progress */}
        {step === "loading" && (
          <div className="setup-center">
            <div className="setup-spinner" />
            <p className="setup-status-text">Setting up Almanac...</p>
            <p className="setup-status-sub">
              If this is the first run, the AI model is being downloaded automatically.
              This may take a few minutes.
            </p>
          </div>
        )}

        {/* Step: Welcome — needs model */}
        {step === "welcome" && (
          <>
            <div className="setup-steps">
              <div className="setup-step done">
                <div className="step-num">1</div>
                <div className="step-info">
                  <span className="step-title">Server running</span>
                  <span className="step-detail">
                    {status ? `${status.hardware.ram_gb} GB RAM · ${status.indexed_chunks} knowledge chunks loaded` : ""}
                  </span>
                </div>
              </div>
              <div className="setup-step active">
                <div className="step-num">2</div>
                <div className="step-info">
                  <span className="step-title">Install an AI model</span>
                  <span className="step-detail">
                    {bestModel
                      ? `Recommended: ${bestModel.description} (${bestModel.size_gb} GB download)`
                      : "A language model is needed for answering questions"}
                  </span>
                </div>
              </div>
              <div className="setup-step">
                <div className="step-num">3</div>
                <div className="step-info">
                  <span className="step-title">Start asking questions</span>
                </div>
              </div>
            </div>

            {bestModel && (
              <button className="setup-cta" onClick={handleQuickStart}>
                Download & Start
              </button>
            )}

            <details className="setup-advanced">
              <summary>Advanced: use your own model</summary>
              <p>
                Place any GGUF model file in the <code>models</code> volume directory, then restart.
                Recommended: 3B–7B parameter models in Q4 quantization.
              </p>
            </details>

            {error && <p className="setup-error">{error}</p>}
          </>
        )}

        {/* Step: Downloading */}
        {step === "downloading" && (
          <div className="setup-center">
            <div className="setup-spinner" />
            <p className="setup-status-text">{downloadProgress}</p>
            <p className="setup-status-sub">This is a one-time download. The model runs entirely on your device.</p>
          </div>
        )}

        {/* Step: Model available, loading */}
        {step === "load" && (
          <div className="setup-center">
            <p className="setup-status-text">Model found. Ready to load.</p>
            {status && status.available_models.length > 0 && (
              <p className="setup-status-sub">{status.available_models[0].name}</p>
            )}
            <button className="setup-cta" onClick={handleLoadExisting}>
              Load & Start
            </button>
            {error && <p className="setup-error">{error}</p>}
          </div>
        )}

        {/* Step: Loading model into memory */}
        {step === "loading-model" && (
          <div className="setup-center">
            <div className="setup-spinner" />
            <p className="setup-status-text">Loading model into memory...</p>
            <p className="setup-status-sub">This takes 10–30 seconds depending on your hardware.</p>
          </div>
        )}
      </div>

      <style>{`
        .setup-page {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
          animation: fadeInUp 0.4s ease;
        }
        .setup-card {
          max-width: 480px;
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 36px;
        }
        .setup-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 32px;
        }
        .setup-mark {
          width: 5px;
          height: 32px;
          background: var(--accent);
          border-radius: 2px;
          flex-shrink: 0;
        }
        .setup-title {
          font-family: var(--font-mono);
          font-size: 18px;
          font-weight: 500;
          letter-spacing: 0.14em;
          color: var(--text-bright);
          line-height: 1.2;
        }
        .setup-sub {
          font-size: 13px;
          color: var(--text-muted);
          margin-top: 3px;
        }

        /* Steps */
        .setup-steps {
          display: flex;
          flex-direction: column;
          gap: 0;
          margin-bottom: 28px;
        }
        .setup-step {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 12px 0;
          border-bottom: 1px solid var(--border);
          opacity: 0.35;
        }
        .setup-step:last-child { border-bottom: none; }
        .setup-step.done {
          opacity: 0.6;
        }
        .setup-step.active {
          opacity: 1;
        }
        .step-num {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          border: 1px solid var(--border-light);
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-dim);
          flex-shrink: 0;
          margin-top: 1px;
        }
        .setup-step.done .step-num {
          background: var(--sage-dim);
          border-color: var(--sage);
          color: var(--sage-bright);
        }
        .setup-step.active .step-num {
          background: var(--accent-dim);
          border-color: var(--accent);
          color: var(--accent);
        }
        .step-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .step-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--text);
        }
        .step-detail {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.4;
        }

        /* CTA button */
        .setup-cta {
          display: block;
          width: 100%;
          padding: 12px;
          background: var(--accent);
          color: var(--bg);
          border: none;
          border-radius: 8px;
          font-family: var(--font-body);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: filter 0.15s;
          margin-bottom: 16px;
        }
        .setup-cta:hover { filter: brightness(1.1); }

        /* Advanced */
        .setup-advanced {
          font-size: 12px;
          color: var(--text-dim);
        }
        .setup-advanced summary {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.04em;
          padding: 4px 0;
          color: var(--text-muted);
        }
        .setup-advanced summary:hover {
          color: var(--text);
        }
        .setup-advanced p {
          margin-top: 8px;
          line-height: 1.6;
          color: var(--text-muted);
        }
        .setup-advanced code {
          font-family: var(--font-mono);
          background: var(--bg);
          padding: 1px 6px;
          border-radius: 3px;
          font-size: 11px;
        }

        /* Center states */
        .setup-center {
          text-align: center;
          padding: 16px 0;
        }
        .setup-status-text {
          font-size: 14px;
          color: var(--text);
          margin-bottom: 6px;
        }
        .setup-status-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 16px;
          line-height: 1.5;
        }
        .setup-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 16px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .setup-error {
          font-size: 12px;
          color: var(--danger);
          margin-top: 12px;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
