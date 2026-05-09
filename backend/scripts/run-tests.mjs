#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const backendRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(backendRoot, "src");

async function findTestFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map(async (dirent) => {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) return findTestFiles(fullPath);
    return dirent.isFile() && dirent.name.endsWith(".test.ts") ? [fullPath] : [];
  }));
  return files.flat().sort((a, b) => a.localeCompare(b));
}

const testFiles = await findTestFiles(srcRoot);
const forwardedNodeTestArgs = process.argv.slice(2);
const child = spawn(
  process.execPath,
  ["--test", "--import", "tsx", ...forwardedNodeTestArgs, ...testFiles],
  { cwd: backendRoot, stdio: "inherit" }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
