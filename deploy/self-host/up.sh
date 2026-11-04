#!/bin/sh
set -eu

cd "$(dirname "$0")"

if ! command -v openssl >/dev/null 2>&1; then
  echo "I need openssl to generate the secrets. Install it, or write .env by hand from .env.example." >&2
  exit 1
fi

if [ -f .env ]; then
  echo "using the .env that is already here"
else
  echo "writing .env with freshly generated secrets"
  umask 077
  {
    echo "CLICKHOUSE_DEFAULT_PASSWORD=$(openssl rand -hex 24)"
    echo "CLICKHOUSE_READ_PASSWORD=$(openssl rand -hex 24)"
    echo "CLICKHOUSE_INSERT_PASSWORD=$(openssl rand -hex 24)"
    echo "CLICKHOUSE_JOBS_PASSWORD=$(openssl rand -hex 24)"
    echo "CLICKHOUSE_MIGRATOR_PASSWORD=$(openssl rand -hex 24)"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "NEKOLOG_CONSOLE_URL=${NEKOLOG_CONSOLE_URL:-https://localhost}"
    echo "INGEST_PUBLISH=${INGEST_PUBLISH:-8787}"
    echo "JOBS_PUBLISH=${JOBS_PUBLISH:-8788}"
    echo "API_PUBLISH=${API_PUBLISH:-8789}"
    echo "SEED_ENVIRONMENTS=${SEED_ENVIRONMENTS:-production}"
    echo "SEED_RETENTION_DAYS=${SEED_RETENTION_DAYS:-30}"
  } >.env
  echo "back .env up somewhere safe: ENCRYPTION_KEY cannot be recovered from the database"
fi

docker compose up -d --build

echo ""
docker compose logs bootstrap | tail -n 12
