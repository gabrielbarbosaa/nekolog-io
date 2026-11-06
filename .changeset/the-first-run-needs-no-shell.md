---
'@internal/self-host': patch
---

The first run of the self-host stack no longer needs a shell or `openssl`.
`pnpm self-host:up` writes `deploy/self-host/.env` with secrets from
`node:crypto`, reads each app's version from its own `package.json` and runs
`docker compose up -d --build`, which is what makes a first run work on Windows.
`up.sh` stays for the machine, and a test fails if the two stop writing the same
variables with the same defaults.
