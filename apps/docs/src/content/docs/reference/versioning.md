---
title: Versioning and support
description: What carries a version, what a change to it promises, and how long an old one keeps working.
---

:::caution[Nothing is 1.0 yet]
Every package is at `0.x` and none has been published. Until 1.0, treat anything
here as able to change — the promises below are what will hold from 1.0 on.
:::

## What carries a version

| What | How |
|---|---|
| npm packages (`@nekolog-io/*`) | SemVer, with a changelog per package |
| Apps (`web`, `ingest`, `api`, `jobs`) | the same release process; the version shows at `/health` |
| The HTTP API | in the path (`/v1`) |
| The ingestion payload | the `schemaVersion` field |
| Databases | numbered migrations, never edited after merge |
| Documentation | one version per major |
| Releases | a tag and a GitHub Release, with notes and an SBOM |

## What a change promises

**The HTTP API.** A breaking change becomes `/v2`, and `/v1` keeps answering for
at least six months. Adding a field to a response is not breaking, so read what
you need and ignore the rest.

**The payload.** The server accepts the **two most recent** `schemaVersion`
values, which is what lets an SDK in an app nobody has redeployed keep sending
while a newer one is already out.

**Packages.** SemVer, and the usual reading of it: a patch fixes, a minor adds,
a major may break. Anything being removed gets a console warning and a changelog
entry **at least one minor before** it goes.

**Migrations are forward-only.** A migration already merged is never edited —
the runner checksums each one and refuses to start if a file it has already
applied has changed, if there is a gap in the numbering, or if the database
remembers one the repository no longer has.

## How long an old version keeps working

| | |
|---|---|
| Current major | everything |
| Previous major | security fixes, for six months after the new one |
| `/v1` after `/v2` | at least six months |
| Previous `schemaVersion` | accepted while it is one of the last two |

## What it runs on

| | |
|---|---|
| Node | 22 or newer |
| Bun, Deno | current |
| Browsers | Baseline widely available |

Node 22, 24 and 26, Bun, Deno, Chromium, Firefox and WebKit all run the test
suite on every pull request — against the **built** package, not the source,
because that is what you install.

## Why your version matters to us

An SDK runs inside your application. That shapes two rules the code is built
around and that no version will change:

- **The SDK never throws into your app.** A logging library that takes a service
  down has failed at its one job.
- **`@nekolog-io/core` has zero runtime dependencies**, by contract. The limits
  it needs are deliberately duplicated rather than imported, and a test compares
  them one by one against the real parser so the copies cannot drift.
