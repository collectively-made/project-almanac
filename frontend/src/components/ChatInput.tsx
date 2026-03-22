import { useState, type FormEvent } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px" }}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask a question..."
        disabled={disabled}
        maxLength={2048}
        style={{
          flex: 1,
          padding: "12px 16px",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text)",
          fontSize: "15px",
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        style={{
          padding: "12px 24px",
          background: disabled || !text.trim() ? "var(--border)" : "var(--accent)",
          color: disabled || !text.trim() ? "var(--text-muted)" : "#000",
          border: "none",
          borderRadius: "var(--radius)",
          fontWeight: 600,
          cursor: disabled || !text.trim() ? "not-allowed" : "pointer",
          fontSize: "15px",
        }}
      >
        {disabled ? "..." : "Send"}
      </button>
    </form>
  );
}
