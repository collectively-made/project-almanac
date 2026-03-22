import { useEffect, useRef, useState } from "react";
import { ChatInput } from "./components/ChatInput";
import { ChatResponse, type Message } from "./components/ChatResponse";
import { Setup } from "./pages/Setup";
import { Settings } from "./pages/Settings";

type Page = "loading" | "setup" | "chat" | "settings";

const SUGGESTED = [
  "How do I safely can tomatoes at home?",
  "What size solar panel system do I need for off-grid?",
  "How do I start raising backyard chickens?",
  "What's the best way to purify well water?",
];

export default function App() {
  const [page, setPage] = useState<Page>("loading");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const checkStatus = () => {
      fetch("/api/setup/status")
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "ready") {
            setPage("chat");
            if (interval) clearInterval(interval);
          } else {
            setPage("setup");
          }
        })
        .catch(() => setPage("setup"));
    };

    checkStatus();
    // Poll every 3s while on setup — catches auto-download completing on backend
    interval = setInterval(checkStatus, 3000);

    return () => clearInterval(interval);
  }, [page]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (text: string) => {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (response.status === 503) {
        setMessages((prev) => {
          const u = [...prev];
          u[u.length - 1] = { role: "assistant", content: "Model is busy or not loaded. Try again shortly." };
          return u;
        });
        return;
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
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
            const parsed = JSON.parse(line.slice(6));
            if (parsed.event === "token") {
              setMessages((prev) => {
                const u = [...prev];
                u[u.length - 1] = { ...u[u.length - 1], content: u[u.length - 1].content + parsed.text };
                return u;
              });
            } else if (parsed.event === "done") {
              setMessages((prev) => {
                const u = [...prev];
                u[u.length - 1] = { ...u[u.length - 1], confidence: parsed.confidence, sources: parsed.sources, grounded: parsed.grounded };
                return u;
              });
            } else if (parsed.event === "error") {
              setMessages((prev) => {
                const u = [...prev];
                u[u.length - 1] = { role: "assistant", content: parsed.message };
                return u;
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", content: `Connection error: ${err instanceof Error ? err.message : "Unknown"}` };
        return u;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  if (page === "loading") {
    return (
      <div className="page-center">
        <div className="loading-indicator">
          <div className="loading-dot" />
          <span>INITIALIZING</span>
        </div>
        <style>{`
          .page-center { display: flex; align-items: center; justify-content: center; height: 100vh; }
          .loading-indicator {
            display: flex; align-items: center; gap: 10px;
            font-family: var(--font-mono); font-size: 11px;
            color: var(--text-dim); letter-spacing: 0.12em;
          }
          .loading-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--accent); animation: pulse 1.2s ease infinite;
          }
        `}</style>
      </div>
    );
  }

  if (page === "setup") return <Setup onReady={() => setPage("chat")} />;
  if (page === "settings") return <Settings onBack={() => setPage("chat")} />;

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="header-mark" />
          <div>
            <h1 className="header-title">ALMANAC</h1>
            <span className="header-sub">Homesteading Knowledge Base</span>
          </div>
        </div>
        <button onClick={() => setPage("settings")} className="header-settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </header>

      {/* Messages */}
      <main className="app-main" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 3v26M3 16h26" stroke="var(--border-light)" strokeWidth="1"/>
                <circle cx="16" cy="16" r="10" stroke="var(--border-light)" strokeWidth="1" strokeDasharray="3 3"/>
                <circle cx="16" cy="16" r="3" fill="var(--accent)" opacity="0.3"/>
              </svg>
            </div>
            <h2 className="empty-title">What do you need to know?</h2>
            <p className="empty-sub">
              Grounded answers from USDA, FEMA, and Extension Service sources.
            </p>
            <div className="suggested-grid">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  className="suggested-btn"
                  onClick={() => handleSend(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((msg, i) => (
              <ChatResponse key={i} message={msg} isLatest={i === messages.length - 1} />
            ))}
          </div>
        )}
      </main>

      {/* Input */}
      <footer className="app-footer">
        <div className="footer-inner">
          <ChatInput onSend={handleSend} disabled={isStreaming} />
          <p className="footer-disclaimer">
            For informational purposes only. Always verify critical information with qualified sources.
          </p>
        </div>
      </footer>

      <style>{`
        .app-layout {
          display: flex;
          flex-direction: column;
          height: 100vh;
          max-height: 100vh;
        }

        /* Header */
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .header-mark {
          width: 8px;
          height: 24px;
          background: var(--accent);
          border-radius: 2px;
        }
        .header-title {
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.14em;
          color: var(--text-bright);
          line-height: 1.2;
        }
        .header-sub {
          font-size: 11px;
          color: var(--text-dim);
          letter-spacing: 0.02em;
        }
        .header-settings {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--text-muted);
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .header-settings:hover {
          color: var(--text);
          border-color: var(--border);
          background: var(--bg-elevated);
        }

        /* Main */
        .app-main {
          flex: 1;
          overflow-y: auto;
          padding: 0;
        }

        /* Empty state */
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100%;
          padding: 40px 24px;
          text-align: center;
          animation: fadeInUp 0.4s ease;
        }
        .empty-icon {
          margin-bottom: 20px;
          opacity: 0.7;
        }
        .empty-title {
          font-family: var(--font-mono);
          font-size: 18px;
          font-weight: 500;
          color: var(--text);
          margin-bottom: 6px;
          letter-spacing: -0.01em;
        }
        .empty-sub {
          font-size: 13px;
          color: var(--text-muted);
          margin-bottom: 28px;
          max-width: 360px;
        }
        .suggested-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          max-width: 480px;
          width: 100%;
        }
        .suggested-btn {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 12px 14px;
          color: var(--text-muted);
          font-size: 12.5px;
          line-height: 1.45;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s;
          font-family: var(--font-body);
        }
        .suggested-btn:hover {
          border-color: var(--accent);
          color: var(--text);
          background: var(--accent-dim);
        }

        /* Messages */
        .messages-list {
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding: 24px 20px;
          max-width: 720px;
          margin: 0 auto;
          width: 100%;
        }

        /* Footer */
        .app-footer {
          border-top: 1px solid var(--border);
          background: var(--bg);
          padding: 12px 20px 16px;
          flex-shrink: 0;
        }
        .footer-inner {
          max-width: 720px;
          margin: 0 auto;
        }
        .footer-disclaimer {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-dim);
          text-align: center;
          margin-top: 8px;
          letter-spacing: 0.02em;
        }

        @media (max-width: 600px) {
          .suggested-grid {
            grid-template-columns: 1fr;
          }
          .messages-list {
            padding: 16px 12px;
          }
        }
      `}</style>
    </div>
  );
}
