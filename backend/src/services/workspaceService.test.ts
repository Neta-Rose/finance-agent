import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-service-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

const [
  { buildWorkspace },
  workspaceService,
  stateService,
] = await Promise.all([
  import("../middleware/userIsolation.js"),
  import("./workspaceService.js"),
  import("./stateService.js"),
]);

const {
  createUserWorkspace,
  reconcileWorkspaceIntegrity,
  saveUserPortfolio,
  startUserBootstrap,
} = workspaceService;
const { readState, writeState } = stateService;

test("saveUserPortfolio stores a valid portfolio and opens pending guidance without starting bootstrap", async () => {
  const userId = "workspace-save-portfolio";
  const ws = buildWorkspace(userId, usersDir);
  await createUserWorkspace(userId);

  await writeState(userId, {
    onboarding: {
      portfolioSubmittedAt: null,
      positionGuidanceStatus: "completed",
      positionGuidance: {
        AAPL: {
          thesis: "Keep this one",
          horizon: "years",
          addOn: "",
          reduceOn: "",
          notes: "",
        },
        ORCL: {
          thesis: "This should be dropped after portfolio replace",
          horizon: "months",
          addOn: "",
          reduceOn: "",
          notes: "",
        },
      },
    },
  });

  await saveUserPortfolio(userId, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "stage1" },
    accounts: {
      taxable: [
        {
          ticker: "AAPL",
          exchange: "NASDAQ",
          shares: 10,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
      ],
      retirement: [
        {
          ticker: "MSFT",
          exchange: "NASDAQ",
          shares: 4,
          unitAvgBuyPrice: 120,
          unitCurrency: "USD",
        },
      ],
    },
  });

  const state = await readState(userId);
  assert.equal(state.state, "INCOMPLETE");
  assert.equal(state.bootstrapProgress, null);
  assert.equal(state.onboarding.positionGuidanceStatus, "pending");
  assert.deepEqual(Object.keys(state.onboarding.positionGuidance), ["AAPL"]);

  const portfolioRaw = await fs.readFile(ws.portfolioFile, "utf-8");
  const portfolio = JSON.parse(portfolioRaw) as {
    accounts: Record<string, Array<{ ticker: string }>>;
  };
  assert.deepEqual(
    Object.values(portfolio.accounts).flat().map((position) => position.ticker),
    ["AAPL", "MSFT"]
  );

  const jobFiles = await fs.readdir(ws.jobsDir);
  assert.deepEqual(jobFiles, []);
});

test("startUserBootstrap deduplicates holdings by ticker and preserves skip status", async () => {
  const userId = "workspace-bootstrap";
  const ws = buildWorkspace(userId, usersDir);
  await createUserWorkspace(userId);

  await saveUserPortfolio(userId, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "bootstrap" },
    accounts: {
      main: [
        {
          ticker: "TSM",
          exchange: "NYSE",
          shares: 8,
          unitAvgBuyPrice: 110,
          unitCurrency: "USD",
        },
      ],
      second: [
        {
          ticker: "TSM",
          exchange: "NYSE",
          shares: 2,
          unitAvgBuyPrice: 105,
          unitCurrency: "USD",
        },
        {
          ticker: "NVDA",
          exchange: "NASDAQ",
          shares: 3,
          unitAvgBuyPrice: 115,
          unitCurrency: "USD",
        },
      ],
    },
  });

  await writeState(userId, {
    onboarding: {
      portfolioSubmittedAt: new Date().toISOString(),
      positionGuidanceStatus: "skipped",
      positionGuidance: {},
    },
  });

  const bootstrap = await startUserBootstrap(userId);
  assert.deepEqual(bootstrap, { totalPositions: 2 });

  const state = await readState(userId);
  assert.equal(state.state, "BOOTSTRAPPING");
  assert.equal(state.onboarding.positionGuidanceStatus, "skipped");
  assert.equal(state.bootstrapProgress?.total, 2);
  assert.equal(state.bootstrapProgress?.completed, 0);
  assert.deepEqual(state.bootstrapProgress?.completedTickers, []);

  await fs.access(ws.strategyFile("TSM"));
  await fs.access(ws.strategyFile("NVDA"));
});

test("reconcileWorkspaceIntegrity preserves non-portfolio ticker data and pending deep dives when strategy/report data exists", async () => {
  const userId = "workspace-reconcile";
  const ws = buildWorkspace(userId, usersDir);
  await createUserWorkspace(userId);

  await saveUserPortfolio(userId, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "reconcile" },
    accounts: {
      main: [
        {
          ticker: "TSM",
          exchange: "NYSE",
          shares: 5,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
      ],
    },
  });

  await fs.mkdir(path.join(ws.tickersDir, "AAPL"), { recursive: true });
  await fs.writeFile(path.join(ws.tickersDir, "AAPL", "strategy.json"), "{}", "utf-8");
  await fs.mkdir(path.join(ws.reportsDir, "AAPL"), { recursive: true });
  await fs.writeFile(path.join(ws.reportsDir, "AAPL", "quick_check.json"), "{}", "utf-8");
  await writeState(userId, { pendingDeepDives: ["TSM", "AAPL"] });

  const reconciliation = await reconcileWorkspaceIntegrity(userId);
  assert.equal(reconciliation.changed, false);
  assert.deepEqual(reconciliation.archivedTickers, []);
  assert.deepEqual(reconciliation.archivedReports, []);
  assert.deepEqual(reconciliation.removedPendingDeepDives, []);

  await fs.access(path.join(ws.tickersDir, "AAPL"));
  await fs.access(path.join(ws.reportsDir, "AAPL"));

  const state = await readState(userId);
  assert.deepEqual(state.pendingDeepDives, ["TSM", "AAPL"]);
});

test("reconcileWorkspaceIntegrity recreates exploratory ticker workspace from existing non-portfolio reports", async () => {
  const userId = "workspace-reconcile-exploratory-restore";
  const ws = buildWorkspace(userId, usersDir);
  await createUserWorkspace(userId);

  await saveUserPortfolio(userId, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "reconcile" },
    accounts: {
      main: [
        {
          ticker: "TSM",
          exchange: "NYSE",
          shares: 5,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
      ],
    },
  });

  await fs.mkdir(path.join(ws.reportsDir, "ONDS"), { recursive: true });
  await fs.writeFile(
    path.join(ws.reportsDir, "ONDS", "deep_dive_state.json"),
    JSON.stringify({ ticker: "ONDS", status: "completed" }, null, 2),
    "utf-8"
  );
  await writeState(userId, { pendingDeepDives: ["ONDS"] });

  const reconciliation = await reconcileWorkspaceIntegrity(userId);
  assert.equal(reconciliation.changed, false);
  assert.deepEqual(reconciliation.removedPendingDeepDives, []);

  await fs.access(path.join(ws.tickersDir, "ONDS"));
  const strategyRaw = await fs.readFile(ws.strategyFile("ONDS"), "utf-8");
  const strategy = JSON.parse(strategyRaw) as { ticker: string; deepDiveTriggeredBy?: string; reasoning?: string };
  assert.equal(strategy.ticker, "ONDS");
  assert.equal(strategy.deepDiveTriggeredBy, "manual_exploration");
  assert.match(strategy.reasoning ?? "", /exploratory deep dive/i);

  const state = await readState(userId);
  assert.deepEqual(state.pendingDeepDives, ["ONDS"]);
});

test("reconcileWorkspaceIntegrity removes pending deep dives only when no portfolio or stored ticker data exists", async () => {
  const userId = "workspace-reconcile-orphaned-pending";
  await createUserWorkspace(userId);

  await saveUserPortfolio(userId, {
    meta: { currency: "ILS", transactionFeeILS: 0, note: "reconcile" },
    accounts: {
      main: [
        {
          ticker: "TSM",
          exchange: "NYSE",
          shares: 5,
          unitAvgBuyPrice: 100,
          unitCurrency: "USD",
        },
      ],
    },
  });

  await writeState(userId, { pendingDeepDives: ["TSM", "AAPL"] });

  const reconciliation = await reconcileWorkspaceIntegrity(userId);
  assert.equal(reconciliation.changed, true);
  assert.deepEqual(reconciliation.archivedTickers, []);
  assert.deepEqual(reconciliation.archivedReports, []);
  assert.deepEqual(reconciliation.removedPendingDeepDives, ["AAPL"]);

  const state = await readState(userId);
  assert.deepEqual(state.pendingDeepDives, ["TSM"]);
});
