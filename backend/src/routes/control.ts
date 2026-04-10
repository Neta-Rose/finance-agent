// backend/src/routes/control.ts
import { Router } from "express";
import { getUserControl, getSystemControl } from "../services/controlService.js";

const router = Router();

// GET /api/me/control — returns current user's control state + system state
// Always 200 — even suspended users need this to render the suspension page.
router.get("/control", async (_req, res) => {
  const userId = res.locals["userId"] as string;
  const [userCtrl, sysCtrl] = await Promise.all([
    getUserControl(userId),
    getSystemControl(),
  ]);

  res.json({
    restriction:      userCtrl.restriction,
    reason:           userCtrl.reason,
    restrictedUntil:  userCtrl.restrictedUntil,
    banner:           userCtrl.banner,
    systemLocked:     sysCtrl.locked,
    systemLockReason: sysCtrl.lockReason,
    systemBroadcast:  sysCtrl.broadcast,
  });
});

export default router;
