---
title: Endpoint OTLP
description: Envía logs desde un collector o un SDK de OpenTelemetry, sin un SDK de NekoLog.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado, y todavía no hay instancia
alojada. Esta página describe el comportamiento que el código ya tiene, para que
la forma de la API quede clara.
:::

Si ya usas OpenTelemetry, no necesitas nuestro SDK. Apunta el exportador de logs
a la ingesta:

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

OTLP/HTTP con cuerpo **JSON**, `POST /v1/otlp/logs`. La codificación protobuf no
se acepta.

## No hay una segunda puerta de entrada

El registro se traduce a [el payload nativo](/docs/es/api/reference/) **antes que
cualquier otra cosa**, así que pasa exactamente por la misma validación, el
mismo fingerprint, el mismo nivel mínimo, el mismo muestreo y la misma redacción
que un lote de uno de nuestros SDK. Nada de un registro OTLP toma un atajo, y no
hay un segundo conjunto de reglas que mantener al día.

| OTLP | Se convierte en |
|---|---|
| `resource.attributes["service.name"]` | el servicio |
| `timeUnixNano` | el timestamp del evento |
| `severityNumber` | el nivel, por las bandas de cuatro de la especificación |
| `severityText` | el nivel, cuando el número cae fuera de esas bandas |
| `body.stringValue` | el mensaje |
| `attributes` | atributos, leídos tres niveles de profundidad y no más |
| `traceId`, `spanId` | el contexto de traza |

## Tres detalles que conviene saber

**`timeUnixNano` se lee como `BigInt`.** Pasó `Number.MAX_SAFE_INTEGER` en 2001,
y leerlo como float redondea un milisegundo en silencio:
`1762257600999999999` se vuelve `…601000` en vez de `…600999`. Un milisegundo
decide en qué partición diaria cae la fila, así que esto no es cosmético.

**La respuesta es un `200`, no un `202`,** y el cuerpo es el del propio OTLP:
`{ "partialSuccess": { "rejectedLogRecords": "2", "errorMessage": "…" } }`. Un
exportador lee un `202`, o un cuerpo que no reconoce, como un fallo y reintenta.

**OTLP no lleva id de lote, así que un envío reintentado escribe dos veces.**
Nuestros lotes llevan uno y se deduplican por `<entorno>:<batchId>`; OTLP no
tiene dónde ponerlo, y la especificación lo dice. Si el exactamente-una-vez te
importa, usa un SDK.

## El resto es igual

La misma key, la misma cuota, el mismo límite de tasa, el mismo techo de 512 KB
de cuerpo y los mismos códigos de error que `/v1/logs`. Una key es una key.
