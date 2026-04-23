import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySystemAgentHealth,
  classifyUserAgentHealth,
  shouldRestartGatewayAfterStartupReconciliation,
  shouldUserHeartbeatBeEnabled,
} from "./startupService.js";

test("startup reconciliation restarts gateway when any runtime config changed", () => {
  assert.equal(
    shouldRestartGatewayAfterStartupReconciliation({
      systemAgentChanged: false,
      proxyProvidersChanged: true,
      userProfilesChanged: false,
      systemProfileChanged: false,
    }),
    true
  );
});

test("startup reconciliation skips gateway restart when no runtime config changed", () => {
  assert.equal(
    shouldRestartGatewayAfterStartupReconciliation({
      systemAgentChanged: false,
      proxyProvidersChanged: false,
      userProfilesChanged: false,
      systemProfileChanged: false,
    }),
    false
  );
});

test("heartbeat is enabled only for unrestricted operational users", () => {
  assert.equal(
    shouldUserHeartbeatBeEnabled({
      state: "ACTIVE",
      restriction: null,
      eligibilityIssue: null,
      hasAgentManagedWork: true,
    }),
    true
  );
  assert.equal(
    shouldUserHeartbeatBeEnabled({
      state: "BOOTSTRAPPING",
      restriction: null,
      eligibilityIssue: null,
      hasAgentManagedWork: true,
    }),
    true
  );
  assert.equal(
    shouldUserHeartbeatBeEnabled({
      state: "ACTIVE",
      restriction: "suspended",
      eligibilityIssue: null,
      hasAgentManagedWork: true,
    }),
    false
  );
  assert.equal(
    shouldUserHeartbeatBeEnabled({
      state: "INCOMPLETE",
      restriction: null,
      eligibilityIssue: null,
      hasAgentManagedWork: true,
    }),
    false
  );
  assert.equal(
    shouldUserHeartbeatBeEnabled({
      state: "ACTIVE",
      restriction: null,
      eligibilityIssue: "portfolio missing",
      hasAgentManagedWork: true,
    }),
    false
  );
  assert.equal(
    shouldUserHeartbeatBeEnabled({
      state: "ACTIVE",
      restriction: null,
      eligibilityIssue: null,
      hasAgentManagedWork: false,
    }),
    false
  );
});

test("classifyUserAgentHealth marks restricted and inactive users as non-operational without failing health", () => {
  const rawHealth = {
    healthy: false,
    consecutiveErrors: 14,
    lastError: "auth failed",
    lastErrorReason: "auth",
    lastRunAt: null,
  };

  const restricted = classifyUserAgentHealth(rawHealth, {
    state: "ACTIVE",
    restriction: "suspended",
    eligibilityIssue: null,
    hasAgentManagedWork: true,
  });
  assert.equal(restricted.healthy, true);
  assert.equal(restricted.classification, "restricted");
  assert.equal(restricted.operational, false);

  const inactive = classifyUserAgentHealth(rawHealth, {
    state: "INCOMPLETE",
    restriction: null,
    eligibilityIssue: null,
    hasAgentManagedWork: false,
  });
  assert.equal(inactive.healthy, true);
  assert.equal(inactive.classification, "inactive");
  assert.equal(inactive.operational, false);
});

test("classifyUserAgentHealth preserves degraded health for operational users", () => {
  const degraded = classifyUserAgentHealth(
    {
      healthy: false,
      consecutiveErrors: 11,
      lastError: "wake failed",
      lastErrorReason: null,
      lastRunAt: null,
    },
    {
      state: "ACTIVE",
      restriction: null,
      eligibilityIssue: null,
      hasAgentManagedWork: true,
    }
  );

  assert.equal(degraded.healthy, false);
  assert.equal(degraded.classification, "degraded");
  assert.equal(degraded.operational, true);

  const systemHealth = classifySystemAgentHealth({
    healthy: true,
    consecutiveErrors: 0,
    lastError: null,
    lastErrorReason: null,
    lastRunAt: null,
  });
  assert.equal(systemHealth.classification, "healthy");
  assert.equal(systemHealth.operational, true);
});
