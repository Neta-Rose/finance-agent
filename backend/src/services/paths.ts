import path from "path";
import { fileURLToPath } from "url";

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SERVICES_DIR, "..", "..");

export function resolveConfiguredPath(
  configuredPath: string | undefined,
  fallbackRelativeToBackend: string
): string {
  return path.resolve(BACKEND_ROOT, configuredPath ?? fallbackRelativeToBackend);
}
