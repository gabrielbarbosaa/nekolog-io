---
title: Introduction
description: What NekoLog is, how it is put together, and what you get.
---

NekoLog is a logging platform for JavaScript and TypeScript applications, on the
front-end and on the back-end. You install an SDK, it batches your logs and sends
them to an ingestion API, they are stored in ClickHouse, and you search and chart
them in a dashboard — with separate API keys per environment.

:::caution[By invitation]
There is no open sign-up. An invitation gives you a dashboard login and access
to the packages; [write to us](mailto:contato@nekolog.io) if you want one.
:::

## How it fits together

- **SDKs** (`@nekolog-io/*`) collect logs in your app and send them in batches.
  They never throw into your application and ship with zero dependencies.
- **Ingestion** validates each batch and writes to ClickHouse. It does nothing
  else — no grouping, no alerting — so it stays fast.
- **Jobs** run every minute to group errors into issues, evaluate alert rules,
  and track usage and quotas.
- **The dashboard** is where you search logs, read traces, and manage projects.

## What you get

Two things, and you run neither of them:

- **The SDK for your stack**, installed into your own application. It is the
  only part of NekoLog that runs on your side.
- **A dashboard login**, where you search your logs, read traces, see issues
  and configure alerts.

Everything else — the ingestion, the storage, the jobs — runs on our instance.
There is nothing to deploy, nothing to keep up, and no database of yours to
size.

NekoLog is proprietary software. The SDK is yours to install and to ship inside
your application; it is not yours to republish or to build a logging service
with. The full terms come with your agreement.

If you would rather not use our SDKs at all, the ingestion speaks
[OTLP/HTTP](/docs/api/otlp/) and your existing OpenTelemetry exporter can point
straight at it.

## Keys and environments

Every project has environments (`production`, `staging`, `development`, and any
others you create), and every environment has its own keys:

- `nekolog_pk_…` — **public**, write-only, safe to ship in browser code.
- `nekolog_sk_…` — **secret**, used on the back-end, with scopes
  (`logs:write`, `logs:read`).

The key determines the environment, so the SDK never needs an `environment`
option and a staging key can never write to production.
