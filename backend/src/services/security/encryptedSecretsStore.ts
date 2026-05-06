import { createHash, randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import type { EncryptedSecretKind } from "../../db/entities/EncryptedSecretEntity.js";

export type { EncryptedSecretKind } from "../../db/entities/EncryptedSecretEntity.js";

/**
 * Encrypted-secrets store — third-party bearer tokens at rest (§4.17, O5).
 *
 * Phase 1 ships with **identity encryption** (key_id = 0): plaintext bytes
 * are stored verbatim in the `ciphertext` column with an empty nonce. This
 * lets every later phase consume a uniform read API while we wait for the
 * libsodium key in Phase 8.
 *
 * Phase 8 introduces the real `encryption.ts` module; the store imports
 * the encrypt/decrypt functions when its `keyId` says so. The rotation
 * script re-encrypts every key_id=0 row under key_id=1 in one transaction
 * and updates `rotated_at`.
 *
 * `ciphertext_hash` is a stable last-4-hex digest of the ciphertext used
 * by logs (O10.2): we never log the ciphertext itself, only this short id.
 */

export const KEY_ID_IDENTITY = 0;

export interface EncryptedSecretRecord {
  id: string;
  userId: string;
  secretKind: EncryptedSecretKind;
  ciphertext: Buffer;
  nonce: Buffer;
  keyId: number;
  ciphertextHash: string;
  createdAt: string;
  rotatedAt: string | null;
}

export interface UpsertEncryptedSecretInput {
  userId: string;
  secretKind: EncryptedSecretKind;
  /** Plaintext secret. The store handles encryption (identity in Phase 1). */
  plaintext: string;
  /** Optional UUID; generated if omitted (only used on insert). */
  id?: string;
}

interface Row {
  id: string;
  user_id: string;
  secret_kind: EncryptedSecretKind;
  ciphertext: Buffer;
  nonce: Buffer;
  key_id: number;
  ciphertext_hash: string;
  created_at: Date | string;
  rotated_at: Date | string | null;
}

const SELECT_COLUMNS = `id, user_id, secret_kind, ciphertext, nonce, key_id,
                        ciphertext_hash, created_at, rotated_at`;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromRow(row: Row): EncryptedSecretRecord {
  return {
    id: row.id,
    userId: row.user_id,
    secretKind: row.secret_kind,
    ciphertext: Buffer.isBuffer(row.ciphertext) ? row.ciphertext : Buffer.from(row.ciphertext),
    nonce: Buffer.isBuffer(row.nonce) ? row.nonce : Buffer.from(row.nonce),
    keyId: row.key_id,
    ciphertextHash: row.ciphertext_hash,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    rotatedAt: toIso(row.rotated_at),
  };
}

/**
 * Stable 8-hex-char digest used as a non-secret identifier in logs (O10.2).
 */
function ciphertextHash(ciphertext: Buffer): string {
  return createHash("sha256").update(ciphertext).digest("hex").slice(0, 8);
}

/**
 * Encrypt under the active key. Phase 1 uses key_id=0 (identity); Phase 8
 * swaps this body for the libsodium implementation in `encryption.ts`.
 */
function encryptActive(plaintext: string): { ciphertext: Buffer; nonce: Buffer; keyId: number } {
  return {
    ciphertext: Buffer.from(plaintext, "utf-8"),
    nonce: Buffer.alloc(0),
    keyId: KEY_ID_IDENTITY,
  };
}

/**
 * Decrypt by `keyId`. Phase 1 only knows key_id=0; Phase 8 will look up
 * the key in the in-memory keyring.
 */
function decryptByKey(ciphertext: Buffer, _nonce: Buffer, keyId: number): string {
  if (keyId === KEY_ID_IDENTITY) {
    return ciphertext.toString("utf-8");
  }
  throw new Error(`encryption_key_id_not_loaded:${keyId}`);
}

/**
 * Insert or replace the secret for (user, kind). Returns the persisted record.
 */
export async function upsertEncryptedSecret(
  input: UpsertEncryptedSecretInput
): Promise<EncryptedSecretRecord> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("upsertEncryptedSecret requires the application database");
  }
  const ds = await getApplicationDataSource();
  const id = input.id ?? randomUUID();
  const enc = encryptActive(input.plaintext);
  const hash = ciphertextHash(enc.ciphertext);

  const rows = (await ds.query(
    `INSERT INTO encrypted_secrets
       (id, user_id, secret_kind, ciphertext, nonce, key_id, ciphertext_hash, created_at, rotated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
     ON CONFLICT (user_id, secret_kind) DO UPDATE SET
       ciphertext = EXCLUDED.ciphertext,
       nonce = EXCLUDED.nonce,
       key_id = EXCLUDED.key_id,
       ciphertext_hash = EXCLUDED.ciphertext_hash,
       rotated_at = NULL
     RETURNING ${SELECT_COLUMNS}`,
    [id, input.userId, input.secretKind, enc.ciphertext, enc.nonce, enc.keyId, hash]
  )) as Row[];
  return fromRow(rows[0]!);
}

/**
 * Read and decrypt the secret for (user, kind). Returns null when no row.
 */
export async function readEncryptedSecret(
  userId: string,
  secretKind: EncryptedSecretKind
): Promise<{ record: EncryptedSecretRecord; plaintext: string } | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM encrypted_secrets
      WHERE user_id = $1 AND secret_kind = $2
      LIMIT 1`,
    [userId, secretKind]
  )) as Row[];
  const row = rows[0];
  if (!row) return null;
  const record = fromRow(row);
  const plaintext = decryptByKey(record.ciphertext, record.nonce, record.keyId);
  return { record, plaintext };
}

/** Delete the secret for (user, kind). No-op if no row. */
export async function deleteEncryptedSecret(
  userId: string,
  secretKind: EncryptedSecretKind
): Promise<boolean> {
  if (!isApplicationDatabaseConfigured()) return false;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `DELETE FROM encrypted_secrets
      WHERE user_id = $1 AND secret_kind = $2
      RETURNING id`,
    [userId, secretKind]
  )) as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * List rows by (user, kind?). Used by the Phase 8 rotation script and by
 * admin observability. Decrypted plaintext is intentionally NOT returned —
 * callers that need plaintext use `readEncryptedSecret`.
 */
export async function listEncryptedSecrets(
  userId?: string,
  secretKind?: EncryptedSecretKind
): Promise<EncryptedSecretRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (userId) {
    params.push(userId);
    wheres.push(`user_id = $${params.length}`);
  }
  if (secretKind) {
    params.push(secretKind);
    wheres.push(`secret_kind = $${params.length}`);
  }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : ``;
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM encrypted_secrets ${where}
      ORDER BY created_at DESC`,
    params
  )) as Row[];
  return rows.map(fromRow);
}

// Test-only export: the encryption layer used internally. Phase 8 swaps
// these for libsodium implementations.
export const _internal = { encryptActive, decryptByKey, ciphertextHash };
