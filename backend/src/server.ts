import "dotenv/config";
import { createApp } from "./app.js";
import { logger } from "./services/logger.js";
import { startWatchdog } from "./services/watchdogService.js";
import {
  ensureAllProxyProviders,
  restartGateway,
  healAllCrons,
  ensureAllUserCrons,
  wakeAgentsWithPendingTriggers,
  ensureSystemAgent,
} from "./services/agentService.js";
import { syncAllUserProfiles, syncSystemAgentProfile } from "./services/profileService.js";

const PORT = parseInt(process.env["PORT"] ?? "8081", 10);

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  startWatchdog();
  // Ensure every agent has a proxy provider in openclaw.json and rebuild the
  // in-memory key map, reconcile per-user model profiles, then restart the
  // gateway so the new providers and models take effect.
  ensureSystemAgent()
    .then(() => ensureAllProxyProviders())
    .then(() => syncAllUserProfiles())
    .then(() => syncSystemAgentProfile())
    .then(() => restartGateway())
    .catch((err: Error) =>
      logger.warn(`Proxy/profile setup on startup failed: ${err.message}`)
    );
  // Heal any crons that were created before --no-deliver was the default
  healAllCrons();
  ensureAllUserCrons()
    .then(() => wakeAgentsWithPendingTriggers())
    .catch((err: Error) =>
      logger.warn(`Cron reconciliation on startup failed: ${err.message}`)
    );
});

server.on("error", (err: NodeJS.ErrnoException) => {
  logger.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});
