---
title: React
description: Provider, useLogger e um error boundary que loga o que quebrou.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

```bash
npm install @nekolog-io/react
```

```tsx
import { ErrorBoundary, NekologProvider, useLogger } from '@nekolog-io/react'

export function App() {
  return (
    <NekologProvider apiKey={import.meta.env.VITE_NEKOLOG_KEY} service="checkout-web">
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

Tudo do [guia do browser](/docs/pt-br/guides/browser/) vale aqui — sessão,
breadcrumbs, fila offline, `traceparent`, `setUser`, o flush no `pagehide`.
Este pacote só acrescenta o que é do React.

## Um SDK por página, não um por provider

O `NekologProvider` não cria um cliente por montagem: ele pega o cliente da
página, que existe uma vez só. Dois providers aninhados, o modo estrito do React
renderizando tudo duas vezes, uma rota que desmonta e remonta — em todos esses
casos é o mesmo cliente, com os mesmos handlers globais instalados uma vez.

É por isso que desmontar o provider **não fecha nada**. A página continua sendo
a página, e os handlers de erro global e o flush no `pagehide` continuam
valendo. Quem quiser mesmo encerrar chama `closeClient()` — é o que os testes
fazem entre um caso e outro.

```tsx
<NekologProvider logger={meuLogger}>…</NekologProvider>
```

Com a prop `logger` o provider usa o que você passar e não cria cliente nenhum.
É o caminho para teste, e para quem já monta o logger em outro lugar.

## `useLogger` fora de um provider não derruba o app

Devolve um logger que escreve no console e **avisa uma vez** pelo `onError`. A
convenção do React seria lançar exceção; o contrato deste SDK é nunca lançar no
app de quem usa, e um provider esquecido não pode ser o motivo de a página em
produção ficar branca. O aviso é alto o bastante.

## `ErrorBoundary`

| | |
|---|---|
| `fallback` | o que renderizar no lugar — um nó, ou uma função `({ error, reset })` |
| `name` | vai no atributo `react.boundary`, para saber qual pedaço da tela caiu |
| `onError` | o seu handler, que **sempre** roda, mesmo se o log falhar |

O erro vira log `error` com `react.component_stack` — a pilha de componentes que
o React entrega, cortada em 2.000 caracteres para uma pilha só não ocupar todo o
orçamento de atributo. Sem `fallback`, renderiza nada, em vez de deixar o React
derrubar a árvore inteira.

```tsx
export default withErrorBoundary(Checkout, { fallback: <Opa /> })
```

## React Server Components

`useLogger` e `NekologProvider` são componentes de cliente — eles usam contexto
e estado de página. Num app com Server Components, marque o arquivo com
`'use client'`. Para o lado do servidor, use o
[`@nekolog-io/next`](/docs/pt-br/guides/next/), que liga o logger pelo
`instrumentation.ts`.
