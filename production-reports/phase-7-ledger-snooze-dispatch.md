# Production report — Phase 7: Transactions ledger, corporate actions, snooze, asset-class dispatch

**Date:** 2026-05-06
**Initiative:** Platform Stabilization and Assistant
**Tasks:** 7.1–7.10 (code), 7.11 (operational — VPS flag flips)

---

## Goal

First-class portfolio management: transactions ledger with FIFO cost basis, corporate actions (splits/dividends), snooze suppression, asset-class-aware dispatch, position-level rule enforcement, portfolio-level risk computation.

---

## 7.1 — DDL

Appended to `db/application_postgres.sql`:

| Table | Purpose |
|---|---|
| `position_transactions` | Append-only ledger with tombstone semantics. FIFO cost basis computed from this table. |
| `corporate_actions` | Splits and dividends applied to historical transactions. |

ALTERs:
- `jobs.asset_class VARCHAR(16)` — records the asset class the job was admitted for
- `ticker_work_items.asset_class VARCHAR(16)` — per-ticker dispatch decision

Two new TypeORM entities registered in `applicationDataSource.ts`.

---

## 7.2 — `transactionStore.ts`

CRUD for `position_transactions` with append-only semantics:
- `insertTransaction` — insert a new row
- `listTransactions` — read non-superseded rows (default) or all
- `editTransaction` — insert new row + tombstone old row (J1.2)
- `deleteTransaction` — insert tombstone row + supersede original
- `computeFifoForTicker` — FIFO lot matching per §11.1; returns `FifoResult` with `openLots`, `costBasisIls`, `realizedPlIls`, `unrealizedPlIls`
- `replayOpeningLot` — insert a synthetic opening lot from migration_archive

FIFO handles: partial fills, dividends (ignored for cost basis), oversold error (structured, not silent), split rows (structured error — rewrite must run first).

---

## 7.3 — `corporateActionsStore.ts`

- `applyCorporateAction` — idempotent; splits rewrite historical transactions; dividends insert zero-quantity rows
- `listCorporateActions` — filtered by ticker/user
- `revertCorporateAction` — stamps `reverted_at` + reason

Idempotency key: `(ticker, exchange, action_type, effective_date, ratio_or_amount, source, user_id)`.

---

## 7.4 — Asset-class-aware dispatch

`expansion.ts` updated:
- `selectStepKindsForAssetClass(assetClass, fullDeepDive)` — equity: full pipeline; bond/ETF: skip `analyst.technical`; other: equity pipeline
- `resolveAssetClass(userId, ticker)` — reads `strategies.asset_class` from DB, defaults to `"equity"`
- Both `deep_dive` and `full_report` expansion now use asset-class dispatch

---

## 7.5 — Position-level rule engine

`positionRuleEngine.ts` — `evaluatePositionRules({ userId, ticker, positionWeightPct, drawdownPct })`:
- Reads `max_single_position_pct` and `stop_loss_threshold_pct` from `users` table
- Triggers a `deep_dive` job when a rule fires
- Writes a `step_lifecycle_events` audit row with `error_class='rule_triggered'`
- Called from daily-brief expansion and transaction insert path

---

## 7.6 — Snooze suppression

Already wired in Phase 2 (`quickCheck.ts`). `findActiveSnooze` is called before admitting a deep-dive escalation. Marked done.

---

## 7.7 — Signal-set fingerprint

Already implemented in Phase 2 (`quickCheckService.ts`, `quickCheck.ts`). Marked done.

---

## 7.8 — Portfolio-level risk computation

`portfolioRiskService.ts` — `computeAndStorePortfolioRisk(userId)`:
- Reads portfolio.json for position values (cost-basis proxy)
- Computes concentration by single name, currency, asset class
- Inserts a `portfolio_risk_snapshots` row
- Called from daily-brief admission, full-report admission, transaction insert path

`GET /api/portfolio/risk` endpoint added to `portfolio.ts`.

`PortfolioRiskCard` frontend component added — shows top-3 concentration bars with red highlight when any position exceeds 20%.

---

## 7.9 — Coverage limit replaces fake `pro` plan check

`getDailyBriefCoverageLimit` in `dailyBriefService.ts` now reads `feature_flags.coverage_limit` instead of checking `plan === "pro"`. Default is `Number.POSITIVE_INFINITY` (no limit) when the flag is not set. The `pro` plan concept is removed per N3.

---

## 7.10 — Frontend additions

- `PortfolioRiskCard` component — concentration risk visualization
- `frontend/src/api/portfolioRisk.ts` — `fetchPortfolioRiskSnapshot()`
- `frontend/src/api/verdictActions.ts` — `recordVerdictAction()`, `createSnooze()`
- `POST /api/verdict-actions` — record followed/dismissed/partial_acted
- `POST /api/snoozes` — snooze a ticker for N days

---

## 7.11 — Replay script

`backend/src/scripts/replayOpeningLots.ts` — reads `migration_archive` rows with `reason='synthetic_opening_lot_inserted'` and inserts the corresponding `position_transactions` rows. Idempotent.

---

## Files changed

```
NEW (backend)
  backend/src/services/transactionStore.ts
  backend/src/services/corporateActionsStore.ts
  backend/src/services/positionRuleEngine.ts
  backend/src/services/portfolioRiskService.ts
  backend/src/routes/verdictActions.ts
  backend/src/scripts/replayOpeningLots.ts
  backend/src/db/entities/PositionTransactionEntity.ts
  backend/src/db/entities/CorporateActionEntity.ts

NEW (frontend)
  frontend/src/components/portfolio/PortfolioRiskCard.tsx
  frontend/src/api/portfolioRisk.ts
  frontend/src/api/verdictActions.ts

EDITED
  db/application_postgres.sql                          (+ Phase 7 tables + ALTERs)
  backend/src/db/applicationDataSource.ts              (+ 2 entities)
  backend/src/services/stepQueue/expansion.ts          (+ asset-class dispatch)
  backend/src/services/dailyBriefService.ts            (+ coverage_limit flag replaces pro plan)
  backend/src/routes/portfolio.ts                      (+ GET /portfolio/risk)
  backend/src/app.ts                                   (+ verdictActions route)
```

---

## Operational steps on VPS

```bash
cd /root/clawd && git pull origin main && ./deploy.sh

# Verify Phase 7 DDL applied
psql "$APP_DATABASE_URL" -c "\d position_transactions; \d corporate_actions;"

# Replay synthetic opening lots from Phase 1 migration
tsx backend/src/scripts/replayOpeningLots.ts --all
# Inspect output, then commit:
tsx backend/src/scripts/replayOpeningLots.ts --all --commit

# Verify lots inserted
psql "$APP_DATABASE_URL" -c "
  SELECT user_id, ticker, quantity, unit_price, transaction_at, note
  FROM position_transactions
  WHERE note = 'synthetic_opening_lot'
  ORDER BY user_id, ticker;"

# Flip Phase 7 flags
psql "$APP_DATABASE_URL" -c "
  UPDATE feature_flags
  SET enabled = true, updated_at = NOW(), updated_by = 'operator'
  WHERE flag_name IN ('transactions_ledger_enabled','snooze_enabled','asset_class_dispatch_enabled')
    AND scope_user_id IS NULL;"

# Verify asset-class dispatch (trigger a deep dive and check step kinds)
psql "$APP_DATABASE_URL" -c "
  SELECT t.ticker, t.asset_class, s.kind, s.status
  FROM ticker_work_items t
  JOIN step_work_items s ON s.ticker_work_item_id = t.id
  WHERE t.created_at > NOW() - INTERVAL '5 minutes'
  ORDER BY t.ticker, s.kind;"
```

**Rollback:** Flip the three flags back to `false`. `position_transactions` rows are append-only; they remain but are not read by the cost-basis path when the flag is off.
