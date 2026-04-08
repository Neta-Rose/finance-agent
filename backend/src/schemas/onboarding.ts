import { z } from "zod";

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

export const ProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  telegramChatId: z.string().nullable().optional(),
  schedule: ScheduleSchema.nullable().optional(),
  rateLimits: z.any().optional(),
  createdAt: z.string().datetime(),
});

export type Profile = z.infer<typeof ProfileSchema>;
