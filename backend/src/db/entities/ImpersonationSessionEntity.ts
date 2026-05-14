import { EntitySchema } from "typeorm";

export interface ImpersonationSessionEntity {
  id: string;
  impersonatorId: string;
  targetUserId: string;
  reason: string | null;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastUsedAt: Date | null;
  userAgent: string | null;
  ipHash: string | null;
}

export const ImpersonationSessionEntitySchema = new EntitySchema<ImpersonationSessionEntity>({
  name: "ImpersonationSession",
  tableName: "impersonation_sessions",
  columns: {
    id: { type: "varchar", length: 64, primary: true },
    impersonatorId: { name: "impersonator_id", type: "varchar", length: 64 },
    targetUserId: { name: "target_user_id", type: "varchar", length: 64 },
    reason: { type: "varchar", length: 512, nullable: true },
    issuedAt: { name: "issued_at", type: "timestamptz" },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    revokedAt: { name: "revoked_at", type: "timestamptz", nullable: true },
    revokedReason: { name: "revoked_reason", type: "varchar", length: 64, nullable: true },
    lastUsedAt: { name: "last_used_at", type: "timestamptz", nullable: true },
    userAgent: { name: "user_agent", type: "varchar", length: 256, nullable: true },
    ipHash: { name: "ip_hash", type: "varchar", length: 64, nullable: true },
  },
});
