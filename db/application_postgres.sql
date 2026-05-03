CREATE TABLE IF NOT EXISTS llm_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  purpose VARCHAR(128) NOT NULL,
  ticker VARCHAR(32),
  job_id VARCHAR(128),
  step_id UUID,
  source_class VARCHAR(64) NOT NULL,
  analyst VARCHAR(64) NOT NULL,
  model VARCHAR(255) NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  error_message TEXT,
  attribution_source VARCHAR(128) NOT NULL,
  rejection_reason VARCHAR(128),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_requests_occurred_at
  ON llm_requests (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_occurred_at
  ON llm_requests (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_source_occurred_at
  ON llm_requests (user_id, source_class, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_purpose_ticker_analyst_occurred_at
  ON llm_requests (user_id, purpose, ticker, analyst, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_requests_user_job_occurred_at
  ON llm_requests (user_id, job_id, occurred_at DESC);

ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS step_id UUID;

CREATE INDEX IF NOT EXISTS idx_llm_requests_step_id
  ON llm_requests (step_id)
  WHERE step_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_points_budgets (
  user_id VARCHAR(128) PRIMARY KEY,
  daily_budget_points NUMERIC(18, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_points_budgets_updated_at
  ON user_points_budgets (updated_at DESC);

CREATE TABLE IF NOT EXISTS tracked_assets (
  user_id VARCHAR(128) NOT NULL,
  ticker VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'muted', 'archived')),
  created_from_job_id VARCHAR(128),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_tracked_assets_user_status
  ON tracked_assets (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  source VARCHAR(64) NOT NULL,
  model_tier VARCHAR(32) NOT NULL,
  notify_per_ticker BOOLEAN NOT NULL DEFAULT FALSE,
  budget_admitted_at TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pause_reason TEXT,
  failure_reason TEXT,
  result JSONB
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status
  ON jobs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_jobs_status_triggered
  ON jobs (status, triggered_at);

CREATE TABLE IF NOT EXISTS ticker_work_items (
  id UUID PRIMARY KEY,
  job_id VARCHAR(128) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  ticker VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  position INTEGER NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  skip_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickers_job
  ON ticker_work_items (job_id);

CREATE INDEX IF NOT EXISTS idx_tickers_user_status
  ON ticker_work_items (user_id, status);

CREATE TABLE IF NOT EXISTS step_work_items (
  id UUID PRIMARY KEY,
  ticker_work_item_id UUID NOT NULL REFERENCES ticker_work_items(id) ON DELETE CASCADE,
  job_id VARCHAR(128) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  model_tier_used VARCHAR(32),
  cost_accrued_cents INTEGER NOT NULL DEFAULT 0,
  input_artifact_paths TEXT[] NOT NULL DEFAULT '{}',
  output_artifact_path TEXT,
  last_error TEXT,
  owner_lock_id UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steps_status_created
  ON step_work_items (status, created_at);

CREATE INDEX IF NOT EXISTS idx_steps_job_status
  ON step_work_items (job_id, status);

CREATE INDEX IF NOT EXISTS idx_steps_ticker_status
  ON step_work_items (ticker_work_item_id, status);

CREATE INDEX IF NOT EXISTS idx_steps_lock
  ON step_work_items (owner_lock_id)
  WHERE owner_lock_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS step_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  step_id UUID NOT NULL REFERENCES step_work_items(id) ON DELETE CASCADE,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  attempt_n INTEGER,
  model_used VARCHAR(255),
  tier_used VARCHAR(32),
  error_class VARCHAR(64),
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_step_events_step
  ON step_lifecycle_events (step_id, occurred_at);

CREATE TABLE IF NOT EXISTS model_tier_assignments (
  tier VARCHAR(32) NOT NULL CHECK (tier IN ('free', 'cheap', 'balanced', 'expensive')),
  step_kind VARCHAR(64) NOT NULL,
  model VARCHAR(255) NOT NULL,
  fallback VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(128) NOT NULL DEFAULT 'admin',
  PRIMARY KEY (tier, step_kind)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_llm_requests_step_id'
  ) THEN
    ALTER TABLE llm_requests
      ADD CONSTRAINT fk_llm_requests_step_id
      FOREIGN KEY (step_id)
      REFERENCES step_work_items(id)
      ON DELETE SET NULL;
  END IF;
END
$$;
