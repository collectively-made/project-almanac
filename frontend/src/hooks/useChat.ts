import { useState, useCallback } from "react";
import type { Message } from "../components/ChatResponse";

export type ChatMode = "normal" | "profile";

interface UseChatReturn {
  messages: Message[];
  isStreaming: boolean;
  chatMode: ChatMode;
  hasProfile: boolean;
  activeThreadId: string | null;
  sendMessage: (text: string, isProfileInit?: boolean) => Promise<void>;
  startProfileChat: () => void;
  newChat: () => void;
  loadThread: (threadId: string) => Promise<void>;
  checkProfile: () => void;
}

async function createThread(): Promise<string> {
  const r = await fetch("/api/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await r.json();
  return data.id;
}

async function saveMessage(
  threadId: string,
  msg: { role: string; content: string; confidence?: number; sources?: { source: string; section: string }[]; grounded?: boolean }
) {
  await fetch(`/api/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  }).catch(() => {}); // Non-blocking — don't fail the chat if save fails
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("normal");
  const [hasProfile, setHasProfile] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const checkProfile = useCallback(() => {
    fetch("/api/context/profile")
      .then((r) => r.json())
      .then((data) => setHasProfile(Object.keys(data).length > 0))
      .catch(() => {});
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setChatMode("normal");
    setActiveThreadId(null);
  }, []);

  const loadThread = useCallback(async (threadId: string) => {
    try {
      const r = await fetch(`/api/threads/${threadId}`);
      if (!r.ok) return;
      const data = await r.json();
      setMessages(data.messages || []);
      setActiveThreadId(threadId);
      setChatMode("normal");
    } catch {
      // silent
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string, isProfileInit = false) => {
      const isProfile = chatMode === "profile" || isProfileInit;
      const endpoint = isProfile ? "/api/profile/chat" : "/api/chat";

      // Auto-create a thread for normal chat if none exists
      let threadId = activeThreadId;
      if (!isProfile && !threadId) {
        try {
          threadId = await createThread();
          setActiveThreadId(threadId);
        } catch {
          // Continue without thread persistence
        }
      }

      // Build history
      const history = messages
        .filter((m) => m.content)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsStreaming(true);
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      // Save user message to thread
      if (threadId && !isProfile) {
        saveMessage(threadId, { role: "user", content: text });
      }

      try {
        const body = isProfile
          ? { message: text, history }
          : { message: text, history };

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.status === 503) {
          setMessages((prev) => {
            const u = [...prev];
            u[u.length - 1] = {
              role: "assistant",
              content: "Model is busy or not loaded. Try again shortly.",
            };
            return u;
          });
          return;
        }
        if (!response.ok || !response.body)
          throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let profileSaved = false;
        let finalMeta: { confidence?: number; sources?: { source: string; section: string }[]; grounded?: boolean } = {};

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
                  u[u.length - 1] = {
                    ...u[u.length - 1],
                    content: u[u.length - 1].content + parsed.text,
                  };
                  return u;
                });
              } else if (parsed.event === "done") {
                finalMeta = {
                  confidence: parsed.confidence,
                  sources: parsed.sources,
                  grounded: parsed.grounded,
                };
                setMessages((prev) => {
                  const u = [...prev];
                  u[u.length - 1] = { ...u[u.length - 1], ...finalMeta };
                  return u;
                });
              } else if (parsed.event === "profile_saved") {
                profileSaved = true;
                setHasProfile(true);
              } else if (parsed.event === "error") {
                setMessages((prev) => {
                  const u = [...prev];
                  u[u.length - 1] = { role: "assistant", content: parsed.message };
                  return u;
                });
              }
            } catch {
              /* skip */
            }
          }
        }

        // Save assistant response to thread
        if (threadId && !isProfile) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.content) {
              saveMessage(threadId!, {
                role: "assistant",
                content: last.content,
                ...finalMeta,
              });
            }
            return prev;
          });
        }

        // Handle profile save cleanup
        if (profileSaved) {
          setMessages((prev) => {
            const u = [...prev];
            const last = u[u.length - 1];
            let cleaned = last.content
              .replace(/```json\s*\{[\s\S]*?\}\s*```/g, "")
              .trim();
            cleaned = cleaned
              .replace(/\{"profile":\s*\{[\s\S]*?\}\}/g, "")
              .trim();
            if (!cleaned) {
              cleaned = "Your profile has been saved! All future answers will be personalized to your situation.";
            }
            u[u.length - 1] = { ...last, content: cleaned };
            return u;
          });
          setTimeout(() => setChatMode("normal"), 1500);
        }
      } catch (err) {
        setMessages((prev) => {
          const u = [...prev];
          u[u.length - 1] = {
            role: "assistant",
            content: `Connection error: ${err instanceof Error ? err.message : "Unknown"}`,
          };
          return u;
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [chatMode, messages, activeThreadId]
  );

  const startProfileChat = useCallback(() => {
    setChatMode("profile");
    setMessages([]);
    setActiveThreadId(null);
    sendMessage("Hi, I'd like to set up my profile.", true);
  }, [sendMessage]);

  return {
    messages,
    isStreaming,
    chatMode,
    hasProfile,
    activeThreadId,
    sendMessage,
    startProfileChat,
    newChat,
    loadThread,
    checkProfile,
  };
}
