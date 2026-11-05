#!/bin/sh
set -eu

cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
BRANCH="${NEKOLOG_DEPLOY_BRANCH:-main}"
WAIT_SECONDS="${NEKOLOG_DEPLOY_WAIT:-180}"

fail() {
  echo "deploy: $1" >&2
  exit 1
}

cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "this is not a git work tree. The machine deploys by pulling, so it needs a clone."
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "$BRANCH" ]; then
  fail "on branch '$current_branch', not '$BRANCH'. Set NEKOLOG_DEPLOY_BRANCH to deploy another one."
fi

if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  fail "the work tree has changes. A deploy has to be reproducible from a commit; commit or discard them."
fi

before="$(git rev-parse HEAD)"

echo "deploy: fetching $BRANCH"
git fetch --quiet origin "$BRANCH"
after="$(git rev-parse "origin/$BRANCH")"

if [ "$before" = "$after" ]; then
  echo "deploy: already on $(git rev-parse --short HEAD), nothing to pull"
else
  echo "deploy: $(git rev-parse --short "$before") -> $(git rev-parse --short "$after")"
  git --no-pager log --oneline "$before..$after" | sed 's/^/  /'
  git merge --ff-only --quiet "origin/$BRANCH" ||
    fail "'$BRANCH' and the machine have diverged. Nothing was changed; look at the clone by hand."
fi

cd "$ROOT/deploy/self-host"

[ -f .env ] || fail "there is no .env here. Copy .env.example and fill it in before the first deploy."

echo "deploy: building and starting"
docker compose up -d --build --remove-orphans

waited=0
while [ "$waited" -lt "$WAIT_SECONDS" ]; do
  unhealthy="$(docker compose ps --format '{{.Service}} {{.State}}' |
    awk '$2 != "running" && $1 != "bootstrap" { print $1 }' | tr '\n' ' ')"
  if [ -z "$unhealthy" ]; then
    break
  fi
  sleep 5
  waited=$((waited + 5))
done

if [ -n "${unhealthy:-}" ]; then
  echo "deploy: these are not running after ${WAIT_SECONDS}s: $unhealthy" >&2
  docker compose logs --tail 40 $unhealthy >&2
  echo "" >&2
  fail "roll back with: git -C '$ROOT' checkout $before && $0"
fi

echo "deploy: running $(git -C "$ROOT" rev-parse --short HEAD)"
echo "deploy: roll back with: git -C '$ROOT' checkout $before && $0"
