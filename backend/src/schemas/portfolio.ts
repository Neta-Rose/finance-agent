import { z } from "zod";

export const PortfolioPositionSchema = z.object({
  ticker: z.string().regex(/^[A-Z0-9]{1,10}$/),
  exchange: z.enum(["TASE", "NYSE", "NASDAQ"]),
  shares: z.number().int().positive(),
  unitAvgBuyPrice: z.number().positive(),
  unitCurrency: z.enum(["USD", "ILA"]),
});

export const PortfolioAccountSchema = z.object({
  positions: z.array(PortfolioPositionSchema),
});

export const PortfolioFileSchema = z.object({
  meta: z.object({
    currency: z.literal("ILS"),
    transactionFeeILS: z.number(),
    note: z.string(),
  }),
  accounts: z.object({
    main: z.array(PortfolioPositionSchema),
    second: z.array(PortfolioPositionSchema).optional(),
  }),
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

// export type PortfolioPosition = z.infer<typeof PortfolioPositionSchema>;
// export type PortfolioAccount = z.infer<typeof PortfolioAccountSchema>;
// export type PortfolioFile = z.infer<typeof PortfolioFileSchema>;
// export type PortfolioState = z.infer<typeof PortfolioStateSchema>;
