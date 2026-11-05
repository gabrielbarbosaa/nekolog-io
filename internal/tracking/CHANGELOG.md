# @internal/tracking

## 0.1.0

### Minor Changes

- [#44](https://github.com/gabrielbarbosaa/nekolog-io/pull/44) [`66339d7`](https://github.com/gabrielbarbosaa/nekolog-io/commit/66339d7acb914be3b88fc254080d01001f54af51) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the script that projects `docs/ETAPAS.md` onto GitHub: one milestone per marker, one label per branch prefix and one issue per step. Dry-run by default, idempotent, and it never deletes, renames or closes anything.

- [#137](https://github.com/gabrielbarbosaa/nekolog-io/pull/137) [`4382329`](https://github.com/gabrielbarbosaa/nekolog-io/commit/43823296eae85d769c9eb0e08aef05fe8baf53e9) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Rewrite the body of an open issue when `docs/ETAPAS.md` has moved on. The script only ever created, so the 53 issues open on 2026-11-03 still told the reader to close them with `Closes #N`, which this repository cannot do — the `close-step-issue` workflow finds the issue by branch name because GitHub only closes a linked issue from the default branch. It still never renames, closes or deletes anything, skips closed issues, keeps an item somebody ticked by hand, and normalises `\r\n` so an unchanged issue is not rewritten on every run.

### Patch Changes

- [#45](https://github.com/gabrielbarbosaa/nekolog-io/pull/45) [`a8401b2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a8401b24df5bb8a953574b47ef10158af25cd5a0) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Pass the issue body to `gh` as an argument instead of through stdin. Async `execFile` has no `input` option, so `gh issue create --body-file -` waited on a stdin that was never written and the run hung without creating anything. Every `gh` call now also has a 30 s timeout.
