import { z } from "zod";
import { NotificationPreferencesSchema } from "./notifications.js";
import { WhatsAppConnectionSchema } from "./channels.js";

export const ScheduleSchema = z.object({
  dailyBriefTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  weeklyResearchDay: z.enum([
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ]),
  weeklyResearchTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  timezone: z.string().min(1).max(50),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

export const OnboardInitSchema = z.object({
  userId: z
    .string()
    .regex(/^[a-zA-Z0-9-]{4,32}$/, "userId must be 4-32 alphanumeric chars or hyphens"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1).max(50),
  telegramChatId: z.string().regex(/^\d+$/, "Must be numeric"),
  schedule: ScheduleSchema,
});

export type OnboardInit = z.infer<typeof OnboardInitSchema>;

export const PositionGuidanceHorizonSchema = z.enum([
  "unspecified",
  "days",
  "weeks",
  "months",
  "years",
]);

export const PositionGuidanceSchema = z.object({
  thesis: z.string().trim().max(400).optional().default(""),
  horizon: PositionGuidanceHorizonSchema.optional().default("unspecified"),
  addOn: z.string().trim().max(300).optional().default(""),
  reduceOn: z.string().trim().max(300).optional().default(""),
  notes: z.string().trim().max(600).optional().default(""),
});

export const PositionGuidanceRecordSchema = z.record(
  z.string().regex(/^[A-Z0-9.]{1,12}$/),
  PositionGuidanceSchema
);

export const PositionGuidanceCompletionSchema = z.object({
  skip: z.boolean().optional().default(false),
  guidance: PositionGuidanceRecordSchema.optional().default({}),
});

export type PositionGuidance = z.infer<typeof PositionGuidanceSchema>;

export const ProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  telegramChatId: z.string().nullable().optional(),
  channelConnections: z
    .object({
      whatsapp: WhatsAppConnectionSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  schedule: ScheduleSchema.nullable().optional(),
  rateLimits: z.any().optional(),
  pointsBudget: z
    .object({
      dailyBudgetPoints: z.number().finite().positive(),
    })
    .optional(),
  notifications: NotificationPreferencesSchema.optional(),
  createdAt: z.string().datetime(),
});

export const NotificationPreferencesUpdateSchema = NotificationPreferencesSchema;

export type Profile = z.infer<typeof ProfileSchema>;
