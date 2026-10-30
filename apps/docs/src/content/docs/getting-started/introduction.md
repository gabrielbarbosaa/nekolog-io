---
title: Introduction
description: What NekoLog is, how it is put together, and what is open source.
---

NekoLog is a logging platform for JavaScript and TypeScript applications, on the
front-end and on the back-end. You install an SDK, it batches your logs and sends
them to an ingestion API, they are stored in ClickHouse, and you search and chart
them in a dashboard — with separate API keys per environment.

:::caution[Early development]
Nothing has been published to npm yet. These pages describe the designed
behaviour; see [the roadmap](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/ETAPAS.md)
for what actually exists today.
:::

## How it fits together

- **SDKs** (`@nekolog-io/*`) collect logs in your app and send them in batches.
  They never throw into your application and ship with zero dependencies.
- **Ingestion** validates each batch and writes to ClickHouse. It does nothing
  else — no grouping, no alerting — so it stays fast.
- **Jobs** run every minute to group errors into issues, evaluate alert rules,
  and track usage and quotas.
- **The dashboard** is where you search logs, read traces, and manage projects.

## Open core

This project is **open core**:

- The SDKs, the ingestion API, the background jobs, and the public read API are
  open source under MIT, in
  [`nekolog-io`](https://github.com/gabrielbarbosaa/nekolog-io). You can
  self-host all of it with Docker.
- **The dashboard is closed source** and runs only on the hosted instance. It is
  not part of the self-host setup.

If you self-host, you send logs, query them through the public read API, and
receive alerts — but you do not get the web interface.

## Keys and environments

Every project has environments (`production`, `staging`, `development`, and any
others you create), and every environment has its own keys:

- `nekolog_pk_…` — **public**, write-only, safe to ship in browser code.
- `nekolog_sk_…` — **secret**, used on the back-end, with scopes
  (`logs:write`, `logs:read`).

The key determines the environment, so the SDK never needs an `environment`
option and a staging key can never write to production.
