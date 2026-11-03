CREATE TABLE IF NOT EXISTS {{database}}.logs (
  project_id      LowCardinality(String),
  environment_id  LowCardinality(String),
  timestamp       DateTime64(3),
  received_at     DateTime64(3),
  level           LowCardinality(String),
  message         String,
  service         LowCardinality(String),
  release         LowCardinality(String),
  source          LowCardinality(String),
  trace_id        String,
  span_id         String,
  session_id      String,
  user_id         String,
  fingerprint     UInt64,
  error_type      String,
  stacktrace      String,
  attributes      Map(LowCardinality(String), String),
  country         LowCardinality(String),
  retention_days  UInt16,
  INDEX idx_message lower(message) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
  INDEX idx_trace   trace_id TYPE bloom_filter GRANULARITY 4
) ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (project_id, environment_id, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(retention_days)
SETTINGS non_replicated_deduplication_window = 1000
