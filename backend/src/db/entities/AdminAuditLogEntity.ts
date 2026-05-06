import { EntitySchema } from "typeorm";

export type AdminAuditResultStatus = "success" | "error" | "rejected";

export interface AdminAuditLogEntity {
  id: string;
  actorAdminId: string;
  actionType: string;
  targetUserId: string | null;
  argsJson: Record<string, unknown> | null;
  resultStatus: AdminAuditResultStatus;
  requestId: string;
  ipAddress: string | null;
  occurredAt: Date;
}

export const AdminAuditLogEntitySchema = new EntitySchema<AdminAuditLogEntity>({
  name: "AdminAuditLog",
  tableName: "admin_audit_log",
  columns: {
    id: { type: "bigint", primary: true, generated: true },
    actorAdminId: { name: "actor_admin_id", type: "varchar", length: 64 },
    actionType: { name: "action_type", type: "varchar", length: 64 },
    targetUserId: { name: "target_user_id", type: "varchar", length: 64, nullable: true },
    argsJson: { name: "args_json", type: "jsonb", nullable: true },
    resultStatus: { name: "result_status", type: "varchar", length: 16 },
    requestId: { name: "request_id", type: "varchar", length: 64 },
    ipAddress: { name: "ip_address", type: "varchar", length: 64, nullable: true },
    occurredAt: { name: "occurred_at", type: "timestamptz" },
  },
});
