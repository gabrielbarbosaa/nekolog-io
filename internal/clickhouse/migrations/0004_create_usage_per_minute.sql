CREATE TABLE IF NOT EXISTS {{database}}.usage_per_minute (
  project_id      LowCardinality(String),
  environment_id  LowCardinality(String),
  minute          DateTime,
  events          UInt64
) ENGINE = SummingMergeTree(events)
PARTITION BY toYYYYMM(minute)
ORDER BY (environment_id, minute, project_id)
TTL minute + toIntervalDay(90)
