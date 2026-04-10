// backend/src/schemas/control.ts
import { z } from "zod";

export const BannerSchema = z.object({
  text:        z.string().max(500),
  type:        z.enum(["info", "warning", "error"]),
  dismissible: z.boolean().default(true),
  expiresAt:   z.string().datetime().nullable().default(null),
});

export const UserControlSchema = z.object({
  restriction:     z.enum(["readonly", "blocked", "suspended"]).nullable().default(null),
  reason:          z.string().max(500).default(""),
  restrictedAt:    z.string().datetime().nullable().default(null),
  restrictedUntil: z.string().datetime().nullable().default(null),
  banner:          BannerSchema.nullable().default(null),
});

export const SystemControlSchema = z.object({
  locked:       z.boolean().default(false),
  lockReason:   z.string().max(500).default(""),
  lockedAt:     z.string().datetime().nullable().default(null),
  lockedUntil:  z.string().datetime().nullable().default(null),
  broadcast:    BannerSchema.nullable().default(null),
});

export type UserControl   = z.infer<typeof UserControlSchema>;
export type SystemControl = z.infer<typeof SystemControlSchema>;
export type Banner        = z.infer<typeof BannerSchema>;
