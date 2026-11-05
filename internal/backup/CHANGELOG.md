# @internal/backup

## 0.1.0

### Minor Changes

- [#144](https://github.com/gabrielbarbosaa/nekolog-io/pull/144) [`7e31d67`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7e31d67f0359495fd6b990f4b5dac012b3841615) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Back the Postgres up daily, encrypted, and prove the restore works. `pg_dump | gzip | age` is one pipe, so no readable `.sql` is ever written for somebody to forget, and the workflow checks the `age-encryption.org` header before uploading — an `age` that failed quietly would produce a file that looks like a backup and is plain text. The connection string travels in the environment, never in an argument any process on the machine can read. `expired` refuses to return the whole list: if every backup looks expired the clock is wrong, and acting on it would leave no backup at all. A `workflow_dispatch` restores the newest backup into a throwaway database and queries every table, because a backup nobody restored is hope, not a backup.
