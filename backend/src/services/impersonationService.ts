/**
 * Impersonation service — S07 (Pilot Operational Visibility)
 *
 * Issues short-lived read-only JWT tokens that allow an admin to view the
 * product as a specific user without modifying any user state.
 *
 * Sessions are persisted in `impersonation_sessions` and audited in
 * `admin_audit_log`.  A maximum of MAX_ACTIVE_SESSIONS concurrent active
 * sessions per impersonator is enforced.
 */

import { randomUUID } from "crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { logger } from "./logger.js";

const JWT_SECRET = process.env["JWT_SECRET"] ?? "changeme";
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ACTIVE_SESSIONS = 3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ImpersonationSession {
  id: string;
  impersonatorId: string;
  targetUserId: string;
  reason: string | null;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastUsedAt: string | null;
}

export interface IssueSessionResult {
  sessionId: string;
  token: string;
  expiresAt: string;
  targetUserId: string;
  impersonatorId: string;
}

export class ImpersonationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ImpersonationError";
  }
}

// ---------------------------------------------------------------------------
// Dependency injection interface (for testability)
// ---------------------------------------------------------------------------

interface QueryRunnerLike {
  query<T = unknown>(sql: string, params: unknown[]): Promise<T>;
}

export interface ImpersonationDeps {
  databaseConfigured: () => boolean;
  dataSourceProvider: () => Promise<QueryRunnerLike>;
  now: () => Date;
  idFactory: () => string;
  jwtSign: (payload: Record<string, unknown>, secret: string, options: SignOptions) => string;
}

const defaultDeps: ImpersonationDeps = {
  databaseConfigured: isApplicationDatabaseConfigured,
  dataSourceProvider: async () => getApplicationDataSource() as unknown as QueryRunnerLike,
  now: () => new Date(),
  idFactory: () => `imp_${randomUUID()}`,
  jwtSign: (payload, secret, options) =>
    jwt.sign(payload, secret, options as SignOptions),
};

// ---------------------------------------------------------------------------
// Row shapes returned from raw SQL queries
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  impersonator_id: string;
  target_user_id: string;
  reason: string | null;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  last_used_at: Date | null;
  user_agent: string | null;
  ip_hash: string | null;
}

interface CountRow {
  count: string;
}

interface UserRow {
  user_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToSession(row: SessionRow): ImpersonationSession {
  return {
    id: row.id,
    impersonatorId: row.impersonator_id,
    targetUserId: row.target_user_id,
    reason: row.reason,
    issuedAt: row.issued_at instanceof Date ? row.issued_at.toISOString() : String(row.issued_at),
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
    revokedAt: row.revoked_at
      ? row.revoked_at instanceof Date
        ? row.revoked_at.toISOString()
        : String(row.revoked_at)
      : null,
    revokedReason: row.revoked_reason,
    lastUsedAt: row.last_used_at
      ? row.last_used_at instanceof Date
        ? row.last_used_at.toISOString()
        : String(row.last_used_at)
      : null,
  };
}

async function writeAuditLog(
  db: QueryRunnerLike,
  params: {
    actorAdminId: string;
    actionType: string;
    targetUserId: string | null;
    argsJson: Record<string, unknown>;
    resultStatus: string;
    requestId: string;
    ipAddress: string | null;
    occurredAt: Date;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log
       (actor_admin_id, action_type, target_user_id, args_json, result_status, request_id, ip_address, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.actorAdminId,
      params.actionType,
      params.targetUserId,
      JSON.stringify(params.argsJson),
      params.resultStatus,
      params.requestId,
      params.ipAddress,
      params.occurredAt,
    ]
  );
}

// ---------------------------------------------------------------------------
// issueSession
// ---------------------------------------------------------------------------

export async function issueSession(input: {
  impersonatorId: string;
  targetUserId: string;
  reason?: string | undefined;
  userAgent?: string | undefined;
  ipHash?: string | undefined;
  deps?: ImpersonationDeps | undefined;
}): Promise<IssueSessionResult> {
  const deps = input.deps ?? defaultDeps;

  if (!deps.databaseConfigured()) {
    throw new ImpersonationError("database_unavailable", "Application database is not configured");
  }

  const db = await deps.dataSourceProvider();

  // Verify target user exists
  const userRows = await db.query<UserRow[]>(
    `SELECT user_id FROM users WHERE user_id = $1 LIMIT 1`,
    [input.targetUserId]
  );
  if (!userRows || userRows.length === 0) {
    throw new ImpersonationError(
      "target_user_not_found",
      `User ${input.targetUserId} does not exist`
    );
  }

  // Enforce active session cap
  const countRows = await db.query<CountRow[]>(
    `SELECT COUNT(*) AS count
     FROM impersonation_sessions
     WHERE impersonator_id = $1
       AND revoked_at IS NULL
       AND expires_at > $2`,
    [input.impersonatorId, deps.now()]
  );
  const activeCount = parseInt(countRows[0]?.count ?? "0", 10);
  if (activeCount >= MAX_ACTIVE_SESSIONS) {
    throw new ImpersonationError(
      "too_many_active_sessions",
      `Impersonator ${input.impersonatorId} already has ${activeCount} active sessions (max ${MAX_ACTIVE_SESSIONS})`
    );
  }

  const sessionId = deps.idFactory();
  const issuedAt = deps.now();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
  const reason = input.reason ?? null;

  // Insert session row
  await db.query(
    `INSERT INTO impersonation_sessions
       (id, impersonator_id, target_user_id, reason, issued_at, expires_at, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sessionId,
      input.impersonatorId,
      input.targetUserId,
      reason,
      issuedAt,
      expiresAt,
      input.userAgent ?? null,
      input.ipHash ?? null,
    ]
  );

  // Write audit log
  await writeAuditLog(db, {
    actorAdminId: input.impersonatorId,
    actionType: "impersonation.issued",
    targetUserId: input.targetUserId,
    argsJson: { sessionId, reason },
    resultStatus: "success",
    requestId: sessionId,
    ipAddress: input.ipHash ?? null,
    occurredAt: issuedAt,
  });

  // Mint JWT — never log the token value
  const token = deps.jwtSign(
    { userId: input.targetUserId, impersonatorId: input.impersonatorId, sessionId, readOnly: true },
    JWT_SECRET,
    { expiresIn: "15m" } as SignOptions
  );

  logger.info("impersonation_session_issued", {
    sessionId,
    impersonatorId: input.impersonatorId,
    targetUserId: input.targetUserId,
  });

  return {
    sessionId,
    token,
    expiresAt: expiresAt.toISOString(),
    targetUserId: input.targetUserId,
    impersonatorId: input.impersonatorId,
  };
}

// ---------------------------------------------------------------------------
// validateSession
// ---------------------------------------------------------------------------

export async function validateSession(
  sessionId: string,
  deps?: ImpersonationDeps
): Promise<{ valid: true; targetUserId: string; impersonatorId: string } | { valid: false; reason: string }> {
  const d = deps ?? defaultDeps;

  const db = await d.dataSourceProvider();

  const rows = await db.query<SessionRow[]>(
    `SELECT id, impersonator_id, target_user_id, reason, issued_at, expires_at,
            revoked_at, revoked_reason, last_used_at, user_agent, ip_hash
     FROM impersonation_sessions
     WHERE id = $1`,
    [sessionId]
  );

  if (!rows || rows.length === 0) {
    return { valid: false, reason: "not_found" };
  }

  const row = rows[0];
  if (!row) {
    return { valid: false, reason: "not_found" };
  }

  if (row.revoked_at !== null) {
    return { valid: false, reason: "revoked" };
  }

  const now = d.now();
  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (expiresAt < now) {
    return { valid: false, reason: "expired" };
  }

  // Update last_used_at
  await db.query(
    `UPDATE impersonation_sessions SET last_used_at = $1 WHERE id = $2`,
    [now, sessionId]
  );

  return {
    valid: true,
    targetUserId: row.target_user_id,
    impersonatorId: row.impersonator_id,
  };
}

// ---------------------------------------------------------------------------
// listActiveSessions
// ---------------------------------------------------------------------------

export async function listActiveSessions(
  impersonatorId: string,
  deps?: ImpersonationDeps
): Promise<ImpersonationSession[]> {
  const d = deps ?? defaultDeps;

  const db = await d.dataSourceProvider();

  const rows = await db.query<SessionRow[]>(
    `SELECT id, impersonator_id, target_user_id, reason, issued_at, expires_at,
            revoked_at, revoked_reason, last_used_at, user_agent, ip_hash
     FROM impersonation_sessions
     WHERE impersonator_id = $1
       AND revoked_at IS NULL
       AND expires_at > $2
     ORDER BY issued_at DESC`,
    [impersonatorId, d.now()]
  );

  return (rows ?? []).map(rowToSession);
}

// ---------------------------------------------------------------------------
// revokeSession
// ---------------------------------------------------------------------------

export async function revokeSession(
  sessionId: string,
  reason: string,
  actorAdminId: string,
  deps?: ImpersonationDeps
): Promise<void> {
  const d = deps ?? defaultDeps;

  const db = await d.dataSourceProvider();
  const now = d.now();

  // Fetch session before revoking so audit row has accurate target/actor.
  const preCheck = await db.query<SessionRow[]>(
    `SELECT id, impersonator_id, target_user_id
     FROM impersonation_sessions
     WHERE id = $1`,
    [sessionId]
  );
  if (!preCheck || preCheck.length === 0) {
    throw new ImpersonationError("session_not_found", `Session ${sessionId} not found`);
  }
  const sessionRow = preCheck[0]!;
  if (sessionRow.revoked_at !== null && sessionRow.revoked_at !== undefined) {
    throw new ImpersonationError("session_not_found", `Session ${sessionId} is already revoked`);
  }

  const result = await db.query<{ rowCount?: number }>(
    `UPDATE impersonation_sessions
     SET revoked_at = $1, revoked_reason = $2
     WHERE id = $3 AND revoked_at IS NULL`,
    [now, reason, sessionId]
  );

  // TypeORM raw query returns an array [rows, rowCount] for UPDATE statements
  // but our mock and real driver may differ — handle both shapes
  const rowCount =
    typeof result === "object" && result !== null && "rowCount" in result
      ? (result as { rowCount: number }).rowCount
      : Array.isArray(result)
        ? (result as unknown[])[1]
        : undefined;

  if (rowCount === 0 || rowCount === undefined) {
    throw new ImpersonationError("session_not_found", `Session ${sessionId} is already revoked or not found`);
  }

  // Write audit log with the real actor and target
  await writeAuditLog(db, {
    actorAdminId,
    actionType: "impersonation.revoked",
    targetUserId: sessionRow.target_user_id,
    argsJson: { sessionId, reason },
    resultStatus: "success",
    requestId: sessionId,
    ipAddress: null,
    occurredAt: now,
  });

  logger.info("impersonation_session_revoked", {
    sessionId,
    reason,
    actorAdminId,
    targetUserId: sessionRow.target_user_id,
  });
}
