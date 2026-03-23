import { useState, useCallback } from "react";
import type { Message } from "../components/ChatResponse";

export type ChatMode = "normal" | "profile";

interface UseChatReturn {
  messages: Message[];
  isStreaming: boolean;
  chatMode: ChatMode;
  hasProfile: boolean;
  sendMessage: (text: string, isProfileInit?: boolean) => Promise<void>;
  startProfileChat: () => void;
  newChat: () => void;
  checkProfile: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("normal");
  const [hasProfile, setHasProfile] = useState(false);

  const checkProfile = useCallback(() => {
    fetch("/api/context/profile")
      .then((r) => r.json())
      .then((data) => setHasProfile(Object.keys(data).length > 0))
      .catch(() => {});
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setChatMode("normal");
  }, []);

  const sendMessage = useCallback(
    async (text: string, isProfileInit = false) => {
      const isProfile = chatMode === "profile" || isProfileInit;
      const endpoint = isProfile ? "/api/profile/chat" : "/api/chat";

      // Build history for profile chat
      const history = isProfile
        ? messages
            .filter((m) => m.content)
            .map((m) => ({ role: m.role, content: m.content }))
        : [];

      // Build conversation history for normal chat (last N exchanges)
      const chatHistory = !isProfile
        ? messages
            .filter((m) => m.content && m.role)
            .slice(-10) // Last 10 messages (5 exchanges)
            .map((m) => ({ role: m.role, content: m.content }))
        : [];

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsStreaming(true);
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      try {
        const body = isProfile
          ? { message: text, history }
          : { message: text, history: chatHistory };

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
                setMessages((prev) => {
                  const u = [...prev];
                  u[u.length - 1] = {
                    ...u[u.length - 1],
                    confidence: parsed.confidence,
                    sources: parsed.sources,
                    grounded: parsed.grounded,
                  };
                  return u;
                });
              } else if (parsed.event === "profile_saved") {
                profileSaved = true;
                setHasProfile(true);
              } else if (parsed.event === "error") {
                setMessages((prev) => {
                  const u = [...prev];
                  u[u.length - 1] = {
                    role: "assistant",
                    content: parsed.message,
                  };
                  return u;
                });
              }
            } catch {
              /* skip */
            }
          }
        }

        // If profile was saved, clean up JSON from displayed message
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
              cleaned =
                "Your profile has been saved! All future answers will be personalized to your situation.";
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
    [chatMode, messages]
  );

  const startProfileChat = useCallback(() => {
    setChatMode("profile");
    setMessages([]);
    sendMessage("Hi, I'd like to set up my profile.", true);
  }, [sendMessage]);

  return {
    messages,
    isStreaming,
    chatMode,
    hasProfile,
    sendMessage,
    startProfileChat,
    newChat,
    checkProfile,
  };
}
