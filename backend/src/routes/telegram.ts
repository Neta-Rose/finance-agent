import express from "express";
import { lookupByChannelId, setConversationId } from "../services/channelBindingStore.js";
import { agentChat } from "../services/chat/agentChat.js";
import { logger } from "../services/logger.js";
import { completeChannelBinding } from "./channels.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

/**
 * Telegram webhook — Phase 6, task 6.2.
 *
 * Spec: design.md §9.2; D1.1–D1.4.
 *
 * Thin transport: verify secret → resolve channel binding → call agentChat
 * → deliver reply. No slash-command parsing (D1.4). No content branching.
 *
 * The strict refuse-to-start guard for TELEGRAM_SECRET lands in Phase 9.
 * For now: log + reject malformed requests.
 */

const router = express.Router();

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}

async function deliverTelegramReply(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  const chunks = splitMessage(text, TELEGRAM_MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          }),
        }
      );
      if (!response.ok) {
        const body = await response.text();
        logger.warn(`Telegram delivery failed: ${body.slice(0, 200)}`);
      }
    } catch (err) {
      logger.warn(`Telegram delivery error: ${(err as Error).message}`);
    }
  }
}

async function getBotTokenForUser(userId: string): Promise<string | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  try {
    const ds = await getApplicationDataSource();
    const rows = await ds.query(
      `SELECT ciphertext FROM encrypted_secrets
        WHERE user_id = $1 AND secret_kind = 'telegram_bot_token'
        LIMIT 1`,
      [userId]
    ) as Array<{ ciphertext: Buffer }>;
    const row = rows[0];
    if (!row) return null;
    // Phase 1 identity encryption: ciphertext IS the plaintext
    return row.ciphertext.toString("utf-8");
  } catch {
    return null;
  }
}

router.post("/telegram/webhook", async (req, res) => {
  // 1. Verify secret token (Phase 9 adds the strict startup guard)
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (process.env["TELEGRAM_SECRET"] && secret !== process.env["TELEGRAM_SECRET"]) {
    if (isApplicationDatabaseConfigured()) {
      try {
        const ds = await getApplicationDataSource();
        await ds.query(
          `INSERT INTO admin_audit_log
             (actor_admin_id, action_type, target_user_id, args_json, result_status, request_id, ip_address, occurred_at)
           VALUES ('telegram_webhook', 'telegram_webhook_signature_failed', NULL, '{}'::jsonb, 'rejected', gen_random_uuid()::text, $1, NOW())`,
          [req.ip ?? null]
        );
      } catch { /* audit failure must not block */ }
    }
    res.status(200).json({ ok: true }); // Telegram requires 200
    return;
  }

  try {
    const update = req.body;
    const message = update?.message;
    if (!message?.text || !message?.chat?.id) {
      res.json({ ok: true });
      return;
    }

    const chatId = String(message.chat.id);
    const text = (message.text as string).trim();

    // 2. Handle channel-binding connect code
    const connectMatch = text.match(/^(?:\/connect\s+|connect\s+)([A-Fa-f0-9]{6})$/i);
    if (connectMatch) {
      const code = connectMatch[1]!;
      const result = await completeChannelBinding(code, "telegram", chatId);
      if (result.success && result.userId) {
        const botToken = await getBotTokenForUser(result.userId);
        if (botToken) {
          await deliverTelegramReply(botToken, chatId, result.message);
        }
      }
      res.json({ ok: true });
      return;
    }

    // 3. Resolve channel binding (D1.1)
    const binding = await lookupByChannelId("telegram", chatId);
    if (!binding) {
      if (isApplicationDatabaseConfigured()) {
        try {
          const ds = await getApplicationDataSource();
          await ds.query(
            `INSERT INTO admin_audit_log
               (actor_admin_id, action_type, target_user_id, args_json, result_status, request_id, ip_address, occurred_at)
             VALUES ('telegram_webhook', 'unknown_channel', NULL, $1::jsonb, 'rejected', gen_random_uuid()::text, $2, NOW())`,
            [JSON.stringify({ chatId }), req.ip ?? null]
          );
        } catch { /* audit failure must not block */ }
      }
      res.json({ ok: true });
      return;
    }

    // 4. Resolve or create conversation id (D1.2)
    let conversationId = binding.conversationId ?? undefined;

    // 5. Call agentChat (D1.2)
    const result = await agentChat({
      userId: binding.userId,
      text,
      channel: "telegram",
      conversationId,
    });

    // Persist conversation id on the binding for future messages
    if (!binding.conversationId && result.conversationId) {
      await setConversationId("telegram", chatId, result.conversationId);
    }

    // 6. Deliver reply (D1.3) — length truncation only
    const botToken = await getBotTokenForUser(binding.userId);
    if (botToken) {
      await deliverTelegramReply(botToken, chatId, result.replyText);
    } else {
      logger.warn(`No bot token found for user ${binding.userId}, cannot deliver Telegram reply`);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error("Telegram webhook error", { err });
    res.json({ ok: true }); // Always 200 to Telegram
  }
});

export default router;
