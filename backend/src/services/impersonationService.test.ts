/**
 * Tests for impersonationService — S07 (Pilot Operational Visibility)
 *
 * Uses Node's built-in test runner with a mocked data source.
 * No real DB connection is used.
 */

import test from "node:test";
import assert from "node:assert/strict";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { ImpersonationDeps } from "./impersonationService.js";
import {
  issueSession,
  validateSession,
  listActiveSessions,
  revokeSession,
  ImpersonationError,
} from "./impersonationService.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface SqlCall {
  sql: string;
  params: unknown[];
}

interface MockQueryResult {
  rows?: unknown[];
  rowCount?: number;
}

/**
 * Build a mock deps object.
 *
 * `queryResults` is a queue: each call to `db.query()` pops the next entry.
 * If the queue is exhausted, the mock returns an empty array.
 */
function makeDeps(options: {
  queryResults?: MockQueryResult[];
  now?: Date;
  sessionIdOverride?: string;
}): ImpersonationDeps & { calls: SqlCall[] } {
  const calls: SqlCall[] = [];
  const queue: MockQueryResult[] = options.queryResults ? [...options.queryResults] : [];
  const fixedNow = options.now ?? new Date("2025-01-01T12:00:00.000Z");

  const db = {
    query<T = unknown>(sql: string, params: unknown[]): Promise<T> {
      calls.push({ sql, params });
      const next = queue.shift();
      if (next === undefined) {
        return Promise.resolve([] as unknown as T);
      }
      // For UPDATE statements the real TypeORM driver returns [rows, rowCount].
      // Our service checks for a `rowCount` property on the result object.
      if (next.rowCount !== undefined) {
        return Promise.resolve({ rowCount: next.rowCount } as unknown as T);
      }
      return Promise.resolve((next.rows ?? []) as unknown as T);
    },
  };

  return {
    calls,
    databaseConfigured: () => true,
    dataSourceProvider: async () => db,
    now: () => fixedNow,
    idFactory: () => options.sessionIdOverride ?? "imp_test-session-id",
    jwtSign: (payload, secret, opts) => jwt.sign(payload, secret, opts as SignOptions),
  };
}

// ---------------------------------------------------------------------------
// Test 1: issueSession succeeds
// ---------------------------------------------------------------------------

test("issueSession succeeds: inserts session row, writes audit log, returns token with correct claims", async () => {
  const deps = makeDeps({
    sessionIdOverride: "imp_abc123",
    queryResults: [
      // 1. users lookup → found (schema uses user_id, not id)
      { rows: [{ user_id: "user-42" }] },
      // 2. active session count → 0
      { rows: [{ count: "0" }] },
      // 3. INSERT impersonation_sessions → ok
      { rows: [] },
      // 4. INSERT admin_audit_log → ok
      { rows: [] },
    ],
  });

  const result = await issueSession({
    impersonatorId: "admin-1",
    targetUserId: "user-42",
    reason: "support investigation",
    userAgent: "Mozilla/5.0",
    ipHash: "abc123hash",
    deps,
  });

  assert.equal(result.sessionId, "imp_abc123");
  assert.equal(result.targetUserId, "user-42");
  assert.equal(result.impersonatorId, "admin-1");
  assert.ok(result.token, "token should be present");
  assert.ok(result.expiresAt, "expiresAt should be present");

  // Verify JWT claims
  const decoded = jwt.decode(result.token) as Record<string, unknown>;
  assert.equal(decoded["userId"], "user-42");
  assert.equal(decoded["impersonatorId"], "admin-1");
  assert.equal(decoded["sessionId"], "imp_abc123");
  assert.equal(decoded["readOnly"], true);

  // Verify SQL calls
  assert.equal(deps.calls.length, 4, "should make 4 SQL calls");

  // Call 0: user lookup — must use real schema column user_id, not id
  assert.ok(deps.calls[0]!.sql.includes("FROM users"), "first call should query users");
  assert.ok(deps.calls[0]!.sql.includes("user_id"), "user lookup must use the user_id column, not id");
  assert.deepEqual(deps.calls[0]!.params, ["user-42"]);

  // Call 1: active session count
  assert.ok(deps.calls[1]!.sql.includes("COUNT(*)"), "second call should count sessions");
  assert.equal(deps.calls[1]!.params[0], "admin-1");

  // Call 2: INSERT session
  assert.ok(deps.calls[2]!.sql.includes("INSERT INTO impersonation_sessions"), "third call should insert session");
  assert.equal(deps.calls[2]!.params[0], "imp_abc123");
  assert.equal(deps.calls[2]!.params[1], "admin-1");
  assert.equal(deps.calls[2]!.params[2], "user-42");
  assert.equal(deps.calls[2]!.params[3], "support investigation");

  // Call 3: INSERT audit log
  assert.ok(deps.calls[3]!.sql.includes("INSERT INTO admin_audit_log"), "fourth call should insert audit log");
  assert.equal(deps.calls[3]!.params[0], "admin-1");
  assert.equal(deps.calls[3]!.params[1], "impersonation.issued");
  assert.equal(deps.calls[3]!.params[2], "user-42");
});

// ---------------------------------------------------------------------------
// Test 2: issueSession throws too_many_active_sessions
// ---------------------------------------------------------------------------

test("issueSession throws too_many_active_sessions when 3 active sessions exist", async () => {
  const deps = makeDeps({
    queryResults: [
      // 1. users lookup → found
      { rows: [{ user_id: "user-42" }] },
      // 2. active session count → 3
      { rows: [{ count: "3" }] },
    ],
  });

  await assert.rejects(
    () =>
      issueSession({
        impersonatorId: "admin-1",
        targetUserId: "user-42",
        deps,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ImpersonationError);
      assert.equal(err.code, "too_many_active_sessions");
      return true;
    }
  );

  // Should not have attempted to insert
  assert.equal(deps.calls.length, 2);
});

// ---------------------------------------------------------------------------
// Test 3: issueSession throws target_user_not_found
// ---------------------------------------------------------------------------

test("issueSession throws target_user_not_found when users query returns empty", async () => {
  const deps = makeDeps({
    queryResults: [
      // 1. users lookup → not found
      { rows: [] },
    ],
  });

  await assert.rejects(
    () =>
      issueSession({
        impersonatorId: "admin-1",
        targetUserId: "ghost-user",
        deps,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ImpersonationError);
      assert.equal(err.code, "target_user_not_found");
      return true;
    }
  );

  assert.equal(deps.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Test 4: validateSession returns not_found when row missing
// ---------------------------------------------------------------------------

test("validateSession returns { valid: false, reason: 'not_found' } when row missing", async () => {
  const deps = makeDeps({
    queryResults: [
      // SELECT → empty
      { rows: [] },
    ],
  });

  const result = await validateSession("imp_missing", deps);
  assert.deepEqual(result, { valid: false, reason: "not_found" });
});

// ---------------------------------------------------------------------------
// Test 5: validateSession returns revoked when revoked_at is set
// ---------------------------------------------------------------------------

test("validateSession returns { valid: false, reason: 'revoked' } when revoked_at is set", async () => {
  const now = new Date("2025-01-01T12:00:00.000Z");
  const deps = makeDeps({
    now,
    queryResults: [
      {
        rows: [
          {
            id: "imp_revoked",
            impersonator_id: "admin-1",
            target_user_id: "user-42",
            reason: null,
            issued_at: new Date("2025-01-01T11:00:00.000Z"),
            expires_at: new Date("2025-01-01T11:15:00.000Z"),
            revoked_at: new Date("2025-01-01T11:05:00.000Z"),
            revoked_reason: "manual",
            last_used_at: null,
            user_agent: null,
            ip_hash: null,
          },
        ],
      },
    ],
  });

  const result = await validateSession("imp_revoked", deps);
  assert.deepEqual(result, { valid: false, reason: "revoked" });
});

// ---------------------------------------------------------------------------
// Test 6: validateSession returns expired when expires_at is in the past
// ---------------------------------------------------------------------------

test("validateSession returns { valid: false, reason: 'expired' } when expires_at is in the past", async () => {
  const now = new Date("2025-01-01T12:00:00.000Z");
  const deps = makeDeps({
    now,
    queryResults: [
      {
        rows: [
          {
            id: "imp_expired",
            impersonator_id: "admin-1",
            target_user_id: "user-42",
            reason: null,
            issued_at: new Date("2025-01-01T11:00:00.000Z"),
            expires_at: new Date("2025-01-01T11:15:00.000Z"), // in the past relative to now
            revoked_at: null,
            revoked_reason: null,
            last_used_at: null,
            user_agent: null,
            ip_hash: null,
          },
        ],
      },
    ],
  });

  const result = await validateSession("imp_expired", deps);
  assert.deepEqual(result, { valid: false, reason: "expired" });
});

// ---------------------------------------------------------------------------
// Test 7: validateSession returns valid and updates last_used_at
// ---------------------------------------------------------------------------

test("validateSession returns { valid: true } and updates last_used_at for active session", async () => {
  const now = new Date("2025-01-01T12:00:00.000Z");
  const deps = makeDeps({
    now,
    queryResults: [
      {
        rows: [
          {
            id: "imp_active",
            impersonator_id: "admin-1",
            target_user_id: "user-42",
            reason: "support",
            issued_at: new Date("2025-01-01T11:50:00.000Z"),
            expires_at: new Date("2025-01-01T12:05:00.000Z"), // still valid
            revoked_at: null,
            revoked_reason: null,
            last_used_at: null,
            user_agent: null,
            ip_hash: null,
          },
        ],
      },
      // UPDATE last_used_at → ok
      { rows: [] },
    ],
  });

  const result = await validateSession("imp_active", deps);
  assert.ok(result.valid === true);
  if (result.valid) {
    assert.equal(result.targetUserId, "user-42");
    assert.equal(result.impersonatorId, "admin-1");
  }

  // Verify UPDATE was called
  assert.equal(deps.calls.length, 2);
  assert.ok(deps.calls[1]!.sql.includes("UPDATE impersonation_sessions"), "should update last_used_at");
  assert.ok(deps.calls[1]!.sql.includes("last_used_at"), "should set last_used_at");
  assert.deepEqual(deps.calls[1]!.params[0], now);
  assert.equal(deps.calls[1]!.params[1], "imp_active");
});

// ---------------------------------------------------------------------------
// Test 8: listActiveSessions filters by impersonator and excludes revoked/expired
// ---------------------------------------------------------------------------

test("listActiveSessions filters by impersonator and excludes revoked/expired", async () => {
  const now = new Date("2025-01-01T12:00:00.000Z");
  const deps = makeDeps({
    now,
    queryResults: [
      {
        rows: [
          {
            id: "imp_s1",
            impersonator_id: "admin-1",
            target_user_id: "user-10",
            reason: "reason-a",
            issued_at: new Date("2025-01-01T11:55:00.000Z"),
            expires_at: new Date("2025-01-01T12:10:00.000Z"),
            revoked_at: null,
            revoked_reason: null,
            last_used_at: null,
            user_agent: null,
            ip_hash: null,
          },
          {
            id: "imp_s2",
            impersonator_id: "admin-1",
            target_user_id: "user-20",
            reason: null,
            issued_at: new Date("2025-01-01T11:50:00.000Z"),
            expires_at: new Date("2025-01-01T12:05:00.000Z"),
            revoked_at: null,
            revoked_reason: null,
            last_used_at: new Date("2025-01-01T11:58:00.000Z"),
            user_agent: null,
            ip_hash: null,
          },
        ],
      },
    ],
  });

  const sessions = await listActiveSessions("admin-1", deps);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]!.id, "imp_s1");
  assert.equal(sessions[0]!.targetUserId, "user-10");
  assert.equal(sessions[1]!.id, "imp_s2");
  assert.equal(sessions[1]!.targetUserId, "user-20");

  // Verify the SQL filters correctly
  const sql = deps.calls[0]!.sql;
  assert.ok(sql.includes("impersonator_id = $1"), "should filter by impersonator_id");
  assert.ok(sql.includes("revoked_at IS NULL"), "should exclude revoked");
  assert.ok(sql.includes("expires_at > $2"), "should exclude expired");
  assert.ok(sql.includes("ORDER BY issued_at DESC"), "should order by issued_at DESC");
  assert.equal(deps.calls[0]!.params[0], "admin-1");
  assert.deepEqual(deps.calls[0]!.params[1], now);
});

// ---------------------------------------------------------------------------
// Test 9: revokeSession updates the row and writes audit log
// ---------------------------------------------------------------------------

test("revokeSession updates the row and writes audit log with real actor and target", async () => {
  const now = new Date("2025-01-01T12:00:00.000Z");
  const deps = makeDeps({
    now,
    queryResults: [
      // pre-check SELECT → session found, not yet revoked
      {
        rows: [
          {
            id: "imp_abc",
            impersonator_id: "admin-1",
            target_user_id: "user-42",
            revoked_at: null,
            revoked_reason: null,
          },
        ],
      },
      // UPDATE → 1 row affected
      { rowCount: 1 },
      // INSERT audit log → ok
      { rows: [] },
    ],
  });

  await revokeSession("imp_abc", "admin_request", "admin-1", deps);

  assert.equal(deps.calls.length, 3);

  // Call 0: pre-check SELECT
  assert.ok(deps.calls[0]!.sql.includes("SELECT"), "should pre-check session exists");
  assert.equal(deps.calls[0]!.params[0], "imp_abc");

  // Call 1: UPDATE
  assert.ok(deps.calls[1]!.sql.includes("UPDATE impersonation_sessions"), "should update session");
  assert.ok(deps.calls[1]!.sql.includes("revoked_at"), "should set revoked_at");
  assert.ok(deps.calls[1]!.sql.includes("revoked_reason"), "should set revoked_reason");
  assert.deepEqual(deps.calls[1]!.params[0], now);
  assert.equal(deps.calls[1]!.params[1], "admin_request");
  assert.equal(deps.calls[1]!.params[2], "imp_abc");

  // Call 2: audit log — must use real actorAdminId and targetUserId (not sessionId as actor)
  assert.ok(deps.calls[2]!.sql.includes("INSERT INTO admin_audit_log"), "should write audit log");
  assert.equal(deps.calls[2]!.params[0], "admin-1", "actorAdminId must be the real admin, not the sessionId");
  assert.equal(deps.calls[2]!.params[1], "impersonation.revoked");
  assert.equal(deps.calls[2]!.params[2], "user-42", "targetUserId must be set from the session row");
});

// ---------------------------------------------------------------------------
// Test 10: revokeSession throws session_not_found when no row updated
// ---------------------------------------------------------------------------

test("revokeSession throws session_not_found when session does not exist", async () => {
  const deps = makeDeps({
    queryResults: [
      // pre-check SELECT → not found
      { rows: [] },
    ],
  });

  await assert.rejects(
    () => revokeSession("imp_ghost", "cleanup", "admin-1", deps),
    (err: unknown) => {
      assert.ok(err instanceof ImpersonationError);
      assert.equal(err.code, "session_not_found");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Test 11: revokeSession throws session_not_found when session already revoked
// ---------------------------------------------------------------------------

test("revokeSession throws session_not_found when session is already revoked", async () => {
  const deps = makeDeps({
    queryResults: [
      // pre-check SELECT → found but already revoked
      {
        rows: [
          {
            id: "imp_revoked",
            impersonator_id: "admin-1",
            target_user_id: "user-42",
            revoked_at: new Date("2025-01-01T11:00:00.000Z"),
            revoked_reason: "expired",
          },
        ],
      },
    ],
  });

  await assert.rejects(
    () => revokeSession("imp_revoked", "duplicate_revoke", "admin-1", deps),
    (err: unknown) => {
      assert.ok(err instanceof ImpersonationError);
      assert.equal(err.code, "session_not_found");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Test 12: issueSession uses user_id column (not id) in user lookup
// ---------------------------------------------------------------------------

test("issueSession user lookup query uses user_id column, matching the Postgres schema", async () => {
  const deps = makeDeps({
    queryResults: [
      // user lookup with user_id column → not found
      { rows: [] },
    ],
  });

  await assert.rejects(
    () =>
      issueSession({
        impersonatorId: "admin-1",
        targetUserId: "ghost",
        deps,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ImpersonationError);
      assert.equal(err.code, "target_user_not_found");
      return true;
    }
  );

  assert.ok(
    deps.calls[0]!.sql.includes("user_id"),
    "user lookup SQL must reference the user_id column, not a generic 'id' column"
  );
});
