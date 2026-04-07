import { z } from "zod";

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
  result: z.string().max(1000).nullable(),
  error: z.string().max(500).nullable(),
});
