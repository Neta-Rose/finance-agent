import { z } from "zod";

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ])
);

export const JobSchema = z.object({
  id: z.string(),
  action: z.enum([
    "daily_brief",
    "full_report",
    "deep_dive",
    "new_ideas",
    "switch_production",
    "switch_testing",
  ]),
  ticker: z.string().nullable(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  triggered_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  result: JsonValueSchema,
  error: z.string().max(500).nullable(),
});
