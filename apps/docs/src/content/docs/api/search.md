---
title: Search language
description: The query language the Explorer and the public API share, with its fields, operators and limits.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published, and no instance is hosted
yet. This page describes the behaviour the code already has, so the shape of the
API is clear.
:::

One language, used by the Explorer in the dashboard, by `q` on
[`/v1/logs` and `/v1/histogram`](/docs/api/reference/), and by the condition of
an [alert rule](/docs/guides/alerts/).

```
timeout                              a word in the message
"payment failed"                     an exact phrase in the message
level:error service:api              fields; a space means AND
level:(error OR fatal)               several values
service:api-*                        prefix
-level:debug                         negation
@orderId:123                         an attribute
@status>=500                         a numeric comparison on an attribute
(service:api OR service:web) -level:debug
```

## Fields

`level`, `service`, `release`, `source`, `env`, `trace`, `span`, `session`,
`user`, `issue`, and any attribute with `@`.

Anything else is an error that tells you **where in the text** it gave up, so a
long query says which part is wrong rather than failing as a whole.

:::note[`env:` on the public API]
A secret key already names exactly one environment, so `env:` there is refused
with a `400` rather than quietly matching nothing. In the dashboard, where a
session can see several environments, it works and takes the environment's
**name**.
:::

## Operators

| | |
|---|---|
| Space, or `AND` | both |
| `OR` | either |
| `-` or `NOT` | not this |
| `( … )` | grouping, up to 5 levels |
| `*` at the end of a value | prefix |
| `>`, `>=`, `<`, `<=` | numeric, on `@attributes` only |

A bare word matches a **whole word** in the message, case-insensitively. A
quoted `"phrase"` matches that text anywhere in the message, which is slower but
finds `api.timeout` — a bare `timeout` will not, because word search stops at
separators.

## Limits

| | |
|---|---|
| Length | 1000 characters |
| Conditions | 20 |
| Nesting | 5 levels of parentheses |

They are there so one query cannot cost everyone else their ClickHouse. A query
over any of them is refused before it runs, not killed halfway.

## What happens to your text

It becomes a syntax tree and then **SQL with bound parameters, always**. Nothing
you type is ever pasted into a statement — including the **name** of an
attribute: `@orderId` compiles to `attributes[{p1:String}]`, never
`attributes['orderId']`. That is the one place interpolation would be an
injection, since `@a'] OR 1=1 --:x` closes the bracket, and it is a parameter
like everything else.

The project, the environment and the period are added by the server, after your
filter and around it. There is no query you can write that widens them.

The parser is [fuzzed](https://fast-check.dev/) and the compiled API is scanned
with OWASP ZAP; its SQL injection rules pass.
