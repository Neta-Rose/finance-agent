import express from "express";
import { createHmac } from "crypto";
import { lookupByChannelId, setConversationId } from "../services/channelBindingStore.js";
import { readEncryptedSecret } from "../services/security/encryptedSecretsStore.js";
import { agentChat } from "../services/chat/agentChat.js";
import { logger } from "../services/logger.js";
import { completeChannelBinding } from "./channels.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

/**
 * WhatsApp webhook — Phase 6, task 6.4.
 *
 * Spec: design.md §9.3; D2.1–D2.5.
 *
 * Provider: Meta WhatsApp Cloud API direct.
 *
 * GET  /api/whatsapp/webhook — webhook verification (hub.challenge)
 * POST /api/whatsapp/webhook — inbound message handling
 *
 * Mounted BEFORE CSRF middleware in app.ts (webhooks sign their own bodies).
 * Backend refuses to start if WHATSAPP_VERIFY_TOKEN is unset (D2.5) —
 * enforced by the startup guard added in Phase 9; for now we log a warning.
 */

const router = express.Router();

const WHATSAPP_GRAPH_VERSION = process.env["WHATSAPP_GRAPH_VERSION"] ?? "v17.0";
const WHATSAPP_MAX_MESSAGE_LENGTH = 4096;

// ---------------------------------------------------------------------------
// HMAC signature verification (D2.2)
// ---------------------------------------------------------------------------

async function verifyWhatsAppSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string
): Promise<boolean> {
  if (!signature) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Outbound delivery (task 6.5)
// ---------------------------------------------------------------------------

export async function deliverWhatsAppMessage(
  userId: string,
  text: string
): Promise<void> {
  const secret = await readEncryptedSecret(userId, "whatsapp_access_token");
  if (!secret) {
    logger.warn(`No WhatsApp access token for user ${userId}`);
    return;
  }
  const accessToken = secret.plaintext;

  // Get phone number id from encrypted_secrets (stored as whatsapp_app_secret for now)
  // In a full implementation this would be a separate secret_kind.
  // For Phase 6 we read the recipient phone from channel_bindings.
  if (!isApplicationDatabaseConfigured()) return;
  const ds = await getApplicationDataSource();
  const rows = await ds.query(
    `SELECT channel_identifier FROM channel_bindings
      WHERE user_id = $1 AND channel = 'whatsapp' AND unbound_at IS NULL
      LIMIT 1`,
    [userId]
  ) as Array<{ channel_identifier: string }>;
  const phone = rows[0]?.channel_identifier;
  if (!phone) return;

  const truncated = text.slice(0, WHATSAPP_MAX_MESSAGE_LENGTH);
  try {
    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phone}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "text",
          text: { preview_url: false, body: truncated },
        }),
      }
    );
    if (!response.ok) {
      const body = await response.text();
      logger.warn(`WhatsApp delivery failed: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    logger.warn(`WhatsApp delivery error: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// GET /api/whatsapp/webhook — verification
// ---------------------------------------------------------------------------

router.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env["WHATSAPP_VERIFY_TOKEN"]) {
    res.status(200).send(String(challenge));
  } else {
    res.status(403).end();
  }
});

// ---------------------------------------------------------------------------
// POST /api/whatsapp/webhook — inbound messages
// ---------------------------------------------------------------------------

// Raw body middleware for HMAC verification
router.use("/whatsapp/webhook", express.raw({ type: "application/json" }));

router.post("/whatsapp/webhook", async (req, res) => {
  // 1. Verify HMAC signature (D2.2)
  const rawBody = req.body as Buffer;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  // Get app secret from encrypted_secrets (system-level, user_id='system')
  // For Phase 6 we fall back to env var if no DB row exists.
  let appSecret = process.env["WHATSAPP_APP_SECRET"] ?? "";
  if (!appSecret && isApplicationDatabaseConfigured()) {
    try {
      const ds = await getApplicationDataSource();
      const rows = await ds.query(
        `SELECT ciphertext FROM encrypted_secrets
          WHERE user_id = 'system' AND secret_kind = 'whatsapp_app_secret'
          LIMIT 1`,
        []
      ) as Array<{ ciphertext: Buffer }>;
      if (rows[0]) appSecret = rows[0].ciphertext.toString("utf-8");
    } catch { /* fall through */ }
  }

  if (appSecret) {
    const valid = await verifyWhatsAppSignature(rawBody, signature, appSecret);
    if (!valid) {
      if (isApplicationDatabaseConfigured()) {
        try {
          const ds = await getApplicationDataSource();
          await ds.query(
            `INSERT INTO admin_audit_log
               (actor_admin_id, action_type, target_user_id, args_json, result_status, request_id, ip_address, occurred_at)
             VALUES ('whatsapp_webhook', 'whatsapp_webhook_signature_failed', NULL, '{}'::jsonb, 'rejected', gen_random_uuid()::text, $1, NOW())`,
            [req.ip ?? null]
          );
        } catch { /* audit failure must not block */ }
      }
      res.status(403).end();
      return;
    }
  }

  // Parse body (was raw for HMAC)
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
  } catch {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const entry = (body["entry"] as Array<Record<string, unknown>>)?.[0];
    const change = (entry?.["changes"] as Array<Record<string, unknown>>)?.[0];
    const value = change?.["value"] as Record<string, unknown> | undefined;
    const messages = (value?.["messages"] as Array<Record<string, unknown>>) ?? [];

    for (const msg of messages) {
      if (msg["type"] !== "text") continue;
      const phone = String(msg["from"] ?? "");
      const text = (msg["text"] as Record<string, unknown>)?.["body"] as string | undefined;
      if (!phone || !text) continue;

      // Handle channel-binding connect code
      const connectMatch = text.trim().match(/^(?:\/connect\s+|connect\s+)([A-Fa-f0-9]{6})$/i);
      if (connectMatch) {
        const code = connectMatch[1]!;
        const result = await completeChannelBinding(code, "whatsapp", phone);
        if (result.success && result.userId) {
          await deliverWhatsAppMessage(result.userId, result.message);
        }
        continue;
      }

      // Resolve channel binding (D2.3)
      const binding = await lookupByChannelId("whatsapp", phone);
      if (!binding) continue;

      // Call agentChat
      const convId = binding.conversationId ?? undefined;
      const result = await agentChat({
        userId: binding.userId,
        text: text.trim(),
        channel: "whatsapp",
        ...(convId ? { conversationId: convId } : {}),
      });

      if (!binding.conversationId && result.conversationId) {
        await setConversationId("whatsapp", phone, result.conversationId);
      }

      await deliverWhatsAppMessage(binding.userId, result.replyText);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("WhatsApp webhook error", { err });
    res.status(200).json({ ok: true });
  }
});

export default router;
