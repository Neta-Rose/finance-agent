import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import type { AdminAuditResultStatus } from "../../db/entities/AdminAuditLogEntity.js";

export type { AdminAuditResultStatus } from "../../db/entities/AdminAuditLogEntity.js";

/**
 * Admin-audit store — `admin_audit_log` (design §4.13, O9).
 *
 * One row per `/api/admin/*` request, written by the global middleware
 * landing in Phase 8. We ship the writer in Phase 1 so the table has a
 * tested writer ready when the middleware is wired.
 */

export interface AdminAuditRecord {
  id: string;
  actorAdminId: string;
  actionType: string;
  targetUserId: string | null;
  argsJson: Record<string, unknown> | null;
  resultStatus: AdminAuditResultStatus;
  requestId: string;
  ipAddress: string | null;
  occurredAt: string;
}

export interface WriteAdminAuditInput {
  actorAdminId: string;
  actionType: string;
  targetUserId?: string | null;
  argsJson?: Record<string, unknown> | null;
  resultStatus: AdminAuditResultStatus;
  requestId: string;
  ipAddress?: string | null;
}

interface Row {
  id: string;
  actor_admin_id: string;
  action_type: string;
  target_user_id: string | null;
  args_json: Record<string, unknown> | null;
  result_status: AdminAuditResultStatus;
  request_id: string;
  ip_address: string | null;
  occurred_at: Date | string;
}

const SELECT_COLUMNS = `id, actor_admin_id, action_type, target_user_id,
                        args_json, result_status, request_id, ip_address, occurred_at`;
const ACTION_TYPE_MAX = 64;

function fromRow(row: Row): AdminAuditRecord {
  return {
    id: String(row.id),
    actorAdminId: row.actor_admin_id,
    actionType: row.action_type,
    targetUserId: row.target_user_id,
    argsJson: row.args_json,
    resultStatus: row.result_status,
    requestId: row.request_id,
    ipAddress: row.ip_address,
    occurredAt: (row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at)).toISOString(),
  };
}

export async function writeAdminAudit(input: WriteAdminAuditInput): Promise<AdminAuditRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("writeAdminAudit requires the application database");
  }
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `INSERT INTO admin_audit_log
       (actor_admin_id, action_type, target_user_id, args_json,
        result_status, request_id, ip_address, occurred_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW())
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.actorAdminId,
      input.actionType.slice(0, ACTION_TYPE_MAX),
      input.targetUserId ?? null,
      input.argsJson === undefined || input.argsJson === null ? null : JSON.stringify(input.argsJson),
      input.resultStatus,
      input.requestId,
      input.ipAddress ?? null,
    ]
  )) as Row[];
  return fromRow(rows[0]!);
}

export interface ListAdminAuditQuery {
  actorAdminId?: string;
  targetUserId?: string;
  actionType?: string;
  /** ISO timestamp lower bound, inclusive. */
  sinceIso?: string;
  /** ISO timestamp upper bound, exclusive. */
  untilIso?: string;
  limit?: number;
}

export async function listAdminAudit(query: ListAdminAuditQuery = {}): Promise<AdminAuditRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (query.actorAdminId) {
    params.push(query.actorAdminId);
    wheres.push(`actor_admin_id = $${params.length}`);
  }
  if (query.targetUserId) {
    params.push(query.targetUserId);
    wheres.push(`target_user_id = $${params.length}`);
  }
  if (query.actionType) {
    params.push(query.actionType);
    wheres.push(`action_type = $${params.length}`);
  }
  if (query.sinceIso) {
    params.push(query.sinceIso);
    wheres.push(`occurred_at >= $${params.length}`);
  }
  if (query.untilIso) {
    params.push(query.untilIso);
    wheres.push(`occurred_at < $${params.length}`);
  }
  params.push(query.limit ?? 100);
  const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : ``;
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM admin_audit_log ${where}
      ORDER BY occurred_at DESC LIMIT $${params.length}`,
    params
  )) as Row[];
  return rows.map(fromRow);
}
