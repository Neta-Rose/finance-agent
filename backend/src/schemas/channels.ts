import { z } from "zod";

export const TelegramConnectRequestSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{35,}$/, "Invalid bot token format"),
  telegramChatId: z.string().regex(/^\d+$/, "Invalid telegram chat ID"),
});

export const WhatsAppConnectionSchema = z.object({
  accessToken: z.string().min(20, "Access token is too short"),
  phoneNumberId: z.string().regex(/^\d+$/, "Phone number ID must be numeric"),
  recipientPhone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Recipient phone must use E.164 format"),
});

export const ConnectWhatsAppRequestSchema = WhatsAppConnectionSchema;

export type TelegramConnectRequest = z.infer<typeof TelegramConnectRequestSchema>;
export type WhatsAppConnection = z.infer<typeof WhatsAppConnectionSchema>;
export type ConnectWhatsAppRequest = z.infer<typeof ConnectWhatsAppRequestSchema>;
