---
title: What is stored
description: What a log line holds, what is removed before it leaves your process, what is removed on the server, and what is never written at all.
---

Logs are the most sensitive thing this platform holds, because people put things
in them by accident. This page is what the code does about that — the legal text
lives at [/legal/privacy](https://nekolog.io/legal/privacy).

## The IP address is never written

Not hashed, not truncated, not kept for a while. The row is built with the
**country** only, read from `CF-IPCountry` and validated as two characters. No
IP header is consulted anywhere on the path, and a test sends
`CF-Connecting-IP` and `X-Forwarded-For` and fails if the stored row contains
either address.

## Removed before it leaves your process

The SDK strips sensitive data **inside your application**, so it never reaches
the network:

- **by key**: `password`, `token`, `authorization`, `secret`, `cpf`, card fields
  and more, at any depth;
- **by value in text**: a `key=value` pair whose key is sensitive, a card number
  that passes the Luhn check, a CPF with a valid check digit, a JWT, `Bearer` and
  `Basic` credentials, credentials inside a URL, and a NekoLog key.

This runs **after** your `beforeSend` hook, so a hook cannot undo it.

Two more defaults worth knowing: `page.url` drops the query string and the
fragment, because reset tokens and invite codes live there; and a click
breadcrumb records `button#pay` — the selector — **never** the element's text or
value, because a label can name a person.

## Removed again on the server

Each environment can turn on named patterns, applied at ingestion **before the
row is written**: e-mail, IPv4, IPv6, Brazilian phone, CPF, CNPJ, JWT, `Bearer`,
UUID and credit card. Attributes can be blanked by exact key or by prefix.

You **cannot** supply a regular expression. The column takes names from a closed
list, and a check constraint refuses a label called `regex`, `pattern` or
`patternSource`. That is not bureaucracy: a third party's regex on the hot path
of a Worker with a 10 ms CPU budget is a denial of service you write for
yourself.

If the stored rule cannot be read, the ingestion **applies every pattern** rather
than none. A privacy control that quietly stops working is worse than one that
over-redacts.

## How long it stays

Retention is per environment, and it is enforced by the **server's** clock, not
yours. The stored `timestamp` is clamped to
`[received_at − (retention − 1h), received_at + 5min]`, and the real distance
goes to `clock_skew_ms`, so the time you sent is always
`received_at − clock_skew_ms`.

That clamp exists because the table partitions and expires by that column. A
clock set to 2099 would write into a partition no period query reaches and whose
expiry only comes due in 2099; a clock set further back than the retention makes
the row **disappear at the insert**, with nothing reported. The five minutes of
slack ahead leave ordinary NTP drift alone.

## What you can choose not to send

| | |
|---|---|
| Minimum level | per environment, enforced at ingestion |
| Sampling | per environment, a rate between 0 and 1 |

Sampling is seeded on the trace id, then the session id, so **a whole trace is
kept or dropped together** — half a trace is no use to anyone investigating.
**`error` and `fatal` are never sampled out**, whatever the rate: a rate set low
to control volume should cut the noise, not the signal.

A setting that makes no sense — an unknown level, a rate of zero or above one —
falls back to letting everything through, rather than silently dropping your
logs.

## Where it all sits

| | |
|---|---|
| Log lines | ClickHouse |
| Projects, keys, issues, alerts | Postgres, and only the key's SHA-256 hash, never the key |
| Source maps and exports | an object store |

An export link goes to the dashboard, never to the file, and the bucket deletes
it after seven days. A source map is never served back by the public API: there
is no route that reads one.
