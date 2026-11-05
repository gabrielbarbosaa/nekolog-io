# Contributing

Thank you for looking. This is a personal project, so read the next section
before you spend time on a change.

## What kind of project this is

NekoLog is one person's portfolio project, built end to end against a written
plan ([docs/PLANO.md](docs/PLANO.md)) and a numbered roadmap
([docs/ETAPAS.md](docs/ETAPAS.md)). **Scope decisions are the maintainer's.**
That is not a brush-off — it is so nobody writes a feature that was already
turned down for a reason recorded in an ADR.

What is genuinely welcome, in rough order of usefulness:

- **Bug reports.** Especially with a failing test, or the output of
  `docker compose logs` from a self-host that misbehaved.
- **Documentation fixes.** A wrong snippet, a stale number, a translation that
  reads badly. The documentation ships in English, Portuguese and Spanish, and
  the Spanish and Portuguese were written by a non-native speaker in one of
  them.
- **Security reports.** Privately, through
  [SECURITY.md](SECURITY.md) — never in an issue.
- **A fix for something already filed.**

Before a feature or a refactor, open an issue or a discussion. A pull request
that arrives unannounced and changes an architectural decision will probably be
closed with a link to the ADR that made it, and that is a waste of your evening.

## Getting it running

Node 24 (see `.nvmrc`), pnpm through Corepack, Docker for the services.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` brings up ClickHouse, Postgres, Valkey, Mailpit and Garage in Docker,
then starts the landing page on `:3000` and the docs on `:4321/docs`.
`pnpm dev:infra:down` tears the containers down again.

Useful commands:

| Command | What it does |
|---|---|
| `pnpm test` | every package's tests; integration tests skip when their service is not up |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm check` | Biome: format and lint, with fixes |
| `pnpm build` | every package's build |
| `pnpm lint` | `publint` and `attw` against each published tarball, plus `size-limit` |
| `pnpm seed init` | mint a project, its environments and their API keys |
| `pnpm ch:migrate` | apply the ClickHouse migrations |
| `pnpm db:migrate` | apply the Postgres migrations |

## How the repository is laid out

`packages/` is published to npm, `apps/` is deployed, `internal/` is only
meaningful inside this repository, `examples/` is what the end-to-end tests
actually run. [docs/PLANO.md](docs/PLANO.md) §18 has the map.

## What a change has to carry

A pull request merges when:

- CI is green;
- new behaviour has a test, and that test fails without the change;
- a changeset exists if a package or an app changed — `pnpm changeset`;
- user-facing strings exist in **all three** locales, which the i18n tests
  enforce;
- the documentation is updated for anything public-facing;
- and, if it touches `apps/ingest`, `packages/db` or anything that checks a
  permission, it carries the `security` label and a reviewer walked the
  [threat model](docs/security/threat-model.md).

### Conventions that will trip you up

- **No comments.** This codebase is deliberately comment-free; the explanation
  goes in a name, a smaller function, the commit message or a document under
  `docs/`. Compiler directives (`biome-ignore`, `@ts-check`) are not comments
  and stay.
- **Relative imports carry the `.ts` extension.** Node 24 runs most of this code
  with no bundler and will not resolve an extensionless specifier.
- **Commits are Conventional Commits, in English, scoped by package**:
  `feat(core): add batching transport`. Commitlint enforces it.
- **One step, one branch, one pull request**, off `dev`, prefixed `feat/`,
  `fix/`, `chore/`, `docs/`, `ci/`, `test/`, `security/`, `infra/` or `a11y/`.
  `docs/process/branching.md` has the rest.
- **Integration tests run against real services**, not mocks. A test that mocks
  ClickHouse to test a ClickHouse query is testing the mock.
- **Do not raise a `size-limit` budget to make a build pass.** Find the bytes,
  or say in the pull request that you could not.

### Where tests live and what they are expected to do

A test is expected to fail when the thing it describes breaks. Two habits this
repository has, both learned the hard way:

- **Pin a limit to the number the specification writes down**, not to another
  copy of the constant. A test written relative to the constant cannot notice
  the constant moving.
- **A fuzz suite carries a block that counts its own outcomes** and fails if the
  distribution degenerates, because a property whose precondition never holds
  passes without testing anything.

## Reporting a bug

Use the issue template. The three things that make a report actionable: what you
ran, what you expected, and what actually happened — with the error text, not a
description of it. For a self-host problem, `docker compose logs jobs` prints
one JSON line per minute naming every task that ran; that line is usually the
fastest answer.

## Translations

English is the source. `pt-BR` and `es` are translations, and the tests fail if
a page, a message key or a legal clause exists in one locale and not in the
others. A translation that is still the English sentence is a bug, and for the
documentation there is a test that catches it.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies to issues, pull requests,
discussions and anywhere else this project is discussed.
