import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { bindChannel } from "../services/channelBindingStore.js";
import { logger } from "../services/logger.js";
import { randomBytes } from "crypto";

/**
 * Channel-binding routes — Phase 6, task 6.1.
 *
 * Spec: design.md §9.4; D1.1, D2.3.
 *
 * POST /api/channels/binding-codes — issue a 6-char code for the user to
 *   send to their Telegram or WhatsApp bot. Code is stored in an in-memory
 *   map with a 15-minute TTL.
 *
 * The webhook handlers (telegram.ts, whatsapp.ts) parse "connect ABC123"
 * and call `completeChannelBinding` to insert the `channel_bindings` row.
 */

const router = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ---------------------------------------------------------------------------
// In-memory pending-code store (15-minute TTL)
// ---------------------------------------------------------------------------

interface PendingCode {
  userId: string;
  code: string;
  expiresAt: number;
}

const pendingCodes = new Map<string, PendingCode>(); // code → entry
const CODE_TTL_MS = 15 * 60 * 1000;

function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase(); // 6 hex chars
}

function pruneExpiredCodes(): void {
  const now = Date.now();
  for (const [code, entry] of pendingCodes.entries()) {
    if (now > entry.expiresAt) pendingCodes.delete(code);
  }
}

export function lookupPendingCode(code: string): PendingCode | null {
  pruneExpiredCodes();
  const entry = pendingCodes.get(code.toUpperCase());
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry;
}

export function consumePendingCode(code: string): PendingCode | null {
  const entry = lookupPendingCode(code);
  if (entry) pendingCodes.delete(code.toUpperCase());
  return entry;
}

// ---------------------------------------------------------------------------
// Complete a channel binding (called by webhook handlers)
// ---------------------------------------------------------------------------

export async function completeChannelBinding(
  code: string,
  channel: "telegram" | "whatsapp",
  channelIdentifier: string
): Promise<{ success: boolean; userId?: string; message: string }> {
  const pending = consumePendingCode(code);
  if (!pending) {
    return { success: false, message: "Code not found or expired. Use /connect from the Settings page to get a new code." };
  }
  try {
    await bindChannel({ channel, channelIdentifier, userId: pending.userId, conversationId: null });
    logger.info(`Channel binding complete: user=${pending.userId} channel=${channel} identifier=${channelIdentifier}`);
    return { success: true, userId: pending.userId, message: `Connected! Messages from this ${channel} chat will now reach your portfolio assistant.` };
  } catch (err) {
    logger.warn(`Channel binding failed: ${(err as Error).message}`);
    return { success: false, message: "Failed to save binding. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// POST /api/channels/binding-codes
// ---------------------------------------------------------------------------

router.post(
  "/channels/binding-codes",
  handler(async (_req, res) => {
    const userId = res.locals["userId"] as string;
    pruneExpiredCodes();

    // Revoke any existing code for this user
    for (const [code, entry] of pendingCodes.entries()) {
      if (entry.userId === userId) pendingCodes.delete(code);
    }

    const code = generateCode();
    pendingCodes.set(code, { userId, code, expiresAt: Date.now() + CODE_TTL_MS });

    res.json({
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      instructions: {
        telegram: `Send "connect ${code}" to your Telegram bot.`,
        whatsapp: `Send "connect ${code}" to your WhatsApp bot number.`,
      },
    });
  })
);

export default router;
