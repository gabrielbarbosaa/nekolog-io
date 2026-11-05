---
title: Browser
description: Instala el SDK de navegador, captura los errores que nadie capturó y mantén los datos del usuario fuera del log.
---

```bash
npm install @nekolog-io/browser
```

```ts
import { init } from '@nekolog-io/browser'

const nekolog = init({
  apiKey: import.meta.env.VITE_NEKOLOG_KEY,
  service: 'checkout-web',
  release: '1.4.2',
})

nekolog.logger.info('Checkout abierto', { step: 'payment' })
```

`init` hace cuatro cosas a la vez: crea el logger, instala los dos manejadores
globales, instala los recolectores de breadcrumbs y vacía el lote cuando la
página se va. Cada pieza también se exporta por separado (`createLogger`,
`installGlobalHandlers`, `installFlushOnHide`, `installBreadcrumbs`), y cada
`install*` devuelve la función que lo deshace.

## Usa la clave pública

Una `nekolog_sk_…` en una página es una credencial publicada: cualquiera con
"ver código fuente" la tiene. El SDK la **rechaza**, avisa por `onError`, cae a
la consola y no envía nada. No lanza excepción: tumbar la aplicación de quien se
configuró mal es peor que no enviar logs.

Usa la `nekolog_pk_…` del entorno. Es ella la que identifica proyecto y entorno,
y solo puede escribir.

## Lo que obtienes sin escribir código

| Evento | Se convierte en |
|---|---|
| `error` en `window` | log `error` con `error.kind=uncaught`, más origen, línea y columna |
| `unhandledrejection` | log `error` con `error.kind=unhandledrejection` |
| un clic | breadcrumb — `button#pay`, nunca el texto del elemento |
| una navegación | breadcrumb con la dirección nueva y la anterior |
| un `fetch` | breadcrumb con método, dirección, estado y duración |

El navegador sigue reportando por su cuenta: añadimos un listener, nunca
reemplazamos `window.onerror` y nunca llamamos a `preventDefault()`.

Los breadcrumbs viven en memoria — una cola de 20 — y viajan **solo con logs de
`error` y `fatal`**, como un único atributo de 4 KB. Pegar 4 KB a cada uno de
los 500 eventos de un lote daría un lote que la ingesta rechaza entero.

```ts
init({ breadcrumbs: { attachFrom: 'info', max: 40 } })
init({ breadcrumbs: false })
```

## La sesión, y quién es el usuario

Cada pestaña tiene una sesión: un UUID en `sessionStorage`, que vuelve a empezar
tras 30 minutos sin logs y sobrevive a una recarga.

```ts
nekolog.setUser('u_42')   // después del login
nekolog.setUser(null)     // después del logout
nekolog.resetSession()    // también al cerrar sesión
```

`setUser` acepta un identificador y nada más. **No hay dónde poner un nombre ni
un correo**, a propósito: el panel no los necesita para agrupar, y un campo
libre de usuario es exactamente por donde los datos personales se filtran a un
log. Si necesitas más, `logger.child({ attributes: … })` pasa por el filtro de
eliminación.

## La dirección de la página pierde la query string

Cada evento lleva `page.url`, y por defecto **sin query string y sin
fragmento**: ahí viajan el token de restablecimiento, el código de invitación y
el cupón. Un `?token=…` en un log es una fuga que nadie va a buscar.

```ts
init({ page: 'full' })   // con la query, si sabes qué hay ahí
init({ page: false })    // sin dirección alguna
```

## Al salir de la página

`pagehide` es el último evento que una página recibe de forma fiable, y es justo
ahí donde un `fetch` normal puede morir junto con la pestaña. Así que el lote
sale por `navigator.sendBeacon`, que el navegador entrega después de que la
página ya murió.

`sendBeacon` no manda ninguna cabecera, y por eso, y solo por eso, **la clave va
en la URL** en ese camino (`/v1/logs?key=nekolog_pk_…`); en cualquier otro envío
sigue en `Authorization`. Dos consecuencias: el lote del navegador se limita a
60 KB, que es la cuota del beacon, y un beacon rechazado cae a `fetch` con
`keepalive` en vez de perder el lote.

## Sin conexión

Un lote que no pudo salir — metro, avión, wifi de hotel — se guarda en IndexedDB
y se reenvía cuando vuelve la red, **y también en la visita siguiente**, sin
esperar ningún evento. El error que ocurrió sin conexión y cerró la pestaña
llega cuando la persona vuelve a abrir el sitio.

```ts
init({ offline: { maxBatches: 50, maxBytes: 2 * 1024 * 1024, maxAgeMs: 7 * 86_400_000 } })
init({ offline: false })
```

Solo se guarda un **fallo de transporte**. Un `400` es un rechazo que el
servidor va a repetir, así que ese lote se descarta en vez de reintentarse para
siempre. El registro guardado tiene solo `{at, url, body}`: la cabecera
`Authorization` se reconstruye con la clave vigente, porque una clave en una
base de datos del navegador es una credencial en reposo para nada.

## Renderizado en el servidor

El paquete no toca `window`, `document` ni `sessionStorage` al importarse, y
protege cada acceso. Un componente compartido entre servidor y cliente puede
importarlo y loguear desde ambos lados; en el servidor los `install*` no
instalan nada y la sesión queda en memoria.

## Siguientes pasos

- [Trazas distribuidas](/docs/es/guides/tracing/) — conecta el clic de esta
  página con la petición que provocó, y la cabecera que tu back-end tiene que
  permitir en CORS.
- [React](/docs/es/guides/react/) — provider, `useLogger` y un error boundary.
