---
title: OTLP endpoint
description: Send logs from an OpenTelemetry collector or SDK, without a NekoLog SDK.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published, and no instance is hosted
yet. This page describes the behaviour the code already has, so the shape of the
API is clear.
:::

If you already run OpenTelemetry, you do not need our SDK. Point the logs
exporter at the ingestion:

```yaml
exporters:
  otlphttp/nekolog:
    logs_endpoint: https://ingest.nekolog.io/v1/otlp/logs
    headers:
      authorization: Bearer ${NEKOLOG_KEY}

service:
  pipelines:
    logs:
      exporters: [otlphttp/nekolog]
```

OTLP/HTTP with a **JSON** body, `POST /v1/otlp/logs`. The protobuf encoding is
not accepted.

## There is no second ingestion path

The record is translated into [the native payload](/docs/api/reference/) **before
anything else happens**, so it goes through exactly the same validation,
fingerprinting, minimum level, sampling and redaction as a batch from one of our
SDKs. Nothing about an OTLP record takes a shortcut, and there is no second set
of rules to keep in step.

| OTLP | Becomes |
|---|---|
| `resource.attributes["service.name"]` | the service |
| `timeUnixNano` | the event's timestamp |
| `severityNumber` | the level, by the spec's four-wide bands |
| `severityText` | the level, when the number is outside those bands |
| `body.stringValue` | the message |
| `attributes` | attributes, read three levels deep and no further |
| `traceId`, `spanId` | the trace context |

## Three details worth knowing

**`timeUnixNano` is read as a `BigInt`.** It passed `Number.MAX_SAFE_INTEGER` in
2001, and reading it as a float silently rounds a millisecond away —
`1762257600999999999` becomes `…601000` instead of `…600999`. A millisecond
decides which daily partition a row lands in, so this is not cosmetic.

**The answer is a `200`, not a `202`,** and the body is OTLP's own
`{ "partialSuccess": { "rejectedLogRecords": "2", "errorMessage": "…" } }`.
An exporter reads a `202`, or a body it does not recognise, as a failure and
retries.

**OTLP carries no batch id, so a retried send writes twice.** Our own batches
carry one and are deduplicated on `<environment>:<batchId>`; OTLP has nowhere to
put that, and the spec says so. If exactly-once matters to you, use an SDK.

## The rest is the same

The same key, the same quota, the same rate limit, the same 512 KB body ceiling
and the same error codes as `/v1/logs`. A key is a key.
