import "dotenv/config";
import { createApp } from "./app.js";
import { logger } from "./services/logger.js";
import { startWatchdog } from "./services/watchdogService.js";

const PORT = parseInt(process.env["PORT"] ?? "8081", 10);

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  startWatchdog();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  logger.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});
