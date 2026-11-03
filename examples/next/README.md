# examples/next

Um app Next com App Router usando o
[`@nekolog-io/next`](../../packages/next/README.md) dos dois lados:
`register()` no `instrumentation.ts` para o servidor, o provider do
`/client` para o navegador.

```bash
pnpm --filter @examples/next dev
```

| | |
|---|---|
| `NEXT_PUBLIC_NEKOLOG_KEY` | a key **pública**, que vai para o navegador |
| `NEXT_PUBLIC_NEKOLOG_ENDPOINT` | a ingestão, para o lado do cliente |
| `NEKOLOG_KEY` | a key **secreta**, que fica só no servidor |

Repare que são variáveis diferentes de propósito. O `NEXT_PUBLIC_` é o que o
Next coloca no bundle; a secreta não pode usar esse prefixo nunca.

## Um route handler não ganha contexto sozinho

Esta foi a descoberta de escrever o exemplo. No Express, no Fastify, no Hono e
no Nest existe um middleware que abre o `AsyncLocalStorage` em volta da
request. **No Next não existe esse gancho**: o `instrumentation.ts` roda uma
vez no processo, e o `proxy.ts` roda em outro runtime. Então `addContext` num
route handler não tem escopo onde escrever, e o `user_id` simplesmente não
aparecia.

A resposta é abrir o escopo você mesmo. `app/api/with-nekolog.ts` é um
envelope de dez linhas que continua o `traceparent` de quem chamou, gera o
`x-request-id`, devolve os dois nos headers da resposta e escreve a linha de
acesso no fim:

```ts
export const POST = withNekolog('/api/orders', async (request) => { … })
```

Ele está no exemplo, e não no pacote, porque a forma certa depende do app —
qual rota, quais headers, o que logar. O exemplo mostra uma que funciona.

## O que o teste cobre

O `register()` subindo o logger do servidor; o `onRequestError` logando o que
o Next entrega **sem a query string**; o route handler criando o pedido com o
`user_id` no evento e o e-mail saindo `[redacted]`; as duas linhas sob o mesmo
`request.id`; e o `traceparent` de volta na resposta.

O `next build` roda no CI e é o que prova que as duas entradas do pacote
(servidor e `/client`) não se misturam num bundle.
