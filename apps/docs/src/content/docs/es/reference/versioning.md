---
title: Versionado y soporte
description: QuÃ© lleva versiÃ³n, quÃ© promete un cambio en ella, y cuÃ¡nto tiempo sigue funcionando una versiÃ³n antigua.
---

:::caution[Nada es 1.0 todavÃ­a]
Todos los paquetes estÃ¡n en `0.x` y ninguno se ha publicado. Hasta la 1.0, trata
cualquier cosa de aquÃ­ como susceptible de cambiar â€” las promesas de abajo son
las que valdrÃ¡n a partir de la 1.0.
:::

## QuÃ© lleva versiÃ³n

| QuÃ© | CÃ³mo |
|---|---|
| Paquetes npm (`@nekolog-io/*`) | SemVer, con un changelog por paquete |
| Apps (`web`, `ingest`, `api`, `jobs`) | el mismo proceso de release; la versiÃ³n aparece en `/health` |
| La API HTTP | en la ruta (`/v1`) |
| El payload de ingesta | el campo `schemaVersion` |
| Bases de datos | migraciones numeradas, nunca editadas tras el merge |
| DocumentaciÃ³n | una versiÃ³n por major |
| Releases | una tag y un GitHub Release, con notas y SBOM |

## QuÃ© promete un cambio

**La API HTTP.** Un cambio incompatible pasa a `/v2`, y `/v1` sigue respondiendo
al menos seis meses. AÃ±adir un campo a una respuesta no es incompatible, asÃ­ que
lee lo que necesites e ignora el resto.

**El payload.** El servidor acepta los **dos `schemaVersion` mÃ¡s recientes**, que
es lo que permite a un SDK en una aplicaciÃ³n que nadie ha redesplegado seguir
enviando mientras ya hay uno mÃ¡s nuevo.

**Paquetes.** SemVer, con la lectura de siempre: un patch arregla, un minor
aÃ±ade, un major puede romper. Todo lo que se vaya a quitar recibe un aviso en
consola y una entrada en el changelog **al menos un minor antes** de irse.

**Las migraciones son solo hacia delante.** Una migraciÃ³n ya fusionada nunca se
edita â€” el runner saca checksum de cada una y se niega a arrancar si un archivo
ya aplicado cambiÃ³, si hay un hueco en la numeraciÃ³n, o si la base de datos
recuerda una que el repositorio ya no tiene.

## CuÃ¡nto dura una versiÃ³n antigua

| | |
|---|---|
| Major actual | todo |
| Major anterior | correcciones de seguridad, seis meses tras la nueva |
| `/v1` tras `/v2` | al menos seis meses |
| `schemaVersion` anterior | aceptado mientras sea uno de los dos Ãºltimos |

## Sobre quÃ© corre

| | |
|---|---|
| Node | 22 o mÃ¡s nuevo |
| Bun, Deno | actuales |
| Navegadores | Baseline widely available |

Node 22, 24 y 26, Bun, Deno, Chromium, Firefox y WebKit corren la suite de tests
en cada pull request â€” contra el paquete **construido**, no contra el fuente,
porque eso es lo que instalas.

## Por quÃ© tu versiÃ³n nos importa

Un SDK corre dentro de tu aplicaciÃ³n. Eso da forma a dos reglas alrededor de las
cuales estÃ¡ escrito el cÃ³digo, y que ninguna versiÃ³n va a cambiar:

- **El SDK nunca lanza hacia tu app.** Una librerÃ­a de logging que tumba un
  servicio ha fallado en su Ãºnica tarea.
- **`@nekolog-io/core` tiene cero dependencias de runtime**, por contrato. Los
  lÃ­mites que necesita estÃ¡n duplicados a propÃ³sito en vez de importados, y un
  test los compara uno a uno contra el parser real para que las copias no se
  separen.
