import { EntitySchema } from "typeorm";

export type NotificationCategory = "daily_brief" | "report" | "market_news";
export type NotificationChannel = "telegram" | "web" | "whatsapp";

export interface NotificationEntity {
  id: string;
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
  delivered: boolean;
  deliveredAt: Date | null;
  readAt: Date | null;
  error: string | null;
  createdAt: Date;
}

export const NotificationEntitySchema = new EntitySchema<NotificationEntity>({
  name: "Notification",
  tableName: "notifications_outbox",
  columns: {
    id: { type: "varchar", length: 64, primary: true },
    userId: { name: "user_id", type: "varchar", length: 64 },
    category: { type: "varchar", length: 32 },
    channel: { type: "varchar", length: 16 },
    title: { type: "varchar", length: 256 },
    body: { type: "text" },
    ticker: { type: "varchar", length: 32, nullable: true },
    batchId: { name: "batch_id", type: "varchar", length: 128, nullable: true },
    delivered: { type: "boolean", default: false },
    deliveredAt: { name: "delivered_at", type: "timestamptz", nullable: true },
    readAt: { name: "read_at", type: "timestamptz", nullable: true },
    error: { type: "text", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
