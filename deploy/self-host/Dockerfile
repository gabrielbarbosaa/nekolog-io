FROM node:24-alpine

ENV COREPACK_HOME=/opt/corepack
ENV CI=1

RUN corepack enable \
  && apk add --no-cache tini postgresql18-client age rclone

WORKDIR /app
COPY . .

RUN node -e "const f='package.json';const p=JSON.parse(require('fs').readFileSync(f,'utf8'));delete p.scripts.prepare;require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"

RUN corepack install \
  && pnpm install --frozen-lockfile --prod \
    --filter "@apps/ingest..." \
    --filter "@apps/api..." \
    --filter "@apps/jobs..." \
    --filter "@internal/seed..." \
  && pnpm install --frozen-lockfile --filter "@nekolog-io/db" \
  && rm -rf "$(pnpm store path)" ~/.cache \
  && mkdir -p /var/lib/nekolog/spool /var/lib/nekolog/kv /var/lib/nekolog/state /var/lib/nekolog/sourcemaps \
  && chown -R node:node /var/lib/nekolog /app \
  && chmod -R a+rX /opt/corepack

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/ingest/src/serve-self-host.ts"]
