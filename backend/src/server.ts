import "dotenv/config";
import { createApp } from "./app.js";
import { logger } from "./services/logger.js";
import { eventStore } from "./services/eventStore.js";
import { startWatchdog } from "./services/watchdogService.js";
import { startJobCompletionWatcher } from "./services/jobCompletionService.js";
import {
  ensureAllProxyProviders,
  getUserAgentStatus,
  restartGateway,
  reconcileUserHeartbeatCron,
  wakeAgentsWithPendingTriggers,
  ensureSystemAgent,
} from "./services/agentService.js";
import { syncAllUserProfiles, syncSystemAgentProfile } from "./services/profileService.js";
import { startDailyScheduler } from "./services/dailySchedulerService.js";
import { startAgentJobDispatcher } from "./services/agentJobDispatcher.js";
import {
  shouldRestartGatewayAfterStartupReconciliation,
  shouldUserHeartbeatBeEnabled,
} from "./services/startupService.js";
import { getActiveUserEligibility, repairActiveUserState, readState } from "./services/stateService.js";
import { getUserControl } from "./services/controlService.js";
import {
  listWorkspaceUserIds,
  reconcileWorkspaceIntegrity,
} from "./services/workspaceService.js";
import { buildWorkspace } from "./middleware/userIsolation.js";
import { hasPendingAgentManagedWork } from "./services/jobService.js";
import {
  pruneExpiredObservabilityRows,
  startObservabilityRetentionLoop,
} from "./services/observabilityRetentionService.js";

const PORT = parseInt(process.env["PORT"] ?? "8081", 10);
const USERS_DIR = process.env["USERS_DIR"] ?? "/root/clawd/users";

const app = createApp();

async function reconcileStartupRuntime(): Promise<void> {
  try {
    const systemAgentChanged = await ensureSystemAgent();
    const proxyProvidersChanged = await ensureAllProxyProviders();
    const userProfilesChanged = await syncAllUserProfiles();
    const systemProfileChanged = await syncSystemAgentProfile();
    const shouldRestartGateway = shouldRestartGatewayAfterStartupReconciliation({
      systemAgentChanged,
      proxyProvidersChanged,
      userProfilesChanged,
      systemProfileChanged,
    });

    logger.info(
      `Startup runtime reconciliation complete: systemAgentChanged=${systemAgentChanged} proxyProvidersChanged=${proxyProvidersChanged} userProfilesChanged=${userProfilesChanged} systemProfileChanged=${systemProfileChanged} restartGateway=${shouldRestartGateway}`
    );

    if (shouldRestartGateway) {
      await restartGateway();
    } else {
      logger.info("Skipping gateway restart on startup because no runtime config changes were applied");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Proxy/profile setup on startup failed: ${message}`);
  }
}

async function reconcileStartupOperationalState(): Promise<void> {
  try {
    const userIds = await listWorkspaceUserIds();
    let workspaceRepairs = 0;
    let runtimeChanges = 0;

    for (const userId of userIds) {
      await repairActiveUserState(userId);
      const workspaceReconciliation = await reconcileWorkspaceIntegrity(userId);
      if (workspaceReconciliation.changed) {
        workspaceRepairs += 1;
      }

      const state = await readState(userId);
      const userCtrl = await getUserControl(userId);
      const agentStatus = await getUserAgentStatus(userId);
      const workspace = buildWorkspace(userId, USERS_DIR);
      const hasAgentManagedWork = await hasPendingAgentManagedWork(workspace);
      const eligibility = state.state === "ACTIVE"
        ? await getActiveUserEligibility(userId)
        : { eligible: true, reason: null };
      const changed = await reconcileUserHeartbeatCron(
        userId,
        agentStatus.configured && shouldUserHeartbeatBeEnabled({
          state: state.state,
          restriction: userCtrl.restriction,
          eligibilityIssue: eligibility.eligible ? null : eligibility.reason,
          hasAgentManagedWork,
        })
      );
      if (changed) runtimeChanges += 1;
    }

    await wakeAgentsWithPendingTriggers();
    logger.info(
      `Startup operational reconciliation complete: users=${userIds.length} workspaceRepairs=${workspaceRepairs} runtimeChanges=${runtimeChanges}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Operational reconciliation on startup failed: ${message}`);
  }
}

async function bootstrap(): Promise<void> {
  await eventStore.initialize();
  await pruneExpiredObservabilityRows();

  const server = app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
    startWatchdog();
    startJobCompletionWatcher();
    startDailyScheduler();
    startAgentJobDispatcher();
    startObservabilityRetentionLoop();
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
