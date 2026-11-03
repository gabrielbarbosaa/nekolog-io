---
'@nekolog-io/db': minor
---

Add the Postgres schema the jobs Worker and the dashboard share: `users`, `organizations`, `memberships`, `invites`, `projects`, `environments`, `api_keys` and `audit_log`, as Drizzle definitions plus the SQL migration drizzle-kit generates from them.

The rules live in the database, not only in the code. Two repositories write to this schema and either can grow a new path tomorrow, so the constraints are what hold for both without an agreement: every id carries its table's prefix and a 26-character Crockford ULID, an e-mail is stored lowercase, an API key column has to look like a SHA-256 digest, a public key may only write, an invite can never hand out ownership, and the audit log records a country rather than an address. Deleting an organization takes its projects, environments and keys; deleting a user only nulls the actor on its audit entries, because an audit trail that disappears with its author is not one.

`@nekolog-io/db` is the one published package here whose types come from its source rather than a generated declaration file: `pgTable` returns a type nobody writes by hand, and TypeScript 7 emits declarations through Oxc, which needs every exported value annotated. The published `src/index.ts` therefore imports no sibling file, since the consumer compiles it with its own settings, and a test fails if one appears.

The integration tests apply the shipped `.sql` to a throwaway database and try to violate each rule, so they exercise the file that runs in production rather than the schema object. A second test regenerates the migrations with drizzle-kit and fails if the schema changed without `pnpm db:generate`, and checks that every constraint the schema declares reaches the SQL by name.
