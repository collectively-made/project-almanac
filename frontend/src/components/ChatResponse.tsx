interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  confidence?: number;
}

interface ChatResponseProps {
  message: Message;
}

function ConfidenceBadge({ score }: { score: number }) {
  let color = "var(--danger)";
  let label = "Low confidence";
  if (score >= 0.7) {
    color = "var(--accent)";
    label = "High confidence";
  } else if (score >= 0.4) {
    color = "var(--warning)";
    label = "Medium confidence";
  }

  return (
    <span
      style={{
        fontSize: "11px",
        color,
        padding: "2px 8px",
        border: `1px solid ${color}`,
        borderRadius: "12px",
      }}
    >
      {label} ({Math.round(score * 100)}%)
    </span>
  );
}

export function ChatResponse({ message }: ChatResponseProps) {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "4px",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: "12px 16px",
          borderRadius: "var(--radius)",
          background: isUser ? "var(--accent-muted)" : "var(--bg-secondary)",
          color: isUser ? "#fff" : "var(--text)",
          whiteSpace: "pre-wrap",
          lineHeight: 1.6,
          fontSize: "15px",
        }}
      >
        {message.content || (
          <span style={{ color: "var(--text-muted)" }}>Thinking...</span>
        )}
      </div>

      {!isUser && message.confidence !== undefined && (
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <ConfidenceBadge score={message.confidence} />
          {message.sources && message.sources.length > 0 && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {message.sources.length} source{message.sources.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
