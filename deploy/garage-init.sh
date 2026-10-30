#!/bin/sh
set -eu

ADMIN="http://garage:3903"

api() {
  method=$1
  path=$2
  body=${3:-}
  if [ -n "$body" ]; then
    curl -sS --fail-with-body -X "$method" -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
      -H "Content-Type: application/json" -d "$body" "$ADMIN$path"
  else
    curl -sS --fail-with-body -X "$method" -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" "$ADMIN$path"
  fi
}

first_hex64() {
  sed -n 's/.*"\([0-9a-f]\{64\}\)".*/\1/p' | head -n 1
}

node_id=$(api GET /v2/GetClusterStatus | tr ',' '\n' | grep -o '"[0-9a-f]\{64\}"' | tr -d '"' | head -n 1)

if [ -z "$node_id" ]; then
  echo "garage-init: could not read the node id" >&2
  api GET /v2/GetClusterStatus >&2
  exit 1
fi

layout_version=$(api GET /v2/GetClusterLayout | tr ',' '\n' | sed -n 's/.*"version":\([0-9]*\).*/\1/p' | head -n 1)

if [ "${layout_version:-0}" = "0" ]; then
  api POST /v2/UpdateClusterLayout \
    "{\"roles\":[{\"id\":\"$node_id\",\"zone\":\"dev\",\"capacity\":1000000000,\"tags\":[]}]}" > /dev/null
  api POST /v2/ApplyClusterLayout '{"version":1}' > /dev/null
  echo "garage-init: layout applied for node $node_id"
fi

if ! api GET "/v2/GetBucketInfo?globalAlias=${R2_BUCKET}" > /dev/null 2>&1; then
  api POST /v2/CreateBucket "{\"globalAlias\":\"${R2_BUCKET}\"}" > /dev/null
  echo "garage-init: created bucket '${R2_BUCKET}'"
fi

if ! api GET "/v2/GetKeyInfo?id=${R2_ACCESS_KEY_ID}" > /dev/null 2>&1; then
  if ! api POST /v2/ImportKey \
    "{\"accessKeyId\":\"${R2_ACCESS_KEY_ID}\",\"secretAccessKey\":\"${R2_SECRET_ACCESS_KEY}\",\"name\":\"nekolog-dev\"}" \
    > /dev/null; then
    echo "garage-init: ImportKey failed. Garage requires an access key id of 'GK' plus 24 hex characters and a secret of exactly 64 hex characters; check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env" >&2
    exit 1
  fi
  echo "garage-init: imported key '${R2_ACCESS_KEY_ID}'"
fi

bucket_id=$(api GET "/v2/GetBucketInfo?globalAlias=${R2_BUCKET}" | first_hex64)

if [ -z "$bucket_id" ]; then
  echo "garage-init: could not resolve the id of bucket '${R2_BUCKET}'" >&2
  api GET "/v2/GetBucketInfo?globalAlias=${R2_BUCKET}" >&2
  exit 1
fi

api POST /v2/AllowBucketKey \
  "{\"bucketId\":\"$bucket_id\",\"accessKeyId\":\"${R2_ACCESS_KEY_ID}\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" \
  > /dev/null

echo "garage-init: bucket '${R2_BUCKET}' ready for key '${R2_ACCESS_KEY_ID}'"
