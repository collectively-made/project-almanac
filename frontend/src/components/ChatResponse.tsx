import { useState } from "react";
import ReactMarkdown from "react-markdown";

interface Source {
  source: string;
  section: string;
  excerpt?: string;
  score?: number;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  confidence?: number;
  grounded?: boolean;
}

interface ChatResponseProps {
  message: Message;
  isLatest?: boolean;
}

/* ─── Sources Accordion ─── */

function SourcesAccordion({ sources, confidence, grounded }: {
  sources: Source[];
  confidence: number;
  grounded?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const pct = Math.round(confidence * 100);
  let statusColor = "var(--danger)";
  let statusLabel = "Low";
  let statusExplain = "Few relevant sources found. Verify this information independently.";
  if (grounded === false) {
    statusColor = "var(--danger)";
    statusLabel = "Unverified";
    statusExplain = "No sufficiently relevant sources found in the knowledge base. This response may not be reliable.";
  } else if (confidence >= 0.65) {
    statusColor = "var(--sage-bright)";
    statusLabel = "Grounded";
    statusExplain = "Strong match found across multiple sources. Response is well-supported by the knowledge base.";
  } else if (confidence >= 0.4) {
    statusColor = "var(--accent)";
    statusLabel = "Partial";
    statusExplain = "Some relevant sources found, but coverage is incomplete. Consider verifying key details.";
  }

  return (
    <div className="sources-accordion">
      {/* Toggle bar — pills + chevron */}
      <button className={`sources-toggle ${open ? "sources-toggle-open" : ""}`} onClick={() => setOpen(!open)}>
        <div className="sources-pills">
          <span className="pill pill-sources">
            {sources.length} source{sources.length !== 1 ? "s" : ""}
          </span>
          <span className="pill pill-confidence" style={{ color: statusColor, borderColor: statusColor }}>
            {statusLabel} {pct}%
          </span>
        </div>
        <svg
          className={`sources-chevron ${open ? "open" : ""}`}
          width="14" height="14" viewBox="0 0 16 16" fill="none"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="sources-expand">
          {/* Confidence explanation */}
          <div className="confidence-explain" style={{ color: statusColor }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <span>{statusExplain}</span>
          </div>

          {/* Source rows */}
          {sources.map((s, i) => (
            <SourceRow key={i} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceIcon({ source }: { source: string }) {
  // Different icon colors by source type — extensible for future categories
  let color = "var(--accent)";
  if (source.includes("USDA")) color = "var(--sage-bright)";
  else if (source.includes("FEMA") || source.includes("CDC")) color = "#6b9ede";
  else if (source.includes("Extension")) color = "var(--accent)";
  else if (source.includes("Peace Corps")) color = "#c27adb";
  else if (source.includes("Army") || source.includes("FM ")) color = "#8a9a6b";

  return (
    <svg className="source-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color }}>
      <path d="M4 1.5h6l3 3V13a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13V3A1.5 1.5 0 014 1.5z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M10 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M5.5 8h5M5.5 10.5h3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
    </svg>
  );
}

function SourceRow({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  const hasExcerpt = !!source.excerpt;

  return (
    <div className="source-item">
      <button
        className="source-row"
        onClick={() => hasExcerpt && setExpanded(!expanded)}
        style={{ cursor: hasExcerpt ? "pointer" : "default" }}
      >
        <svg
          className={`source-row-chevron ${expanded ? "expanded" : ""}`}
          width="10" height="10" viewBox="0 0 16 16" fill="none"
          style={{ opacity: hasExcerpt ? 1 : 0 }}
        >
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <SourceIcon source={source.source} />
        <span className="source-name">{source.source}</span>
        {source.section && (
          <>
            <span className="source-sep">·</span>
            <span className="source-section">{source.section}</span>
          </>
        )}
      </button>

      {expanded && source.excerpt && (
        <div className="source-excerpt-wrap">
          <div className="source-excerpt-card">
            <p>{source.excerpt}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Chat Response ─── */

export function ChatResponse({ message, isLatest }: ChatResponseProps) {
  const isUser = message.role === "user";
  const isThinking = !isUser && !message.content && isLatest;

  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-assistant"}`}>
      {!isUser && (
        <div className="msg-indicator">
          <div className="msg-dot" />
        </div>
      )}

      <div className="msg-body">
        {isUser && <div className="msg-role">YOU</div>}

        <div className={`msg-content ${isUser ? "msg-content-user" : ""}`}>
          {isUser ? (
            message.content
          ) : isThinking ? (
            <span className="thinking">
              <span className="thinking-dot" />
              <span className="thinking-dot" style={{ animationDelay: "0.15s" }} />
              <span className="thinking-dot" style={{ animationDelay: "0.3s" }} />
            </span>
          ) : (
            <div className="markdown-body">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {!isUser && message.confidence !== undefined && message.sources && message.sources.length > 0 && (
          <SourcesAccordion
            sources={message.sources}
            confidence={message.confidence}
            grounded={message.grounded}
          />
        )}
      </div>

      <style>{`
        .msg {
          display: flex;
          gap: 12px;
          animation: fadeInUp 0.25s ease both;
          max-width: 100%;
        }
        .msg-user {
          justify-content: flex-end;
          padding-left: 40px;
        }
        .msg-assistant {
          padding-right: 20px;
        }
        .msg-indicator {
          flex-shrink: 0;
          width: 20px;
          display: flex;
          justify-content: center;
          padding-top: 6px;
        }
        .msg-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--sage);
        }
        .msg-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
          max-width: 100%;
          flex: 1;
        }
        .msg-role {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          color: var(--text-dim);
          letter-spacing: 0.1em;
          text-align: right;
        }
        .msg-content {
          font-size: 14.5px;
          line-height: 1.75;
          color: var(--text);
          overflow-wrap: break-word;
        }
        .msg-content-user {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px 8px 2px 8px;
          padding: 10px 16px;
          color: var(--text-bright);
          font-size: 14.5px;
          line-height: 1.6;
        }
        .thinking {
          display: inline-flex;
          gap: 4px;
          padding: 4px 0;
        }
        .thinking-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--text-muted);
          animation: pulse 1s ease infinite;
        }

        /* ─── Sources Accordion ─── */
        .sources-accordion {
          animation: slideIn 0.3s ease 0.1s both;
        }
        .sources-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 6px 10px;
          margin: 0 -10px;
          width: calc(100% + 20px);
          background: none;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-family: var(--font-body);
          transition: background 0.15s;
        }
        .sources-toggle:hover {
          background: rgba(255,255,255,0.03);
        }
        .sources-toggle:hover .sources-chevron {
          color: var(--text-muted);
        }
        .sources-toggle-open {
          background: rgba(255,255,255,0.02);
        }
        .sources-pills {
          display: flex;
          gap: 6px;
        }
        .pill {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 500;
          padding: 3px 10px;
          border-radius: 20px;
          letter-spacing: 0.02em;
          line-height: 1.4;
        }
        .pill-sources {
          color: var(--text-muted);
          border: 1px solid var(--border-light);
        }
        .pill-confidence {
          border: 1px solid;
          background: none;
        }
        .sources-chevron {
          color: var(--text-dim);
          transition: transform 0.2s ease, color 0.15s;
          flex-shrink: 0;
        }
        .sources-chevron.open {
          transform: rotate(180deg);
        }

        /* Expanded content */
        .sources-expand {
          padding: 6px 0 2px;
          animation: fadeInUp 0.2s ease;
        }
        .confidence-explain {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          font-size: 11.5px;
          line-height: 1.5;
          padding: 6px 2px 10px;
          opacity: 0.85;
        }

        .source-item + .source-item {
          border-top: 1px solid var(--border);
        }

        .source-row {
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          padding: 7px 2px;
          background: none;
          border: none;
          color: inherit;
          font-family: var(--font-body);
          text-align: left;
          border-radius: 4px;
          transition: background 0.1s;
        }
        .source-row:hover {
          background: rgba(255,255,255,0.025);
        }
        .source-row-chevron {
          color: var(--text-dim);
          flex-shrink: 0;
          transition: transform 0.15s ease;
        }
        .source-row-chevron.expanded {
          transform: rotate(90deg);
        }
        .source-icon {
          flex-shrink: 0;
        }
        .source-name {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .source-sep {
          color: var(--text-dim);
          flex-shrink: 0;
          font-size: 12px;
        }
        .source-section {
          font-size: 12.5px;
          color: var(--text-dim);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Expanded excerpt */
        .source-excerpt-wrap {
          padding: 4px 0 8px 19px;
          animation: fadeInUp 0.15s ease;
        }
        .source-excerpt-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: 2px solid var(--accent);
          border-radius: 0 6px 6px 0;
          padding: 10px 14px;
        }
        .source-excerpt-card p {
          font-size: 12px;
          line-height: 1.65;
          color: var(--text-muted);
          margin: 0;
        }
      `}</style>
    </div>
  );
}
