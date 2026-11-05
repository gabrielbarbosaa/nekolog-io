---
title: Introducción
description: Qué es NekoLog, cómo está armado y qué recibes.
---

NekoLog es una plataforma de logs para aplicaciones JavaScript y TypeScript, en
el front-end y en el back-end. Instalas un SDK, este agrupa tus logs por lotes y
los envía a una API de ingestión, se almacenan en ClickHouse, y los buscas y
visualizas en un dashboard — con claves de API separadas por entorno.

:::caution[Por invitación]
No hay registro abierto. Una invitación da acceso al panel y a los paquetes;
[escríbenos](mailto:contato@nekolog.io) si quieres una.
:::

## Cómo encajan las piezas

- **Los SDKs** (`@nekolog-io/*`) recogen logs en tu aplicación y los envían por
  lotes. Nunca rompen tu aplicación y no tienen dependencias.
- **La ingestión** valida cada lote y escribe en ClickHouse. No hace nada más —
  sin agrupación, sin alertas — para mantenerse rápida.
- **Los jobs** se ejecutan cada minuto para agrupar errores en issues, evaluar
  reglas de alerta y controlar uso y cuotas.
- **El dashboard** es donde buscas logs, lees trazas y gestionas proyectos.

## Qué recibes

Dos cosas, y no ejecutas ninguna de las dos:

- **El SDK de tu stack**, instalado dentro de tu propia aplicación. Es la única
  parte de NekoLog que corre de tu lado.
- **Un acceso al dashboard**, donde buscas tus logs, lees trazas, ves issues y
  configuras alertas.

Todo lo demás — la ingestión, el almacenamiento, los jobs — corre en nuestra
instancia. No hay nada que desplegar, nada que mantener en pie y ninguna base
de datos tuya que dimensionar.

NekoLog es software propietario. El SDK es tuyo para instalarlo y embarcarlo en
tu aplicación; no es tuyo para republicarlo ni para montar un servicio de logs.
Los términos completos vienen con el contrato.

Si prefieres no usar nuestros SDKs, la ingestión habla
[OTLP/HTTP](/docs/es/api/otlp/) y tu exportador OpenTelemetry actual puede
apuntar directamente a ella.

## Claves y entornos

Cada proyecto tiene entornos (`production`, `staging`, `development` y otros que
crees), y cada entorno tiene sus propias claves:

- `nekolog_pk_…` — **pública**, solo escritura, segura para usar en el navegador.
- `nekolog_sk_…` — **secreta**, usada en el back-end, con ámbitos
  (`logs:write`, `logs:read`).

La clave define el entorno, así que el SDK nunca necesita la opción
`environment` y una clave de staging nunca puede escribir en producción.
