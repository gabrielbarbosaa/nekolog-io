---
title: Referencia de la API pública
description: Lee tus logs, su histograma y tus issues con una key secreta, y registra lo que desplegaste.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado, y todavía no hay instancia
alojada. Esta página describe el comportamiento que el código ya tiene, para que
la forma de la API quede clara.
:::

Todo lo que el dashboard muestra lo puedes leer por tu cuenta. La API sirve su
propio documento OpenAPI en `/openapi.json`, construido contra el origen desde
el que lo pediste, así que puedes apuntar un generador o
[OWASP ZAP](https://www.zaproxy.org/) directamente a él.

```bash
curl https://api.nekolog.io/v1/logs?limit=20 \
  -H "Authorization: Bearer $NEKOLOG_KEY"
```

## La key decide lo que ves

Una key secreta nombra exactamente un proyecto y un entorno. El servidor toma el
alcance de la key y de nada más — no existe un parámetro `project`, y no va a
existir. Para leer otro entorno, usa la key de ese entorno.

| | |
|---|---|
| Cabecera | `Authorization: Bearer nekolog_sk_…` |
| Lectura | necesita el scope `logs:read` |
| Escritura | necesita `logs:write`, y rechaza una key pública por su prefijo |

Tres cosas se rechazan antes que cualquier otra:

- **Una key en la URL.** `?key=…` se rechaza con `secret_key_in_url`, aunque
  esté vacía, aunque venga junto a una cabecera válida — y su hash ni siquiera
  se calcula. La ingesta acepta `?key=` en un solo camino, porque
  `navigator.sendBeacon` no puede enviar una cabecera mientras una página se
  descarga. Aquí nada es un beacon.
- **Una key pública.** Va en el bundle de todos los navegadores.
- **`env:` dentro de una búsqueda.** La key ya nombra un entorno. Un filtro que
  en silencio no hace nada se lee como un filtro que funciona, así que esto es un
  `400` y no un encogerse de hombros.

## Rutas

Solo `GET` está enrutado en las rutas de lectura, así que un `POST /v1/logs` es
un `404` y no un error de método.

| Ruta | Qué hace |
|---|---|
| `GET /health` | Si este despliegue está en pie, y qué versión es. No necesita key. |
| `GET /openapi.json` | Esta API, descrita. No necesita key. |
| `GET /v1/logs` | Búsqueda. |
| `GET /v1/histogram` | Conteos por cubo y por nivel, para un gráfico. |
| `GET /v1/issues` | Errores agrupados por fingerprint. |
| `POST /v1/releases` | Registra que una versión salió. |
| `POST /v1/sourcemaps` | Sube un `.map` de una release. |

### `GET /v1/logs`

| Parámetro | |
|---|---|
| `from`, `to` | ISO 8601 o epoch en milisegundos. Por defecto, la última hora. |
| `q` | Una [búsqueda](/docs/es/api/search/). |
| `limit` | 1 a 1000, por defecto 100. |
| `order` | `newest` (por defecto) u `oldest`. |

### `GET /v1/histogram`

Toma `from`, `to` y `q`, más `bucket`: uno de `1m`, `5m`, `15m`, `1h`, `6h` o
`1d`. Un periodo que necesitaría más de 1500 puntos se rechaza — pide un cubo
más ancho o un periodo más corto.

### `GET /v1/issues`

| Parámetro | |
|---|---|
| `limit` | 1 a 200, por defecto 50. |
| `status` | `open`, `resolved` o `ignored`, repetible o separado por comas. |
| `cursor` | El `nextCursor` de la página anterior. |
| `since`, `until` | Acotan por cuándo se vio la issue por última vez. |

### Escritura

Las dos rutas de escritura son lo que llama un job de despliegue, y la
[CLI](/docs/es/guides/cli/) y el
[plugin de bundler](/docs/es/guides/bundler-plugin/) las llaman por ti.

`POST /v1/releases` toma `{ version, commit?, releasedAt? }` y es
**idempotente**: la misma versión otra vez conserva el momento en que salió por
primera vez y nunca descarta un commit que ya conoce, así que repetir el
pipeline es gratis.

`POST /v1/sourcemaps?release=<versión>&name=<archivo>.map` toma el mapa como
cuerpo. La release tiene que existir ya, el nombre es un único segmento que
cumple `^[A-Za-z0-9][A-Za-z0-9._-]*\.map$`, y el cuerpo es de 8 MB como máximo.
Volver a subir un nombre lo reemplaza sin subir el conteo, y una release guarda
como máximo 200 mapas.

## Paginación

**Las issues paginan por cursor.** Una issue tiene id, así que la lectura usa
keyset sobre `(last_seen_at, id)` y devuelve un `nextCursor`. Pásalo de vuelta
para la siguiente página; `null` significa que esa fue la última.

**Los logs paginan por periodo.** Una línea de log no tiene identidad — nada
separa dos filas escritas en el mismo milisegundo — así que no hay cursor que
darte. Estrecha `to` hasta el timestamp más antiguo que ya tengas y vuelve a
pedir. Eso es una propiedad real del dato, no un hueco en la API.

## Límites

| | |
|---|---|
| Periodo | 31 días como máximo por petición |
| Histograma | 1500 puntos como máximo |
| Tasa | 120 peticiones por minuto por key, con `Retry-After` en un `429` |

Cada respuesta lleva `Cache-Control: no-store` y
`X-Content-Type-Options: nosniff`. Nada entre tú y la API debería estar
guardando tus logs.

## Errores

El cuerpo siempre tiene la misma forma:

```json
{ "error": { "code": "invalid_query", "message": "…", "retryAfter": null } }
```

| Código | Estado | |
|---|---|---|
| `invalid_key` | 401 | Sin key, key desconocida, o una pública. |
| `secret_key_in_url` | 401 | La key iba en la query string. |
| `insufficient_scope` | 403 | La key no puede hacer esto. |
| `invalid_query` | 400 | Un parámetro, una búsqueda o un cursor que la ruta no acepta. |
| `period_too_long` | 400 | Más de 31 días. |
| `not_found` | 404 | No existe la ruta, o este despliegue no la sirve. |
| `unsupported_media_type` | 415 | El cuerpo no es lo que la ruta lee. |
| `payload_too_large` | 413 | Por encima del límite de esa ruta. |
| `rate_limited` | 429 | Vuelve tras `retryAfter` segundos. |
| `upstream_unavailable` | 503 | El almacén de logs no respondió. |
| `internal_error` | 500 | Otra cosa. |

**Un parámetro que la ruta no tiene es un error**, no algo que se ignora. El
mensaje nombra lo que no reconoció y lo que la ruta sí acepta, para que una
errata nunca parezca una consulta que funcionó.

Un `503` responde una frase fija a propósito: la excepción real puede citar una
columna o un valor, así que va al log del servidor en vez de a ti.

## Dónde corre

La misma app sirve en Cloudflare Workers y como proceso Node normal, que es lo
que el [self-host](/docs/es/self-host/install/) levanta en el puerto 8789. En
Workers alcanza Postgres por HTTP, que es la única razón por la que un Worker
puede servir issues.
