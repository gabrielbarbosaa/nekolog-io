---
title: Introducción
description: Qué es NekoLog, cómo está armado y qué es open source.
---

NekoLog es una plataforma de logs para aplicaciones JavaScript y TypeScript, en
el front-end y en el back-end. Instalas un SDK, este agrupa tus logs por lotes y
los envía a una API de ingestión, se almacenan en ClickHouse, y los buscas y
visualizas en un dashboard — con claves de API separadas por entorno.

:::caution[En desarrollo inicial]
Todavía no se ha publicado nada en npm. Estas páginas describen el
comportamiento diseñado; consulta
[la hoja de ruta](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/ETAPAS.md)
para saber qué existe hoy.
:::

## Cómo encajan las piezas

- **Los SDKs** (`@nekolog-io/*`) recogen logs en tu aplicación y los envían por
  lotes. Nunca rompen tu aplicación y no tienen dependencias.
- **La ingestión** valida cada lote y escribe en ClickHouse. No hace nada más —
  sin agrupación, sin alertas — para mantenerse rápida.
- **Los jobs** se ejecutan cada minuto para agrupar errores en issues, evaluar
  reglas de alerta y controlar uso y cuotas.
- **El dashboard** es donde buscas logs, lees trazas y gestionas proyectos.

## Open core

Este proyecto es **open core**:

- Los SDKs, la API de ingestión, los jobs y la API pública de lectura son open
  source bajo MIT, en
  [`nekolog-io`](https://github.com/gabrielbarbosaa/nekolog-io). Puedes alojar
  todo eso por cuenta propia con Docker.
- **El dashboard es de código cerrado** y solo funciona en la instancia alojada.
  No forma parte del self-host.

Si lo alojas por cuenta propia, envías logs, los consultas con la API pública de
lectura y recibes alertas — pero no tienes la interfaz web.

## Claves y entornos

Cada proyecto tiene entornos (`production`, `staging`, `development` y otros que
crees), y cada entorno tiene sus propias claves:

- `nekolog_pk_…` — **pública**, solo escritura, segura para usar en el navegador.
- `nekolog_sk_…` — **secreta**, usada en el back-end, con ámbitos
  (`logs:write`, `logs:read`).

La clave define el entorno, así que el SDK nunca necesita la opción
`environment` y una clave de staging nunca puede escribir en producción.
