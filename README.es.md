# NekoLog

> Logs para aplicaciones JavaScript y TypeScript, en el front y en el back.
>
> Léelo en [English](README.md) o [Português (pt-BR)](README.pt-BR.md).

[![CI](https://github.com/gabrielbarbosaa/nekolog-io/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/gabrielbarbosaa/nekolog-io/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/gabrielbarbosaa/nekolog-io/badge)](https://scorecard.dev/viewer/?uri=github.com/gabrielbarbosaa/nekolog-io)
[![Licencia: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

NekoLog toma los logs que tu aplicación ya escribe, los agrupa en lotes, quita
lo que nunca debería salir de tu proceso y los guarda en un sitio donde se
pueden buscar. SDKs para el navegador y para Node, una API de ingesta,
ClickHouse para almacenar, trabajos en segundo plano para alertas y agrupación
de errores, y una API HTTP para leerlo todo de vuelta.

## Estado

**Versión 1.0, y honesto sobre lo que eso significa.**

- Todo en este repositorio funciona y está probado: los SDKs, la ingesta, los
  trabajos, la API pública de lectura, el sitio de documentación. `pnpm test` lo
  ejecuta, y CI lo ejecuta contra un ClickHouse real, un Postgres real, un Redis
  real y un servidor SMTP real en cada pull request.
- **Nada se ha publicado en npm todavía** y **no hay servicio alojado.** El
  workflow de publicación está listo y espera una variable de repositorio que no
  existe; la infraestructura está escrita en OpenTofu y nunca se ha aplicado. No
  hay cuenta que crear.
- **Lo que se puede hacer hoy es ejecutarlo tú mismo.** `deploy/self-host`
  levanta la plataforma entera con un comando, y para ese camino existe este
  repositorio.
- **El panel es de código cerrado** y no forma parte de este repositorio. Mira
  [Qué es abierto y qué no](#qué-es-abierto-y-qué-no).

Es un proyecto personal, hecho para correr entero en servicios de nube
gratuitos. El único coste es el dominio.

## Ejecutarlo

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

Un comando levanta ClickHouse, Postgres, la ingesta, la API de lectura y los
trabajos. Genera sus propios secretos, aplica las migraciones, crea un proyecto
con una clave de API y dice dónde se escribió esa clave. Guía completa:
[Ejecutar NekoLog por tu cuenta](https://nekolog.io/docs/es/self-host/install/).

Después basta con enviar algo:

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({ apiKey: process.env.NEKOLOG_KEY })

log.info('pedido creado', { orderId: 'ord_7f3a91', total: 219.9 })
log.error('el pago falló', new Error('gateway timeout'))
```

Y leerlo de vuelta, sin ningún panel de por medio:

```bash
curl -H "Authorization: Bearer $NEKOLOG_KEY" \
  "http://localhost:8789/v1/logs?q=level:error&limit=20"
```

`q` es un lenguaje de búsqueda, no una coincidencia de subcadena:
`level:error service:api @status>=500 "timeout"`. Está descrito por completo en
[el lenguaje de búsqueda](https://nekolog.io/docs/es/api/search/).

## Los SDKs

| Paquete | Para |
|---|---|
| [`@nekolog-io/browser`](packages/browser) | el navegador: errores no capturados, promesas rechazadas, breadcrumbs, cola sin conexión |
| [`@nekolog-io/node`](packages/node) | Node: contexto por petición, excepciones no capturadas, hooks de proceso |
| [`@nekolog-io/react`](packages/react) | provider, `useLogger`, un error boundary |
| [`@nekolog-io/next`](packages/next) | `register()` para `instrumentation.ts`, `onRequestError`, una entrada de cliente |
| [`@nekolog-io/express`](packages/express) · [`fastify`](packages/fastify) · [`hono`](packages/hono) · [`nestjs`](packages/nestjs) | middleware de petición sobre una sola implementación |
| [`@nekolog-io/pino`](packages/pino) · [`winston`](packages/winston) | puentes para el logger que ya usas |
| [`@nekolog-io/cli`](packages/cli) | `nekolog init`, releases, subida de source maps |
| [`@nekolog-io/bundler-plugin`](packages/bundler-plugin) | Vite, Rollup, webpack y esbuild: sube los mapas desde dentro del build |

Si ya usas OpenTelemetry no necesitas ninguno de ellos: la ingesta acepta
[OTLP/HTTP](https://nekolog.io/docs/es/api/otlp/) en `POST /v1/otlp/logs`.

## Cómo encajan las piezas

```
SDKs (browser / node) ──► lote por HTTPS, con gzip
         │
         ▼
   ingest (Hono, Cloudflare Workers o Node)
         │   valida · quita dato sensible · fingerprint · muestreo
         ├─► Workers KV            clave → proyecto, entorno, cuota
         └─► ClickHouse            los logs
                 ▲
   jobs (cron, cada minuto) ───────┘
         alertas · agrupación de errores · uso y cuota · exportaciones
         └─► correo, Discord, webhook

   api (solo lectura)  búsqueda · histograma · issues · releases · source maps
```

La ingesta no hace E/S más allá de la escritura. Lo que necesita una segunda
llamada de red — evaluar una alerta, montar una issue, resolver un source map —
corre en el Worker de trabajos. La ingesta nunca toca Postgres ni Redis, así que
una base de datos fría no puede sumar latencia al camino en el que tu aplicación
está esperando.

## Qué es abierto y qué no

Este repositorio es MIT y contiene los SDKs, la ingesta, los trabajos, la API
pública de lectura, la landing page y la documentación. **El panel — las
pantallas — es de código cerrado**, vive en un repositorio privado aparte y solo
corre en el servicio alojado.

Esa es la línea del open-core, y está donde está a propósito: todo lo que toca
tus datos, tu proceso y tus logs es abierto y auditable. El self-host te da
ingesta, almacenamiento, búsqueda, agrupación de errores y alertas a través de
una API HTTP; lo que no te da es una pantalla donde mirarlos. El razonamiento
está en [docs/PLANO.md](docs/PLANO.md) sección 1 y en la
[ADR 0016](docs/adr/0016-pacotes-compartilhados-no-npm.md).

## Qué hace con tus datos

- **La dirección IP nunca se guarda.** Ni con hash, ni truncada. La fila lleva
  el país, leído de una cabecera y validado como dos caracteres. Una prueba
  envía `CF-Connecting-IP` y `X-Forwarded-For` y falla si cualquiera de los dos
  llega al almacenamiento.
- **El dato sensible sale dentro de tu proceso**, antes de cualquier envío: por
  clave (`password`, `token`, `authorization`, `secret`, `cpf`, campos de
  tarjeta, a cualquier profundidad) y por valor dentro del texto (tarjetas que
  pasan Luhn, CPF con dígito válido, JWT, credenciales `Bearer`, claves de
  NekoLog). Esto corre **después** de tu propio `beforeSend`, así que el hook no
  puede deshacerlo.
- **Y otra vez en el servidor**, desde una lista cerrada de patrones por
  entorno. No puedes enviar una expresión regular — la regex de un tercero en un
  Worker con 10 ms de CPU es una denegación de servicio que escribes tú mismo.
- Un breadcrumb de clic registra `button#pay`, nunca el texto del elemento;
  `page.url` pierde la query string, porque ahí viven los tokens de
  recuperación.

[Qué se guarda](https://nekolog.io/docs/es/reference/privacy/) lo cuenta
entero.

## Números medidos, no prometidos

- **`@nekolog-io/core` no tiene dependencias de runtime**, por contrato — y
  desde la 1.0 eso ya no es prosa: cada paquete publicado sale con un inventario
  CycloneDX construido desde el lockfile, y una dependencia que llegue a `core`,
  `cli` o `adapters` hace fallar la release.
- **El SDK de navegador no cumple su propio presupuesto de tamaño.** La meta era
  5 kB con gzip; `init` está en **12,05 kB** y solo `createLogger` en **9,4 kB**.
  La mayor parte de eso es el filtro de privacidad, que no es opcional. Los
  números están fijados por `size-limit` para que no crezcan solos, y la meta
  incumplida está escrita en [docs/PLANO.md](docs/PLANO.md) sección 9 en lugar de
  redondeada hasta desaparecer.
- **El lote más grande que permite el protocolo no cabía en un Worker
  gratuito.** 500 eventos con un 20% de errores y todas las reglas de limpieza
  activas costaban **10,8 ms** de CPU contra un límite de 10 ms — invisible para
  una prueba de carga, que mide latencia. Memoizar el fingerprint por lote y
  bajar el lote por defecto del cliente a 200 eventos lo dejó en 9,1 ms y
  2,1 ms. `apps/ingest/src/budget.test.ts` lo vigila en CI.
- Node 22, 24 y 26, Bun, Deno, Chromium, Firefox y WebKit ejecutan la suite en
  cada pull request — contra el paquete **construido**, no contra el código
  fuente, porque es el construido lo que instalas.

## Documentación

[nekolog.io/docs/es](https://nekolog.io/docs/es/) — guías de cada SDK, la
referencia de la API, el lenguaje de búsqueda, OTLP, alertas, qué se guarda y la
instalación del self-host, en español, inglés y portugués.

Dentro del repositorio, tres documentos son la fuente de la verdad:

- [docs/PLANO.md](docs/PLANO.md) — el qué y el porqué: arquitectura, modelo de
  datos, APIs, seguridad, operación.
- [docs/ETAPAS.md](docs/ETAPAS.md) — el orden en que se construyó, un paso por
  rama por pull request.
- [docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) — los contratos que valen:
  payload, variables de entorno, migraciones, gramática de la búsqueda,
  fingerprint, reglas de alerta.

Además [docs/adr/](docs/adr/README.md) para el porqué de cada decisión y a qué
se renunció en ella, [docs/security/](docs/security/README.md) para el modelo de
amenazas y la lista del ASVS, y [docs/runbooks/](docs/runbooks/README.md) para
qué hacer cuando algo se rompe.

## Contribuir

[CONTRIBUTING.md](CONTRIBUTING.md) tiene la puesta en marcha, las convenciones y
lo que un cambio debe llevar para ser fusionado.
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) vale en todo el proyecto.

¿Encontraste una vulnerabilidad? No abras una issue — [SECURITY.md](SECURITY.md)
tiene el camino de reporte privado.

## Licencia

[MIT](LICENSE).
