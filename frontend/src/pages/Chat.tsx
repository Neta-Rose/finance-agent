import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronLeft,
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
  type SavedConversationListResponse,
  type ConversationHistory,
  type ConversationTurn,
  type SavedConversation,
} from "../api/chat";
import {
  fetchBalance,
  type UserPointsBalanceSnapshot,
} from "../api/balance";
import { clsx } from "clsx";

/**
 * Dashboard chat pane.
 *
 * Saved conversations, metadata, and message turns are loaded from the backend.
 * Browser storage is limited to a best-effort preference for the last opened
 * conversation ID; no message content is persisted client-side.
 *
 * Mobile: full-screen chat view with a slide-in drawer sidebar.
 * Desktop (lg+): side-by-side panel layout.
 */

const LAST_OPENED_CONVERSATION_KEY = "chat_last_opened_conversation_id";
const CONVERSATION_LIST_LIMIT = 50;
const EMPTY_CONVERSATIONS: SavedConversation[] = [];
const EMPTY_MESSAGES: ChatViewMessage[] = [];
const CHAT_REQUEST_MIN_REMAINING_POINTS = 25;

type ChatViewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  toolCalls?: string[];
  confirmationAction?: string;
};

// Matches any fenced code block whose language starts with "tool"
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
    // best-effort
  }
}

function prependConversationToList(
  current: SavedConversationListResponse | undefined,
  conversation: SavedConversation
): SavedConversationListResponse | undefined {
  if (!current) return current;
  return {
    ...current,
    items: [conversation, ...current.items.filter((item) => item.id !== conversation.id)].slice(0, current.limit),
  };
}

function clearLastOpenedConversationId(): void {
  try {
    localStorage.removeItem(LAST_OPENED_CONVERSATION_KEY);
  } catch {
    // best-effort
  }
}

function normalizeTurnContent(content: unknown): { text: string; toolCalls: string[]; confirmationAction?: string } {
  if (typeof content === "string") {
    const toolCalls = extractToolCallsFromText(content);
    const confirmationMatch = CONFIRMATION_PROMPT_RE.exec(content);
    if (confirmationMatch) {
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
  if (turn.role === "tool_result") return null;
  const role = turn.role === "user" ? "user" : "assistant";
  const { text, toolCalls, confirmationAction } = normalizeTurnContent(turn.content);
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
  const updated = conversation.updatedAt || conversation.lastActivityAt;
  if (!updated) return `${conversation.turnCount} turns`;
  const date = new Date(updated);
  if (Number.isNaN(date.getTime())) return `${conversation.turnCount} turns`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatPoints(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.floor(value)}`;
}

function chatBudgetBlockReason(balance: UserPointsBalanceSnapshot | undefined): string | null {
  if (!balance) return null;
  if (balance.exhausted) {
    return `Daily points are exhausted. Resets after the rolling budget window; contact admin if you need more now.`;
  }
  if (balance.pointsRemaining < CHAT_REQUEST_MIN_REMAINING_POINTS) {
    return `Only ${formatPoints(balance.pointsRemaining)} points remain. Chat needs at least ${CHAT_REQUEST_MIN_REMAINING_POINTS} points reserved before it can send.`;
  }
  return null;
}

function chatPointsLabel(balance: UserPointsBalanceSnapshot | undefined): string {
  if (!balance) return "… pts";
  return `${formatPoints(balance.pointsRemaining)} pts`;
}

function renderChatText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(<strong key={`bold-${match.index}`} className="font-bold">{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const maybeError = error as {
    code?: string;
    response?: { data?: { error?: string; message?: string } };
  };
  if (maybeError?.code === "ECONNABORTED") return "The request timed out. Please try again.";
  const code = maybeError?.response?.data?.error;
  switch (code) {
    case "database_unavailable": return "Saved chats are temporarily unavailable. Please try again soon.";
    case "conversation_not_found": return "That saved chat is no longer available.";
    case "conversation_archived": return "That saved chat was archived. Choose another chat or start a new one.";
    case "conversation_expired": return "That saved chat expired. Start a new chat to continue.";
    case "invalid_title": return "Enter a title before saving the rename.";
    case "invalid_request": return "Check the message and try again.";
    case "points_budget_exhausted": return maybeError?.response?.data?.message ?? "Daily points budget is exhausted. Try again after the budget window resets or contact admin.";
    default: return maybeError?.response?.data?.message ?? fallback;
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
  // Mobile drawer open state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasScrolledInitially = useRef(false);

  const conversationsQuery = useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: () => listSavedConversations({ limit: CONVERSATION_LIST_LIMIT, offset: 0 }),
  });

  const balanceQuery = useQuery({
    queryKey: ["balance"],
    queryFn: fetchBalance,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const budgetBlockReason = chatBudgetBlockReason(balanceQuery.data);

  const conversations = conversationsQuery.data?.items ?? EMPTY_CONVERSATIONS;
  const availableConversationIds = useMemo(
    () => new Set(conversations.map((c) => c.id)),
    [conversations]
  );
  const selectedConversationIsAvailable = selectedConversationId
    ? availableConversationIds.has(selectedConversationId)
    : false;
  const effectiveConversationId = selectedConversationIsAvailable ? selectedConversationId : undefined;
  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === effectiveConversationId),
    [conversations, effectiveConversationId]
  );

  const historyQuery = useQuery({
    queryKey: ["chat", "conversation", effectiveConversationId],
    queryFn: () => getConversationHistory(effectiveConversationId as string),
    enabled: Boolean(effectiveConversationId),
    retry: false,
    placeholderData: keepPreviousData,
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
    setSelectedConversationId(undefined);
    queryClient.removeQueries({ queryKey: ["chat", "conversation", selectedConversationId] });
  }, [conversationsQuery.data, queryClient, selectedConversationId, selectedConversationIsAvailable]);

  // Close sidebar when screen grows to desktop width
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => { if (e.matches) setSidebarOpen(false); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const createMutation = useMutation({
    mutationFn: () => createSavedConversation(null),
    onSuccess: async (conversation) => {
      queryClient.setQueryData<SavedConversationListResponse | undefined>(["chat", "conversations"], (current) =>
        prependConversationToList(current, conversation)
      );
      setSelectedConversationId(conversation.id);
      rememberLastOpenedConversationId(conversation.id);
      setStatusMessage(null);
      setSidebarOpen(false);
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
        queryClient.setQueryData<SavedConversationListResponse | undefined>(["chat", "conversations"], (current) =>
          prependConversationToList(current, created)
        );
        conversationId = created.id;
        setSelectedConversationId(created.id);
        rememberLastOpenedConversationId(created.id);
      }
      const result = await sendChatMessage(text, conversationId);
      return { ...result, submittedText: text };
    },
    onSuccess: async (data) => {
      setStatusMessage(null);
      setSelectedConversationId(data.conversationId);
      rememberLastOpenedConversationId(data.conversationId);

      queryClient.setQueryData<ConversationHistory | undefined>(["chat", "conversation", data.conversationId], (current) => {
        if (!current) return current;
        const nextIndex = current.turns.reduce((max, turn) => Math.max(max, turn.turnIndex), -1) + 1;
        const now = new Date().toISOString();
        const optimisticTurns: ConversationTurn[] = [
          {
            conversationId: data.conversationId,
            turnIndex: nextIndex,
            role: "user",
            content: data.submittedText,
            model: null,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            latencyMs: 0,
            createdAt: now,
          },
          {
            conversationId: data.conversationId,
            turnIndex: nextIndex + 1,
            role: "assistant",
            content: data.replyText,
            model: null,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: data.totalCostUsd,
            latencyMs: 0,
            createdAt: now,
          },
        ];
        return {
          ...current,
          conversation: {
            ...current.conversation,
            turnCount: data.turnCount,
            totalCostUsd: data.totalCostUsd,
            terminationReason: data.terminationReason,
            updatedAt: now,
            lastActivityAt: now,
          },
          turns: [...current.turns, ...optimisticTurns],
        };
      });

      await queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversation", data.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      setPendingMessage(null);
    },
    onError: (error) => {
      setPendingMessage(null);
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      setStatusMessage(getApiErrorMessage(error, "Could not send that message. Please try again."));
    },
  });

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (messages.length === 0 && !sendMutation.isPending) return;

    if (!hasScrolledInitially.current && messages.length > 0) {
      container.scrollTop = container.scrollHeight;
      hasScrolledInitially.current = true;
      return;
    }

    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, historyQuery.isFetching, sendMutation.isPending]);

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
      const nextConversation = conversations.find((c) => c.id !== archivedId);
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
  const isSendBlocked = isBusy || Boolean(budgetBlockReason) || balanceQuery.isLoading;
  const hasConversations = conversations.length > 0;
  const showEmptyHistory = Boolean(effectiveConversationId) && !historyQuery.isLoading && messages.length === 0;

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    rememberLastOpenedConversationId(conversationId);
    setStatusMessage(null);
    setEditingConversationId(null);
    setSidebarOpen(false);
  };

  const handleNewChat = () => {
    if (!createMutation.isPending) createMutation.mutate();
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    if (budgetBlockReason) {
      setStatusMessage(budgetBlockReason);
      return;
    }
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
    if (!title) { setRenameError("Enter a title before saving the rename."); return; }
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
  const staleSelectionError = selectedConversationId && conversationsQuery.data && !selectedConversationIsAvailable && !isBusy
    ? "That saved chat is no longer available. Choose another chat or start a new one."
    : null;
  const historyError = historyQuery.error
    ? getApiErrorMessage(historyQuery.error, "Could not open that saved chat. Please try again.")
    : null;
  const activeError = statusMessage ?? historyError ?? staleSelectionError ?? conversationError;

  // Sidebar panel — shared between drawer (mobile) and static (desktop)
  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-sm font-bold" style={{ color: "var(--color-fg-default)" }}>
          Chats
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleNewChat}
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: "var(--color-accent-blue)", color: "#fff" }}
            aria-label="Create new chat"
          >
            {createMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            New
          </button>
          {/* Close button — mobile only */}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden inline-flex items-center justify-center rounded-xl p-1.5"
            style={{ color: "var(--color-fg-muted)" }}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {conversationError && (
        <div className="mx-3 mb-2 rounded-xl border px-3 py-2 text-xs" role="alert" style={{ borderColor: "rgba(239,68,68,0.35)", color: "var(--color-accent-red)" }}>
          {conversationError}
        </div>
      )}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {conversationsQuery.isLoading && (
          <div className="flex items-center gap-2 py-4 text-xs" style={{ color: "var(--color-fg-muted)" }}>
            <Loader2 size={13} className="animate-spin" />
            Loading…
          </div>
        )}

        {!conversationsQuery.isLoading && !conversationError && !hasConversations && (
          <div className="rounded-2xl border px-4 py-5 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
            No saved chats yet.
          </div>
        )}

        <div className="space-y-1.5" role="list" aria-label="Saved conversation list">
          {conversations.map((conversation) => {
            const isSelected = conversation.id === effectiveConversationId;
            const isEditing = editingConversationId === conversation.id;
            const isArchiving = archiveMutation.isPending && archiveMutation.variables === conversation.id;
            return (
              <div
                key={conversation.id}
                role="listitem"
                className={clsx("rounded-2xl border transition-colors", isSelected && "shadow-sm")}
                style={{
                  borderColor: isSelected ? "var(--color-accent-blue)" : "var(--color-border)",
                  background: isSelected ? "rgba(59,130,246,0.10)" : "transparent",
                }}
              >
                {isEditing ? (
                  <div className="space-y-2 p-2">
                    <label className="sr-only" htmlFor={`rename-${conversation.id}`}>Rename saved chat</label>
                    <input
                      id={`rename-${conversation.id}`}
                      value={renameTitle}
                      onChange={(e) => { setRenameTitle(e.target.value); setRenameError(null); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveRename(conversation.id);
                        if (e.key === "Escape") handleCancelRename();
                      }}
                      className="w-full rounded-lg border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-2"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-fg-default)" }}
                      disabled={renameMutation.isPending}
                    />
                    {renameError && (
                      <p className="text-xs" role="alert" style={{ color: "var(--color-accent-red)" }}>{renameError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveRename(conversation.id)}
                        disabled={renameMutation.isPending || !renameTitle.trim()}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                        style={{ background: "var(--color-accent-blue)", color: "#fff" }}
                      >
                        {renameMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRename}
                        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}
                      >
                        <X size={12} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group">
                    <button
                      type="button"
                      onClick={() => handleSelectConversation(conversation.id)}
                      className="block w-full px-3 py-2.5 text-left"
                      aria-current={isSelected ? "true" : undefined}
                    >
                      <span className="block truncate text-sm font-medium" style={{ color: "var(--color-fg-default)" }}>
                        {titleForConversation(conversation)}
                      </span>
                      <span className="block text-xs" style={{ color: "var(--color-fg-subtle)" }}>
                        {formatConversationMeta(conversation)}
                      </span>
                    </button>
                    <div className="flex gap-1 px-2 pb-2">
                      <button
                        type="button"
                        onClick={() => handleStartRename(conversation)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
                        style={{ color: "var(--color-fg-muted)" }}
                        aria-label={`Rename ${titleForConversation(conversation)}`}
                      >
                        <Pencil size={11} />
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
                        {isArchiving ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        Archive
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{
        background: "var(--color-bg-base)",
      }}
    >
      {/* ── Mobile drawer overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ background: "rgba(0,0,0,0.68)" }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar: drawer on mobile, static on desktop ── */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r transition-transform duration-250 ease-in-out",
          "lg:relative lg:inset-auto lg:z-auto lg:flex lg:translate-x-0 lg:w-72",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-bg-base)",
          top: "0",
          bottom: "0",
        }}
        aria-label="Saved chats"
      >
        {sidebarContent}
      </aside>

      {/* ── Main chat area ── */}
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Selected chat">
        {/* Top bar */}
        <div
          className="flex shrink-0 items-center gap-2 border-b px-3 py-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}
        >
          {/* Open sidebar button — mobile only */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden inline-flex shrink-0 items-center justify-center rounded-xl p-1.5 transition-colors"
            style={{ color: "var(--color-fg-muted)", background: "var(--color-bg-subtle)" }}
            aria-label="Open chat list"
          >
            <ChevronLeft size={20} />
          </button>

          <MessageCircle size={17} className="shrink-0" style={{ color: "var(--color-accent-blue)" }} aria-hidden="true" />
          <div className="min-w-0 flex-1 pr-2">
            <h1 className="truncate text-sm font-bold" style={{ color: "var(--color-fg-default)" }}>
              {selectedConversation ? titleForConversation(selectedConversation) : "Portfolio chat"}
            </h1>
            {!selectedConversation && (
              <p className="text-xs leading-none" style={{ color: "var(--color-fg-subtle)" }}>
                Type to start a new chat
              </p>
            )}
          </div>
          {selectedConversation && (
            <span className="hidden shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] sm:inline-flex" style={{ background: "rgba(59,130,246,0.10)", color: "var(--color-accent-blue)" }}>
              Saved
            </span>
          )}
          <span
            className="shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold tabular-nums"
            style={{
              borderColor: balanceQuery.data?.exhausted || budgetBlockReason ? "rgba(226,80,80,0.35)" : "rgba(66,201,122,0.28)",
              background: balanceQuery.data?.exhausted || budgetBlockReason ? "rgba(226,80,80,0.08)" : "rgba(66,201,122,0.08)",
              color: balanceQuery.data?.exhausted || budgetBlockReason ? "var(--color-red)" : "var(--color-green)",
            }}
            aria-label="Chat points remaining"
          >
            {chatPointsLabel(balanceQuery.data)}
          </span>
        </div>

        {/* Error banner */}
        {activeError && (
          <div className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-xl border px-3 py-2 text-sm" role="alert" style={{ borderColor: "rgba(239,68,68,0.35)", color: "var(--color-accent-red)", background: "rgba(239,68,68,0.08)" }}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p>{activeError}</p>
              {conversationError && (
                <button type="button" onClick={() => void conversationsQuery.refetch()} className="mt-1 text-xs font-semibold underline">
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={messagesContainerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {!effectiveConversationId && !historyQuery.isLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <MessageCircle size={44} style={{ color: "var(--color-fg-subtle)" }} aria-hidden="true" />
              <div className="max-w-xs space-y-2">
                <h2 className="text-lg font-bold" style={{ color: "var(--color-fg-default)" }}>
                  Ask about your portfolio
                </h2>
                <p className="text-sm" style={{ color: "var(--color-fg-muted)" }}>
                  Just type below — a new chat will be created automatically when you send.
                </p>
              </div>
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
              <MessageCircle size={36} style={{ color: "var(--color-fg-subtle)" }} aria-hidden="true" />
              <p className="max-w-xs text-sm" style={{ color: "var(--color-fg-muted)" }}>
                This chat is ready. Send a message to begin.
              </p>
            </div>
          )}

          <div className="space-y-3">
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
                      className="inline-flex max-w-[88%] items-start gap-2 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm"
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
                        "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                        message.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"
                      )}
                      style={
                        message.role === "user"
                          ? { background: "var(--color-accent-blue)", color: "#fff" }
                          : message.isError
                            ? { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--color-accent-red)" }
                            : { background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }
                      }
                    >
                      {message.isError && <AlertCircle size={14} className="mb-0.5 mr-1 inline" aria-hidden="true" />}
                      <span style={{ whiteSpace: "pre-wrap" }}>{renderChatText(message.content)}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {sendMutation.isPending && pendingMessage && (
              <div className="flex flex-col items-end gap-1">
                <div
                  className="max-w-[88%] rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed opacity-80"
                  style={{ background: "var(--color-accent-blue)", color: "#fff" }}
                >
                  <span style={{ whiteSpace: "pre-wrap" }}>{pendingMessage}</span>
                </div>
              </div>
            )}

            {sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border px-3.5 py-2.5 text-sm" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)", color: "var(--color-fg-muted)" }}>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  <span>Thinking…</span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
          {budgetBlockReason && (
            <div className="mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs" role="status" style={{ borderColor: "rgba(226,80,80,0.28)", background: "rgba(226,80,80,0.08)", color: "var(--color-accent-red)" }}>
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{budgetBlockReason}</span>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-base)" }}>
            <label className="sr-only" htmlFor="chat-message-input">Message portfolio chat</label>
            <textarea
              id="chat-message-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your portfolio…"
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm outline-none"
              style={{ color: "var(--color-fg-default)", maxHeight: "120px", lineHeight: "1.5" }}
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isSendBlocked}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: input.trim() && !isSendBlocked ? "var(--color-accent-blue)" : "var(--color-bg-muted)",
                color: input.trim() && !isSendBlocked ? "#fff" : "var(--color-fg-subtle)",
              }}
              aria-label="Send message"
            >
              {sendMutation.isPending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
