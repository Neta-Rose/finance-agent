import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "../services/paths.js";

const JWT_SECRET  = process.env["JWT_SECRET"] ?? "changeme";

if (JWT_SECRET === "changeme" && process.env["NODE_ENV"] === "production") {
  throw new Error(
    "FATAL: JWT_SECRET is set to the insecure default \"changeme\". " +
    "Set a strong, random JWT_SECRET environment variable before running in production."
  );
}
const TOKEN_EXPIRY = "7d";
const USERS_DIR   = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: { userId: string; tokenVersion?: number };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { userId: string; tokenVersion?: number };
    if (!payload.userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  } catch {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // Async tokenVersion check — if it fails we fail open (don't lock out on file errors)
  const authFile = path.resolve(USERS_DIR, payload.userId, "auth.json");
  fs.readFile(authFile, "utf-8")
    .then((raw) => {
      const data = JSON.parse(raw) as { tokenVersion?: number };
      const storedVersion = data.tokenVersion ?? 0;
      const tokenVersion  = payload.tokenVersion ?? 0;

      if (tokenVersion !== storedVersion) {
        res.status(401).json({ error: "session_invalidated" });
        return;
      }
      res.locals.userId = payload.userId;
      next();
    })
    .catch(() => {
      // File read error → fail open (don't block on infra issues)
      res.locals.userId = payload.userId;
      next();
    });
}

export function generateToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ userId, tokenVersion }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
