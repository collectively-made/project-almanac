import { useEffect, useState } from "react";

interface HealthData {
  status: string;
  model_loaded: boolean;
  model_name: string | null;
  indexed_chunks: number;
}

interface ModelsData {
  models: { name: string; size_mb: number }[];
  active: string | null;
}

interface SettingsProps {
  onBack: () => void;
  onProfile?: () => void;
}

export function Settings({ onBack, onProfile }: SettingsProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [models, setModels] = useState<ModelsData | null>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    fetch("/api/models").then((r) => r.json()).then(setModels).catch(() => {});
  }, []);

  return (
    <div className="settings-page">
      <div className="settings-inner">
        {/* Header */}
        <div className="settings-header">
          <button onClick={onBack} className="settings-back" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <h1 className="settings-title">SETTINGS</h1>
        </div>

        {/* Model */}
        <section className="settings-section">
          <div className="section-label">MODEL</div>
          {health?.model_loaded ? (
            <div className="info-row">
              <span className="info-key">Active</span>
              <span className="info-val active">{health.model_name}</span>
            </div>
          ) : (
            <div className="info-row">
              <span className="info-key">Status</span>
              <span className="info-val dim">Not loaded</span>
            </div>
          )}
          {models?.models.map((m) => (
            <div key={m.name} className="info-row">
              <span className="info-key mono">{m.name}</span>
              <span className="info-val dim">{m.size_mb} MB</span>
            </div>
          ))}
        </section>

        {/* Profile */}
        <section className="settings-section">
          <div className="section-label">YOUR PROFILE</div>
          <p className="info-desc">
            Tell Almanac about your location, household, and setup for personalized answers.
          </p>
          {onProfile && (
            <button className="profile-link" onClick={onProfile}>
              Edit Profile
            </button>
          )}
        </section>

        {/* Content */}
        <section className="settings-section">
          <div className="section-label">KNOWLEDGE BASE</div>
          <div className="info-row">
            <span className="info-key">Indexed chunks</span>
            <span className="info-val">{health?.indexed_chunks ?? "—"}</span>
          </div>
          <div className="info-row">
            <span className="info-key">Sources</span>
            <span className="info-val dim">USDA, FEMA, Extension Service</span>
          </div>
        </section>

        {/* About */}
        <section className="settings-section">
          <div className="section-label">ABOUT</div>
          <div className="info-row">
            <span className="info-key">Version</span>
            <span className="info-val mono">0.1.0</span>
          </div>
          <div className="info-row">
            <span className="info-key">License</span>
            <span className="info-val mono">AGPL-3.0</span>
          </div>
          <div className="info-row">
            <span className="info-key">Source</span>
            <a
              href="https://github.com/alexanderussell/survival-app"
              target="_blank"
              rel="noopener"
              className="info-link"
            >
              github.com/alexanderussell/survival-app
            </a>
          </div>
        </section>
      </div>

      <style>{`
        .settings-page {
          min-height: 100vh;
          padding: 24px;
          animation: fadeInUp 0.3s ease;
        }
        .settings-inner {
          max-width: 520px;
          margin: 0 auto;
        }
        .settings-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 32px;
        }
        .settings-back {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-elevated);
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .settings-back:hover {
          color: var(--text);
          border-color: var(--border-light);
        }
        .settings-title {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.14em;
          color: var(--text);
        }
        .settings-section {
          margin-bottom: 24px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px 18px;
        }
        .section-label {
          font-family: var(--font-mono);
          font-size: 9.5px;
          font-weight: 500;
          color: var(--text-dim);
          letter-spacing: 0.14em;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px 0;
          font-size: 13px;
        }
        .info-key {
          color: var(--text-muted);
        }
        .info-key.mono {
          font-family: var(--font-mono);
          font-size: 11.5px;
        }
        .info-val {
          color: var(--text);
        }
        .info-val.active {
          color: var(--sage-bright);
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .info-val.dim {
          color: var(--text-dim);
          font-size: 12px;
        }
        .info-val.mono {
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .info-link {
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: var(--accent);
          text-decoration: none;
        }
        .info-link:hover {
          text-decoration: underline;
        }
        .info-desc {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.5;
          margin-bottom: 10px;
        }
        .profile-link {
          display: inline-block;
          padding: 7px 16px;
          background: var(--accent-dim);
          color: var(--accent);
          border: 1px solid var(--accent);
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: all 0.15s;
        }
        .profile-link:hover {
          background: var(--accent);
          color: var(--bg);
        }
      `}</style>
    </div>
  );
}
