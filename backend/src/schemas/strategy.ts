import { z } from "zod";

export const StrategyCatalystSchema = z.object({
  description: z.string().max(300),
  expiresAt: z.string().datetime().nullable(),
  triggered: z.boolean(),
});

export const StrategySchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9]{1,10}$/),
  updatedAt: z.string().datetime(),
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
  lastDeepDiveAt: z.string().datetime().nullable(),
  deepDiveTriggeredBy: z.string().nullable(),
});

// export type Strategy = z.infer<typeof StrategySchema>;
