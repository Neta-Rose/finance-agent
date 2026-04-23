import type { AgentHealth } from "./agentService.js";

export interface StartupGatewayDecisionInput {
  systemAgentChanged: boolean;
  proxyProvidersChanged: boolean;
  userProfilesChanged: boolean;
  systemProfileChanged: boolean;
}

export type AgentHealthClassification =
  | "healthy"
  | "degraded"
  | "restricted"
  | "inactive";

export interface UserOperationalContext {
  state: string;
  restriction: "readonly" | "blocked" | "suspended" | null;
  eligibilityIssue: string | null;
  hasAgentManagedWork: boolean;
}

function inactiveReasonForState(state: string): string {
  if (state === "INCOMPLETE") return "onboarding_incomplete";
  if (state === "BLOCKED") return "state_blocked";
  return `state_${state.toLowerCase()}`;
}

export function shouldUserHeartbeatBeEnabled(
  context: UserOperationalContext
): boolean {
  if (context.restriction !== null) return false;
  if (!context.hasAgentManagedWork) return false;
  if (context.state === "BOOTSTRAPPING") return true;
  if (context.state === "ACTIVE" && context.eligibilityIssue === null) return true;
  return false;
}

export function classifyUserAgentHealth(
  rawHealth: AgentHealth,
  context: UserOperationalContext
): AgentHealth {
  if (context.restriction !== null) {
    return {
      ...rawHealth,
      healthy: true,
      classification: "restricted",
      statusReason: `user_${context.restriction}`,
      operational: false,
    };
  }

  if (!shouldUserHeartbeatBeEnabled(context)) {
    return {
      ...rawHealth,
      healthy: true,
      classification: "inactive",
      statusReason:
        context.eligibilityIssue ??
        (context.hasAgentManagedWork
          ? inactiveReasonForState(context.state)
          : "no_agent_work_queued"),
      operational: false,
    };
  }

  if (rawHealth.healthy) {
    return {
      ...rawHealth,
      classification: "healthy",
      statusReason: null,
      operational: true,
    };
  }

  return {
    ...rawHealth,
    healthy: false,
    classification: "degraded",
    statusReason:
      rawHealth.lastErrorReason ??
      rawHealth.lastError ??
      `${rawHealth.consecutiveErrors} consecutive heartbeat failures`,
    operational: true,
  };
}

export function classifySystemAgentHealth(rawHealth: AgentHealth): AgentHealth {
  if (rawHealth.healthy) {
    return {
      ...rawHealth,
      classification: "healthy",
      statusReason: null,
      operational: true,
    };
  }

  return {
    ...rawHealth,
    classification: "degraded",
    statusReason:
      rawHealth.lastErrorReason ??
      rawHealth.lastError ??
      `${rawHealth.consecutiveErrors} consecutive heartbeat failures`,
    operational: true,
  };
}

export function shouldRestartGatewayAfterStartupReconciliation(
  input: StartupGatewayDecisionInput
): boolean {
  return (
    input.systemAgentChanged ||
    input.proxyProvidersChanged ||
    input.userProfilesChanged ||
    input.systemProfileChanged
  );
}
