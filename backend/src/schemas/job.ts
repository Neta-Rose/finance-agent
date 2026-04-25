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
    "quick_check",
    "switch_production",
    "switch_testing",
  ]),
  ticker: z.string().nullable(),
  source: z.enum(["backend_job", "telegram_command", "dashboard_action"]).nullable().optional(),
  budget_admitted_at: z.string().datetime().nullable().optional(),
  status: z.enum(["pending", "paused", "running", "completed", "failed", "cancelled"]),
  triggered_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  result: JsonValueSchema,
  error: z.string().max(500).nullable(),
});
