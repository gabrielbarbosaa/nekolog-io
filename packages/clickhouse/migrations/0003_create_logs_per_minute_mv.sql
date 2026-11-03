CREATE MATERIALIZED VIEW IF NOT EXISTS {{database}}.logs_per_minute_mv
TO {{database}}.logs_per_minute
AS SELECT
  project_id,
  environment_id,
  toStartOfMinute(timestamp) AS minute,
  level,
  service,
  count() AS events
FROM {{database}}.logs
GROUP BY project_id, environment_id, minute, level, service
