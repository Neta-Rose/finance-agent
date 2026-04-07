import { createLogger, format, transports } from "winston";
import path from "path";
import fs from "fs";

const logDir = path.resolve("logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logLevel = process.env["LOG_LEVEL"] ?? "info";

export const logger = createLogger({
  level: logLevel,
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.printf(({ level, message, timestamp, stack }) => {
      if (stack) {
        return `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`;
      }
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.timestamp()),
    }),
    new transports.File({
      filename: path.join(logDir, "app.log"),
      format: format.uncolorize(),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});
