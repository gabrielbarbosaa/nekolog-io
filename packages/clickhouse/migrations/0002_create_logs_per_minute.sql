CREATE TABLE IF NOT EXISTS {{database}}.logs_per_minute (
  project_id      LowCardinality(String),
  environment_id  LowCardinality(String),
  minute          DateTime,
  level           LowCardinality(String),
  service         LowCardinality(String),
  events          UInt64
) ENGINE = SummingMergeTree(events)
PARTITION BY toYYYYMM(minute)
ORDER BY (project_id, environment_id, minute, level, service)
