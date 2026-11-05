---
title: Versionado y soporte
description: Qué lleva versión, qué promete un cambio en ella, y cuánto tiempo sigue funcionando una versión antigua.
---

:::caution[La 1.0 está cortada, nada se ha distribuido todavía]
Todos los paquetes están en `1.0.0` y ninguno ha llegado al registro todavía.
Las promesas de abajo son las que valen a partir de la 1.0, y valen desde la
primera versión que puedas instalar.
:::

## Qué lleva versión

| Qué | Cómo |
|---|---|
| Paquetes npm (`@nekolog-io/*`) | SemVer, con un changelog por paquete |
| Apps (`web`, `ingest`, `api`, `jobs`) | el mismo proceso de release; la versión aparece en `/health` |
| La API HTTP | en la ruta (`/v1`) |
| El payload de ingesta | el campo `schemaVersion` |
| Bases de datos | migraciones numeradas, nunca editadas tras el merge |
| Documentación | una versión por major |
| Releases | una tag y un GitHub Release, con notas y SBOM |

## Qué promete un cambio

**La API HTTP.** Un cambio incompatible pasa a `/v2`, y `/v1` sigue respondiendo
al menos seis meses. Añadir un campo a una respuesta no es incompatible, así que
lee lo que necesites e ignora el resto.

**El payload.** El servidor acepta los **dos `schemaVersion` más recientes**, que
es lo que permite a un SDK en una aplicación que nadie ha redesplegado seguir
enviando mientras ya hay uno más nuevo.

**Paquetes.** SemVer, con la lectura de siempre: un patch arregla, un minor
añade, un major puede romper. Todo lo que se vaya a quitar recibe un aviso en
consola y una entrada en el changelog **al menos un minor antes** de irse.

**Las migraciones son solo hacia delante.** Una migración ya fusionada nunca se
edita — el runner saca checksum de cada una y se niega a arrancar si un archivo
ya aplicado cambió, si hay un hueco en la numeración, o si la base de datos
recuerda una que el repositorio ya no tiene.

## Cuánto dura una versión antigua

| | |
|---|---|
| Major actual | todo |
| Major anterior | correcciones de seguridad, seis meses tras la nueva |
| `/v1` tras `/v2` | al menos seis meses |
| `schemaVersion` anterior | aceptado mientras sea uno de los dos últimos |

## Sobre qué corre

| | |
|---|---|
| Node | 22 o más nuevo |
| Bun, Deno | actuales |
| Navegadores | Baseline widely available |

Node 22, 24 y 26, Bun, Deno, Chromium, Firefox y WebKit corren la suite de tests
en cada pull request — contra el paquete **construido**, no contra el fuente,
porque eso es lo que instalas.

## Por qué tu versión nos importa

Un SDK corre dentro de tu aplicación. Eso da forma a dos reglas alrededor de las
cuales está escrito el código, y que ninguna versión va a cambiar:

- **El SDK nunca lanza hacia tu app.** Una librería de logging que tumba un
  servicio ha fallado en su única tarea.
- **`@nekolog-io/core` tiene cero dependencias de runtime**, por contrato. Los
  límites que necesita están duplicados a propósito en vez de importados, y un
  test los compara uno a uno contra el parser real para que las copias no se
  separen.
