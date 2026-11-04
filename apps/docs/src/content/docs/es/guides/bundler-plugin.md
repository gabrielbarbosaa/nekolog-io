---
title: Plugin de bundler
description: Registra la release y sube los source maps al final de cada build de producción, en Vite, webpack, Rollup o esbuild.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado. Esta página describe el
comportamiento que el código ya tiene, para que la forma de la API quede clara.
:::

`@nekolog-io/bundler-plugin` hace desde dentro del build lo que
[`nekolog releases create` y `nekolog sourcemaps upload`](/docs/es/guides/cli/)
hacen desde un script de despliegue — así nadie tiene que acordarse de
ejecutarlos, y los mapas que suben son exactamente los que el build acaba de
escribir.

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), nekolog()],
  build: { sourcemap: true },
})
```

Hay una entrada por bundler, y todas son el mismo plugin — por debajo es
[`unplugin`](https://unplugin.unjs.io/):

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'
import nekolog from '@nekolog-io/bundler-plugin/webpack'
import nekolog from '@nekolog-io/bundler-plugin/rollup'
import nekolog from '@nekolog-io/bundler-plugin/esbuild'
```

Tu bundler tiene que estar generando source maps — `sourcemap: true` en Vite y
Rollup, `devtool: 'source-map'` en webpack, `sourcemap: true` en esbuild. El
plugin sube lo que encuentra; no activa la generación de mapas por ti.

## Configuración

Todo puede venir del entorno, que es lo que un job de CI ya tiene.

| Opción | Entorno | |
|---|---|---|
| `key` | `NEKOLOG_KEY` | la key **secreta** del entorno |
| `release` | `NEKOLOG_RELEASE` | la versión que sale |
| `commit` | `NEKOLOG_COMMIT`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, `CI_COMMIT_SHA` | 7 a 40 caracteres hexadecimales en minúscula |
| `apiUrl` | `NEKOLOG_API_URL` | dónde responde la API pública |
| `dir` | — | qué recorrer, cuando el bundler no lo dice |
| `deleteAfterUpload` | — | borra del build los mapas que subieron (por defecto: no) |
| `disable`, `silent` | — | apágalo, o cállalo |

Un commit que pasas tú tiene que estar bien, y el plugin tumba el build si no lo
está. Un commit que simplemente *encontró* en una de esas variables de CI es de
mejor esfuerzo: si `GITHUB_SHA` trae una referencia de rama, la release se
registra sin commit en vez de romper tu despliegue.

## Dos reglas lo deciden todo

**Sin key no hace nada, y lo dice en una línea.** Así es un build local — nadie
tiene una key secreta en su portátil, y un build que fallara por eso sería
insoportable.

**En cuanto tiene una key, cualquier otra cosa mal tumba el build.** Una key
pública, una versión que falta, un commit mal escrito, `http://` puro hacia
fuera de esta máquina, un mapa que la API rechazó — todo eso es un error, no un
aviso. Una release registrada *sin* sus mapas es exactamente el problema que
este plugin existe para evitar, y enterarse por el stack trace minificado de un
error en producción es demasiado tarde.

## Lo que nunca hace

**Nunca toca tu código.** El plugin no tiene `transform`, ni `load`, ni
`resolveId` — solo `writeBundle`. No tiene forma de escribir la key secreta
dentro del bundle para el que está subiendo mapas, y hay un test que falla si
esos hooks aparecen.

**Nunca corre en el servidor de desarrollo.** En Vite es `apply: 'build'`, o
cada recarga se convertiría en una subida.

**Nunca lanza mientras se lee la configuración.** Nada se valida al construir el
plugin, solo al final del build, así que una key equivocada en tu `.env` no
puede impedir que arranque `vite dev`.

**Nunca sube dos veces.** En modo watch, o en un build que escribe más de una
vez, sube una vez por proceso.

**Nunca borra un mapa que no subió.** Con `deleteAfterUpload` elimina solo los
archivos cuyo nombre confirmó la API — un mapa por encima del límite de tamaño,
que la subida saltó, se queda donde está, porque nadie más tiene una copia.

## Dónde busca los mapas

Aprende el directorio del propio bundler: `build.outDir` en Vite, `output.path`
en webpack, `outdir` o `outfile` en esbuild, `dir` o `file` en Rollup. Un `dir`
explícito gana a todos; sin nada de eso, `dist`.

**No** quita el comentario `//# sourceMappingURL=` de los archivos generados, ni
siquiera con `deleteAfterUpload`. Hacerlo significaría reescribir la salida del
build, y el precio de dejarlo es un 404 en las devtools de quien abra el archivo
— no un error.

## En una configuración de webpack en CommonJS

El paquete es ESM. En un `webpack.config.js` que sigue siendo CommonJS, una
configuración asíncrona lo resuelve:

```js
module.exports = async () => ({
  devtool: 'source-map',
  plugins: [(await import('@nekolog-io/bundler-plugin/webpack')).default()],
})
```

## Después

La [guía de la CLI](/docs/es/guides/cli/) cubre las mismas dos operaciones como
comandos, que es lo que quieres cuando el build y el despliegue son jobs
distintos.
