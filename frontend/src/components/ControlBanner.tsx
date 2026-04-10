// frontend/src/components/ControlBanner.tsx
import { useState } from "react";
import type { ControlState, Banner } from "../api/control";

const BANNER_STYLES: Record<Banner["type"], { bg: string; border: string; text: string; icon: string }> = {
  info:    { bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.25)",  text: "var(--color-accent-blue)",  icon: "ℹ" },
  warning: { bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.25)",  text: "#f59e0b",                  icon: "⚠" },
  error:   { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.25)",   text: "var(--color-accent-red)",  icon: "⊗" },
};

const RESTRICTION_BANNER: Record<
  NonNullable<ControlState["restriction"]>,
  { text: string; type: Banner["type"] }
> = {
  readonly:  { text: "Your account is in read-only mode. Job triggers are disabled.", type: "info" },
  blocked:   { text: "Your account has been restricted. Contact the administrator.",   type: "warning" },
  suspended: { text: "Your account is suspended.",                                     type: "error" },
};

function SingleBanner({
  text, type, dismissible, onDismiss,
}: {
  text: string; type: Banner["type"]; dismissible: boolean; onDismiss: () => void;
}) {
  const s = BANNER_STYLES[type];
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium"
      style={{ background: s.bg, borderBottom: `1px solid ${s.border}`, color: s.text }}
    >
      <span className="flex items-center gap-2">
        <span className="text-sm leading-none">{s.icon}</span>
        <span>{text}</span>
      </span>
      {dismissible && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-base leading-none opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >×</button>
      )}
    </div>
  );
}

export function ControlBanner({ state }: { state: ControlState }) {
  const [dismissedSystem,      setDismissedSystem]      = useState(false);
  const [dismissedRestriction, setDismissedRestriction] = useState(false);
  const [dismissedUserBanner,  setDismissedUserBanner]  = useState(false);

  const now = new Date();

  // 1. System broadcast
  const sysBroadcast = state.systemBroadcast;
  const showSys = !dismissedSystem && !!sysBroadcast &&
    (!sysBroadcast.expiresAt || new Date(sysBroadcast.expiresAt) > now);

  // 2. System lock banner (if no broadcast already covers it)
  const showLock = !showSys && state.systemLocked;

  // 3. User restriction banner (shown for readonly + blocked; suspended users see SuspensionPage)
  const restriction = state.restriction;
  const showRestriction = !dismissedRestriction && (restriction === "readonly" || restriction === "blocked");
  const restrictionDef  = restriction ? RESTRICTION_BANNER[restriction] : null;
  const restrictionText = (state.reason && state.reason.trim()) ? state.reason : restrictionDef?.text ?? "";
  const restrictionType = restrictionDef?.type ?? "warning";

  // 4. Custom user banner (independent of restriction)
  const userBanner = state.banner;
  const showUserBanner = !dismissedUserBanner && !!userBanner &&
    (!userBanner.expiresAt || new Date(userBanner.expiresAt) > now);

  if (!showSys && !showLock && !showRestriction && !showUserBanner) return null;

  return (
    <div className="sticky top-0 z-50">
      {showSys && (
        <SingleBanner
          text={sysBroadcast!.text}
          type={sysBroadcast!.type}
          dismissible={sysBroadcast!.dismissible}
          onDismiss={() => setDismissedSystem(true)}
        />
      )}
      {showLock && (
        <SingleBanner
          text={state.systemLockReason || "System is temporarily locked. No new jobs can be triggered."}
          type="error"
          dismissible={false}
          onDismiss={() => {}}
        />
      )}
      {showRestriction && (
        <SingleBanner
          text={restrictionText}
          type={restrictionType}
          dismissible={true}
          onDismiss={() => setDismissedRestriction(true)}
        />
      )}
      {showUserBanner && (
        <SingleBanner
          text={userBanner!.text}
          type={userBanner!.type}
          dismissible={userBanner!.dismissible}
          onDismiss={() => setDismissedUserBanner(true)}
        />
      )}
    </div>
  );
}
