---
title: NestJS
description: Un módulo global, un interceptor y los propios logs de Nest por el mismo camino.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado. Esta página describe el
comportamiento que el código ya tiene, para que la forma de la API quede clara.
:::

```bash
npm install @nekolog-io/nestjs @nekolog-io/node
```

```ts
import { Module } from '@nestjs/common'
import { NekologModule } from '@nekolog-io/nestjs'

@Module({
  imports: [NekologModule.forRoot({ service: 'pedidos' })],
  controllers: [OrdersController],
})
export class AppModule {}
```

```ts
import { Controller, Get, Inject, Param } from '@nestjs/common'
import { NEKOLOG_LOGGER, type Logger } from '@nekolog-io/nestjs'

@Controller('orders')
export class OrdersController {
  constructor(@Inject(NEKOLOG_LOGGER) private readonly log: Logger) {}

  @Get(':id')
  read(@Param('id') id: string) {
    this.log.info('Pedido leído', { orderId: id })
    return { ok: true }
  }
}
```

`forRoot` es global por defecto, registra el interceptor como `APP_INTERCEPTOR`
y exporta el logger bajo el token `NEKOLOG_LOGGER`.

| Opción | |
|---|---|
| `global: false` | importa el módulo donde lo necesites, en su lugar |
| `interceptor: false` | sin contexto por petición y sin línea de acceso; solo el logger |
| todo lo demás | las [opciones del logger de Node](/docs/es/guides/node/) |

Para opciones que vienen del `ConfigService`:

```ts
NekologModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    apiKey: config.get('NEKOLOG_KEY'),
    service: 'pedidos',
  }),
})
```

## Los propios logs de Nest

```ts
const app = await NestFactory.create(AppModule)
app.useLogger(new NekologLoggerService(app.get(NEKOLOG_LOGGER)))
```

Nest pasa su contexto (`RouterExplorer`, `NestFactory`…) como último argumento y
la pila como primero en un `error`. Ambos se convierten en atributos:
`nest.context` y `stack`.

## El contexto atraviesa la suscripción, no la llamada

Un interceptor de Nest devuelve un `Observable`, y el controlador solo corre
cuando alguien se **suscribe** a él, después de que `intercept` ya retornó.
Abrir el `AsyncLocalStorage` alrededor de `next.handle()` no resuelve nada: el
handler correría fuera.

Por eso `intercept` devuelve un `Observable` nuevo y hace la **suscripción**
dentro de `runWithContext`. Hay una prueba con tres peticiones simultáneas
comprobando que los ids no se mezclan.

## El estado de error viene del error

Cuando el handler lanza, el filtro de excepciones de Nest **todavía no** ha
ajustado `response.statusCode` en el momento en que se avisa al interceptor:
sigue en 200. Leerlo de ahí convertiría un 500 en una línea de `info`.

Así que en el camino de error el estado viene del propio error: `getStatus()` de
una `HttpException`, o un campo `status`, o 500. Solo si es un código entre 400
y 599; cualquier otra cosa es 500. **Ese bug existió, y lo encontró una prueba
de extremo a extremo.**

## Sin sintaxis de decorador dentro del paquete

El paquete no usa `@Decorator` en ningún sitio, así que compila sin
`experimentalDecorators` ni `emitDecoratorMetadata`. Tu aplicación sí los usa,
claro — Nest está construido sobre ellos —, pero la dependencia no te impone la
configuración.

## Permitir `traceparent` en CORS

Un navegador de otro origen que envía `traceparent` (que es lo que hace
[el SDK de navegador](/docs/es/guides/browser/) para los destinos que
configures) dispara un preflight de CORS por esa cabecera personalizada.
Permítela:

```ts
app.enableCors({
  origin: 'https://shop.test',
  allowedHeaders: ['content-type', 'authorization', 'traceparent'],
  exposedHeaders: ['traceparent', 'x-request-id'],
})
```

`allowedHeaders` deja entrar la cabecera; `exposedHeaders` deja que la página lea
el `traceparent` y el `x-request-id` que vuelven. Mira
[Trazas distribuidas](/docs/es/guides/tracing/).
