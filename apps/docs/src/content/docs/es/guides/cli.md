---
title: nekolog init
description: Un comando que detecta el framework, instala el SDK correcto y escribe el .env.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado. Esta página describe el
comportamiento que el código ya tiene, para que la forma de la API quede clara.
:::

```bash
npx @nekolog-io/cli init
npx @nekolog-io/cli init --key nekolog_pk_… --no-install
```

Lee el `package.json` del proyecto, elige el SDK, lo instala con el gestor de
paquetes que indique el lockfile y escribe las variables de entorno.

| | |
|---|---|
| `--key <key>` | la clave a escribir, `nekolog_pk_…` o `nekolog_sk_…` |
| `--no-install` | escribe el `.env` e **imprime** el comando de instalación, en vez de ejecutarlo |
| `--cwd <path>` | dónde está el proyecto |
| `--env <file>` | qué archivo escribir (por defecto `.env`) |

## Qué elige, y por qué

El orden importa, porque un proyecto real tiene varias de estas a la vez:

| Encontró | Instala |
|---|---|
| `next` | `@nekolog-io/next` |
| `@nestjs/core` | `@nekolog-io/nestjs` |
| `fastify` / `hono` / `express` | el paquete del framework más `@nekolog-io/node` |
| `react` | `@nekolog-io/react` |
| `vite` sin react | `@nekolog-io/browser` |
| nada de eso | `@nekolog-io/node` |

`next` gana a `react` y `@nestjs/core` gana a `express`, porque en ambos casos
el de fuera es quien manda. Siempre dice **por qué** eligió.

El gestor viene del lockfile: `pnpm-lock.yaml`, `bun.lock`, `yarn.lock`,
`package-lock.json`. Sin lockfile, `npm`.

## Cuatro cosas que se niega a hacer

**Nunca sobrescribe una variable que el `.env` ya tiene.** Si `NEKOLOG_KEY` ya
está ahí, la deja en paz y lo dice. Tu clave de verdad no se cambia por un
marcador — ni por la que acabas de pasar en `--key`.

**Nunca escribe una clave secreta en una variable pública.** En un proyecto Next
pide las dos: `NEKOLOG_KEY` para el servidor y `NEXT_PUBLIC_NEKOLOG_KEY` para el
navegador. Un `--key nekolog_sk_…` rellena solo la primera; la pública se queda
con el marcador, porque una clave secreta en una variable `NEXT_PUBLIC_` va
directa al bundle.

**No escribe nada si la clave no parece una clave.** La validación ocurre
*antes* de la primera escritura, así que un `--key` equivocado no deja medio
archivo escrito.

**No ejecuta nada a través de un shell.** El gestor se arranca con una lista de
argumentos y `shell: false`.

También rechaza una carpeta sin `package.json` en vez de inventarse un proyecto.
Si la instalación falla, el `.env` **queda escrito** y el mensaje dice qué falta
por ejecutar.

## Registrar una versión publicada

```bash
npx @nekolog-io/cli releases create 1.4.2 --commit "$(git rev-parse HEAD)"
```

Lee la clave de `--key` o de `NEKOLOG_KEY`, y la clave ya dice a qué proyecto y
a qué entorno pertenece la release — nunca pasas ninguno de los dos.

| | |
|---|---|
| `--key <clave>` | la clave **secreta** del entorno (por defecto: `$NEKOLOG_KEY`) |
| `--commit <sha>` | 7 a 40 caracteres hexadecimales en minúscula |
| `--at <momento>` | cuándo salió, ISO 8601 (por defecto: ahora) |
| `--api <url>` | dónde responde la API pública (por defecto: `https://api.nekolog.io`) |

Ponlo al final del job de despliegue. Es **idempotente**: volver a ejecutarlo
para la misma versión no cambia nada, conserva el momento en que esa versión
salió por primera vez y nunca descarta un commit que ya conoce, así que repetir
un pipeline es inofensivo y el código de salida sigue significando lo que dice.

Tres cosas rechaza **antes de abrir un socket**, para que un error nunca ponga
tu clave en la red:

- **una clave pública**, porque viaja en cada bundle del navegador;
- **un commit que no es lo que imprime `git rev-parse`** — en mayúsculas,
  demasiado corto o no hexadecimal;
- **HTTP plano hacia cualquier sitio que no sea esta máquina.** Una clave
  secreta en claro es una clave secreta regalada. Apunta `--api` a `https://…`,
  o pon un proxy inverso con certificado delante de tu self-host.
  `http://localhost` se permite, porque nada sale de la máquina.

## Subir source maps

```bash
npx @nekolog-io/cli sourcemaps upload 1.4.2 --dir dist
```

Registra la versión antes — la subida rechaza una versión que este entorno nunca
vio, para que el conteo en la release siga siendo cierto. Luego recorre `--dir`,
toma cada `.map` que encuentra y envía uno por uno. Una ruta anidada se aplana
en un solo nombre (`assets/index.mjs.map` pasa a `assets-index.mjs.map`), y
`node_modules` y las carpetas con punto quedan fuera porque no son tu build.

| | |
|---|---|
| `--key <clave>` | la clave **secreta** del entorno (por defecto: `$NEKOLOG_KEY`) |
| `--dir <ruta>` | la salida del build a recorrer (por defecto: `dist`) |
| `--api <url>` | dónde responde la API pública |

Subir el mismo nombre otra vez lo reemplaza y **no** sube el conteo, así que
repetir es tan inofensivo como repetir `releases create`. Un mapa de más de 8 MB
se **omite y se nombra**, no se descarta en silencio, y una subida que el
servidor rechace detiene toda la corrida diciendo el archivo y el motivo que dio
el servidor.

:::note[Por qué el servidor no lee tu mapa entero]
Comprueba la forma — los primeros kilobytes deben abrir un objeto JSON y nombrar
`mappings` o `sections`, y un `version` declarado debe ser 3 — y guarda el resto
sin leer. Parsear megabytes de JSON no cabe en el presupuesto de CPU de un
Worker, y el mapa se parsea donde realmente se usa.
:::

Si tu build y tu despliegue son el mismo job, el
[plugin de bundler](/docs/es/guides/bundler-plugin/) hace las dos cosas desde
dentro del build, y así nadie tiene que acordarse de ejecutarlos.

## Después de ejecutarlo

Abre la guía de lo que haya instalado: [Browser](/docs/es/guides/browser/),
[React](/docs/es/guides/react/), [Next.js](/docs/es/guides/next/),
[Node.js](/docs/es/guides/node/), [Express](/docs/es/guides/express/),
[Fastify](/docs/es/guides/fastify/), [Hono](/docs/es/guides/hono/) o
[NestJS](/docs/es/guides/nestjs/).
