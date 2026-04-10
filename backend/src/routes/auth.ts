import { Router } from "express";
import { promises as fs } from "fs";
import path from "path";
import { authLimiter } from "../middleware/rateLimit.js";
import {
  generateToken,
  hashPassword,
  verifyPassword,
} from "../middleware/auth.js";
import { guardUserMessage } from "../services/sanitizerService.js";
import { createUserWorkspace } from "../services/workspaceService.js";

const router = Router();

router.post(
  "/login",
  authLimiter,
  async (req, res) => {
    const { userId, password } = req.body as {
      userId?: string;
      password?: string;
    };

    if (!userId || !password) {
      res.status(400).json({ error: "userId and password required" });
      return;
    }

    const guard = guardUserMessage(password);
    if (!guard.proceed) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const USERS_DIR = process.env["USERS_DIR"] ?? "../users";
    const authFile = path.join(USERS_DIR, userId, "auth.json");

    let authData: { passwordHash: string; tokenVersion?: number };
    try {
      const raw = await fs.readFile(authFile, "utf-8");
      authData = JSON.parse(raw);
    } catch {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }

    const valid = await verifyPassword(password, authData.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }

    // Read tokenVersion from auth.json (default 0 if missing — backward compat)
    const tokenVersion = authData.tokenVersion ?? 0;
    const token = generateToken(userId, tokenVersion);
    res.json({ token, userId });
  }
);

router.post("/logout", async (_req, res) => {
  res.json({ status: "ok" });
});

router.post("/register", async (req, res) => {
  const expectedKey = process.env["ADMIN_KEY"];
  const adminKey = req.headers["x-admin-key"];
  if (!expectedKey || adminKey !== expectedKey) {
    res.status(403).json({ error: "admin access only" });
    return;
  }

  const { userId, password } = req.body as {
    userId?: string;
    password?: string;
  };

  if (!userId || !/^[a-zA-Z0-9]{4,32}$/.test(userId)) {
    res.status(400).json({ error: "userId must be alphanumeric, 4-32 chars" });
    return;
  }

  if (!password || password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }

  const USERS_DIR = process.env["USERS_DIR"] ?? "../users";
  const wsRoot = path.join(USERS_DIR, userId);
  try {
    await fs.access(wsRoot);
    res.status(409).json({ error: "user already exists" });
    return;
  } catch {
    // doesn't exist — good
  }

  await createUserWorkspace(userId);
  const hash = await hashPassword(password);
  await fs.writeFile(
    path.join(wsRoot, "auth.json"),
    JSON.stringify({ passwordHash: hash }),
    "utf-8"
  );

  res.status(201).json({ userId, created: true });
});

// POST /api/auth/change-password — admin alias, no current password required
router.post("/change-password", async (req, res) => {
  const expectedKey = process.env["ADMIN_KEY"];
  const adminKey = req.headers["x-admin-key"];
  if (!expectedKey || adminKey !== expectedKey) {
    res.status(403).json({ error: "admin access only" });
    return;
  }

  const { userId, newPassword } = req.body as {
    userId?: string;
    newPassword?: string;
  };

  if (!userId || !newPassword) {
    res.status(400).json({ error: "userId and newPassword required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "newPassword must be at least 8 characters" });
    return;
  }

  const USERS_DIR = process.env["USERS_DIR"] ?? "../users";
  const authFile = path.join(USERS_DIR, userId, "auth.json");

  try {
    await fs.access(authFile);
  } catch {
    res.status(404).json({ error: "user not found" });
    return;
  }

  const hash = await hashPassword(newPassword);
  await fs.writeFile(authFile, JSON.stringify({ passwordHash: hash }), "utf-8");
  res.json({ changed: true });
});

export default router;
