# @internal/release

What a release of this repository has to carry besides the code: a CycloneDX
bill of materials for every package that goes to npm, and a check that the set
of them actually describes the release being published.

```bash
pnpm run release:sbom     # write them, then check them
pnpm run sbom:write       # only write them, into sbom/
pnpm run sbom:check       # only check what is in sbom/
```

`sbom/` is generated and gitignored. CI writes it on every pull request, so a
package that changes what it brings fails there rather than during a release.

## There is no SBOM tool here

`pnpm sbom` emits CycloneDX 1.7 from the lockfile, so this package adds no
dependency of its own and nothing has to be kept in step with pnpm's resolver.
What lives here is the part pnpm cannot do: deciding which packages are owed a
document, and refusing a set that does not match the release.

The command is **one string in the root `package.json`**, and
`sbomCommand()` in `src/sbom.ts` is the same string built from named constants.
A test asserts the two are equal, so the flags cannot drift apart. The script
cannot simply call this package instead: `pnpm sbom` is a pnpm built-in, and a
built-in cannot be spawned from Node on Windows — `pnpm` there is a `.cmd`
shim, and Node refuses to `spawn` one without a shell since CVE-2024-27980.
Letting pnpm run pnpm sidesteps that without putting a shell in the path.

## Two flags that change what the document means

**`--prod`** leaves out everything that only the build needs. A consumer
installs none of it.

**`--exclude-peers`** leaves out what the application supplies. Without it the
documents contradict each other: `@nekolog-io/express` would omit `express`,
because `packages/express` happens to keep it in `devDependencies` and `--prod`
drops it, while `@nekolog-io/next` would carry **58** components — all of Next
and React and sharp — because `packages/next` never installs `next` for itself,
so pnpm auto-installs the peer into the production graph. Same relationship,
two different answers. With the flag, every document lists exactly what that
package brings: `@nekolog-io/next` lists its four workspace dependencies.

## What the check refuses

- a published package with **no** document — a release nobody can audit;
- a document for something this release does not publish;
- a document whose version is not the version being published, which is what a
  stale `sbom/` from the version before looks like;
- a **document missing for a package that promises no runtime dependencies**,
  so the promise is never confirmed by absence.

`DEPENDENCY_FREE` lists the three packages whose zero runtime dependencies are
a stated contract — `core`, `cli` and `adapters`. Until now that promise lived
only in prose and in the fact that nobody had broken it. The lockfile answers
it now, and a transitive dependency arriving through a package they already use
fails the check.

## The licence a dependency brings with it

```bash
pnpm run licences:check
```

pipes `pnpm -r licenses list --json` into `src/licences-cli.ts`, which refuses
the GPL and AGPL families anywhere in the tree. It replaces the `deny-licenses`
half of the `dependency-review` workflow, which a private repository cannot run
without GitHub Advanced Security, and it reaches further: that action compared
only the dependencies a pull request changed.

Four decisions are worth knowing before changing it.

**The policy is a family, not a list of identifiers.** The action named six
exact SPDX ids; a manifest may say `GPL-3.0`, `GPL-2.0+` or the name written
out in words, and none of those three was on the list. `isDenied` matches
`^a?gpl` and, for free text, `GENERAL PUBLIC LICENSE` without `LESSER` —
so LGPL, which is not refused, is not caught by either rule.

**An expression is read the way SPDX means it.** `AND` binds tighter than `OR`.
A choice passes when one alternative is ours to take (`MIT OR GPL-3.0`), and a
conjunction fails when either half is refused (`MIT AND GPL-3.0`), because both
apply at once.

**The listing is piped in, never spawned.** `pnpm` on Windows is a `.cmd` shim
Node cannot `spawn` without a shell — the same constraint the SBOM command has.
Reading stdin sidesteps it, and `parseListing` strips a leading byte order mark,
which is what a PowerShell pipe can put in front of the JSON.

**A listing smaller than `MINIMUM_PACKAGES` is an error, not a pass.** Without
`-r`, `pnpm licenses list` answers for the root project alone — 116 packages
against 698 — and every one of them is permissively licensed, so the check would
pass while reading almost nothing. The count is also what catches a command that
failed before the pipe.

## The version an SDK reports

Eight packages carry `export const SDK_VERSION`, because every batch names the
SDK that sent it and the SDK cannot read its own `package.json` at runtime — it
is bundled. Only `@nekolog-io/core` had a test tying that constant to its
`package.json`; the other seven compared it to itself, which is the vacuous
shape this repository already warns about elsewhere. At 1.0.0 all seven would
have gone on reporting `0.0.0` in every event, and nothing would have said so.

```bash
pnpm run stamp-sdk-versions
```

runs after `changeset version` in all three version scripts and rewrites each
one from the package that owns it. `src/stamp.test.ts` fails if any of them
drifts, if a package declares the constant in two files, or if the set of
packages that declare it changes — the constant does not live in the same file
in all eight, which is why it is searched for rather than listed.

## The workspace list is read, not kept

`workspaceProjects()` reads the globs out of `pnpm-workspace.yaml` and then
each `package.json`, rather than carrying a second copy of the layout. Anything
without `private: true` is published, the way npm reads it. `src/workflow.test.ts`
pins what the release workflow may and may not do: an OIDC token, no npm
credential anywhere, build before publish, SBOM written before and attached
after.
