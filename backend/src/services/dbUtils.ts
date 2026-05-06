/**
 * TypeORM UPDATE/DELETE RETURNING result unwrapper.
 *
 * TypeORM 0.3.x wraps UPDATE/DELETE results as `[rows, rowCount]` while
 * SELECT/INSERT results are returned as `rows[]` directly. This helper
 * normalises both shapes so callers can always treat the result as `T[]`.
 *
 * See: TypeORM PostgresQueryRunner.js — case "UPDATE": result.raw = [raw.rows, raw.rowCount]
 */
export function unwrapMutationRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  // TypeORM UPDATE/DELETE shape: [[row, row, ...], rowCount]
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") {
    return (result[0] as T[]).filter((r): r is T => r !== null && r !== undefined);
  }
  // INSERT RETURNING / SELECT shape: [row, row, ...]
  return (result as T[]).filter((r): r is T => r !== null && r !== undefined);
}
