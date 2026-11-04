---
title: Trazas distribuidas
description: Conecta un clic en el navegador con la petición que provocó — y la cabecera de CORS que lo hace posible.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado. Esta página describe el
comportamiento que el código ya tiene, para que la forma de la API quede clara.
:::

Cada log de una página lleva el mismo `trace`, y cada petición sale con una
cabecera `traceparent` del W3C — un span hijo por petición. El back-end continúa
esa traza en vez de empezar otra, y el clic en el front y la petición en el back
acaban en la misma línea de tiempo.

```
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
   └ versión       └ id de la traza        └ id del span └ flags
```

## En el navegador

```ts
init({ trace: { targets: ['api.shop.test', '.servicios.interno'] } })
init({ trace: { sameOrigin: false, targets: [/^https:\/\/api\./] } })
init({ trace: false })
```

**Por defecto, solo el propio origen.** El `traceId` es un identificador
interno: mandarlo a un tercero es una fuga pequeña pero gratuita, y una cabecera
de más en una petición entre dominios la convierte en un preflight que
simplemente puede romper la llamada. El endpoint de ingesta también queda fuera:
no tiene nada que hacer con él.

## La coincidencia es estricta a propósito

| Entrada | Coincide con |
|---|---|
| `api.shop.test` | solo ese host |
| `.shop.test` | el dominio y sus subdominios |
| `shop.test/api` o `https://shop.test/api` | ese host, en esa ruta o por debajo |
| `/^https:\/\/api\./` | lo que diga la expresión |

Un host que solo **empieza** igual (`api.shop.test.evil.test`) no coincide: la
comparación es de origen entero y host entero, nunca prefijo de texto. Un puerto
distinto es otro origen. `http:` no es `https:`. Una entrada con ruta tiene que
coincidir en una frontera de segmento. Cualquier esquema que no sea
`http`/`https` nunca recibe la cabecera.

Añadir la cabecera nunca rompe la petición. `Headers`, listas de pares, objetos
simples y un `Request` ya preparado se extienden cada uno, no se reemplazan — y
si algo sale mal al montarla, la petición sale **sin** la cabecera en vez de no
salir.

## En el servidor

Cada middleware ([Express](/docs/es/guides/express/),
[Fastify](/docs/es/guides/fastify/), [Hono](/docs/es/guides/hono/),
[NestJS](/docs/es/guides/nestjs/)) ya lee el `traceparent` entrante, continúa la
traza con un span nuevo, la ata al contexto de la petición y responde con
`traceparent` y `x-request-id`. Un `traceparent` inválido no rompe la petición:
se convierte en una traza nueva.

Para las llamadas que tu servicio **hace**:

```ts
import { installTracePropagation } from '@nekolog-io/node'

installTracePropagation({ targets: ['pedidos.interno', '.servicios.interno'] })
```

`targets` es **obligatorio, y no hay valor por defecto**. En un navegador "su
propio origen" es un valor por defecto obvio y seguro; en un servidor no existe
un origen propio, y mandar en silencio un id de traza interno a la pasarela de
pago no es lo que nadie quería. Si no lo listas, no se propaga — y eso es
preferible a propagar a todo el mundo en silencio.

La traza sale del contexto de la petición, y cada llamada lleva un span hijo,
nunca el span de la propia petición. Fuera de una petición no hay traza, y
entonces no sale ninguna cabecera.

## CORS: la parte que muerde

`traceparent` no es una cabecera de la lista segura de CORS. En el momento en
que el navegador la añade a una petición **entre orígenes**, esa petición deja
de ser simple y recibe un preflight — y si tu API no responde a ese preflight
permitiendo la cabecera, la llamada falla antes de que tu handler vea nada.

Dos cabeceras importan, y hacen cosas distintas:

| Cabecera de respuesta | Qué te da |
|---|---|
| `Access-Control-Allow-Headers: traceparent` | deja que la petición lleve la cabecera **hacia dentro**. Sin ella, la llamada falla |
| `Access-Control-Expose-Headers: traceparent, x-request-id` | deja que la página **lea** lo que volvió. Sin ella, la llamada funciona y los valores solo quedan invisibles para JavaScript |

Solo la primera es obligatoria. La segunda es la que permite mostrar un id de
petición en una pantalla de error, para que alguien lo pegue en un ticket de
soporte.

```http
Access-Control-Allow-Origin: https://shop.test
Access-Control-Allow-Headers: content-type, authorization, traceparent
Access-Control-Expose-Headers: traceparent, x-request-id
```

Cada guía de servidor tiene el fragmento de su framework:
[Express](/docs/es/guides/express/), [Fastify](/docs/es/guides/fastify/),
[Hono](/docs/es/guides/hono/), [NestJS](/docs/es/guides/nestjs/),
[Next.js](/docs/es/guides/next/).

### Si no puedes tocar la API

Deja ese host fuera de `targets`. La página conserva su traza, la petición sale
intacta, y lo único que pierdes es el enlace entre los dos lados en esa llamada.
Es mejor trato que un checkout roto.

## El muestreo no corta una petición por la mitad

Con muestreo activo y un `trace.traceId` en el contexto, la decisión viene de un
hash de la traza, no de un sorteo por evento: o entran todos los logs de esa
petición, o ninguno. Media petición en el panel no ayuda a nadie a depurar. El
muestreo nunca descarta errores — el suelo empieza en `error`.
