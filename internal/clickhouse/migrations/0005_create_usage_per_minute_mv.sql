CREATE MATERIALIZED VIEW IF NOT EXISTS {{database}}.usage_per_minute_mv
TO {{database}}.usage_per_minute
AS SELECT
  project_id,
  environment_id,
  toStartOfMinute(received_at) AS minute,
  count() AS events
FROM {{database}}.logs
GROUP BY project_id, environment_id, minute
