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
    echo "CLICKHOUSE_BACKUP_PASSWORD=$(openssl rand -hex 24)"
    echo "CLICKHOUSE_MIGRATOR_PASSWORD=$(openssl rand -hex 24)"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "NEKOLOG_CONSOLE_URL=${NEKOLOG_CONSOLE_URL:-https://localhost}"
    echo "NEKOLOG_DOMAIN=${NEKOLOG_DOMAIN:-localhost}"
    echo "ACME_EMAIL=${ACME_EMAIL:-admin@localhost}"
    echo "INGEST_PUBLISH=${INGEST_PUBLISH:-8787}"
    echo "JOBS_PUBLISH=${JOBS_PUBLISH:-8788}"
    echo "API_PUBLISH=${API_PUBLISH:-8789}"
    echo "SEED_ENVIRONMENTS=${SEED_ENVIRONMENTS:-production}"
    echo "SEED_RETENTION_DAYS=${SEED_RETENTION_DAYS:-30}"
    echo "BACKUP_S3_ENDPOINT=${BACKUP_S3_ENDPOINT:-}"
    echo "BACKUP_S3_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY_ID:-}"
    echo "BACKUP_S3_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_ACCESS_KEY:-}"
    echo "BACKUP_AGE_RECIPIENT=${BACKUP_AGE_RECIPIENT:-}"
    echo "BACKUP_ENVIRONMENT=${BACKUP_ENVIRONMENT:-prod}"
    echo "BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}"
  } >.env
  echo "back .env up somewhere safe: ENCRYPTION_KEY cannot be recovered from the database"
fi

version_of() {
  sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "../../apps/$1/package.json" | head -n 1
}

INGEST_VERSION=$(version_of ingest)
API_VERSION=$(version_of api)
JOBS_VERSION=$(version_of jobs)
export INGEST_VERSION API_VERSION JOBS_VERSION

docker compose up -d --build

echo ""
docker compose logs bootstrap | tail -n 12
