import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { ChannelBindingChannel } from "../db/entities/ChannelBindingEntity.js";
import { unwrapMutationRows } from "./dbUtils.js";

export type { ChannelBindingChannel } from "../db/entities/ChannelBindingEntity.js";

/**
 * Channel-binding store — Telegram chat / WhatsApp phone → user_id (§4.16,
 * D1.1, D2.3). Used by the transports to resolve inbound webhook traffic to
 * a Clawd user, and by the chat agent to pick a stable conversationId.
 */

export interface ChannelBindingRecord {
  channel: ChannelBindingChannel;
  channelIdentifier: string;
  userId: string;
  conversationId: string | null;
  boundAt: string;
  unboundAt: string | null;
}

export interface BindChannelInput {
  channel: ChannelBindingChannel;
  channelIdentifier: string;
  userId: string;
  conversationId?: string | null;
}

interface Row {
  channel: ChannelBindingChannel;
  channel_identifier: string;
  user_id: string;
  conversation_id: string | null;
  bound_at: Date | string;
  unbound_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromRow(row: Row): ChannelBindingRecord {
  return {
    channel: row.channel,
    channelIdentifier: row.channel_identifier,
    userId: row.user_id,
    conversationId: row.conversation_id,
    boundAt: toIso(row.bound_at) ?? new Date().toISOString(),
    unboundAt: toIso(row.unbound_at),
  };
}

const SELECT_COLUMNS = `channel, channel_identifier, user_id, conversation_id, bound_at, unbound_at`;

/**
 * Idempotent upsert. If a row exists for (channel, channelIdentifier),
 * its `unbound_at` is cleared and `user_id` is rewritten — supporting the
 * "user rebinds the same chat to a different account" path. Caller should
 * gate this on a confirmation code (the `/connect` flow in §9.4).
 */
export async function bindChannel(input: BindChannelInput): Promise<ChannelBindingRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("bindChannel requires the application database");
  }
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `INSERT INTO channel_bindings
       (channel, channel_identifier, user_id, conversation_id, bound_at, unbound_at)
     VALUES ($1, $2, $3, $4, NOW(), NULL)
     ON CONFLICT (channel, channel_identifier) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       conversation_id = EXCLUDED.conversation_id,
       bound_at = NOW(),
       unbound_at = NULL
     RETURNING ${SELECT_COLUMNS}`,
    [input.channel, input.channelIdentifier, input.userId, input.conversationId ?? null]
  )) as Row[];
  return fromRow(rows[0]!);
}

/**
 * Lookup the active binding (unbound_at IS NULL) for an inbound channel
 * identifier. Returns null when no active binding is found.
 */
export async function lookupByChannelId(
  channel: ChannelBindingChannel,
  channelIdentifier: string
): Promise<ChannelBindingRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM channel_bindings
      WHERE channel = $1 AND channel_identifier = $2 AND unbound_at IS NULL
      LIMIT 1`,
    [channel, channelIdentifier]
  )) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

/** All active bindings for a user across all channels. */
export async function listBindingsForUser(userId: string): Promise<ChannelBindingRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM channel_bindings
      WHERE user_id = $1 AND unbound_at IS NULL
      ORDER BY channel ASC, bound_at DESC`,
    [userId]
  )) as Row[];
  return rows.map(fromRow);
}

/** Soft-unbind by stamping `unbound_at`. Inbound webhooks then return null. */
export async function unbindChannel(
  channel: ChannelBindingChannel,
  channelIdentifier: string
): Promise<boolean> {
  if (!isApplicationDatabaseConfigured()) return false;
  const ds = await getApplicationDataSource();
  const raw = await ds.query(
    `UPDATE channel_bindings
        SET unbound_at = NOW()
      WHERE channel = $1 AND channel_identifier = $2 AND unbound_at IS NULL
      RETURNING channel`,
    [channel, channelIdentifier]
  );
  return unwrapMutationRows<{ channel: string }>(raw).length > 0;
}

/** Persist or update the conversation id for a binding (D1.2 / D2.3). */
export async function setConversationId(
  channel: ChannelBindingChannel,
  channelIdentifier: string,
  conversationId: string
): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;
  const ds = await getApplicationDataSource();
  await ds.query(
    `UPDATE channel_bindings
        SET conversation_id = $3
      WHERE channel = $1 AND channel_identifier = $2 AND unbound_at IS NULL`,
    [channel, channelIdentifier, conversationId]
  );
}
