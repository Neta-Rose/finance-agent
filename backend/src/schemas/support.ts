import { z } from "zod";

export const SupportMessageCreateSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
  source: z.string().trim().min(1).max(120).optional(),
  page: z.string().trim().min(1).max(200).optional(),
});

export const SupportMessageRecordSchema = SupportMessageCreateSchema.extend({
  id: z.string(),
  userId: z.string(),
  createdAt: z.string().datetime(),
  status: z.enum(["open", "closed"]),
});

export type SupportMessageCreate = z.infer<typeof SupportMessageCreateSchema>;
export type SupportMessageRecord = z.infer<typeof SupportMessageRecordSchema>;
