# @nekolog-io/next

SDK do NekoLog para Next.js: `register()` no `instrumentation.ts` para o
servidor, e o provider do React para o cliente.

```ts
// instrumentation.ts
import { register as nekolog } from '@nekolog-io/next'

export function register() {
  nekolog({ service: 'loja' })
}

export { onRequestError } from '@nekolog-io/next'
```

```tsx
// app/providers.tsx
'use client'
import { NekologProvider } from '@nekolog-io/next/client'

export function Providers({ children }: { children: React.ReactNode }) {
  return <NekologProvider apiKey={process.env.NEXT_PUBLIC_NEKOLOG_KEY}>{children}</NekologProvider>
}
```

## Duas entradas, e isso não é organização

`@nekolog-io/next` é servidor; `@nekolog-io/next/client` é navegador. A entrada
do servidor puxa `node:async_hooks` pelo `@nekolog-io/node` — num bundle de
cliente isso quebra. A do cliente é marcada `'use client'` e não importa nada
de Node.

Importar a errada quebra na hora, que é melhor do que quebrar em produção.

## `register()`

Roda uma vez por processo, mesmo chamado de novo — o Next chama o
`instrumentation.ts` em mais de um lugar, e dois loggers seriam dois conjuntos
de hooks no `process`.

No runtime `nodejs` sai um logger do `@nekolog-io/node`, com os hooks de
`uncaughtException`, `unhandledRejection` e `SIGTERM`. No runtime `edge` sai um
logger de core com `runtime: 'edge'` e **sem** hooks: não existe `process` para
prender ali. A decisão vem do `NEXT_RUNTIME`, e um valor que não seja `edge`
nem `nodejs` é tratado como `nodejs`, não como ele mesmo.

`unregister()` desfaz, para teste e para quem encerra o processo na mão.

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
`Authorization`, e tem teste conferindo que nenhum dos dois aparece. O caminho
perde a query pelo mesmo motivo do `page.url` do browser.

Se o logger falhar, o handler **não** joga a exceção de volta para o Next: o
erro que estava sendo tratado é mais importante do que o nosso.

## O resto

Contexto por request (`runWithContext`), `traceparent` e os hooks de processo
vêm do [`@nekolog-io/node`](../node/README.md); provider, `useLogger` e
`ErrorBoundary` vêm do [`@nekolog-io/react`](../react/README.md). Este pacote
só junta os dois no formato que o Next espera.
