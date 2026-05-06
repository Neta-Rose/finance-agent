import { EntitySchema } from "typeorm";

export type ChannelBindingChannel = "telegram" | "whatsapp";

export interface ChannelBindingEntity {
  channel: ChannelBindingChannel;
  channelIdentifier: string;
  userId: string;
  conversationId: string | null;
  boundAt: Date;
  unboundAt: Date | null;
}

export const ChannelBindingEntitySchema = new EntitySchema<ChannelBindingEntity>({
  name: "ChannelBinding",
  tableName: "channel_bindings",
  columns: {
    channel: { type: "varchar", length: 16, primary: true },
    channelIdentifier: {
      name: "channel_identifier",
      type: "varchar",
      length: 128,
      primary: true,
    },
    userId: { name: "user_id", type: "varchar", length: 64 },
    conversationId: { name: "conversation_id", type: "varchar", length: 64, nullable: true },
    boundAt: { name: "bound_at", type: "timestamptz" },
    unboundAt: { name: "unbound_at", type: "timestamptz", nullable: true },
  },
});
