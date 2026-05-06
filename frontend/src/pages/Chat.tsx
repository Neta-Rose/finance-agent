import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Send, Loader2, AlertCircle, Plus } from "lucide-react";
import { sendChatMessage, getConversationHistory } from "../api/chat";
import { clsx } from "clsx";

/**
 * Dashboard chat pane — Phase 5, task 5.14.
 *
 * Conversation ID and messages are persisted to localStorage with a 14-day TTL
 * so the user can return to the same conversation across sessions.
 */

const STORAGE_KEY = "chat_session";
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

interface StoredSession {
  conversationId: string;
  messages: Message[];
  savedAt: number;
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(conversationId: string, messages: Message[]): void {
  try {
    const session: StoredSession = { conversationId, messages, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage full — ignore
  }
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Dashboard chat pane — Phase 5, task 5.14.
 *
 * Spec: design.md §9.1; D3.1, D3.2.
 *
 * Renders streamed or final replies as plain text. No client-side tool-call
 * interpretation (D3.2). Conversation ID is persisted in component state so
 * the same conversation continues across messages in the same session.
 */

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

export function Chat() {
  const stored = loadSession();
  const [messages, setMessages] = useState<Message[]>(stored?.messages ?? []);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(stored?.conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist session whenever messages or conversationId change
  useEffect(() => {
    if (conversationId && messages.length > 0) {
      saveSession(conversationId, messages);
    }
  }, [conversationId, messages]);

  const handleNewChat = () => {
    clearSession();
    setMessages([]);
    setConversationId(undefined);
    setInput("");
  };

  const mutation = useMutation({
    mutationFn: ({ text, convId }: { text: string; convId?: string }) =>
      sendChatMessage(text, convId),
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.replyText,
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "Something went wrong. Please try again.",
          isError: true,
        },
      ]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, mutation.isPending]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || mutation.isPending) return;

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: text },
    ]);
    setInput("");
    mutation.mutate({ text, convId: conversationId });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="flex flex-col"
      style={{
        height: "calc(100dvh - 56px - env(safe-area-inset-bottom))",
        background: "var(--color-bg-base)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 border-b"
        style={{ borderColor: "var(--color-border)", background: "#111111" }}
      >
        <div className="flex items-center gap-2">
          <MessageCircle size={18} style={{ color: "var(--color-accent-blue)" }} />
          <span className="font-bold text-sm" style={{ color: "var(--color-fg-default)" }}>
            Portfolio Assistant
          </span>
          {conversationId && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-subtle)", color: "var(--color-fg-subtle)" }}>
              saved
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--color-fg-muted)", background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}
            title="Start a new conversation"
          >
            <Plus size={12} />
            New
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <MessageCircle size={40} style={{ color: "var(--color-fg-subtle)" }} />
            <p className="text-sm" style={{ color: "var(--color-fg-muted)" }}>
              Ask about your portfolio, strategies, or request an analysis.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                "What's my portfolio looking like?",
                "Which positions need attention?",
                "Run a quick check on AAPL",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-fg-muted)",
                    background: "var(--color-bg-subtle)",
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={clsx(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                msg.role === "user"
                  ? "rounded-br-sm"
                  : "rounded-bl-sm"
              )}
              style={
                msg.role === "user"
                  ? {
                      background: "var(--color-accent-blue)",
                      color: "#fff",
                    }
                  : msg.isError
                  ? {
                      background: "rgba(239,68,68,0.1)",
                      color: "var(--color-accent-red)",
                      border: "1px solid rgba(239,68,68,0.2)",
                    }
                  : {
                      background: "var(--color-bg-subtle)",
                      color: "var(--color-fg-default)",
                      border: "1px solid var(--color-border)",
                    }
              }
            >
              {msg.isError && (
                <AlertCircle size={14} className="inline mr-1 mb-0.5" />
              )}
              {/* Render as plain text — no client-side tool interpretation (D3.2) */}
              <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
            </div>
          </div>
        ))}

        {mutation.isPending && (
          <div className="flex justify-start">
            <div
              className="flex items-center gap-2 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm"
              style={{
                background: "var(--color-bg-subtle)",
                border: "1px solid var(--color-border)",
                color: "var(--color-fg-muted)",
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              <span>Thinking…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: "var(--color-border)", background: "#111111" }}
      >
        <div
          className="flex items-end gap-2 rounded-2xl border px-3 py-2"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-subtle)",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your portfolio…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm outline-none"
            style={{
              color: "var(--color-fg-default)",
              maxHeight: "120px",
              lineHeight: "1.5",
            }}
            disabled={mutation.isPending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || mutation.isPending}
            className="shrink-0 rounded-full p-1.5 transition-colors disabled:opacity-40"
            style={{
              background: input.trim() && !mutation.isPending
                ? "var(--color-accent-blue)"
                : "var(--color-bg-muted)",
              color: input.trim() && !mutation.isPending ? "#fff" : "var(--color-fg-subtle)",
            }}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-center text-[10px] mt-1.5" style={{ color: "var(--color-fg-subtle)" }}>
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
