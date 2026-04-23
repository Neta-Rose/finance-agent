CREATE TABLE IF NOT EXISTS llm_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  purpose VARCHAR(128) NOT NULL,
  ticker VARCHAR(32),
  job_id VARCHAR(128),
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
