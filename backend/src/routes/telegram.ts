import express from "express";
import { routeTelegramMessage } from "../services/telegramRouter.js";
import { logger } from "../services/logger.js";

const router = express.Router();

router.post("/telegram/webhook", async (req, res) => {
  // Verify secret — require TELEGRAM_SECRET to be configured
  const expectedSecret = process.env.TELEGRAM_SECRET;
  if (!expectedSecret) {
    logger.warn("Telegram webhook called but TELEGRAM_SECRET is not configured — rejecting");
    res.status(200).json({ ok: true });
    return;
  }
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (secret !== expectedSecret) {
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

    const userId = await routeTelegramMessage(chatId, action, ticker);
    res.json({ ok: true, routed: !!userId });
  } catch (err) {
    logger.error("Telegram webhook error", { err });
    res.json({ ok: true }); // Always 200
  }
});

export default router;
