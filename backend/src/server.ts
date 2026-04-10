import "dotenv/config";
import { createApp } from "./app.js";
import { logger } from "./services/logger.js";
import { startWatchdog } from "./services/watchdogService.js";
import { ensureAllProxyProviders, restartGateway } from "./services/agentService.js";

const PORT = parseInt(process.env["PORT"] ?? "8081", 10);

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  startWatchdog();
  // Ensure every agent has a proxy provider in openclaw.json and rebuild the
  // in-memory key map, then restart the gateway so the new providers take effect.
  ensureAllProxyProviders()
    .then(() => restartGateway())
    .catch((err: Error) =>
      logger.warn(`Proxy provider setup on startup failed: ${err.message}`)
    );
});

server.on("error", (err: NodeJS.ErrnoException) => {
  logger.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});
