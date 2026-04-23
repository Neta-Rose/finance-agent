import express from "express";
import { resolveTelegramRoute, routeTelegramMessage } from "../services/telegramRouter.js";
import { logger } from "../services/logger.js";
import { isTelegramFinancialOnlyViolation } from "../services/telegramSecurityService.js";
import { incrementTokenVersion, setUserControl } from "../services/controlService.js";
import { disconnectUserTelegram, restartGateway } from "../services/agentService.js";

const router = express.Router();

router.post("/telegram/webhook", async (req, res) => {
  // Verify secret
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (process.env.TELEGRAM_SECRET && secret !== process.env.TELEGRAM_SECRET) {
    res.status(200).json({ ok: true }); // Return 200 anyway — Telegram requirement
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
    const text = message.text.trim();

    if (isTelegramFinancialOnlyViolation(text)) {
      const route = await resolveTelegramRoute(chatId);
      if (route) {
        await setUserControl(route.userId, {
          restriction: "blocked",
          reason: "Blocked automatically due to a non-financial or administrative Telegram request",
          restrictedAt: new Date().toISOString(),
          restrictedUntil: null,
          banner: {
            text: "Account blocked automatically due to a non-financial Telegram request. Telegram access was disconnected. Contact admin.",
            type: "error",
            dismissible: false,
            expiresAt: null,
          },
        });
        await disconnectUserTelegram(route.userId);
        await restartGateway();
        await incrementTokenVersion(route.userId);
        logger.warn(`Telegram security block applied to ${route.userId}`);
      }
      res.json({ ok: true, blocked: true });
      return;
    }

    let action: string | null = null;
    let ticker: string | undefined;

    if (text === "/full-report" || text === "/fullreport") {
      action = "full_report";
    } else if (text === "/daily") {
      action = "daily_brief";
    } else if (text.startsWith("/deep-dive ") || text.startsWith("/deepdive ")) {
      action = "deep_dive";
      ticker = text.split(" ")[1]?.toUpperCase();
    } else if (text === "/new-ideas" || text === "/newideas") {
      action = "new_ideas";
    }

    if (!action) {
      res.json({ ok: true });
      return;
    }

    const outcome = await routeTelegramMessage(chatId, action, ticker);
    res.json({
      ok: true,
      routed: !!outcome.userId && outcome.statusCode < 400,
      userId: outcome.userId,
      statusCode: outcome.statusCode,
      error: outcome.body?.["error"] ?? null,
    });
  } catch (err) {
    logger.error("Telegram webhook error", { err });
    res.json({ ok: true }); // Always 200
  }
});

export default router;
