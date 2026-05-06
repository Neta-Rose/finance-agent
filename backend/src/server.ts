import "dotenv/config";
import { createApp } from "./app.js";
import { logger } from "./services/logger.js";
import { eventStore } from "./services/eventStore.js";
import { startWatchdog } from "./services/scheduler/watchdog.js";
import {
  ensureAllProxyProviders,
  wakeAgentsWithPendingTriggers,
  ensureSystemAgent,
} from "./services/agentService.js";
import { syncAllUserProfiles, syncSystemAgentProfile } from "./services/profileService.js";
import { startDailyScheduler } from "./services/dailySchedulerService.js";
import { repairActiveUserState } from "./services/stateService.js";
import { reconcilePausedJobStates } from "./services/jobStateReconciler.js";
import {
  listWorkspaceUserIds,
  reconcileWorkspaceIntegrity,
} from "./services/workspaceService.js";
import { buildWorkspace } from "./middleware/userIsolation.js";
import {
  pruneExpiredObservabilityRows,
  startObservabilityRetentionLoop,
} from "./services/observabilityRetentionService.js";
import { startStepQueueExecutor } from "./services/stepQueue/executor.js";
import { ensureDefaultFeatureFlags } from "./services/featureFlagService.js";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "./db/applicationDataSource.js";
import { runStartupGuards } from "./services/security/startupGuards.js";

const PORT = parseInt(process.env["PORT"] ?? "8081", 10);
const USERS_DIR = process.env["USERS_DIR"] ?? "/root/clawd/users";

const app = createApp();

async function reconcileStartupRuntime(): Promise<void> {
  try {
    // Phase 3: ensureSystemAgent, ensureAllProxyProviders, syncAllUserProfiles,
    // syncSystemAgentProfile all return false (no-ops) after OpenClaw retirement.
    // We keep the calls so the function signature is stable; they log nothing.
    await ensureSystemAgent();
    await ensureAllProxyProviders();
    await syncAllUserProfiles();
    await syncSystemAgentProfile();
    logger.info("Startup runtime reconciliation complete (OpenClaw retired — no gateway ops)");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Startup runtime reconciliation failed: ${message}`);
  }
}

async function reconcileStartupOperationalState(): Promise<void> {
  try {
    const userIds = await listWorkspaceUserIds();
    let workspaceRepairs = 0;

    for (const userId of userIds) {
      await repairActiveUserState(userId);
      const workspace = buildWorkspace(userId, USERS_DIR);
      await reconcilePausedJobStates(workspace);
      const workspaceReconciliation = await reconcileWorkspaceIntegrity(userId);
      if (workspaceReconciliation.changed) {
        workspaceRepairs += 1;
      }
    }

    // Phase 3: wakeAgentsWithPendingTriggers is a no-op after OpenClaw retirement.
    await wakeAgentsWithPendingTriggers();

    logger.info(
      `Startup operational reconciliation complete: users=${userIds.length} workspaceRepairs=${workspaceRepairs}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Operational reconciliation on startup failed: ${message}`);
  }
}

async function bootstrap(): Promise<void> {
  // Phase 3: run startup guards before anything else.
  // B4.3 — refuse to start if execSync is detected in source.
  const guard = await runStartupGuards();
  if (!guard.ok) {
    logger.error(`Startup guards failed: ${guard.failures.join(", ")}`);
    process.exit(78); // EX_CONFIG — systemd will not auto-restart
  }

  await eventStore.initialize();
  await pruneExpiredObservabilityRows();

  if (isApplicationDatabaseConfigured()) {
    try {
      const ds = await getApplicationDataSource();
      await ensureDefaultFeatureFlags(ds);
      logger.info("Default feature flags ensured");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Default feature flag seeding failed: ${message}`);
    }
  }

  const server = app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
    startWatchdog();
    // Phase 3: startJobCompletionWatcher() removed — replaced by Postgres-only watchdog.
    startDailyScheduler();
    startObservabilityRetentionLoop();
    startStepQueueExecutor();
    setImmediate(() => {
      void reconcileStartupRuntime();
      void reconcileStartupOperationalState();
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    logger.error(`Server failed to start: ${err.message}`);
    process.exit(1);
  });
}

void bootstrap().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Bootstrap failed: ${message}`);
  process.exit(1);
});
