import { z } from "zod";

export const NotificationChannelSchema = z.enum([
  "telegram",
  "web",
  "none",
  "whatsapp",
]);

export const NotificationPreferencesSchema = z.object({
  primaryChannel: NotificationChannelSchema.default("telegram"),
  enabledChannels: z
    .object({
      telegram: z.boolean().default(true),
      web: z.boolean().default(true),
      whatsapp: z.boolean().default(false),
    })
    .default({
      telegram: true,
      web: true,
      whatsapp: false,
    }),
  categories: z
    .object({
      dailyBriefs: z.boolean().default(true),
      reportRuns: z.boolean().default(true),
      marketNews: z.boolean().default(true),
    })
    .default({
      dailyBriefs: true,
      reportRuns: true,
      marketNews: true,
    }),
});

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
