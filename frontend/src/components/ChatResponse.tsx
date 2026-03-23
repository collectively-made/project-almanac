import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Source {
  source: string;
  section: string;
  excerpt?: string;
  score?: number;
}

interface Document {
  title: string;
  filename: string;
  pack_id: string;
  url: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  documents?: Document[];
  confidence?: number;
  grounded?: boolean;
}

interface ChatResponseProps {
  message: Message;
  isLatest?: boolean;
}

/* ─── Sources Accordion ─── */

function SourcesAccordion({ sources, documents, confidence, grounded }: {
  sources: Source[];
  documents?: Document[];
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
    <div className="src-accordion">
      <button className={`src-toggle ${open ? "is-open" : ""}`} onClick={() => setOpen(!open)}>
        <div className="src-pills">
          {/* Overlapping icon pill */}
          <span className="src-icon-pill">
            <span className="src-icon-stack">
              <svg className="src-icon-base" width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M4 1.5h6l3 3V13a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13V3A1.5 1.5 0 014 1.5z" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M10 1.5V5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {documents && documents.length > 0 && (
                <svg className="src-icon-overlap" width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4.5A1.5 1.5 0 013.5 3h5A1.5 1.5 0 0110 4.5v.5h1.5A1.5 1.5 0 0113 6.5v6a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 015 12.5V12H3.5A1.5 1.5 0 012 10.5z" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M7 9h3M7 11h2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.5"/>
                </svg>
              )}
            </span>
          </span>
          {/* Summary text */}
          <span className="src-summary-text">
            {sources.length} source{sources.length !== 1 ? "s" : ""}
            {documents && documents.length > 0 && (
              <> · {documents.length} doc{documents.length !== 1 ? "s" : ""}</>
            )}
          </span>
          <span className="src-pill src-pill-status" style={{ color: statusColor, borderColor: statusColor }}>
            {statusLabel} {pct}%
          </span>
        </div>
        <svg className={`src-chev ${open ? "is-open" : ""}`} width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="src-expanded">
          <div className="src-explain" style={{ color: statusColor }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <span>{statusExplain}</span>
          </div>
          {sources.map((s, i) => (
            <SourceRow key={i} source={s} />
          ))}

          {documents && documents.length > 0 && (
            <div className="src-docs-section">
              <div className="src-docs-label">DOCUMENTS</div>
              {documents.map((doc, i) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noopener"
                  className="src-doc-row"
                >
                  <svg className="src-doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M4 1.5h6l3 3V13a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13V3A1.5 1.5 0 014 1.5z" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M10 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  <span className="src-doc-title">{doc.title}</span>
                  <span className="src-doc-file">{doc.filename}</span>
                  <svg className="src-doc-arrow" width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M5 11L11 5M11 5H6M11 5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Source Icon ─── */

function SourceIcon({ source }: { source: string }) {
  let color = "var(--accent)";
  if (source.includes("USDA")) color = "var(--sage-bright)";
  else if (source.includes("FEMA") || source.includes("CDC")) color = "#6b9ede";
  else if (source.includes("Extension")) color = "var(--accent)";
  else if (source.includes("Peace Corps")) color = "#c27adb";
  else if (source.includes("Army") || source.includes("FM ")) color = "#8a9a6b";

  return (
    <svg className="src-row-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color }}>
      <path d="M4 1.5h6l3 3V13a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13V3A1.5 1.5 0 014 1.5z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M10 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M5.5 8h5M5.5 10.5h3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    </svg>
  );
}

/* ─── Source Row ─── */

function SourceRow({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  const hasExcerpt = !!source.excerpt;

  return (
    <div className="src-item">
      <button
        className="src-row"
        onClick={() => hasExcerpt && setExpanded(!expanded)}
        style={{ cursor: hasExcerpt ? "pointer" : "default" }}
      >
        <svg
          className={`src-row-chev ${expanded ? "is-open" : ""}`}
          width="10" height="10" viewBox="0 0 16 16" fill="none"
          style={{ opacity: hasExcerpt ? 1 : 0 }}
        >
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <SourceIcon source={source.source} />
        <span className="src-row-name">{source.source}</span>
        {source.section && (
          <>
            <span className="src-row-sep">·</span>
            <span className="src-row-section">{source.section}</span>
          </>
        )}
      </button>

      {expanded && source.excerpt && (
        <div className="src-excerpt-wrap">
          <div className="src-excerpt">
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
    <div className={`msg ${isUser ? "msg-user" : "msg-ai"}`}>
      {!isUser && (
        <div className="msg-gutter">
          <div className="msg-dot" />
        </div>
      )}

      <div className="msg-body">
        {isUser && <div className="msg-label">YOU</div>}

        <div className={`msg-text ${isUser ? "msg-text-user" : ""}`}>
          {isUser ? (
            message.content
          ) : isThinking ? (
            <span className="thinking">
              <span className="dot" />
              <span className="dot" style={{ animationDelay: "0.15s" }} />
              <span className="dot" style={{ animationDelay: "0.3s" }} />
            </span>
          ) : (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">
                      {children}
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ display: "inline", marginLeft: 3, verticalAlign: "middle" }}>
                        <path d="M5 11L11 5M11 5H6M11 5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </a>
                  ),
                }}
              >{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {!isUser && message.confidence !== undefined && message.sources && message.sources.length > 0 && (
          <SourcesAccordion
            sources={message.sources}
            documents={message.documents}
            confidence={message.confidence}
            grounded={message.grounded}
          />
        )}
      </div>

      <style>{`
        /* ── Messages ── */
        .msg {
          display: flex;
          gap: 12px;
          animation: fadeInUp 0.25s ease both;
        }
        .msg-user {
          justify-content: flex-end;
          padding-left: 48px;
        }
        .msg-ai {
          padding-right: 24px;
        }
        .msg-gutter {
          flex-shrink: 0;
          width: 18px;
          display: flex;
          justify-content: center;
          padding-top: 7px;
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
          gap: 12px;
          min-width: 0;
          flex: 1;
        }
        .msg-label {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          color: var(--text-dim);
          letter-spacing: 0.1em;
          text-align: right;
        }
        .msg-text {
          font-size: 14.5px;
          line-height: 1.75;
          color: var(--text);
          overflow-wrap: break-word;
        }
        .msg-text-user {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 10px 2px 10px 10px;
          padding: 10px 16px;
          color: var(--text-bright);
        }
        .thinking {
          display: inline-flex;
          gap: 5px;
          padding: 6px 0;
        }
        .thinking .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--text-muted);
          animation: pulse 1s ease infinite;
        }

        /* ── Sources Accordion ── */
        .src-accordion {
          animation: slideIn 0.3s ease 0.1s both;
        }
        .src-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: calc(100% + 16px);
          margin-left: -8px;
          padding: 7px 10px;
          background: none;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-family: var(--font-body);
          transition: background 0.15s;
        }
        .src-toggle:hover {
          background: rgba(255,255,255,0.035);
        }
        .src-toggle.is-open {
          background: rgba(255,255,255,0.02);
        }
        .src-toggle:hover .src-chev {
          color: var(--text-muted);
        }

        /* Pills */
        .src-pills {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .src-icon-pill {
          display: flex;
          align-items: center;
        }
        .src-icon-stack {
          display: flex;
          align-items: center;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 4px 6px;
          gap: 0;
          color: var(--text-muted);
        }
        .src-icon-base { flex-shrink: 0; }
        .src-icon-overlap { flex-shrink: 0; margin-left: -4px; }
        .src-summary-text {
          font-size: 12.5px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-weight: 500;
        }
        .src-pill-status {
          display: inline-flex;
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          padding: 4px 11px;
          border-radius: 20px;
          line-height: 1.3;
          border: 1px solid;
          background: none;
        }

        /* Chevrons */
        .src-chev {
          color: var(--text-dim);
          transition: transform 0.2s ease, color 0.15s;
          flex-shrink: 0;
        }
        .src-chev.is-open {
          transform: rotate(180deg);
        }

        /* Expanded */
        .src-expanded {
          padding: 4px 2px 2px;
          animation: fadeInUp 0.2s ease;
        }
        .src-explain {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12px;
          line-height: 1.5;
          padding: 4px 0 12px;
          opacity: 0.8;
        }

        /* Source items */
        .src-item + .src-item {
          border-top: 1px solid var(--border);
        }
        .src-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 4px;
          background: none;
          border: none;
          color: inherit;
          font-family: var(--font-body);
          text-align: left;
          border-radius: 4px;
          transition: background 0.1s;
        }
        .src-row:hover {
          background: rgba(255,255,255,0.025);
        }
        .src-row-chev {
          color: var(--text-dim);
          flex-shrink: 0;
          transition: transform 0.15s ease;
        }
        .src-row-chev.is-open {
          transform: rotate(90deg);
        }
        .src-row-icon {
          flex-shrink: 0;
        }
        .src-row-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .src-row-sep {
          color: var(--text-dim);
          flex-shrink: 0;
          font-size: 12px;
        }
        .src-row-section {
          font-size: 13px;
          color: var(--text-dim);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Excerpt */
        .src-excerpt-wrap {
          padding: 2px 0 8px 22px;
          animation: fadeInUp 0.15s ease;
        }
        .src-excerpt {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: 2px solid var(--accent);
          border-radius: 0 6px 6px 0;
          padding: 10px 14px;
        }
        .src-excerpt p {
          font-size: 12.5px;
          line-height: 1.7;
          color: var(--text-muted);
          margin: 0;
        }

        /* Documents section */
        .src-docs-section {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--border);
        }
        .src-docs-label {
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 500;
          color: var(--text-dim);
          letter-spacing: 0.12em;
          margin-bottom: 6px;
        }
        .src-doc-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 4px;
          text-decoration: none;
          border-radius: 4px;
          transition: background 0.1s;
        }
        .src-doc-row:hover {
          background: rgba(255,255,255,0.025);
        }
        .src-doc-row + .src-doc-row {
          border-top: 1px solid var(--border);
        }
        .src-doc-icon {
          color: var(--accent);
          flex-shrink: 0;
          opacity: 0.7;
        }
        .src-doc-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .src-doc-file {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-dim);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .src-doc-arrow {
          color: var(--text-dim);
          flex-shrink: 0;
          margin-left: auto;
        }
        .src-doc-row:hover .src-doc-arrow {
          color: var(--accent);
        }
      `}</style>
    </div>
  );
}
