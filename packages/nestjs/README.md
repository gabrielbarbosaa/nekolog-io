# @nekolog-io/nestjs

Módulo e interceptor do NekoLog para NestJS. O trabalho compartilhado com o
Express, o Fastify e o Hono mora no
[`@nekolog-io/node`](../node/README.md).

```ts
@Module({ imports: [NekologModule.forRoot({ service: 'pedidos' })] })
export class AppModule {}

@Controller('orders')
export class OrdersController {
  constructor(@Inject(NEKOLOG_LOGGER) private readonly log: Logger) {}
}
```

`forRoot` é global por padrão, registra o interceptor como `APP_INTERCEPTOR` e
exporta o logger no token `NEKOLOG_LOGGER`. `forRootAsync({ useFactory })` é a
mesma coisa para quem monta as opções a partir do `ConfigService`.

## O contexto atravessa a subscrição, não a chamada

Um interceptor do Nest devolve um `Observable`, e o controller só roda quando
alguém **assina** esse observable — depois de o `intercept` já ter voltado.
Abrir o `AsyncLocalStorage` em volta do `next.handle()` não resolve nada: o
handler rodaria fora.

Por isso o `intercept` devolve um `Observable` novo e faz a **assinatura**
dentro do `runWithContext`. Tem teste com três requests simultâneas conferindo
que os `request.id` não se misturam.

## Status de erro vem do erro, não da resposta

Quando o handler lança, o filtro de exceção do Nest ainda **não** ajustou o
`response.statusCode` no momento em que o interceptor é avisado — ele ainda
está em 200. Ler dali faria um 500 virar linha de `info`.

Então, no caminho de erro, o status vem do próprio erro: `getStatus()` de uma
`HttpException`, ou um campo `status`, ou 500. Só se for um código entre 400 e
599; qualquer outra coisa é 500. **Esse bug existiu e foi um teste ponta a
ponta que achou.**

## `NekologLoggerService`

Para mandar o log do próprio Nest pelo mesmo caminho:

```ts
app.useLogger(new NekologLoggerService(logger))
```

O Nest passa o contexto (`RouterExplorer`, `NestFactory`…) como último
argumento e a pilha como primeiro, num `error`. Os dois viram atributo:
`nest.context` e `stack`.

## Sem sintaxe de decorator

Este pacote não usa `@Decorator` em lugar nenhum, então não precisa de
`experimentalDecorators` nem de `emitDecoratorMetadata` para compilar. O
módulo é uma classe com métodos estáticos que devolvem `DynamicModule`, e o
interceptor é instanciado por uma factory — nenhum dos dois precisa de
metadado de decorator.

(Havia um `Module({})(NekologModule)` aqui. O harness de sabotagem mostrou que
tirar a linha não quebrava nada, e o motivo é simples: o decorator `Module` do
Nest grava um metadado por chave do objeto que recebe, e `{}` não tem chave
nenhuma. Era código morto e saiu.)

## A rota é o padrão

`GET /orders/:id 200`, com o prefixo do controller na frente. Request que não
casou com rota nenhuma vira `unmatched`.
