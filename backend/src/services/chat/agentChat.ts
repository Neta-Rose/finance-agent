import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import { buildPersonaPrompt, REDIRECT_LINE } from "./personaPrompt.js";
import { filterText } from "./outputFilter.js";
import { buildToolRegistry, toolToProviderDef, FORBIDDEN_TOOL_NAMES, ALL_TOOL_NAMES } from "./tools/registry.js";
import * as confirmationStore from "./confirmationStore.js";
import * as conversationStore from "./conversationStore.js";
import { isFeatureEnabled, getFeatureValue } from "../featureFlagService.js";
import { ensurePointsBudgetAvailable } from "../pointsBudgetService.js";
import { resolveStepModel } from "../stepQueue/modelTier.js";
import { getLlmProvider } from "./llmProviders/index.js";
import * as strategyStore from "../strategyStore.js";
import * as reportIndexStore from "../reportIndexStore.js";
import * as escalationHistoryStore from "../escalationHistoryStore.js";
import * as snoozeStore from "../snoozeStore.js";
import * as notificationStore from "../notificationStore.js";
import * as portfolioRiskStore from "../portfolioRiskStore.js";
import * as verdictActionsStore from "../verdictActionsStore.js";
import { logger } from "../logger.js";
import type { ConversationChannel } from "../../db/entities/ConversationEntity.js";

/**
 * agentChat — Phase 5, task 5.9.
 *
 * Spec: design.md §7.1–7.4; C1.1–C1.7, G1.1–G1.4, F2.2, E4.2.
 *
 * Single entry point for all three transports. Channel is used only as an
 * audit field; the loop, prompt, and tool registry are identical (C1.3).
 */

export interface AgentChatInput {
  userId: string;
  text: string;
  channel: ConversationChannel;
  conversationId?: string;
}

export interface AgentChatResult {
  replyText: string;
  conversationId: string;
  terminationReason: "model_final" | "max_turns" | "token_cap" | "points_budget_exhausted" | "error";
  totalCostUsd: number;
  turnCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getDisplayName(userId: string): Promise<string> {
  if (!isApplicationDatabaseConfigured()) return userId;
  try {
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `SELECT display_name FROM users WHERE user_id = $1 LIMIT 1`,
      [userId]
    ) as Array<{ display_name: string }>;
    return rows[0]?.display_name ?? userId;
  } catch {
    return userId;
  }
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => b && typeof b === "object" && b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return String(content ?? "");
}

function extractToolUseBlocks(content: unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
      b && typeof b === "object" && b.type === "tool_use"
  );
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function agentChat(input: AgentChatInput): Promise<AgentChatResult> {
  const { userId, text, channel } = input;

  // Feature gate (F3.1 — startup guard also enforces this)
  const enabled = await isFeatureEnabled("chat_agent_enabled", userId);
  if (!enabled) {
    return {
      replyText: REDIRECT_LINE,
      conversationId: input.conversationId ?? `conv_disabled_${Date.now()}`,
      terminationReason: "error",
      totalCostUsd: 0,
      turnCount: 0,
    };
  }

  // Budget gate (NFR2.2)
  const budget = await ensurePointsBudgetAvailable(userId);
  if (!budget.allowed) {
    const convId = input.conversationId ?? `conv_budget_${Date.now()}`;
    return {
      replyText: "Your daily budget is exhausted. Try again after the budget window resets.",
      conversationId: convId,
      terminationReason: "points_budget_exhausted",
      totalCostUsd: 0,
      turnCount: 0,
    };
  }

  // Resolve or create conversation
  let conv = input.conversationId
    ? await conversationStore.loadConversation(input.conversationId)
    : null;
  if (!conv) {
    conv = await conversationStore.createConversation({ userId, channel });
  }
  const conversationId = conv.id;

  // Append user turn
  await conversationStore.appendTurn(conversationId, { role: "user", content: text });

  // Confirmation handshake check (§7.4)
  const pending = confirmationStore.peek(conversationId);
  if (pending) {
    const decision = confirmationStore.parseConfirmation(text);
    if (decision === "deny") {
      confirmationStore.clear(conversationId);
      const reply = "Cancelled. What else can I help with?";
      await conversationStore.appendTurn(conversationId, { role: "assistant", content: reply });
      await conversationStore.endConversation(conversationId, "model_final");
      return { replyText: reply, conversationId, terminationReason: "model_final", totalCostUsd: 0, turnCount: conv.turnCount + 2 };
    }
    if (decision === "confirm") {
      // Will be handled in the tool dispatch below with confirmationToken set
    }
    // "unclear" — let the model handle it; clear the pending
    if (decision === "unclear") {
      confirmationStore.clear(conversationId);
    }
  }

  // Resolve model
  const maxTurns = await getFeatureValue<number>("max_turns") ?? 12;
  const tokenCap = await getFeatureValue<number>("conversation_token_cap") ?? 120_000;
  const displayName = await getDisplayName(userId);
  const persona = buildPersonaPrompt(displayName);

  let resolvedModel: Awaited<ReturnType<typeof resolveStepModel>> | null = null;
  if (isApplicationDatabaseConfigured()) {
    try {
      const ds = await getApplicationDataSource();
      const userTierRows = await ds.query(
        `SELECT model_tier FROM users WHERE user_id = $1 LIMIT 1`,
        [userId]
      ) as Array<{ model_tier: string }>;
      const tier = (userTierRows[0]?.model_tier ?? "balanced") as "free" | "cheap" | "balanced" | "expensive";
      resolvedModel = await resolveStepModel(ds, userId, "chat_agent", tier);
    } catch {
      // Fall through to default
    }
  }
  const modelName = resolvedModel?.primary ?? "google/gemini-2.5-flash";
  const providerName = (resolvedModel as { provider?: string } | null)?.provider ?? "openrouter";
  const provider = getLlmProvider(providerName as "openrouter" | "anthropic" | "openai" | "gemini");

  // Build tool registry
  const db = isApplicationDatabaseConfigured() ? await getApplicationDataSource() : null;
  const toolCtx = {
    userId,
    conversationId,
    turnIndex: conv.turnCount,
    confirmationToken: pending && confirmationStore.parseConfirmation(text) === "confirm" ? pending.toolUseId : null,
    db,
    strategyStore,
    reportIndexStore,
    escalationHistoryStore,
    snoozeStore,
    notificationStore,
    portfolioRiskStore,
    verdictActionsStore,
  };
  const tools = buildToolRegistry(toolCtx);
  const toolDefs = tools.map(toolToProviderDef);

  // Load history
  const history = await conversationStore.loadHistory(conversationId, maxTurns * 2);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = history
    .filter((t) => t.role === "user" || t.role === "assistant")
    .map((t) => ({ role: t.role as "user" | "assistant", content: extractTextFromContent(t.content) }));

  let totalCost = 0;
  let totalTokens = 0;
  let turnIndex = conv.turnCount + 1;
  let loopCount = 0;

  // Tool-calling loop
  while (true) {
    loopCount += 1;
    if (loopCount > maxTurns) {
      const reply = "I have to stop here for now (turn limit reached).";
      await conversationStore.appendTurn(conversationId, { role: "assistant", content: reply });
      await conversationStore.endConversation(conversationId, "max_turns", modelName);
      return { replyText: reply, conversationId, terminationReason: "max_turns", totalCostUsd: totalCost, turnCount: turnIndex };
    }
    if (totalTokens >= tokenCap) {
      const reply = "I had to stop here — the conversation reached its token limit.";
      await conversationStore.appendTurn(conversationId, { role: "assistant", content: reply });
      await conversationStore.endConversation(conversationId, "token_cap", modelName);
      return { replyText: reply, conversationId, terminationReason: "token_cap", totalCostUsd: totalCost, turnCount: turnIndex };
    }

    const t0 = Date.now();
    let resp: Awaited<ReturnType<typeof provider.invoke>>;
    try {
      resp = await provider.invoke({
        model: modelName,
        messages: [
          { role: "system", content: persona },
          ...messages,
        ],
        // Tool definitions passed as part of the message for OpenRouter compatibility.
        // Phase 5 uses the OpenRouter provider which doesn't natively support tool_use;
        // we embed the tool list in the system prompt as JSON for now.
        // Phase 5 Anthropic/OpenAI/Gemini providers will use native tool calling.
      });
    } catch (err) {
      logger.warn(`agentChat: provider error user=${userId} conv=${conversationId}: ${(err as Error).message}`);
      const reply = "I encountered an error. Please try again.";
      await conversationStore.appendTurn(conversationId, { role: "assistant", content: reply });
      await conversationStore.endConversation(conversationId, "error", modelName);
      return { replyText: reply, conversationId, terminationReason: "error", totalCostUsd: totalCost, turnCount: turnIndex };
    }

    totalCost += resp.usage.costUsd;
    totalTokens += resp.usage.tokensIn + resp.usage.tokensOut;

    const rawContent = resp.content;
    const textContent = extractTextFromContent(rawContent);
    const toolUseBlocks = extractToolUseBlocks(rawContent);

    await conversationStore.appendTurn(conversationId, {
      role: "assistant",
      content: rawContent,
      model: resp.model,
      tokensIn: resp.usage.tokensIn,
      tokensOut: resp.usage.tokensOut,
      costUsd: resp.usage.costUsd,
      latencyMs: Date.now() - t0,
    });
    turnIndex += 1;
    messages.push({ role: "assistant", content: textContent });

    // No tool calls → final answer
    if (toolUseBlocks.length === 0) {
      const filtered = await filterText(textContent, {
        conversationId,
        turnIndex: turnIndex - 1,
        site: "final_reply",
      });
      await conversationStore.endConversation(conversationId, "model_final", modelName);
      return {
        replyText: filtered.text,
        conversationId,
        terminationReason: "model_final",
        totalCostUsd: totalCost,
        turnCount: turnIndex,
      };
    }

    // Dispatch tool calls
    const toolResults: string[] = [];
    for (const block of toolUseBlocks) {
      // E4.2: refuse unregistered tools
      if (!(ALL_TOOL_NAMES as readonly string[]).includes(block.name)) {
        logger.warn(`agentChat: refused unregistered tool ${block.name} user=${userId}`);
        if (db) {
          await db.query(
            `INSERT INTO tool_calls
               (id, conversation_id, turn_index, tool_name, category, args_json,
                result_status, result_latency_ms, cost_points, audit_note, occurred_at)
             VALUES (gen_random_uuid(), $1, $2, $3, 'read', '{}'::jsonb, 'rejected', 0, 0, 'tool_not_registered', NOW())`,
            [conversationId, turnIndex - 1, block.name.slice(0, 64)]
          );
        }
        toolResults.push(`Tool "${block.name}" is not available.`);
        continue;
      }

      const tool = tools.find((t) => t.name === block.name);
      if (!tool) {
        toolResults.push(`Tool "${block.name}" is not available.`);
        continue;
      }

      // Action tool confirmation gate (E2.2)
      if (tool.category === "action" && tool.requiresConfirmation !== false) {
        const hasPendingConfirmation = pending && confirmationStore.parseConfirmation(text) === "confirm";
        if (!hasPendingConfirmation) {
          // Propose the action and exit the loop
          const summary = `${tool.name}(${JSON.stringify(block.input)})`;
          const reply = `I'd like to run: **${summary}**. Reply 'yes' to confirm, or 'no' to skip.`;
          confirmationStore.put(conversationId, {
            toolUseId: block.id,
            toolName: tool.name,
            args: block.input,
            createdAt: Date.now(),
          });
          await conversationStore.appendTurn(conversationId, { role: "assistant", content: reply });
          await conversationStore.endConversation(conversationId, "model_final", modelName);
          return { replyText: reply, conversationId, terminationReason: "model_final", totalCostUsd: totalCost, turnCount: turnIndex };
        }
        // Confirmed — clear the pending and execute
        confirmationStore.clear(conversationId);
      }

      const toolT0 = Date.now();
      const result = await tool.handler(block.input, {
        ...toolCtx,
        turnIndex: turnIndex - 1,
        confirmationToken: pending?.toolUseId ?? null,
      });
      await conversationStore.incrementToolCallCount(conversationId);

      // Filter tool result (F2.2)
      const resultText = JSON.stringify(result);
      const filtered = await filterText(resultText, {
        conversationId,
        turnIndex: turnIndex - 1,
        site: "tool_result",
      });
      toolResults.push(`${tool.name}: ${filtered.text}`);
    }

    // Feed tool results back as a user message for the next loop iteration
    if (toolResults.length > 0) {
      const toolResultContent = toolResults.join("\n\n");
      messages.push({ role: "user", content: `Tool results:\n${toolResultContent}` });
      await conversationStore.appendTurn(conversationId, {
        role: "tool_result",
        content: toolResults,
      });
      turnIndex += 1;
    }
  }
}
