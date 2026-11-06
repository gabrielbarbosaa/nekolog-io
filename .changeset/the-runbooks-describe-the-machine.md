---
'@internal/self-host': patch
---

The runbooks now describe the machine that exists, and a test keeps them that
way: `runbooks.test.ts` fails if a procedure names a provider this platform
stopped having, links to a file that does not exist, names a volume or a
ClickHouse role that is not declared, or mentions an environment variable
nothing declares.
