---
title: Next.js
description: register() no servidor, o provider no cliente, e o escopo que um route handler não tem.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

```bash
npm install @nekolog-io/next
```

## O servidor

```ts
// instrumentation.ts
import { register as nekolog } from '@nekolog-io/next'

export function register() {
  nekolog({ service: 'loja' })
}

export { onRequestError } from '@nekolog-io/next'
```

O `register()` roda uma vez por processo, por mais vezes que o Next chame o
`instrumentation.ts` — dois loggers seriam dois conjuntos de hooks no
`process`. No runtime `nodejs` ele monta um [logger de Node](/docs/pt-br/guides/node/)
com os hooks de `uncaughtException`, `unhandledRejection` e `SIGTERM`; no `edge`
monta um logger de core com `runtime: 'edge'` e **sem** hooks, porque não existe
`process` para prender ali. Um `NEXT_RUNTIME` que não seja nenhum dos dois é
tratado como `nodejs`, não acreditado.

## O cliente

```tsx
// app/providers.tsx
'use client'
import { NekologProvider } from '@nekolog-io/next/client'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NekologProvider apiKey={process.env.NEXT_PUBLIC_NEKOLOG_KEY}>{children}</NekologProvider>
  )
}
```

**Duas entradas, e isso é estrutural.** O `@nekolog-io/next` é o servidor; ele
puxa `node:async_hooks` pelo `@nekolog-io/node`, o que quebra num bundle de
cliente. O `@nekolog-io/next/client` é marcado `'use client'` e não importa nada
de Node. Importar a errada quebra na hora, que é melhor do que quebrar em
produção.

A variável pública precisa da key **pública**. Uma `nekolog_sk_…` numa variável
`NEXT_PUBLIC_` vai para o bundle; o SDK recusa, mas a credencial já foi
publicada.

## `onRequestError`

O Next entrega os erros de servidor aqui. Viram log `error` com:

| Atributo | De onde vem |
|---|---|
| `http.path` | o caminho, **sem query string** |
| `http.method` | o método |
| `next.router` | `App Router` ou `Pages Router` |
| `next.route` | a rota com os colchetes, `/checkout/[step]` |
| `next.render_source`, `next.revalidate_reason` | o que o Next contou |

**Os headers nunca entram.** É ali que moram o cookie de sessão e o
`Authorization`, e tem teste conferindo que nenhum dos dois aparece. Se o logger
falhar, o handler **não** joga a exceção de volta para o Next: o erro que estava
sendo tratado é mais importante do que o nosso.

## Um route handler não tem contexto por request

Express, Fastify, Hono e Nest têm cada um um middleware que abre o
`AsyncLocalStorage`. O Next não tem esse gancho — o `instrumentation.ts` roda
uma vez por processo e o `proxy.ts` roda em outro runtime — então o `addContext`
dentro de um route handler não tem onde escrever e o id do usuário nunca
aparece.

Abra o escopo você mesmo, em umas dez linhas:

```ts
// app/api/with-nekolog.ts
import {
  accessAttributes,
  accessMessage,
  levelForStatus,
  REQUEST_ID_HEADER,
  runWithContext,
  serverLogger,
  startRequest,
  TRACEPARENT_HEADER,
} from '@nekolog-io/next'

export function withNekolog(route: string, handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const began = startRequest({
      traceparent: request.headers.get(TRACEPARENT_HEADER),
      requestId: request.headers.get(REQUEST_ID_HEADER),
    })
    const startedAt = Date.now()

    return runWithContext(began.context, async () => {
      const response = await handler(request)
      for (const [name, value] of Object.entries(began.headers)) {
        response.headers.set(name, value)
      }
      const line = {
        method: request.method,
        route,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }
      serverLogger()?.log(levelForStatus(line.status), accessMessage(line), accessAttributes(line))
      return response
    })
  }
}
```

```ts
// app/api/orders/[id]/route.ts
import { addContext } from '@nekolog-io/next'
import { withNekolog } from '../../with-nekolog.ts'

export const GET = withNekolog('/api/orders/[id]', async (request) => {
  addContext({ attributes: { userId: 'u_42' } })
  return Response.json({ ok: true })
})
```

Isso mora na sua aplicação e não no pacote porque a forma certa depende do app —
qual é o nome da rota, se você quer os headers de volta, o que fazer num erro. O
`examples/next` do repositório tem o arquivo inteiro.

## Liberando o `traceparent` no CORS

Só importa se um browser de **outra origem** chamar essas rotas — um app Next
chamando o próprio `/api` é mesma origem e não precisa de nada. Quando for entre
origens, responda ao preflight:

```ts
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': 'https://shop.test',
      'access-control-allow-headers': 'content-type, authorization, traceparent',
      'access-control-expose-headers': 'traceparent, x-request-id',
    },
  })
}
```

Veja [Trace distribuído](/docs/pt-br/guides/tracing/).

## O resto

Contexto por request, `traceparent` e os hooks de processo vêm do
[`@nekolog-io/node`](/docs/pt-br/guides/node/); provider, `useLogger` e o error
boundary vêm do [`@nekolog-io/react`](/docs/pt-br/guides/react/). Este pacote só
junta os dois no formato que o Next espera.
