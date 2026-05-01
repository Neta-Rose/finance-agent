import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmpPath, "w");
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmpPath, filePath);
}
