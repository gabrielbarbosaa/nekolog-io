#!/bin/sh
set -eu

echo "applying the ClickHouse migrations"
pnpm ch:migrate

echo "applying the Postgres migrations"
pnpm db:migrate

if [ -f "$SEED_FILE" ]; then
  echo "the project already exists in $SEED_FILE, leaving it alone"
  pnpm seed sync-db --file "$SEED_FILE"
  exit 0
fi

echo "minting the first project, its environments and their keys"
umask 077
pnpm seed init \
  --file "$SEED_FILE" \
  --environments "$SEED_ENVIRONMENTS" \
  --retention-days "$SEED_RETENTION_DAYS" >"$KEYS_FILE"

echo "writing the project into Postgres, so the alerts and the issues have one"
pnpm seed sync-db --file "$SEED_FILE"

echo ""
echo "The keys were written to $KEYS_FILE inside the nekolog_state volume."
echo "They are not in this log on purpose. Read them once and delete the file:"
echo ""
echo "  docker compose run --rm --entrypoint sh bootstrap -c 'cat $KEYS_FILE'"
echo "  docker compose run --rm --entrypoint sh bootstrap -c 'rm $KEYS_FILE'"
echo ""
