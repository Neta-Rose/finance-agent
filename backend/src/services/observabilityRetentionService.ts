import { eventStore } from "./eventStore.js";
import { logger } from "./logger.js";

const RETENTION_DAYS = Math.max(1, Number(process.env["OBSERVABILITY_RETENTION_DAYS"] ?? 14));
const RETENTION_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env["OBSERVABILITY_RETENTION_INTERVAL_MS"] ?? 3_600_000)
);

export async function pruneExpiredObservabilityRows(): Promise<void> {
  const deleted = await eventStore.pruneExpiredRows(RETENTION_DAYS);
  if (deleted > 0) {
    logger.info(`Pruned ${deleted} expired observability rows older than ${RETENTION_DAYS} day(s)`);
  }
}

export function startObservabilityRetentionLoop(): void {
  const timer = setInterval(() => {
    void pruneExpiredObservabilityRows().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Observability retention prune failed: ${message}`);
    });
  }, RETENTION_INTERVAL_MS);
  timer.unref();
}
