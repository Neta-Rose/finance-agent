export {
  FundamentalsReportSchema,
  TechnicalReportSchema,
  SentimentReportSchema,
  MacroReportSchema,
  RiskReportSchema,
  AnalystReportSchema,
} from "./analysts.js";

export {
  StrategySchema,
  StrategyCatalystSchema,
} from "./strategy.js";

export { JobSchema } from "./job.js";

export {
  PortfolioPositionSchema,
  PortfolioFileSchema,
  PortfolioStateSchema,
  BootstrapProgressSchema,
} from "./portfolio.js";

import {
  FundamentalsReportSchema,
  TechnicalReportSchema,
  SentimentReportSchema,
  MacroReportSchema,
  RiskReportSchema,
  AnalystReportSchema,
} from "./analysts.js";

import type { AnalystType } from "../types/index.js";
import type { z } from "zod";

type AnalystReport = z.infer<typeof AnalystReportSchema>;

export function validateAgentOutput(
  analyst: AnalystType,
  raw: unknown
): { success: true; data: AnalystReport } | { success: false; errors: string[] } {
  let schema: z.ZodType<AnalystReport>;

  switch (analyst) {
    case "fundamentals":
      schema = FundamentalsReportSchema;
      break;
    case "technical":
      schema = TechnicalReportSchema;
      break;
    case "sentiment":
      schema = SentimentReportSchema;
      break;
    case "macro":
      schema = MacroReportSchema;
      break;
    case "risk":
      schema = RiskReportSchema;
      break;
    default:
      return { success: false, errors: [`Unknown analyst type: ${analyst}`] };
  }

  const result = schema.safeParse(raw);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(
    (e) => `${e.path.join(".")}: ${e.message}`
  );
  return { success: false, errors };
}
