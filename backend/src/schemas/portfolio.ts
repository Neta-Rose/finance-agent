import { z } from "zod";

export const PortfolioPositionSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9]{1,10}$/),
  exchange: z.enum(["TASE", "NYSE", "NASDAQ", "LSE", "XETRA", "EURONEXT", "OTHER"]),
  shares: z.number().int().positive(),
  unitAvgBuyPrice: z.number().positive(),
  unitCurrency: z.enum(["USD", "ILA", "GBP", "EUR"]),
});

export const PortfolioFileSchema = z.object({
  meta: z.object({
    currency: z.literal("ILS"),
    transactionFeeILS: z.number(),
    note: z.string(),
  }),
  accounts: z.record(
    z.string().min(1).max(30),
    z.array(PortfolioPositionSchema)
  ).refine(
    (accounts) => Object.keys(accounts).length >= 1,
    { message: "At least one account required" }
  ),
});

export const BootstrapProgressSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  completedTickers: z.array(z.string()),
});

export const PortfolioStateSchema = z.object({
  userId: z.string(),
  state: z.enum(["UNINITIALIZED", "BOOTSTRAPPING", "ACTIVE"]),
  lastFullReportAt: z.string().datetime().nullable(),
  lastDailyAt: z.string().datetime().nullable(),
  pendingDeepDives: z.array(z.string()).optional().default([]),
  bootstrapProgress: BootstrapProgressSchema.nullable(),
});
