---
title: NestJS
description: Um módulo global, um interceptor e os logs do próprio Nest no mesmo caminho.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
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
    this.log.info('Pedido lido', { orderId: id })
    return { ok: true }
  }
}
```

O `forRoot` é global por padrão, registra o interceptor como `APP_INTERCEPTOR` e
exporta o logger no token `NEKOLOG_LOGGER`.

| Opção | |
|---|---|
| `global: false` | importe o módulo onde você precisar, em vez disso |
| `interceptor: false` | sem contexto por request e sem linha de acesso; só o logger |
| todo o resto | as [opções do logger de Node](/docs/pt-br/guides/node/) |

Para opções que vêm do `ConfigService`:

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

## Os logs do próprio Nest

```ts
const app = await NestFactory.create(AppModule)
app.useLogger(new NekologLoggerService(app.get(NEKOLOG_LOGGER)))
```

O Nest passa o contexto dele (`RouterExplorer`, `NestFactory`…) como último
argumento e a pilha como primeiro, num `error`. Os dois viram atributo:
`nest.context` e `stack`.

## O contexto atravessa a subscrição, não a chamada

Um interceptor do Nest devolve um `Observable`, e o controller só roda quando
alguém **assina** esse observable — depois de o `intercept` já ter voltado.
Abrir o `AsyncLocalStorage` em volta do `next.handle()` não resolve nada: o
handler rodaria fora.

Por isso o `intercept` devolve um `Observable` novo e faz a **assinatura**
dentro do `runWithContext`. Tem teste com três requests simultâneas conferindo
que os ids não se misturam.

## O status de erro vem do erro

Quando o handler lança, o filtro de exceção do Nest ainda **não** ajustou o
`response.statusCode` no momento em que o interceptor é avisado — ele ainda está
em 200. Ler dali faria um 500 virar linha de `info`.

Então, no caminho de erro, o status vem do próprio erro: `getStatus()` de uma
`HttpException`, ou um campo `status`, ou 500. Só se for um código entre 400 e
599; qualquer outra coisa é 500. **Esse bug existiu, e foi um teste ponta a
ponta que achou.**

## Sem sintaxe de decorator dentro do pacote

O pacote não usa `@Decorator` em lugar nenhum, então compila sem
`experimentalDecorators` nem `emitDecoratorMetadata`. A sua aplicação usa, claro
— o Nest é feito em cima deles —, mas a dependência não força a configuração em
você.

## Liberando o `traceparent` no CORS

Um browser de outra origem mandando `traceparent` (que é o que
[o SDK de browser](/docs/pt-br/guides/browser/) faz para os alvos que você
configurar) dispara um preflight de CORS por causa desse header personalizado.
Libere:

```ts
app.enableCors({
  origin: 'https://shop.test',
  allowedHeaders: ['content-type', 'authorization', 'traceparent'],
  exposedHeaders: ['traceparent', 'x-request-id'],
})
```

O `allowedHeaders` deixa o header entrar; o `exposedHeaders` deixa a página ler
o `traceparent` e o `x-request-id` que voltam. Veja
[Trace distribuído](/docs/pt-br/guides/tracing/).
