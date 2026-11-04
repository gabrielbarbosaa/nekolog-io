ALTER TABLE {{database}}.logs
  ADD COLUMN IF NOT EXISTS clock_skew_ms Int64 DEFAULT 0 AFTER received_at
