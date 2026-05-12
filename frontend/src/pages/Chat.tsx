import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  archiveSavedConversation,
  createSavedConversation,
  getConversationHistory,
  listSavedConversations,
  renameSavedConversation,
  sendChatMessage,
  type ConversationTurn,
  type SavedConversation,
} from "../api/chat";
import { clsx } from "clsx";

/**
 * Dashboard chat pane.
 *
 * Saved conversations, metadata, and message turns are loaded from the backend.
 * Browser storage is limited to a best-effort preference for the last opened
 * conversation ID; no message content is persisted client-side.
 */

const LAST_OPENED_CONVERSATION_KEY = "chat_last_opened_conversation_id";
const CONVERSATION_LIST_LIMIT = 50;
const EMPTY_CONVERSATIONS: SavedConversation[] = [];
const EMPTY_MESSAGES: ChatViewMessage[] = [];

type ChatViewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  toolCalls?: string[];
  confirmationAction?: string; // extracted from backend confirmation prompt
};

// Matches any fenced code block whose language starts with "tool" (tool_call, tool_code, tool_use, tool_result, etc.)
const TOOL_FENCED_BLOCK_RE = /```tool[^\n]*\n[\s\S]*?```/g;

// Only the tool_call variant carries parseable JSON with a tool name
const TOOL_CALL_BLOCK_RE = /```tool_call\s*\n([\s\S]*?)\n```/g;

// Confirmation prompt emitted by the backend action-confirmation gate
const CONFIRMATION_PROMPT_RE = /I'd like to run:\s+\*\*([^*]+)\*\*\.\s+Reply 'yes' to confirm, or 'no' to skip\./;

const TOOL_DISPLAY_LABELS: Record<string, string> = {
  getPortfolio: "Checked portfolio",
  getStrategy: "Looked up strategy",
  getStrategies: "Reviewed all strategies",
  getRecentReports: "Fetched recent reports",
  getReportSummary: "Read report summary",
  getCatalystsDueSoon: "Checked upcoming catalysts",
  getEscalationHistory: "Reviewed escalation history",
  getRiskSummary: "Assessed portfolio risk",
  getNotifications: "Checked notifications",
  searchWeb: "Searched the web",
  triggerQuickCheck: "Ran a quick check",
  triggerDeepDive: "Triggered deep dive",
  triggerDailyBrief: "Triggered daily brief",
  snoozeTicker: "Snoozed ticker",
  markVerdictAddressed: "Recorded verdict decision",
  waitForJob: "Waited for job",
};

function toolDisplayLabel(name: string): string {
  return TOOL_DISPLAY_LABELS[name] ?? name;
}

function extractToolCallsFromText(text: string): string[] {
  const names: string[] = [];
  const re = new RegExp(TOOL_CALL_BLOCK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!) as { name?: string };
      if (typeof parsed.name === "string") names.push(parsed.name);
    } catch {
      // skip malformed
    }
  }
  return names;
}

function stripToolCallBlocks(text: string): string {
  return text.replace(TOOL_FENCED_BLOCK_RE, "").trim();
}

function readLastOpenedConversationId(): string | undefined {
  try {
    const value = localStorage.getItem(LAST_OPENED_CONVERSATION_KEY)?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function rememberLastOpenedConversationId(conversationId: string): void {
  try {
    localStorage.setItem(LAST_OPENED_CONVERSATION_KEY, conversationId);
  } catch {
    // Preference writes are best-effort only.
  }
}

function clearLastOpenedConversationId(): void {
  try {
    localStorage.removeItem(LAST_OPENED_CONVERSATION_KEY);
  } catch {
    // Preference cleanup is best-effort only.
  }
}

function normalizeTurnContent(content: unknown): { text: string; toolCalls: string[]; confirmationAction?: string } {
  if (typeof content === "string") {
    const toolCalls = extractToolCallsFromText(content);
    const confirmationMatch = CONFIRMATION_PROMPT_RE.exec(content);
    if (confirmationMatch) {
      // Strip the entire confirmation prompt — render as a styled chip instead
      const text = content.replace(CONFIRMATION_PROMPT_RE, "").trim();
      return { text: stripToolCallBlocks(text), toolCalls, confirmationAction: confirmationMatch[1]!.trim() };
    }
    return { text: stripToolCallBlocks(content), toolCalls };
  }
  if (typeof content === "number" || typeof content === "boolean") {
    return { text: String(content), toolCalls: [] };
  }
  if (content == null) return { text: "", toolCalls: [] };
  return { text: "", toolCalls: [] };
}

function turnToMessage(turn: ConversationTurn): ChatViewMessage | null {
  // Skip tool_result turns — they're internal plumbing, not for display
  if (turn.role === "tool_result") return null;
  const role = turn.role === "user" ? "user" : "assistant";
  const { text, toolCalls, confirmationAction } = normalizeTurnContent(turn.content);
  // Skip assistant turns that are purely tool calls (no visible text)
  if (role === "assistant" && !text && !confirmationAction && toolCalls.length > 0) {
    return {
      id: `${turn.conversationId}-${turn.turnIndex}-${role}`,
      role,
      content: "",
      toolCalls,
    };
  }
  return {
    id: `${turn.conversationId}-${turn.turnIndex}-${role}`,
    role,
    content: text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    confirmationAction,
  };
}

function titleForConversation(conversation: SavedConversation): string {
  const title = conversation.title?.trim();
  if (title) return title;
  return conversation.turnCount > 0 ? "Untitled chat" : "New chat";
}

function formatConversationMeta(conversation: SavedConversation): string {
  const turns = `${conversation.turnCount} ${conversation.turnCount === 1 ? "turn" : "turns"}`;
  const updated = conversation.updatedAt || conversation.lastActivityAt;
  if (!updated) return turns;
  const date = new Date(updated);
  if (Number.isNaN(date.getTime())) return turns;
  return `${turns} · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const maybeError = error as {
    code?: string;
    response?: { data?: { error?: string; message?: string } };
  };
  if (maybeError?.code === "ECONNABORTED") {
    return "The request timed out. Please try again.";
  }

  const code = maybeError?.response?.data?.error;
  switch (code) {
    case "database_unavailable":
      return "Saved chats are temporarily unavailable. Please try again soon.";
    case "conversation_not_found":
      return "That saved chat is no longer available.";
    case "conversation_archived":
      return "That saved chat was archived. Choose another chat or start a new one.";
    case "conversation_expired":
      return "That saved chat expired. Start a new chat to continue.";
    case "invalid_title":
      return "Enter a title before saving the rename.";
    case "invalid_request":
      return "Check the message and try again.";
    default:
      return maybeError?.response?.data?.message ?? fallback;
  }
}

export function Chat() {
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>(() =>
    readLastOpenedConversationId()
  );
  const [input, setInput] = useState("");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const conversationsQuery = useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: () => listSavedConversations({ limit: CONVERSATION_LIST_LIMIT, offset: 0 }),
  });

  const conversations = conversationsQuery.data?.items ?? EMPTY_CONVERSATIONS;
  const availableConversationIds = useMemo(
    () => new Set(conversations.map((conversation) => conversation.id)),
    [conversations]
  );
  const selectedConversationIsAvailable = selectedConversationId
    ? availableConversationIds.has(selectedConversationId)
    : false;
  const effectiveConversationId = selectedConversationIsAvailable ? selectedConversationId : undefined;
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === effectiveConversationId),
    [conversations, effectiveConversationId]
  );

  const historyQuery = useQuery({
    queryKey: ["chat", "conversation", effectiveConversationId],
    queryFn: () => getConversationHistory(effectiveConversationId as string),
    enabled: Boolean(effectiveConversationId),
    retry: false,
  });

  const messages = useMemo<ChatViewMessage[]>(() => {
    if (!historyQuery.data?.turns) return EMPTY_MESSAGES;
    return historyQuery.data.turns.flatMap((turn) => {
      const msg = turnToMessage(turn);
      return msg ? [msg] : [];
    });
  }, [historyQuery.data]);

  useEffect(() => {
    if (!conversationsQuery.data || !selectedConversationId || selectedConversationIsAvailable) return;
    const rememberedId = readLastOpenedConversationId();
    if (rememberedId === selectedConversationId) clearLastOpenedConversationId();
  }, [conversationsQuery.data, selectedConversationId, selectedConversationIsAvailable]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, historyQuery.isFetching]);

  const createMutation = useMutation({
    mutationFn: () => createSavedConversation(null),
    onSuccess: async (conversation) => {
      setSelectedConversationId(conversation.id);
      rememberLastOpenedConversationId(conversation.id);
      setStatusMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversation", conversation.id] });
      inputRef.current?.focus();
    },
    onError: (error) => {
      setStatusMessage(getApiErrorMessage(error, "Could not create a saved chat. Please try again."));
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      let conversationId = effectiveConversationId;
      if (!conversationId) {
        const created = await createSavedConversation(null);
        conversationId = created.id;
        setSelectedConversationId(created.id);
        rememberLastOpenedConversationId(created.id);
      }
      return sendChatMessage(text, conversationId);
    },
    onSuccess: async (data) => {
      setInput("");
      setPendingMessage(null);
      setStatusMessage(null);
      setSelectedConversationId(data.conversationId);
      rememberLastOpenedConversationId(data.conversationId);
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversation", data.conversationId] });
    },
    onError: (error) => {
      setPendingMessage(null);
      setStatusMessage(getApiErrorMessage(error, "Could not send that message. Please try again."));
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameSavedConversation(id, title),
    onSuccess: async (conversation) => {
      setEditingConversationId(null);
      setRenameTitle("");
      setRenameError(null);
      setStatusMessage(null);
      setSelectedConversationId(conversation.id);
      rememberLastOpenedConversationId(conversation.id);
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversation", conversation.id] });
    },
    onError: (error) => {
      setRenameError(getApiErrorMessage(error, "Could not rename that chat. Please try again."));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (conversationId: string) => archiveSavedConversation(conversationId),
    onSuccess: async (_conversation, archivedId) => {
      setStatusMessage(null);
      setEditingConversationId(null);
      const nextConversation = conversations.find((conversation) => conversation.id !== archivedId);
      if (nextConversation) {
        setSelectedConversationId(nextConversation.id);
        rememberLastOpenedConversationId(nextConversation.id);
      } else {
        setSelectedConversationId(undefined);
        clearLastOpenedConversationId();
      }
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      queryClient.removeQueries({ queryKey: ["chat", "conversation", archivedId] });
    },
    onError: (error) => {
      setStatusMessage(getApiErrorMessage(error, "Could not archive that chat. Please try again."));
    },
  });

  const isBusy = createMutation.isPending || sendMutation.isPending;
  const hasConversations = conversations.length > 0;
  const showEmptyHistory = Boolean(effectiveConversationId) && !historyQuery.isLoading && messages.length === 0;

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    rememberLastOpenedConversationId(conversationId);
    setStatusMessage(null);
    setEditingConversationId(null);
  };

  const handleNewChat = () => {
    if (!createMutation.isPending) createMutation.mutate();
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    setInput("");
    setPendingMessage(text);
    sendMutation.mutate(text);
  };

  const handleStartRename = (conversation: SavedConversation) => {
    setEditingConversationId(conversation.id);
    setRenameTitle(titleForConversation(conversation));
    setRenameError(null);
  };

  const handleSaveRename = (conversationId: string) => {
    const title = renameTitle.trim();
    if (!title) {
      setRenameError("Enter a title before saving the rename.");
      return;
    }
    renameMutation.mutate({ id: conversationId, title });
  };

  const handleCancelRename = () => {
    setEditingConversationId(null);
    setRenameTitle("");
    setRenameError(null);
  };

  const handleArchive = (conversationId: string) => {
    if (!archiveMutation.isPending) archiveMutation.mutate(conversationId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const conversationError = conversationsQuery.error
    ? getApiErrorMessage(conversationsQuery.error, "Could not load saved chats. Please try again.")
    : null;
  const staleSelectionError = selectedConversationId && conversationsQuery.data && !selectedConversationIsAvailable
    ? "That saved chat is no longer available. Choose another chat or start a new one."
    : null;
  const historyError = historyQuery.error
    ? getApiErrorMessage(historyQuery.error, "Could not open that saved chat. Please try again.")
    : null;
  const activeError = statusMessage ?? historyError ?? staleSelectionError ?? conversationError;

  return (
    <div
      className="flex min-h-0 flex-col lg:flex-row"
      style={{
        height: "calc(100dvh - 56px - env(safe-area-inset-bottom))",
        background: "var(--color-bg-base)",
      }}
    >
      <aside
        className="flex max-h-64 flex-col border-b lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r"
        style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}
        aria-label="Saved chats"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-fg-subtle)" }}>
              Saved chats
            </p>
            <h2 className="text-sm font-bold" style={{ color: "var(--color-fg-default)" }}>
              Conversations
            </h2>
          </div>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg-base)",
              color: "var(--color-fg-default)",
            }}
            aria-label="Create new saved chat"
          >
            {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            New chat
          </button>
        </div>

        {conversationError && (
          <div className="mx-4 mb-3 rounded-xl border px-3 py-2 text-xs" role="alert" style={{ borderColor: "rgba(239,68,68,0.35)", color: "var(--color-accent-red)" }}>
            {conversationError}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {conversationsQuery.isLoading && (
            <div className="flex items-center gap-2 rounded-xl border px-3 py-3 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
              <Loader2 size={14} className="animate-spin" />
              Loading saved chats…
            </div>
          )}

          {!conversationsQuery.isLoading && !conversationError && !hasConversations && (
            <div className="rounded-2xl border px-4 py-5 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
              No saved chats yet. Start a new chat or send a message to create one.
            </div>
          )}

          <div className="space-y-2" role="list" aria-label="Saved conversation list">
            {conversations.map((conversation) => {
              const isSelected = conversation.id === effectiveConversationId;
              const isEditing = editingConversationId === conversation.id;
              const isArchiving = archiveMutation.isPending && archiveMutation.variables === conversation.id;
              return (
                <div
                  key={conversation.id}
                  role="listitem"
                  className={clsx("rounded-2xl border p-2 transition-colors", isSelected && "shadow-sm")}
                  style={{
                    borderColor: isSelected ? "var(--color-accent-blue)" : "var(--color-border)",
                    background: isSelected ? "rgba(59,130,246,0.10)" : "var(--color-bg-base)",
                  }}
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <label className="sr-only" htmlFor={`rename-${conversation.id}`}>
                        Rename saved chat
                      </label>
                      <input
                        id={`rename-${conversation.id}`}
                        value={renameTitle}
                        onChange={(event) => {
                          setRenameTitle(event.target.value);
                          setRenameError(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleSaveRename(conversation.id);
                          if (event.key === "Escape") handleCancelRename();
                        }}
                        className="w-full rounded-lg border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-2"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-fg-default)",
                        }}
                        disabled={renameMutation.isPending}
                      />
                      {renameError && (
                        <p className="text-xs" role="alert" style={{ color: "var(--color-accent-red)" }}>
                          {renameError}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveRename(conversation.id)}
                          disabled={renameMutation.isPending || !renameTitle.trim()}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                          style={{ background: "var(--color-accent-blue)", color: "#fff" }}
                          aria-label="Save renamed chat"
                        >
                          {renameMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelRename}
                          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}
                          aria-label="Cancel rename"
                        >
                          <X size={12} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSelectConversation(conversation.id)}
                        className="block w-full rounded-xl px-2 py-1.5 text-left transition-colors"
                        aria-current={isSelected ? "true" : undefined}
                      >
                        <span className="block truncate text-sm font-semibold" style={{ color: "var(--color-fg-default)" }}>
                          {titleForConversation(conversation)}
                        </span>
                        <span className="block text-xs" style={{ color: "var(--color-fg-subtle)" }}>
                          {formatConversationMeta(conversation)}
                        </span>
                      </button>
                      <div className="mt-1 flex gap-1 px-1">
                        <button
                          type="button"
                          onClick={() => handleStartRename(conversation)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
                          style={{ color: "var(--color-fg-muted)" }}
                          aria-label={`Rename ${titleForConversation(conversation)}`}
                        >
                          <Pencil size={12} />
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchive(conversation.id)}
                          disabled={isArchiving}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors disabled:opacity-50"
                          style={{ color: "var(--color-accent-red)" }}
                          aria-label={`Archive ${titleForConversation(conversation)}`}
                        >
                          {isArchiving ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          Archive
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col" aria-label="Selected chat">
        <div
          className="flex items-center justify-between gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <MessageCircle size={18} style={{ color: "var(--color-accent-blue)" }} aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold" style={{ color: "var(--color-fg-default)" }}>
                {selectedConversation ? titleForConversation(selectedConversation) : "Portfolio chat"}
              </h1>
              <p className="text-xs" style={{ color: "var(--color-fg-subtle)" }}>
                {selectedConversation ? "Saved to your chat history" : "Start or choose a saved chat"}
              </p>
            </div>
          </div>
          {selectedConversation && (
            <span className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ background: "rgba(59,130,246,0.10)", color: "var(--color-accent-blue)" }}>
              Saved
            </span>
          )}
        </div>

        {activeError && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm" role="alert" style={{ borderColor: "rgba(239,68,68,0.35)", color: "var(--color-accent-red)", background: "rgba(239,68,68,0.08)" }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p>{activeError}</p>
              {conversationError && (
                <button
                  type="button"
                  onClick={() => void conversationsQuery.refetch()}
                  className="mt-1 text-xs font-semibold underline"
                >
                  Retry loading saved chats
                </button>
              )}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!effectiveConversationId && !historyQuery.isLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <MessageCircle size={44} style={{ color: "var(--color-fg-subtle)" }} aria-hidden="true" />
              <div className="max-w-sm space-y-2">
                <h2 className="text-lg font-bold" style={{ color: "var(--color-fg-default)" }}>
                  Start a saved chat
                </h2>
                <p className="text-sm" style={{ color: "var(--color-fg-muted)" }}>
                  Ask about your portfolio, reports, or positions. The chat will be saved automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={handleNewChat}
                disabled={createMutation.isPending}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--color-accent-blue)", color: "#fff" }}
              >
                {createMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                New chat
              </button>
            </div>
          )}

          {effectiveConversationId && historyQuery.isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm" style={{ color: "var(--color-fg-muted)" }}>
              <Loader2 size={16} className="animate-spin" />
              Opening saved chat…
            </div>
          )}

          {showEmptyHistory && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <MessageCircle size={40} style={{ color: "var(--color-fg-subtle)" }} aria-hidden="true" />
              <p className="max-w-sm text-sm" style={{ color: "var(--color-fg-muted)" }}>
                This saved chat is ready. Send a message to begin.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((message) => {
              const hasText = Boolean(message.content);
              const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
              const hasConfirmation = Boolean(message.confirmationAction);
              if (!hasText && !hasToolCalls && !hasConfirmation) return null;
              return (
                <div key={message.id} className={clsx("flex flex-col gap-1", message.role === "user" ? "items-end" : "items-start")}>
                  {hasToolCalls && (
                    <div className="flex flex-wrap gap-1.5 px-1">
                      {message.toolCalls!.map((name, i) => (
                        <span
                          key={`${message.id}-tool-${i}`}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                          style={{
                            background: "rgba(99,102,241,0.12)",
                            color: "var(--color-fg-muted)",
                            border: "1px solid rgba(99,102,241,0.2)",
                          }}
                        >
                          <Zap size={10} style={{ color: "rgba(99,102,241,0.8)" }} aria-hidden="true" />
                          {toolDisplayLabel(name)}
                        </span>
                      ))}
                    </div>
                  )}
                  {hasConfirmation && (
                    <div
                      className="inline-flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm"
                      style={{
                        background: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.25)",
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      <Zap size={14} className="mt-0.5 shrink-0" style={{ color: "rgba(245,158,11,0.8)" }} aria-hidden="true" />
                      <span className="leading-relaxed">
                        <span className="font-medium" style={{ color: "var(--color-fg-default)" }}>Action: </span>
                        {message.confirmationAction}
                      </span>
                    </div>
                  )}
                  {hasText && (
                    <div
                      className={clsx(
                        "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        message.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"
                      )}
                      style={
                        message.role === "user"
                          ? { background: "var(--color-accent-blue)", color: "#fff" }
                          : message.isError
                            ? {
                                background: "rgba(239,68,68,0.1)",
                                border: "1px solid rgba(239,68,68,0.2)",
                                color: "var(--color-accent-red)",
                              }
                            : {
                                background: "var(--color-bg-subtle)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-fg-default)",
                              }
                      }
                    >
                      {message.isError && <AlertCircle size={14} className="mb-0.5 mr-1 inline" aria-hidden="true" />}
                      <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {sendMutation.isPending && pendingMessage && (
              <div className="flex flex-col items-end gap-1">
                <div
                  className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed opacity-80"
                  style={{ background: "var(--color-accent-blue)", color: "#fff" }}
                >
                  <span style={{ whiteSpace: "pre-wrap" }}>{pendingMessage}</span>
                </div>
              </div>
            )}

            {sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border px-4 py-2.5 text-sm" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  <span>Thinking…</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
          <div className="flex items-end gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}>
            <label className="sr-only" htmlFor="chat-message-input">
              Message portfolio chat
            </label>
            <textarea
              id="chat-message-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your portfolio…"
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm outline-none"
              style={{ color: "var(--color-fg-default)", maxHeight: "120px", lineHeight: "1.5" }}
              disabled={isBusy}
              aria-describedby="chat-input-help"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending || createMutation.isPending}
              className="shrink-0 rounded-full p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: input.trim() && !isBusy ? "var(--color-accent-blue)" : "var(--color-bg-muted)",
                color: input.trim() && !isBusy ? "#fff" : "var(--color-fg-subtle)",
              }}
              aria-label="Send message"
            >
              {sendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p id="chat-input-help" className="mt-1.5 text-center text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
            Press Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </section>
    </div>
  );
}
