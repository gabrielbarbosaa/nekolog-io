---
title: Endpoint OTLP
description: Mande logs de um collector ou de um SDK do OpenTelemetry, sem SDK do NekoLog.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados, e ainda não há instância
hospedada. Esta página descreve o comportamento que o código já tem, para a
forma da API ficar clara.
:::

Se você já roda OpenTelemetry, não precisa do nosso SDK. Aponte o exportador de
logs para a ingestão:

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

OTLP/HTTP com corpo **JSON**, `POST /v1/otlp/logs`. A codificação protobuf não é
aceita.

## Não existe segunda porta de entrada

O registro é traduzido para [o payload nativo](/docs/pt-br/api/reference/)
**antes de qualquer outra coisa**, então ele passa exatamente pela mesma
validação, pelo mesmo fingerprint, pelo mesmo nível mínimo, pela mesma amostragem
e pela mesma redação que um lote de um SDK nosso. Nada num registro OTLP pega
atalho, e não há um segundo conjunto de regras para manter em dia.

| OTLP | Vira |
|---|---|
| `resource.attributes["service.name"]` | o serviço |
| `timeUnixNano` | o timestamp do evento |
| `severityNumber` | o nível, pelas faixas de quatro da especificação |
| `severityText` | o nível, quando o número está fora dessas faixas |
| `body.stringValue` | a mensagem |
| `attributes` | atributos, lidos três níveis fundo e não mais |
| `traceId`, `spanId` | o contexto de trace |

## Três detalhes que valem saber

**O `timeUnixNano` é lido como `BigInt`.** Ele passou do
`Number.MAX_SAFE_INTEGER` em 2001, e ler como float arredonda um milissegundo em
silêncio — `1762257600999999999` vira `…601000` em vez de `…600999`. Um
milissegundo decide em que partição diária a linha cai, então isso não é
cosmético.

**A resposta é `200`, não `202`,** e o corpo é o do próprio OTLP:
`{ "partialSuccess": { "rejectedLogRecords": "2", "errorMessage": "…" } }`. Um
exportador lê um `202`, ou um corpo que não reconhece, como falha e retenta.

**OTLP não carrega id de lote, então um envio retentado grava duas vezes.** Os
nossos lotes carregam um e são deduplicados por `<ambiente>:<batchId>`; o OTLP
não tem onde pôr isso, e a especificação diz isso. Se exatamente-uma-vez importa
para você, use um SDK.

## O resto é igual

A mesma key, a mesma cota, o mesmo limite de taxa, o mesmo teto de 512 KB de
corpo e os mesmos códigos de erro de `/v1/logs`. Key é key.
