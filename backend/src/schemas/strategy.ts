import { z } from "zod";

function isDateTimeString(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

const FlexibleDateTimeString = z.string().refine(isDateTimeString, {
  message: "Invalid datetime",
});

export const StrategyCatalystSchema = z.object({
  description: z.string().max(300),
  expiresAt: FlexibleDateTimeString.nullable(),
  triggered: z.boolean(),
});

export const StrategyMetadataSchema = z.object({
  source: z.enum([
    "bootstrap",
    "full_report",
    "deep_dive",
    "new_ideas",
    "manual_exploration",
    "migration",
  ]),
  status: z.enum(["provisional", "validated"]),
  generatedAt: FlexibleDateTimeString.nullable(),
  userGuidanceApplied: z.boolean().optional().default(false),
});

export const StrategySchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  updatedAt: FlexibleDateTimeString,
  version: z.number().int().min(1),
  verdict: z.enum(["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"]),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().max(800),
  timeframe: z.enum(["week", "months", "long_term", "undefined"]),
  positionSizeILS: z.number(),
  positionWeightPct: z.number(),
  entryConditions: z
    .array(z.string().max(200))
    .max(5)
    .optional(),
  exitConditions: z
    .array(z.string().max(200))
    .max(5)
    .optional(),
  catalysts: z
    .array(StrategyCatalystSchema)
    .max(10)
    .optional()
    .default([]),
  bullCase: z.string().max(600).nullable(),
  bearCase: z.string().max(600).nullable(),
  lastDeepDiveAt: FlexibleDateTimeString.nullable(),
  deepDiveTriggeredBy: z.string().nullable(),
  metadata: StrategyMetadataSchema.optional(),
});

export type Strategy = z.infer<typeof StrategySchema>;
export type StrategyMetadata = z.infer<typeof StrategyMetadataSchema>;
