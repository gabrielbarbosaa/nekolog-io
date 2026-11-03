# @nekolog-io/react

SDK do NekoLog para React: tudo do
[`@nekolog-io/browser`](../browser/README.md) mais um provider, um
`ErrorBoundary` que loga o que quebrou, e o `useLogger`.

```tsx
import { ErrorBoundary, NekologProvider, useLogger } from '@nekolog-io/react'

export function App() {
  return (
    <NekologProvider apiKey="nekolog_pk_…" service="checkout-web">
      <ErrorBoundary name="checkout" fallback={<p>Algo deu errado.</p>}>
        <Checkout />
      </ErrorBoundary>
    </NekologProvider>
  )
}

function Checkout() {
  const log = useLogger()
  log.info('Checkout aberto', { step: 'payment' })
}
```

## Um SDK por página, não um por provider

`NekologProvider` não cria um cliente por montagem: ele pega o cliente da
página, que existe uma vez só. Dois providers aninhados, o modo estrito do
React renderizando tudo duas vezes, uma rota que desmonta e remonta — em todos
esses casos é o mesmo cliente, com os mesmos handlers globais instalados uma
vez.

É por isso que desmontar o provider **não** fecha nada. A página continua
sendo a página; os handlers de erro global e o flush no `pagehide` continuam
valendo. Quem quiser mesmo encerrar chama `closeClient()` — é o que os testes
fazem entre um e outro.

`<NekologProvider logger={…}>` usa o logger que você passar e não cria cliente
nenhum, que é o caminho para teste e para quem já monta o logger em outro
lugar.

## `useLogger` fora de um provider não derruba o app

Devolve um logger que escreve no console e **avisa uma vez** pelo `onError`.
A convenção do React seria lançar exceção; o contrato deste SDK é nunca lançar
no app de quem usa, e um provider esquecido não pode ser o motivo de a página
em produção ficar branca. O aviso é alto o bastante.

## `ErrorBoundary`

| | |
|---|---|
| `fallback` | o que renderizar no lugar — nó ou função `({ error, reset })` |
| `name` | vai no atributo `react.boundary`, para saber qual pedaço da tela caiu |
| `onError` | o seu handler, que **sempre** roda, mesmo se o log falhar |

O erro vira log `error` com `react.component_stack` — a pilha de componentes
que o React entrega, cortada em 2000 caracteres para uma pilha só não ocupar
todo o orçamento de atributo. Sem `fallback`, renderiza nada, em vez de deixar
o React derrubar a árvore inteira.

`withErrorBoundary(Componente, { fallback })` embrulha um componente sem você
escrever o boundary.

## Componente de servidor

`useLogger` e `NekologProvider` são componentes de cliente: eles usam contexto
e estado de página. Num app com React Server Components, marque o arquivo com
`'use client'`. A integração via `instrumentation.ts`, que cobre o servidor, é
o `@nekolog-io/next` da etapa 3.6.

## O resto

Sessão, breadcrumbs, fila offline, `traceparent`, `setUser` e o envio no
`pagehide` vêm do `@nekolog-io/browser` e estão documentados
[lá](../browser/README.md). Este pacote só acrescenta o que é do React.

Os testes renderizam React de verdade (`createRoot` e `act`) num DOM de
verdade, inclusive o modo estrito e um componente que lança de propósito.
