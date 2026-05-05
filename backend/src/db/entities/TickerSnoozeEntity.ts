import { EntitySchema } from "typeorm";

export interface TickerSnoozeEntity {
  id: string;
  userId: string;
  ticker: string;
  snoozeUntil: Date;
  signalSetFingerprint: string;
  reason: string | null;
  createdAt: Date;
}

export const TickerSnoozeEntitySchema = new EntitySchema<TickerSnoozeEntity>({
  name: "TickerSnooze",
  tableName: "ticker_snoozes",
  columns: {
    id: { type: "uuid", primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    ticker: { type: "varchar", length: 32 },
    snoozeUntil: { name: "snooze_until", type: "timestamptz" },
    signalSetFingerprint: {
      name: "signal_set_fingerprint",
      type: "varchar",
      length: 64,
    },
    reason: { type: "text", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
