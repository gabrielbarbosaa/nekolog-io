ALTER TABLE {{database}}.logs
  ADD COLUMN IF NOT EXISTS key_id LowCardinality(String) DEFAULT '' AFTER environment_id
