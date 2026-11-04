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

## Después de ejecutarlo

Abre la guía de lo que haya instalado: [Browser](/docs/es/guides/browser/),
[React](/docs/es/guides/react/), [Next.js](/docs/es/guides/next/),
[Node.js](/docs/es/guides/node/), [Express](/docs/es/guides/express/),
[Fastify](/docs/es/guides/fastify/), [Hono](/docs/es/guides/hono/) o
[NestJS](/docs/es/guides/nestjs/).
