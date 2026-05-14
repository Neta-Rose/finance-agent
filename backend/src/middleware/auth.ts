import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "../services/paths.js";
import { validateSession } from "../services/impersonationService.js";

const JWT_SECRET  = process.env["JWT_SECRET"] ?? "changeme";
const TOKEN_EXPIRY = "7d";
const USERS_DIR   = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

// Shape of a normal JWT payload
interface NormalPayload {
  userId: string;
  tokenVersion?: number;
}

// Shape of an impersonation JWT payload
interface ImpersonationPayload {
  userId: string;
  impersonatorId: string;
  sessionId: string;
  readOnly: true;
}

function isImpersonationPayload(p: NormalPayload | ImpersonationPayload): p is ImpersonationPayload {
  return (
    "impersonatorId" in p &&
    "sessionId" in p &&
    (p as ImpersonationPayload).readOnly === true
  );
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
  let payload: NormalPayload | ImpersonationPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as NormalPayload | ImpersonationPayload;
    if (!payload.userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  } catch {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // --- Impersonation token path ---
  if (isImpersonationPayload(payload)) {
    const { impersonatorId, sessionId } = payload;
    validateSession(sessionId)
      .then((result) => {
        if (!result.valid) {
          res.status(401).json({ error: "impersonation_session_invalid", reason: result.reason });
          return;
        }
        res.locals["userId"] = result.targetUserId;
        res.locals["impersonatorId"] = impersonatorId;
        res.locals["sessionId"] = sessionId;
        res.locals["readOnly"] = true;
        next();
      })
      .catch(() => {
        res.status(401).json({ error: "impersonation_session_invalid", reason: "validation_error" });
      });
    return;
  }

  // --- Normal token path ---
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
      res.locals["userId"] = payload.userId;
      next();
    })
    .catch(() => {
      // File read error → fail open (don't block on infra issues)
      res.locals["userId"] = payload.userId;
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
